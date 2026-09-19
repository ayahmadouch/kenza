import { readFileSync } from "fs";
import path from "path";
import { pool } from "../pool";
import { parseCsv } from "./csv";

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../../../data");

const EXPECTED = {
  products: 80,
  clients: 120,
  orders: 320,
  order_items: 449,
  shipping_rates: 12,
  promotions: 12,
};

function toInt(v: string): number | null {
  if (v === "" || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBool(v: string): boolean {
  return v.trim().toLowerCase() === "oui" || v.trim().toLowerCase() === "true";
}

function toDateOrNull(v: string): string | null {
  return v && v.trim() !== "" ? v.trim() : null;
}

async function applySchema() {
  const schema = readFileSync(path.resolve(__dirname, "../schema.sql"), "utf-8");
  await pool.query(schema);
}

async function seedProducts() {
  const rows = parseCsv(path.join(DATA_DIR, "catalogue.csv"));
  for (const r of rows) {
    await pool.query(
      `INSERT INTO products (ref, modele, famille, genre, couleur, taille, matiere, saison, prix_mad, stock, delai_reassort_jours, code_barre, poids_g)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (ref) DO NOTHING`,
      [
        r.ref, r.modele, r.famille, r.genre, r.couleur, r.taille, r.matiere, r.saison,
        toInt(r.prix_mad), toInt(r.stock), toInt(r.delai_reassort_jours), r.code_barre, toInt(r.poids_g),
      ]
    );
  }
  return rows.length;
}

async function seedClients() {
  const rows = parseCsv(path.join(DATA_DIR, "clients.csv"));
  for (const r of rows) {
    await pool.query(
      `INSERT INTO clients (client_id, nom, telephone, ville, langue_preferee, premier_achat, nb_commandes, segment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id) DO NOTHING`,
      [r.client_id, r.nom, r.telephone, r.ville, r.langue_preferee, toDateOrNull(r.premier_achat), toInt(r.nb_commandes), r.segment]
    );
  }
  return rows.length;
}

async function seedOrders() {
  const rows = parseCsv(path.join(DATA_DIR, "commandes.csv"));
  for (const r of rows) {
    await pool.query(
      `INSERT INTO orders (commande_id, client_id, date, canal, statut, total_articles_mad, frais_livraison_mad, total_mad, ville_livraison, paiement, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'humain')
       ON CONFLICT (commande_id) DO NOTHING`,
      [
        r.commande_id, r.client_id, toDateOrNull(r.date), r.canal, r.statut,
        toInt(r.total_articles_mad), toInt(r.frais_livraison_mad), toInt(r.total_mad), r.ville_livraison, r.paiement,
      ]
    );
  }
  return rows.length;
}

async function seedOrderItems() {
  const rows = parseCsv(path.join(DATA_DIR, "commandes-lignes.csv"));
  for (const r of rows) {
    await pool.query(
      `INSERT INTO order_items (commande_id, ref, modele, taille, quantite, prix_unitaire_mad)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.commande_id, r.ref, r.modele, r.taille, toInt(r.quantite), toInt(r.prix_unitaire_mad)]
    );
  }
  return rows.length;
}

async function seedShipping() {
  const rows = parseCsv(path.join(DATA_DIR, "livraison.csv"));
  for (const r of rows) {
    await pool.query(
      `INSERT INTO shipping_rates (ville, frais_mad, delai_heures, paiement_a_la_livraison, retrait_boutique)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (ville) DO NOTHING`,
      [r.ville, toInt(r.frais_mad), toInt(r.delai_heures), toBool(r.paiement_a_la_livraison), toBool(r.retrait_boutique)]
    );
  }
  return rows.length;
}

async function seedPromotions() {
  const rows = parseCsv(path.join(DATA_DIR, "promotions.csv"));
  for (const r of rows) {
    await pool.query(
      `INSERT INTO promotions (ref, prix_normal_mad, prix_promo_mad, debut, fin, condition)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.ref, toInt(r.prix_normal_mad), toInt(r.prix_promo_mad), toDateOrNull(r.debut), toDateOrNull(r.fin), r.condition]
    );
  }
  return rows.length;
}

async function countRows(table: string): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

/**
 * Le seeder est idempotent (ON CONFLICT DO NOTHING sur les tables à clé
 * naturelle). order_items et orders/promotions n'ont pas de contrainte
 * d'unicité naturelle sur leur contenu : on les vide/recharge uniquement
 * s'ils sont vides, pour rester rejouable sans dupliquer au redémarrage.
 */
async function seedOnceIfEmpty(table: string, fn: () => Promise<number>) {
  const existing = await countRows(table);
  if (existing > 0) {
    console.log(`[seed] ${table}: déjà peuplé (${existing} lignes), on ne recharge pas.`);
    return;
  }
  const n = await fn();
  console.log(`[seed] ${table}: ${n} lignes lues depuis data/.`);
}

async function main() {
  console.log("[seed] Application du schéma...");
  await applySchema();

  console.log("[seed] Chargement des données (idempotent)...");
  await seedOnceIfEmpty("products", seedProducts);
  await seedOnceIfEmpty("clients", seedClients);
  await seedOnceIfEmpty("shipping_rates", seedShipping);
  await seedOnceIfEmpty("promotions", seedPromotions);
  await seedOnceIfEmpty("orders", seedOrders);
  await seedOnceIfEmpty("order_items", seedOrderItems);

  console.log("[seed] Vérification des volumes attendus (FAIL FAST si incorrect)...");
  const actual: Record<string, number> = {};
  for (const table of Object.keys(EXPECTED) as (keyof typeof EXPECTED)[]) {
    actual[table] = await countRows(table);
  }

  const problems: string[] = [];
  for (const table of Object.keys(EXPECTED) as (keyof typeof EXPECTED)[]) {
    if (actual[table] !== EXPECTED[table]) {
      problems.push(`${table}: attendu ${EXPECTED[table]}, trouvé ${actual[table]}`);
    }
  }

  console.table(actual);

  if (problems.length > 0) {
    console.error("[seed] ÉCHEC — volumes incorrects, arrêt (FAIL FAST):");
    problems.forEach((p) => console.error("  - " + p));
    process.exit(1);
  }

  console.log("[seed] OK — base conforme aux volumes attendus.");
  await pool.end();
}

main().catch((err) => {
  console.error("[seed] Erreur fatale:", err);
  process.exit(1);
});
