import { readFileSync } from "fs";
import path from "path";
import type { KenzaState } from "../types";
import { buildLlm } from "../llm";

const BASE_PROMPT = readFileSync(path.resolve(__dirname, "../prompts/system_base.md"), "utf-8");
const STYLE = {
  fr: readFileSync(path.resolve(__dirname, "../prompts/fr/style.md"), "utf-8"),
  ar: readFileSync(path.resolve(__dirname, "../prompts/ar/style.md"), "utf-8"),
  darija: readFileSync(path.resolve(__dirname, "../prompts/darija/style.md"), "utf-8"),
};

/**
 * Rédige la réponse finale, strictement à partir des `facts` déjà validés
 * (produits par catalogue_node). Ne calcule rien lui-même. Si guardrail_node
 * a rejeté un premier brouillon, les violations sont réinjectées pour un
 * unique retry.
 */
export async function conversation_node(state: KenzaState): Promise<Partial<KenzaState>> {
  const start = Date.now();
  const llm = buildLlm({ temperature: 0.4 });

  const retryNote = state.guardrail && !state.guardrail.ok
    ? `\n\nATTENTION — ton brouillon précédent a été rejeté pour ces raisons: ${state.guardrail.violations.join("; ")}.
Corrige-le : n'utilise QUE les faits ci-dessous, aucune autre donnée chiffrée, et ne promets jamais de date de réassort.`
    : "";

  const factsSummary = JSON.stringify(state.facts, null, 2);
  const cartSummary = JSON.stringify(state.cart, null, 2);
  const shippingSummary = JSON.stringify(state.shipping ?? null, null, 2);

  const system = `${BASE_PROMPT}\n\n${STYLE[state.langue]}\n\nFaits disponibles (facts, seule source de vérité pour les chiffres):\n${factsSummary}\n\nPanier actuel:\n${cartSummary}\n\nLivraison calculée (si applicable):\n${shippingSummary}${retryNote}`;

  const res = await llm.invoke([{ role: "system", content: system }, ...state.messages]);
  const draft = typeof res.content === "string" ? res.content : JSON.stringify(res.content);

  return {
    draft,
    trace: [
      ...state.trace,
      { node: "conversation_node", ts: new Date().toISOString(), decision: "brouillon généré", latency_ms: Date.now() - start },
    ],
  };
}
