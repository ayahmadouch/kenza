/**
 * Tests unitaires des tools, sans LLM (PHASE 4 du cahier des charges).
 * Nécessite une base seedée et accessible via DATABASE_URL.
 * Lancer : npm run test:tools
 */
import assert from "node:assert";
import { pool } from "../../db/pool";
import { get_shipping_cost, apply_discount } from "./shipping_discount";
import { check_stock, get_price, search_catalog, suggest_alternatives } from "./catalog";
import { create_order } from "./order";
import { get_client_history } from "./client_escalate";
import { update_cart } from "./cart";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

async function main() {
  console.log("Tests unitaires des tools Kenza\n");

  await test("get_shipping_cost('Essaouira') -> trouve=false (ville hors grille)", async () => {
    const r = await get_shipping_cost({ ville: "Essaouira" });
    assert.strictEqual(r.trouve, false);
  });

  await test("get_shipping_cost('Casablanca') -> trouve=true", async () => {
    const r = await get_shipping_cost({ ville: "Casablanca" });
    assert.strictEqual(r.trouve, true);
    assert.ok(typeof r.frais_mad === "number");
  });

  await test("apply_discount(1000, 30) -> autorise=false (au-dessus du plancher 10%)", async () => {
    const r = await apply_discount({ total: 1000, pct: 30 });
    assert.strictEqual(r.autorise, false);
    assert.strictEqual(r.pct_applique, 0);
  });

  await test("apply_discount(1000, 10) -> autorise=true", async () => {
    const r = await apply_discount({ total: 1000, pct: 10 });
    assert.strictEqual(r.autorise, true);
    assert.strictEqual(r.montant_remise, 100);
  });

  await test("check_stock(REF-0019) -> rupture (cas de démo)", async () => {
    const r = await check_stock({ ref: "REF-0019" });
    assert.strictEqual(r.trouve, true);
    assert.strictEqual(r.disponible, false);
    assert.strictEqual(r.stock, 0);
  });

  await test("check_stock d'une ref en stock -> disponible=true", async () => {
    const { rows } = await pool.query(`SELECT ref FROM products WHERE stock > 0 LIMIT 1`);
    const r = await check_stock({ ref: rows[0].ref });
    assert.strictEqual(r.disponible, true);
  });

  await test("get_price(REF-0074) -> promo active en septembre 2026", async () => {
    const r = await get_price({ ref: "REF-0074" });
    assert.strictEqual(r.trouve, true);
    assert.ok(r.prix_promo !== undefined, "attendu une promo active");
    assert.strictEqual(r.prix_effectif, r.prix_promo);
  });

  await test("get_price d'une ref sans promo -> prix_effectif = prix_normal", async () => {
    const { rows } = await pool.query(
      `SELECT ref FROM products p WHERE NOT EXISTS (
         SELECT 1 FROM promotions pr WHERE pr.ref = p.ref AND pr.debut <= CURRENT_DATE AND pr.fin >= CURRENT_DATE
       ) LIMIT 1`
    );
    const r = await get_price({ ref: rows[0].ref });
    assert.strictEqual(r.prix_effectif, r.prix_normal);
  });

  await test("suggest_alternatives sur une ref en rupture -> alternatives en stock, même famille", async () => {
    const { rows } = await pool.query(`SELECT famille FROM products WHERE ref = 'REF-0019'`);
    const alts = await suggest_alternatives({ ref: "REF-0019" });
    assert.ok(alts.length > 0, "au moins une alternative attendue");
    for (const a of alts) {
      assert.ok(a.stock > 0, "alternative doit avoir du stock");
    }
  });

  await test("search_catalog(en_stock_seulement=true) -> aucun résultat à stock 0", async () => {
    const results = await search_catalog({ en_stock_seulement: true });
    for (const r of results) assert.ok(r.stock > 0);
  });

  await test("update_cart add/change_size -> panier mis à jour (cas changement de taille)", async () => {
    const convId = "TEST-CART-CONV";
    await pool.query(
      `INSERT INTO conversations (id, canal, langue) VALUES ($1, 'web', 'fr')
       ON CONFLICT (id) DO UPDATE SET cart = '[]'::jsonb`,
      [convId]
    );
    await update_cart({ conversationId: convId, action: "add", ref: "REF-0002", modele: "Sac à main noir", taille: "M", qte: 1, prix_unitaire: 1320 });
    const after = await update_cart({ conversationId: convId, action: "change_size", ref: "REF-0002", taille: "M", nouvelle_taille: "L" });
    assert.strictEqual(after.cart[0].taille, "L");
  });

  await test("create_order refuse si stock insuffisant", async () => {
    const { rows } = await pool.query(`SELECT client_id FROM clients LIMIT 1`);
    const r = await create_order({
      conversationId: "TEST-ORDER-CONV",
      clientId: rows[0].client_id,
      items: [{ ref: "REF-0019", modele: "x", taille: "unique", qte: 1, prix_unitaire: 100 }],
      ville: "Casablanca",
      paiement: "à la livraison",
      frais_livraison_mad: 25,
    });
    assert.strictEqual(r.ok, false);
  });

  await test("create_order réussit et décrémente le stock (created_by=agent)", async () => {
    const { rows: prod } = await pool.query(`SELECT ref, prix_mad, stock FROM products WHERE stock >= 2 LIMIT 1`);
    const { rows: cli } = await pool.query(`SELECT client_id FROM clients LIMIT 1`);
    const before = prod[0].stock;
    const r = await create_order({
      conversationId: "TEST-ORDER-CONV-2",
      clientId: cli[0].client_id,
      items: [{ ref: prod[0].ref, modele: "x", taille: "unique", qte: 1, prix_unitaire: prod[0].prix_mad }],
      ville: "Rabat",
      paiement: "à la livraison",
      frais_livraison_mad: 25,
    });
    assert.strictEqual(r.ok, true);
    assert.ok(String(r.commande_id).startsWith("CMD-A"));
    const { rows: after } = await pool.query(`SELECT stock FROM products WHERE ref = $1`, [prod[0].ref]);
    assert.strictEqual(after[0].stock, before - 1);
    const { rows: orderRow } = await pool.query(`SELECT created_by FROM orders WHERE commande_id = $1`, [r.commande_id]);
    assert.strictEqual(orderRow[0].created_by, "agent");
  });

  await test("get_client_history retrouve un client par téléphone", async () => {
    const { rows } = await pool.query(`SELECT telephone FROM clients LIMIT 1`);
    const r = await get_client_history({ telephone: rows[0].telephone });
    assert.strictEqual(r.trouve, true);
  });

  console.log(`\n${passed} passés, ${failed} échoués.`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
