import assert from "node:assert";
import { HumanMessage } from "@langchain/core/messages";
import { runGuardrail } from "./guardrails/guardrail";
import { routeAfterGuardrail } from "./nodes/guardrail_node";
import { routeAfterIntent, routeAfterCatalogue, routeAfterConversation, routeAfterMultimodal } from "./graph";
import { safeReply } from "./nodes/escalation_node";
import type { KenzaState } from "./types";

let ok = 0, ko = 0;
function t(name: string, fn: () => void) {
  try { fn(); ok++; console.log(`  ✓ ${name}`); } catch (e) { ko++; console.log(`  ✗ ${name}\n      ${(e as Error).message}`); }
}

const base = (over: Partial<KenzaState> = {}): KenzaState => ({
  conversationId: "T", langue: "fr", messages: [new HumanMessage("Bonjour, prix de la robe ?")], facts: [
    { type: "price", value: { ref: "REF-0012", prix_mad: 250, prix_effectif_mad: 250, stock: 4 }, source: "db:products.prix_mad", ref: "REF-0012" },
    { type: "shipping", value: { trouve: true, ville: "Rabat", frais_mad: 35, delai_heures: 48, cod: false, retrait: false }, source: "db:shipping_rates" },
  ], cart: [], needsHuman: false, trace: [], ...over,
});
const run = (draft: string, over: Partial<KenzaState> = {}) => runGuardrail({ ...base(over), draft });

console.log("Guardrail — bloque l'invention");
t("prix justifié par un fact -> PASS", () => assert.ok(run("Cette robe est à 250 MAD, livraison 35 MAD en 48h.").ok));
t("prix inventé -> FAIL", () => assert.ok(!run("Cette robe est à 199 MAD.").ok));
t("stock inventé -> FAIL", () => assert.ok(!run("Il en reste 12 en stock.").ok));
t("délai inventé -> FAIL", () => assert.ok(!run("Livraison en 72 heures.").ok));
t("frais inventés -> FAIL", () => assert.ok(!run("Livraison à 20 MAD.").ok));
t("remise 40 % inventée -> FAIL", () => assert.ok(!run("Je vous fais 40 % de remise.").ok));
t("référence inventée -> FAIL", () => assert.ok(!run("Je vous conseille REF-0999.").ok));
t("référence issue d'un fact -> PASS", () => assert.ok(run("La REF-0012 est disponible.").ok));
t("COD interdit (cod=false) -> FAIL", () => assert.ok(!run("Vous pouvez payer à la livraison.").ok));
t("COD autorisé (cod=true) -> PASS", () => {
  const facts = [{ type: "shipping" as const, value: { trouve: true, ville: "Casablanca", frais_mad: 30, delai_heures: 24, cod: true, retrait: true }, source: "db:shipping_rates" }];
  assert.ok(run("Paiement à la livraison possible, 30 MAD de livraison.", { facts }).ok);
});
t("COD refusé explicitement (négation) -> PASS", () => assert.ok(run("Le paiement à la livraison n'est pas disponible pour cette ville.").ok));
t("réassort promis (fr) -> FAIL", () => assert.ok(!run("Ce modèle sera de nouveau disponible la semaine prochaine.").ok));
t("réassort promis (darija) -> FAIL", () => assert.ok(!run("Ghadi yrj3 f stock 9rib.").ok));
t("réassort promis (ar) -> FAIL", () => assert.ok(!run("سيتوفر المنتج قريبا").ok));
t("remboursement espèces promis -> FAIL", () => assert.ok(!run("Vous serez remboursé en espèces.").ok));
t("chiffres arabes-indiens convertis puis vérifiés -> FAIL si inventés", () => assert.ok(!run("الثمن ٩٩ MAD").ok));
t("nombre écho du client toléré (taille 40)", () => assert.ok(run("Taille 40 bien notée.", { messages: [new HumanMessage("je veux la taille 40")] }).ok));

console.log("Routage du graphe");
t("règle d'escalade -> escalation", () => assert.strictEqual(routeAfterIntent({ needsHuman: true, intention: "negociation" }), "escalation"));
t("inconnu -> clarification (conversation)", () => assert.strictEqual(routeAfterIntent({ needsHuman: false, intention: "inconnu" }), "conversation"));
t("intention métier -> catalogue", () => assert.strictEqual(routeAfterIntent({ needsHuman: false, intention: "prix_et_disponibilite" }), "catalogue"));
t("catalogue + needsHuman -> escalation", () => assert.strictEqual(routeAfterCatalogue({ needsHuman: true }), "escalation"));
t("LLM KO -> escalation", () => assert.strictEqual(routeAfterConversation({ needsHuman: true }), "escalation"));
t("multimodal KO -> escalation", () => assert.strictEqual(routeAfterMultimodal({ needsHuman: true }), "escalation"));
t("guardrail: ok -> valid ; 1er échec -> retry ; 2e -> escalate", () => {
  assert.strictEqual(routeAfterGuardrail({ guardrail: { ok: true, violations: [], retries: 0 } } as unknown as KenzaState), "valid");
  assert.strictEqual(routeAfterGuardrail({ guardrail: { ok: false, violations: ["x"], retries: 1 } } as unknown as KenzaState), "retry");
  assert.strictEqual(routeAfterGuardrail({ guardrail: { ok: false, violations: ["x"], retries: 2 } } as unknown as KenzaState), "escalate");
});

console.log("Réponses d'escalade sûres");
for (const code of ["facture_societe", "reclamation", "remboursement_especes", "reassort_demande", "remise_hors_plancher", "ville_hors_grille", "hors_domaine", "llm_indisponible", "default"]) {
  for (const l of ["fr", "ar", "darija"] as const) {
    t(`${code}/${l} : sans chiffre ni promesse`, () => {
      const s = safeReply(code, l);
      assert.ok(s.length > 10);
      assert.ok(!/\d{2,}|MAD|%/.test(s), "contient un montant/nombre");
    });
  }
}
console.log(`\n${ok} passés, ${ko} échoués.`);
process.exit(ko ? 1 : 0);
