import type { Fact, KenzaState } from "../types";

const REASSORT_KEYWORDS = [
  "réassort", "reassort", "de retour en stock", "revient le", "sera de nouveau disponible",
  "disponible dans", "dans quelques jours", "la semaine prochaine", "prochainement en stock",
];

const CASH_REFUND_KEYWORDS = ["remboursement en espèces", "remboursé en cash", "rembourse en espèces"];

/**
 * Le guardrail est la dernière ligne de défense avant l'envoi d'une
 * réponse au client : il ne relit jamais le raisonnement du LLM, seulement
 * le texte final (draft) et les facts produits par les tools. Toute
 * violation bloque la réponse.
 */
export function runGuardrail(state: KenzaState): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const draft = state.draft ?? "";

  // 1) Tout nombre MAD présent dans le texte doit être justifiable par un fact.
  const numbersInDraft = extractNumbers(draft);
  const justifiedNumbers = collectJustifiedNumbers(state.facts, state);
  for (const n of numbersInDraft) {
    if (!justifiedNumbers.has(n)) {
      violations.push(`Nombre non justifié par un fact: ${n}`);
    }
  }

  // 2) Jamais de promesse de date de réassort.
  const lower = draft.toLowerCase();
  if (REASSORT_KEYWORDS.some((k) => lower.includes(k))) {
    violations.push("Promesse de réassort détectée dans la réponse (interdit).");
  }

  // 3) Jamais de remboursement en espèces promis par l'agent.
  if (CASH_REFUND_KEYWORDS.some((k) => lower.includes(k))) {
    violations.push("Promesse de remboursement en espèces détectée (doit escalader).");
  }

  // 4) La remise annoncée ne doit jamais dépasser le plancher autorisé.
  if (state.remise && state.remise.accordee_pct > 10) {
    violations.push(`Remise accordée (${state.remise.accordee_pct}%) dépasse le plancher de 10%.`);
  }

  // 5) COD proposé seulement si un fact shipping l'autorise explicitement.
  if (/paiement (?:à|a) la livraison/i.test(draft) || /\bcod\b/i.test(draft)) {
    const shippingFact = state.facts.find((f) => f.type === "shipping");
    const codOk = shippingFact && (shippingFact.value as { cod?: boolean })?.cod === true;
    if (!codOk) {
      violations.push("Paiement à la livraison mentionné sans fact shipping confirmant cod=true.");
    }
  }

  return { ok: violations.length === 0, violations };
}

function extractNumbers(text: string): number[] {
  // Nombres à 2 chiffres ou plus (évite de flaguer "1ère", "2 articles" trivialement,
  // mais reste volontairement strict : toute quantité/montant doit être justifiée).
  const matches = text.match(/\d[\d\s]{1,}(?=\s?(MAD|mad|%|h\b))|\b\d{2,}\b/g) ?? [];
  return matches
    .map((m) => Number(m.replace(/\s/g, "")))
    .filter((n) => Number.isFinite(n));
}

function collectJustifiedNumbers(facts: Fact[], state: KenzaState): Set<number> {
  const set = new Set<number>();
  for (const f of facts) {
    addNumbersFromValue(f.value, set);
  }
  // Le panier, la livraison et la remise courants sont aussi des sources valides
  // (ils dérivent eux-mêmes de facts produits par les tools en amont).
  for (const item of state.cart) {
    set.add(item.qte);
    set.add(item.prix_unitaire);
    set.add(item.qte * item.prix_unitaire);
  }
  if (state.shipping) {
    set.add(state.shipping.frais);
    set.add(state.shipping.delai_h);
  }
  if (state.remise) {
    set.add(state.remise.accordee_pct);
    set.add(state.remise.demandee_pct);
  }
  const cartTotal = state.cart.reduce((s, c) => s + c.qte * c.prix_unitaire, 0);
  const shippingFee = state.shipping?.frais ?? 0;
  set.add(cartTotal);
  set.add(cartTotal + shippingFee);
  return set;
}

function addNumbersFromValue(value: unknown, set: Set<number>) {
  if (typeof value === "number") {
    set.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => addNumbersFromValue(v, set));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((v) => addNumbersFromValue(v, set));
  }
}
