import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import {
  parseCsvFile,
  parseOuiNon,
  parseNullableInt,
  parseInt10,
  nullableStr,
} from "./parseCsv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Volumes attendus, vérifiés en fin de seed. Toute divergence fait échouer
 * le process bruyamment (FAIL FAST) : on ne démarre jamais l'API avec une
 * base partiellement remplie (cahier des charges §"seeder").
 */
const EXPECTED_COUNTS = {
  products: 80,
  clients: 120,
  orders: 320,
  order_items: 449,
  shipping_rates: 12,
  promotions: 12,
} as const;

type Row = Record<string, string>;

interface ProductRow {
  ref: string; modele: string; famille: string; genre: string; couleur: string;
  taille: string; matiere: string; saison: string; prix_mad: string; stock: string;
  delai_reassort_jours: string; code_barre: string; poids_g: string;
}
interface ClientRow {
  client_id: string; nom: string; telephone: string; ville: string;
  langue_preferee: string; premier_achat: string; nb_commandes: string; segment: string;
}
interface OrderRow {
  commande_id: string; client_id: string; date: string; canal: string; statut: string;
  total_articles_mad: string; frais_livraison_mad: string; total_mad: string;
  ville_livraison: string; paiement: string;
}
interface OrderItemRow {
  commande_id: string; ref: string; modele: string; taille: string;
  quantite: string; prix_unitaire_mad: string;
}
interface ShippingRow {
  ville: string; frais_mad: string; delai_heures: string;
  paiement_a_la_livraison: string; retrait_boutique: string;
}
interface PromotionRow {
  ref: string; modele: string; prix_normal_mad: string; prix_promo_mad: string;
  debut: string; fin: string; condition: string;
}

function dataPath(file: string): string {
  // data/ est monté à la racine du repo, hors de packages/db.
  return join(__dirname, "..", "..", "..", "..", "data", file);
}

async function seedProducts(client: pg.Client): Promise<void> {
  const rows = parseCsvFile<ProductRow>(dataPath("catalogue.csv"));
  for (const r of rows) {
    await client.query(
      `INSERT INTO products
        (ref, modele, famille, genre, couleur, taille, matiere, saison, prix_mad, stock, delai_reassort_jours, code_barre, poids_g)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (ref) DO NOTHING`,
      [
        r.ref,
        r.modele,
        r.famille,
        r.genre,
        r.couleur,
        r.taille,
        r.matiere,
        r.saison,
        parseInt10(r.prix_mad),
        parseInt10(r.stock),
        parseNullableInt(r.delai_reassort_jours),
        r.code_barre,
        parseInt10(r.poids_g),
      ]
    );
  }
  console.log(`[seed] products : ${rows.length} lignes lues`);
}

async function seedClients(client: pg.Client): Promise<void> {
  const rows = parseCsvFile<ClientRow>(dataPath("clients.csv"));
  for (const r of rows) {
    await client.query(
      `INSERT INTO clients
        (client_id, nom, telephone, ville, langue_preferee, premier_achat, nb_commandes, segment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id) DO NOTHING`,
      [
        r.client_id,
        r.nom,
        r.telephone,
        r.ville,
        r.langue_preferee,
        nullableStr(r.premier_achat),
        parseInt10(r.nb_commandes),
        nullableStr(r.segment),
      ]
    );
  }
  console.log(`[seed] clients : ${rows.length} lignes lues`);
}

async function seedOrders(client: pg.Client): Promise<void> {
  const rows = parseCsvFile<OrderRow>(dataPath("commandes.csv"));
  for (const r of rows) {
    await client.query(
      `INSERT INTO orders
        (commande_id, client_id, date, canal, statut, total_articles_mad, frais_livraison_mad, total_mad, ville_livraison, paiement, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'humain')
       ON CONFLICT (commande_id) DO NOTHING`,
      [
        r.commande_id,
        r.client_id,
        r.date,
        r.canal,
        r.statut,
        parseInt10(r.total_articles_mad),
        parseInt10(r.frais_livraison_mad),
        parseInt10(r.total_mad),
        r.ville_livraison,
        r.paiement,
      ]
    );
  }
  console.log(`[seed] orders : ${rows.length} lignes lues`);
}

async function seedOrderItems(client: pg.Client): Promise<void> {
  const rows = parseCsvFile<OrderItemRow>(dataPath("commandes-lignes.csv"));

  // Certaines lignes du CSV source sont intégralement identiques (même
  // commande_id/ref/taille/quantite/prix) : ce sont deux achats distincts
  // dans la même commande, pas un doublon d'import. On leur assigne un rang
  // d'occurrence croissant pour rester idempotent sans en perdre aucune.
  const occurrenceCounter = new Map<string, number>();

  for (const r of rows) {
    const naturalKey = [r.commande_id, r.ref, r.taille, r.quantite, r.prix_unitaire_mad].join("|");
    const occurrence = occurrenceCounter.get(naturalKey) ?? 0;
    occurrenceCounter.set(naturalKey, occurrence + 1);

    await client.query(
      `INSERT INTO order_items
        (commande_id, ref, modele, taille, quantite, prix_unitaire_mad, seed_occurrence)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (commande_id, ref, taille, quantite, prix_unitaire_mad, seed_occurrence) DO NOTHING`,
      [
        r.commande_id,
        r.ref,
        r.modele,
        r.taille,
        parseInt10(r.quantite),
        parseInt10(r.prix_unitaire_mad),
        occurrence,
      ]
    );
  }
  console.log(`[seed] order_items : ${rows.length} lignes lues`);
}

async function seedShippingRates(client: pg.Client): Promise<void> {
  const rows = parseCsvFile<ShippingRow>(dataPath("livraison.csv"));
  for (const r of rows) {
    await client.query(
      `INSERT INTO shipping_rates
        (ville, frais_mad, delai_heures, paiement_a_la_livraison, retrait_boutique)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (ville) DO NOTHING`,
      [
        r.ville,
        parseInt10(r.frais_mad),
        parseInt10(r.delai_heures),
        parseOuiNon(r.paiement_a_la_livraison),
        parseOuiNon(r.retrait_boutique),
      ]
    );
  }
  console.log(`[seed] shipping_rates : ${rows.length} lignes lues`);
}

async function seedPromotions(client: pg.Client): Promise<void> {
  const rows = parseCsvFile<PromotionRow>(dataPath("promotions.csv"));
  for (const r of rows) {
    await client.query(
      `INSERT INTO promotions
        (ref, prix_normal_mad, prix_promo_mad, debut, fin, condition)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (ref, debut, fin) DO NOTHING`,
      [
        r.ref,
        parseInt10(r.prix_normal_mad),
        parseInt10(r.prix_promo_mad),
        r.debut,
        r.fin,
        nullableStr(r.condition),
      ]
    );
  }
  console.log(`[seed] promotions : ${rows.length} lignes lues`);
}

async function countRows(client: pg.Client, table: string): Promise<number> {
  const res = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return res.rows[0].n;
}

/**
 * Point d'entrée du seeder. Idempotent (ré-exécutable sans erreur ni
 * doublon) et fail-fast : si les volumes finaux ne correspondent pas
 * exactement aux CSV sources, le process quitte en erreur plutôt que de
 * laisser démarrer l'API avec une base incomplète.
 */
export async function runSeeder(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await seedProducts(client);
    await seedClients(client);
    await seedOrders(client);
    await seedOrderItems(client);
    await seedShippingRates(client);
    await seedPromotions(client);

    const counts = {
      products: await countRows(client, "products"),
      clients: await countRows(client, "clients"),
      orders: await countRows(client, "orders"),
      order_items: await countRows(client, "order_items"),
      shipping_rates: await countRows(client, "shipping_rates"),
      promotions: await countRows(client, "promotions"),
    };

    const mismatches = Object.entries(EXPECTED_COUNTS).filter(
      ([table, expected]) => counts[table as keyof typeof counts] !== expected
    );

    const ok = mismatches.length === 0;

    await client.query(
      `INSERT INTO _seed_status (counts, ok) VALUES ($1, $2)`,
      [JSON.stringify(counts), ok]
    );

    console.log("[seed] volumes obtenus :", counts);

    if (!ok) {
      const details = mismatches
        .map(([t, exp]) => `${t}: attendu ${exp}, obtenu ${counts[t as keyof typeof counts]}`)
        .join(" | ");
      throw new Error(`[seed] ÉCHEC — volumes incorrects : ${details}`);
    }

    console.log("[seed] OK — volumes conformes (80/120/320/449/12/12).");
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL manquant.");
    process.exit(1);
  }
  runSeeder(connectionString)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1); // FAIL FAST : ne jamais démarrer silencieusement
    });
}
