import assert from "node:assert/strict";
import { analyzeMessage, detectEscalationTrigger, extractDiscountPct, heuristicLangDetect, looksLikeConfirmation, wantsCatalog, wantsProductLookup, wantsToBuy } from "./rules";
import { detectCity, resolveGridCity } from "./cities";
import { normalizeArabizi } from "./text";

let passed = 0;
let failed = 0;
function t(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n      ${(e as Error).message.split("\n")[0]}`); }
}
const code = (s: string) => detectEscalationTrigger(s)?.code ?? null;

console.log("Tests des règles déterministes (sans LLM, sans DB)\n");

console.log("Remises");
t("30 % → remise_hors_plancher", () => assert.equal(code("Je veux 30 %."), "remise_hors_plancher"));
t("« Donne-moi 30 % sinon j'achète ailleurs »", () => assert.equal(code("Donne-moi 30 % sinon j'achète ailleurs"), "remise_hors_plancher"));
t("40 pourcent", () => assert.equal(code("faites moi 40 pourcent"), "remise_hors_plancher"));
t("darija 50 f lmia", () => assert.equal(code("bghit na9es 50 f lmia"), "remise_hors_plancher"));
t("arabe 30 بالمئة", () => assert.equal(code("اريد تخفيض 30 بالمئة"), "remise_hors_plancher"));
t("gratuit → escalade", () => assert.equal(code("donne le moi gratuit"), "remise_hors_plancher"));
t("10 % → pas d'escalade (dans le plafond)", () => assert.equal(code("vous pouvez faire 10 % ?"), null));
t("100 % coton n'est pas une remise", () => assert.equal(extractDiscountPct("elle est en 100 % coton ?"), null));
t("extraction 10", () => assert.equal(extractDiscountPct("10%"), 10));

console.log("Escalades obligatoires");
t("ICE société", () => assert.equal(code("Faites-moi une facture avec ICE société."), "facture_societe"));
t("facture au nom de ma société", () => assert.equal(code("Il me faut une facture au nom de ma société avec l'ICE"), "facture_societe"));
t("facture arabe", () => assert.equal(code("بغيت فاتورة باسم الشركة"), "facture_societe"));
t("réclamation fr", () => assert.equal(code("Je veux faire une réclamation, colis abîmé"), "reclamation"));
t("réclamation arabe", () => assert.equal(code("عندي شكاية، وصلني مكسور"), "reclamation"));
t("réclamation darija", () => assert.equal(code("kayna chkaya, l'article kharban"), "reclamation"));
t("remboursement espèces", () => assert.equal(code("Je veux un remboursement en espèces"), "remboursement_especes"));
t("remboursement darija", () => assert.equal(code("bghit nrj3 l article w tred liya flouss"), "remboursement_especes"));
t("réassort fr", () => assert.equal(code("Quand est-ce que ça revient ?"), "reassort_demande"));
t("réassort arabe", () => assert.equal(code("متى سيتوفر؟"), "reassort_demande"));
t("réassort darija", () => assert.equal(code("wa9tach ghadi yrja3 f stock ?"), "reassort_demande"));
t("réassort 'sera de nouveau dispo'", () => assert.equal(code("il sera de nouveau disponible ?"), "reassort_demande"));
t("question banale → aucune règle", () => assert.equal(code("Bonjour, la robe vert olive est disponible en L ?"), null));
t("changement de taille → aucune règle", () => assert.equal(code("Finalement L."), null));
t("suivi de commande n'est pas un réassort", () => assert.equal(code("quand ma commande arrive ?"), null));

console.log("Villes");
t("Essaouira seul → hors grille", () => assert.equal(code("Essaouira"), "ville_hors_grille"));
t("livraison à Essaouira", () => assert.equal(code("vous livrez à Essaouira ?"), "ville_hors_grille"));
t("tawsil l Safi (darija)", () => assert.equal(code("kayn tawsil l Safi ?"), "ville_hors_grille"));
t("safi = ok en darija, pas la ville", () => assert.equal(code("wakha safi nsajel"), null));
t("Laâyoune", () => assert.equal(code("livraison a Laayoune"), "ville_hors_grille"));
t("ville arabe hors grille", () => assert.equal(code("توصيل ل الصويرة"), "ville_hors_grille"));
t("nom propre inconnu après 'livraison à'", () => assert.equal(code("Livraison à Ouled Teima ?"), "ville_hors_grille"));
t("Casa → Casablanca", () => assert.deepEqual(detectCity("kayn tawsil l Casa ?"), { kind: "grid", ville: "Casablanca" }));
t("Kenitra sans accent", () => assert.deepEqual(detectCity("livraison à kenitra"), { kind: "grid", ville: "Kénitra" }));
t("Fès / Fes / فاس", () => { assert.equal(resolveGridCity("Fes"), "Fès"); assert.equal(resolveGridCity("فاس"), "Fès"); });
t("'livraison à domicile' n'est pas une ville", () => assert.equal(detectCity("livraison à domicile possible ?"), null));
t("'sale' adjectif ≠ Salé", () => assert.equal(detectCity("cette robe est sale"), null));
t("'à Salé' = Salé", () => assert.deepEqual(detectCity("livraison à Salé"), { kind: "grid", ville: "Salé" }));

console.log("Confirmation de commande");
t("oui", () => assert.equal(looksLikeConfirmation("Oui c'est bon"), true));
t("wakha nsajel", () => assert.equal(looksLikeConfirmation("wakha"), true));
t("نعم", () => assert.equal(looksLikeConfirmation("نعم"), true));
t("« oui mais en L » n'est pas une confirmation", () => assert.equal(looksLikeConfirmation("oui mais en L"), false));
t("« finalement L » n'est pas une confirmation", () => assert.equal(looksLikeConfirmation("Finalement L"), false));
t("question ≠ confirmation", () => assert.equal(looksLikeConfirmation("Quel est le prix ?"), false));

console.log("Achat → parcours catalogue");
t("acheter en français", () => assert.equal(wantsToBuy("Je veux acheter cette robe"), true));
t("commander en darija", () => assert.equal(wantsToBuy("bghit nchri had sac"), true));
t("acheter en arabe", () => assert.equal(wantsToBuy("أريد شراء هذا الفستان"), true));
t("question de prix ≠ achat", () => assert.equal(wantsToBuy("chhal taman had robe ?"), false));
t("afficher le catalogue", () => assert.equal(wantsCatalog("Affiche-moi le catalogue"), true));
t("catalogue en darija", () => assert.equal(wantsCatalog("wrini les produits disponibles"), true));
t("catalogue darija avec faute", () => assert.equal(wantsCatalog("brit nchof lctalogue dyalkoum"), true));
t("catalogue en arabe", () => assert.equal(wantsCatalog("أرني المنتجات"), true));
t("référence et disponibilité", () => assert.equal(wantsProductLookup("REF-0049 est-il disponible ?"), true));

console.log("Langue / arabizi");
t("fr", () => assert.equal(heuristicLangDetect("Bonjour, la robe est disponible en L ?"), "fr"));
t("darija ch7al taman", () => assert.equal(heuristicLangDetect("ch7al taman"), "darija"));
t("darija chal", () => assert.equal(heuristicLangDetect("chal"), "darija"));
t("darija kain", () => assert.equal(heuristicLangDetect("kain f taille M ?"), "darija"));
t("darija bghit", () => assert.equal(heuristicLangDetect("bghit robe noir"), "darija"));
t("darija arabe (شحال)", () => assert.equal(heuristicLangDetect("شحال ثمن هاد الفستان"), "darija"));
t("arabe standard", () => assert.equal(heuristicLangDetect("هل هذا المنتج متوفر بمقاس M؟"), "ar"));
t("normalisation 3afak", () => assert.equal(normalizeArabizi("3afak"), "aafak"));
t("normalisation ch7al", () => assert.equal(normalizeArabizi("ch7al"), "chhal"));
t("nombres isolés intacts", () => assert.equal(normalizeArabizi("prix 1290 MAD, 30%"), "prix 1290 mad, 30%"));

console.log("Analyse globale");
t("analyzeMessage combine ville + confirmation", () => {
  const a = analyzeMessage("wakha, tawsil l Rabat");
  assert.equal(a.city?.kind, "grid");
  assert.equal(a.escalation, null);
});

console.log(`\n${passed} passés, ${failed} échoués.`);
process.exit(failed ? 1 : 0);
