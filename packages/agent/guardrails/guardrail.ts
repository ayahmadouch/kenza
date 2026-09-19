import { DISCOUNT_MAX_PCT } from "../config";
import { toLatinDigits, foldText } from "../text";
import type { Fact, KenzaState } from "../types";
import { lastUserText } from "../nodes/util";

const REASSORT = [
  "reassort", "réassort", "reapprovision", "réapprovision", "de retour en stock", "revient le", "reviendra", "sera de nouveau disponible",
  "sera disponible", "redeviendra", "prochainement en stock", "restock", "back in stock", "nouvel arrivage",
  "ghadi yrj3", "ghadi ykon", "ghadi yji", "ghadi yweslo", "ghadi yrja3", "ghadi ywsl", "bnti", "غادي يرجع", "غادي يتوفر", "سيتوفر", "سيعود", "سيرجع", "سيتم توفير", "قريبا", "الاسبوع القادم", "الأسبوع القادم",
];
const CASH_REFUND = ["rembours\\w* (?:en |par )?(?:especes|cash|liquide)", "(?:especes|cash|liquide).{0,20}rembours", "nrj3 lik (?:l)?flous", "نرجع لك الفلوس", "استرجاع المبلغ نقدا", "استرجاع (?:المبلغ|الفلوس) (?:نقدا|كاش)"].map((r) => new RegExp(r));
const COD_RE = /(?:pay\w*|regl\w*|paiement|reglement)[^.!?]{0,30}(?:a la livraison|a la reception|cash)|a la livraison|\bcod\b|contre.?remboursement|cash on delivery|عند الاستلام|الدفع عند|khlas[^.!?]{0,15}(?:3nd|3and|f l?istilam|fl ?dar)|kanxlss[^.!?]{0,15}(?:3nd|3and)|(?:payer|paiement) cash/;
const NEGATION = /\b(?:pas|non|impossible|indisponible|n'est pas|ne peut|ne peux|ne propose|jamais|aucun\w*|makaynach|makaynch|machi|ma kaynach|ma ymknch|ma nqderch|mamkinch)\b|(?:^|\s)(?:لا|ليس|غير|مكاين|ماكاين|ما)\s|غير متاح|غير متوفر/;

/** Vrai si une phrase de `text` matche `re` sans négation ("le paiement à la livraison n'est pas disponible" est légitime). */
function assertsSentence(text: string, re: RegExp): boolean {
  return text.split(/(?<=[.!?؟\n])\s*/).some((sentence) => {
    const f = foldText(sentence);
    return (re.test(f) || re.test(sentence.toLowerCase())) && !NEGATION.test(f);
  });
}

/** Le guardrail relit le texte final et les facts, jamais le raisonnement du LLM. */
export function runGuardrail(state: KenzaState): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const draft = state.draft ?? "";
  const lower = draft.toLowerCase();
  const client = lastUserText(state.messages);

  const justified = collectJustifiedNumbers(state);
  for (const n of extractNumbers(draft)) {
    const echoOfClient = n.pct && numbersIn(client).has(n.value);
    if (!justified.has(n.value) && !echoOfClient && !(numbersIn(client).has(n.value) && !n.money)) {
      violations.push(`Nombre non justifié par un fact: ${n.value}`);
    }
  }

  // Références inventées
  const knownRefs = new Set((JSON.stringify(state.facts) + JSON.stringify(state.cart)).match(/REF-\d{4}/g) ?? []);
  for (const ref of draft.match(/REF-\d{4}/g) ?? []) if (!knownRefs.has(ref)) violations.push(`Référence non issue d'un tool: ${ref}`);

  if (REASSORT.some((k) => lower.includes(k.toLowerCase()))) violations.push("Promesse de réassort détectée (interdit).");
  if (CASH_REFUND.some((re) => assertsSentence(draft, re))) violations.push("Promesse de remboursement en espèces (doit escalader).");
  if (state.remise && state.remise.accordee_pct > DISCOUNT_MAX_PCT) violations.push(`Remise accordée > plafond ${DISCOUNT_MAX_PCT}%.`);

  if (assertsSentence(draft, COD_RE)) {
    const ship = state.facts.find((f) => f.type === "shipping" && (f.value as { trouve?: boolean })?.trouve);
    if (!ship || (ship.value as { cod?: boolean }).cod !== true) violations.push("Paiement à la livraison proposé sans grille confirmant cod=true.");
  }
  return { ok: violations.length === 0, violations };
}

interface Num { value: number; pct: boolean; money: boolean }

function cleaned(text: string): string {
  return toLatinDigits(text)
    .replace(/\b(?:REF|CMD)-[A-Z]?\d+\b/gi, " ")
    .replace(/\+?\d{2,3}[\s.]?\d{8,10}\b/g, " ") // téléphones
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/(\d)[\s\u00a0\u202f](?=\d{3}\b)/g, "$1");
}

function numbersIn(text: string): Set<number> {
  return new Set([...cleaned(text).matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", "."))));
}

export function extractNumbers(text: string): Num[] {
  const t = cleaned(text);
  const out: Num[] = [];
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*(MAD|DH|dhs?|dirhams?|%|h\b|heures?|jours?|j\b)?/gi)) {
    const value = Number(m[1].replace(",", "."));
    const unit = (m[2] ?? "").toLowerCase();
    // Les entiers isolés d'un chiffre (« 1 article », « M ») ne sont pas des données métier ; toute unité l'est.
    if (!unit && value < 10 && Number.isInteger(value)) continue;
    out.push({ value, pct: unit === "%", money: /mad|dh|dirham/.test(unit) });
  }
  return out;
}

function collectJustifiedNumbers(state: KenzaState): Set<number> {
  const set = new Set<number>();
  const add = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) set.add(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(add);
  };
  state.facts.forEach((f: Fact) => add(f.value));
  for (const i of state.cart) { add(i.qte); add(i.prix_unitaire); add(i.qte * i.prix_unitaire); }
  if (state.shipping) add(state.shipping);
  if (state.remise) add(state.remise);
  return set;
}

export { foldText };
