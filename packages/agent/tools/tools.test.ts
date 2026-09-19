/**
 * Tests unitaires des tools, SANS LLM. Nécessite une base seedée (DATABASE_URL).
 * Les données de test (client, conversations, commandes) sont créées puis
 * supprimées, et les stocks modifiés sont restaurés : la base reste intacte.
 * Lancer : npm run test:tools
 */
import "dotenv/config";
import assert from "node:assert";
import { pool } from "../../db/pool";
import { get_shipping_cost, apply_discount } from "./shipping_discount";
import { check_stock, get_price, search_catalog, suggest_alternatives, getProduct } from "./catalog";
import { create_order } from "./order";
import { get_client_history, escalate } from "./client_escalate";
import { update_cart, loadCart } from "./cart";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${(err as Error).message.split("\n")[0]}`);
    failed++;
  }
}

const TEST_CLIENT = "CLI-TEST";
const convs: string[] = [];
const touchedRefs = new Map<string, number>();

async function snapshotStock(...refs: string[]) {
  for (const ref of refs) {
    if (!touchedRefs.has(ref)) touchedRefs.set(ref, (await getProduct(ref))!.stock);
  }
}

async function newConv(id: string, remise = 0) {
  convs.push(id);
  await pool.query(`INSERT INTO conversations (id, client_id, telephone, cart, remise_pct) VALUES ($1,$2,'+212600000000','[]'::jsonb,$3)`, [id, TEST_CLIENT, remise]);
}

async function cleanup() {
  await pool.query(`DELETE FROM order_items WHERE commande_id IN (SELECT commande_id FROM orders WHERE client_id = $1)`, [TEST_CLIENT]);
  await pool.query(`DELETE FROM orders WHERE client_id = $1`, [TEST_CLIENT]);
  await pool.query(`DELETE FROM escalations WHERE conversation_id = ANY($1::text[])`, [convs]);
  await pool.query(`DELETE FROM relances WHERE conversation_id = ANY($1::text[])`, [convs]);
  await pool.query(`DELETE FROM messages WHERE conversation_id = ANY($1::text[])`, [convs]);
  await pool.query(`DELETE FROM conversations WHERE id = ANY($1::text[])`, [convs]);
  await pool.query(`DELETE FROM clients WHERE client_id = $1`, [TEST_CLIENT]);
  for (const [ref, stock] of touchedRefs) await pool.query(`UPDATE products SET stock = $2 WHERE ref = $1`, [ref, stock]);
}

async function main() {
  console.log("Tests unitaires des tools Kenza\n");
  await pool.query(`INSERT INTO clients (client_id, nom, telephone, ville, langue_preferee, nb_commandes) VALUES ($1,'Client Test','+212600000000','Rabat','fr',0) ON CONFLICT DO NOTHING`, [TEST_CLIENT]);

  console.log("Livraison");
  await test("get_shipping_cost('Essaouira') -> trouve=false", async () => {
    const r = await get_shipping_cost({ ville: "Essaouira" });
    assert.strictEqual(r.trouve, false);
    assert.strictEqual(r.frais_mad, null);
  });
  await test("get_shipping_cost('Casablanca') = frais de la grille (25 MAD, pas le 30 des conversations)", async () => {
    const r = await get_shipping_cost({ ville: "Casablanca" });
    assert.strictEqual(r.trouve, true);
    assert.strictEqual(r.frais_mad, 25);
    assert.strictEqual(r.delai_heures, 72);
  });
  await test("alias 'Casa' / 'kenitra' résolus vers la grille", async () => {
    assert.strictEqual((await get_shipping_cost({ ville: "Casa" })).ville, "Casablanca");
    assert.strictEqual((await get_shipping_cost({ ville: "kenitra" })).frais_mad, 45);
  });
  await test("COD autorisé à Rabat, interdit à Fès et Tanger", async () => {
    assert.strictEqual((await get_shipping_cost({ ville: "Rabat" })).cod, true);
    assert.strictEqual((await get_shipping_cost({ ville: "Fès" })).cod, false);
    assert.strictEqual((await get_shipping_cost({ ville: "Tanger" })).cod, false);
  });
  await test("12 villes de la grille toutes trouvées", async () => {
    for (const v of ["Casablanca", "Rabat", "Fès", "Marrakech", "Tanger", "Agadir", "Meknès", "Oujda", "Kénitra", "Tétouan", "Salé", "Mohammedia"]) {
      assert.strictEqual((await get_shipping_cost({ ville: v })).trouve, true, v);
    }
  });

  console.log("\nRemises (plancher en code)");
  await test("apply_discount(1000, 30) -> autorise=false, aucune remise", async () => {
    const r = await apply_discount({ total: 1000, pct: 30 });
    assert.strictEqual(r.autorise, false);
    assert.strictEqual(r.pct_applique, 0);
    assert.strictEqual(r.montant_remise, 0);
    assert.strictEqual(r.escalade_requise, true);
  });
  await test("apply_discount(1000, 10) -> 100 MAD", async () => {
    const r = await apply_discount({ total: 1000, pct: 10 });
    assert.strictEqual(r.autorise, true);
    assert.strictEqual(r.montant_remise, 100);
    assert.strictEqual(r.total_apres_remise, 900);
  });
  await test("apply_discount(1000, 10.5) refusé, pct négatif / NaN refusés", async () => {
    assert.strictEqual((await apply_discount({ total: 1000, pct: 10.5 })).autorise, false);
    assert.strictEqual((await apply_discount({ total: 1000, pct: -5 })).autorise, false);
    assert.strictEqual((await apply_discount({ total: 1000, pct: NaN })).autorise, false);
  });

  console.log("\nStock, prix, promotions");
  await test("check_stock(REF-0019) -> rupture (stock 0)", async () => {
    const r = await check_stock({ ref: "REF-0019" });
    assert.strictEqual(r.disponible, false);
    assert.strictEqual(r.stock, 0);
  });
  await test("check_stock(REF-0021) -> disponible (stock > 0)", async () => {
    const r = await check_stock({ ref: "REF-0021" });
    assert.strictEqual(r.disponible, true);
  });
  await test("promo active : REF-0021 = 1260 MAD (pas 1580)", async () => {
    const r = await get_price({ ref: "REF-0021" });
    assert.strictEqual(r.prix_normal, 1580);
    assert.strictEqual(r.prix_effectif, 1260);
    assert.ok(r.promo_id);
  });
  await test("promotion != disponibilité : REF-0019 (même modèle que REF-0021) reste en rupture", async () => {
    assert.strictEqual((await check_stock({ ref: "REF-0019" })).disponible, false);
    assert.strictEqual((await check_stock({ ref: "REF-0021" })).disponible, true);
  });
  await test("promo inactive (hors période) : prix effectif = prix normal", async () => {
    await pool.query(`INSERT INTO promotions (ref, prix_normal_mad, prix_promo_mad, debut, fin) SELECT 'REF-0001', prix_mad, 1, '2020-01-01', '2020-01-31' FROM products WHERE ref='REF-0001'`);
    try {
      const r = await get_price({ ref: "REF-0001" });
      assert.strictEqual(r.prix_promo, undefined);
      assert.strictEqual(r.prix_effectif, r.prix_normal);
    } finally {
      await pool.query(`DELETE FROM promotions WHERE ref='REF-0001' AND prix_promo_mad = 1`);
    }
  });
  await test("get_price(ref inconnue) -> trouve=false", async () => assert.strictEqual((await get_price({ ref: "REF-9999" })).trouve, false));
  await test("suggest_alternatives(REF-0019) -> même famille, tous en stock > 0", async () => {
    const alts = await suggest_alternatives({ ref: "REF-0019" });
    assert.ok(alts.length > 0);
    for (const a of alts) {
      assert.ok(a.stock > 0, `${a.ref} stock=${a.stock}`);
      assert.strictEqual((await getProduct(a.ref))!.famille, (await getProduct("REF-0019"))!.famille);
    }
    assert.ok(alts[0].modele === "Caftan beige", "la variante du même modèle est proposée en premier");
  });
  await test("suggest_alternatives ne propose jamais une ref à stock 0 (5 refs de démo)", async () => {
    for (const ref of ["REF-0019", "REF-0020", "REF-0047", "REF-0045", "REF-0078"]) {
      const alts = await suggest_alternatives({ ref });
      assert.ok(alts.length > 0, ref);
      assert.ok(alts.every((a) => a.stock > 0), ref);
    }
  });
  await test("search_catalog(en_stock_seulement) -> aucun stock 0", async () => {
    const r = await search_catalog({ en_stock_seulement: true });
    assert.ok(r.length > 0 && r.every((p) => p.stock > 0));
  });
  await test("search_catalog insensible aux accents et à la casse ('Caftan BEIGE')", async () => {
    assert.ok((await search_catalog({ modele: "caftan beige" })).length === 3);
    assert.ok((await search_catalog({ famille: "sac a main" })).length > 0);
  });
  await test("check_stock ambigu (modèle sans taille) -> candidats, pas de devinette", async () => {
    const r = await check_stock({ modele: "Veste blanc cassé" });
    assert.strictEqual(r.ambigu, true);
    assert.ok((r.candidats?.length ?? 0) >= 2);
    assert.strictEqual(r.ref, null);
  });

  console.log("\nPanier (prix toujours issus de la base)");
  await newConv("TEST-CART");
  await test("update_cart add : prix résolu en base (promo), jamais fourni par l'appelant", async () => {
    const r = await update_cart({ conversationId: "TEST-CART", action: "add", ref: "REF-0021" });
    assert.strictEqual(r.ok, true);
    assert.strictEqual((r.cart as any[])[0].prix_unitaire, 1260);
    assert.strictEqual(r.total_articles_mad, 1260);
  });
  await test("update_cart add d'une ref en rupture -> refusé (motif rupture)", async () => {
    const r = await update_cart({ conversationId: "TEST-CART", action: "add", ref: "REF-0019" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.motif, "rupture");
    assert.strictEqual((await loadCart("TEST-CART")).length, 1);
  });
  await test("change_size vers une taille en rupture (S=REF-0019) -> refusé, panier inchangé", async () => {
    const r = await update_cart({ conversationId: "TEST-CART", action: "change_size", nouvelle_taille: "S" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.motif, "rupture");
    assert.strictEqual((await loadCart("TEST-CART"))[0].ref, "REF-0021");
  });
  await test("change_size M -> L puis retour : la référence et le total suivent la variante", async () => {
    await newConv("TEST-SIZE");
    await update_cart({ conversationId: "TEST-SIZE", action: "add", modele: "Veste blanc cassé", taille: "M" });
    const before = (await loadCart("TEST-SIZE"))[0];
    assert.strictEqual(before.taille, "M");
    const r = await update_cart({ conversationId: "TEST-SIZE", action: "change_size", nouvelle_taille: "L" });
    assert.strictEqual(r.ok, true);
    const after = (await loadCart("TEST-SIZE"))[0];
    assert.strictEqual(after.taille, "L");
    assert.notStrictEqual(after.ref, before.ref, "une taille = une référence distincte");
    assert.strictEqual((await loadCart("TEST-SIZE")).length, 1, "pas de doublon : on ne repart pas de zéro");
    assert.strictEqual(r.total_articles_mad, after.prix_unitaire * after.qte);
  });
  await test("change_size vers une taille inexistante -> liste les tailles disponibles", async () => {
    const r = await update_cart({ conversationId: "TEST-SIZE", action: "change_size", nouvelle_taille: "44" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.motif, "taille_inexistante");
    assert.ok(Array.isArray(r.tailles_disponibles));
  });
  await test("update_cart add ambigu (modèle sans taille) -> reference_ambigue", async () => {
    await newConv("TEST-AMB");
    const r = await update_cart({ conversationId: "TEST-AMB", action: "add", modele: "Veste blanc cassé" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.motif, "reference_ambigue");
  });
  await test("update_cart remove / clear", async () => {
    await update_cart({ conversationId: "TEST-CART", action: "remove", ref: "REF-0021" });
    assert.strictEqual((await loadCart("TEST-CART")).length, 0);
    await update_cart({ conversationId: "TEST-CART", action: "add", ref: "REF-0021" });
    await update_cart({ conversationId: "TEST-CART", action: "clear" });
    assert.strictEqual((await loadCart("TEST-CART")).length, 0);
  });

  console.log("\nCommande (transactionnelle)");
  await snapshotStock("REF-0021", "REF-0012", "REF-0009");
  await test("create_order : total recalculé en base, stock décrémenté, created_by='agent'", async () => {
    await newConv("TEST-ORD");
    await update_cart({ conversationId: "TEST-ORD", action: "add", ref: "REF-0021", qte: 2 });
    const stockBefore = (await getProduct("REF-0021"))!.stock;
    const r = await create_order({ conversationId: "TEST-ORD", ville: "Casa", paiement: "virement" });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    assert.strictEqual(r.total_articles_mad, 2520);
    assert.strictEqual(r.frais_livraison_mad, 25);
    assert.strictEqual(r.total_mad, 2545);
    assert.strictEqual((await getProduct("REF-0021"))!.stock, stockBefore - 2);
    const { rows } = await pool.query(`SELECT created_by, total_mad, conversation_id FROM orders WHERE commande_id = $1`, [r.commande_id]);
    assert.strictEqual(rows[0].created_by, "agent");
    assert.strictEqual(rows[0].total_mad, 2545);
    assert.strictEqual(rows[0].conversation_id, "TEST-ORD");
    assert.strictEqual((await loadCart("TEST-ORD")).length, 0, "panier vidé après commande");
  });
  await test("create_order applique la remise accordée (10 %) sur les articles, pas sur la livraison", async () => {
    await newConv("TEST-DISC", 10);
    await update_cart({ conversationId: "TEST-DISC", action: "add", ref: "REF-0021" });
    const r = await create_order({ conversationId: "TEST-DISC", ville: "Rabat", paiement: "à la livraison" });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    if (r.ok) {
      assert.strictEqual(r.remise_mad, 126);
      assert.strictEqual(r.total_mad, 1260 - 126 + 25);
    }
  });
  await test("create_order refuse le COD à Fès (grille : non)", async () => {
    await newConv("TEST-COD");
    await update_cart({ conversationId: "TEST-COD", action: "add", ref: "REF-0021" });
    const r = await create_order({ conversationId: "TEST-COD", ville: "Fès", paiement: "à la livraison" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.ok === false && r.motif, "cod_indisponible");
    assert.strictEqual((await loadCart("TEST-COD")).length, 1, "panier conservé");
  });
  await test("create_order refuse une ville hors grille (aucun frais inventé)", async () => {
    const r = await create_order({ conversationId: "TEST-COD", ville: "Essaouira", paiement: "virement" });
    assert.strictEqual(r.ok === false && r.motif, "ville_hors_grille");
  });
  await test("create_order refuse un panier vide et un paiement inconnu", async () => {
    await newConv("TEST-EMPTY");
    assert.strictEqual((await create_order({ conversationId: "TEST-EMPTY", ville: "Rabat", paiement: "virement" }) as any).motif, "panier_vide");
    assert.strictEqual((await create_order({ conversationId: "TEST-EMPTY", ville: "Rabat", paiement: "bitcoin" }) as any).motif, "paiement_invalide");
  });
  await test("create_order refuse si le stock est insuffisant (rollback, stock intact)", async () => {
    await newConv("TEST-LOW");
    await update_cart({ conversationId: "TEST-LOW", action: "add", ref: "REF-0021" });
    await pool.query(`UPDATE products SET stock = 0 WHERE ref = 'REF-0021'`);
    const r = await create_order({ conversationId: "TEST-LOW", ville: "Rabat", paiement: "virement" });
    assert.strictEqual(r.ok === false && r.motif, "stock_insuffisant");
    assert.strictEqual((await getProduct("REF-0021"))!.stock, 0);
    await pool.query(`UPDATE products SET stock = $1 WHERE ref = 'REF-0021'`, [touchedRefs.get("REF-0021")]);
  });
  await test("CONCURRENCE : 2 commandes simultanées sur la dernière unité (REF-0012, stock=1) -> une seule réussit", async () => {
    assert.strictEqual((await getProduct("REF-0012"))!.stock, 1, "pré-condition : dernière unité");
    await newConv("TEST-RACE-1");
    await newConv("TEST-RACE-2");
    await update_cart({ conversationId: "TEST-RACE-1", action: "add", ref: "REF-0012" });
    await update_cart({ conversationId: "TEST-RACE-2", action: "add", ref: "REF-0012" });
    const [a, b] = await Promise.all([
      create_order({ conversationId: "TEST-RACE-1", ville: "Rabat", paiement: "virement" }),
      create_order({ conversationId: "TEST-RACE-2", ville: "Rabat", paiement: "virement" }),
    ]);
    const oks = [a, b].filter((r) => r.ok).length;
    assert.strictEqual(oks, 1, `attendu 1 succès, obtenu ${oks}: ${JSON.stringify([a, b])}`);
    assert.strictEqual((await getProduct("REF-0012"))!.stock, 0, "stock jamais négatif");
  });
  await test("CONCURRENCE : 8 commandes simultanées sur un stock de 4 -> exactement 4 réussissent", async () => {
    await pool.query(`UPDATE products SET stock = 4 WHERE ref = 'REF-0009'`);
    const ids = Array.from({ length: 8 }, (_, i) => `TEST-BURST-${i}`);
    for (const id of ids) {
      await newConv(id);
      await update_cart({ conversationId: id, action: "add", ref: "REF-0009" });
    }
    const res = await Promise.all(ids.map((id) => create_order({ conversationId: id, ville: "Rabat", paiement: "virement" })));
    assert.strictEqual(res.filter((r) => r.ok).length, 4);
    assert.strictEqual((await getProduct("REF-0009"))!.stock, 0);
  });

  console.log("\nHistorique client & escalade");
  await test("get_client_history retrouve un client par téléphone ET par client_id", async () => {
    const { rows } = await pool.query(`SELECT client_id, telephone FROM clients WHERE client_id <> $1 AND nb_commandes > 0 LIMIT 1`, [TEST_CLIENT]);
    const byPhone = await get_client_history({ telephone: rows[0].telephone });
    assert.strictEqual(byPhone.trouve, true);
    const byId = await get_client_history({ clientId: rows[0].client_id });
    assert.strictEqual(byId.client?.client_id, rows[0].client_id);
    assert.ok(Array.isArray(byId.dernieres_commandes));
  });
  await test("get_client_history(inconnu) -> trouve=false", async () => assert.strictEqual((await get_client_history({ telephone: "+0" })).trouve, false));
  await test("escalate crée une escalade avec contexte + dédoublonne le même motif", async () => {
    const a = await escalate({ conversationId: "TEST-CART", motif: "remise_hors_plancher", contexte: "Client veut 30 %" });
    const b = await escalate({ conversationId: "TEST-CART", motif: "remise_hors_plancher", contexte: "Client insiste" });
    assert.strictEqual(a.escalation_id, b.escalation_id);
    const { rows } = await pool.query(`SELECT statut, contexte_resume FROM escalations WHERE id = $1`, [a.escalation_id]);
    assert.strictEqual(rows[0].statut, "NEEDS_HUMAN_REVIEW");
    assert.strictEqual(rows[0].contexte_resume, "Client insiste");
  });

  console.log(`\n${passed} passés, ${failed} échoués.`);
}

main()
  .catch((e) => { console.error(e); failed++; })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup:", e.message));
    await pool.end();
    process.exit(failed ? 1 : 0);
  });
