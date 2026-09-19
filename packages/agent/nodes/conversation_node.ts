import { readFileSync } from "fs";
import path from "path";
import type { KenzaState } from "../types";
import { buildLlm, contentToText, invokeLogged, llmConfigured } from "../llm";
import { cartTotal } from "../tools/cart";
import { ev, toChat } from "./util";

const dir = path.resolve(__dirname, "../prompts");
const BASE = readFileSync(path.join(dir, "system_base.md"), "utf-8");
const STYLE = {
  fr: readFileSync(path.join(dir, "fr/style.md"), "utf-8"),
  ar: readFileSync(path.join(dir, "ar/style.md"), "utf-8"),
  darija: readFileSync(path.join(dir, "darija/style.md"), "utf-8"),
};

/**
 * Rédige le brouillon final UNIQUEMENT à partir des facts produits par les tools.
 * Ne calcule rien, n'accède à aucune donnée : si le LLM est indisponible, on
 * ne fabrique aucune réponse -> escalade.
 */
export async function conversation_node(state: KenzaState): Promise<Partial<KenzaState>> {
  const start = Date.now();
  const retry = state.guardrail && !state.guardrail.ok
    ? `\n\n## CORRECTION OBLIGATOIRE\nTon brouillon précédent a été rejeté : ${state.guardrail.violations.join(" ; ")}.\nRéécris-le en n'utilisant QUE les chiffres présents dans les faits, sans promesse de réassort ni de remboursement en espèces.`
    : "";

  const system = `${BASE}\n\n${STYLE[state.langue]}\n
## Langue de réponse : ${state.langue === "fr" ? "français" : state.langue === "ar" ? "arabe standard" : "darija marocaine"} (celle du dernier message du client)
## Faits vérifiés (SEULE source des chiffres, prix, stocks, frais, délais, totaux)
${JSON.stringify(state.facts.map((f) => ({ type: f.type, ref: f.ref, value: f.value })), null, 1)}
## Panier actuel (${cartTotal(state.cart)} MAD d'articles avant remise/livraison)
${JSON.stringify(state.cart)}
## Ville de livraison connue : ${state.ville ?? "aucune"}
## Commande créée ce tour : ${state.orderId ?? "non"}${retry}`;

  try {
    if (!llmConfigured()) throw new Error("LLM non configuré");
    const res = await invokeLogged("conversation", buildLlm(), [{ role: "system", content: system }, ...toChat(state.messages)]);
    const draft = contentToText(res.content).trim();
    if (!draft) throw new Error("réponse vide");
    return { draft, trace: [...state.trace, ev("conversation_node", { decision: "brouillon généré", latency_ms: Date.now() - start })] };
  } catch (err) {
    return {
      needsHuman: true,
      escalationCode: "llm_indisponible",
      escalation: { motif: `LLM indisponible ou réponse invalide (${String(err).slice(0, 80)}).`, contexte: "" },
      trace: [...state.trace, ev("conversation_node", { decision: "échec LLM -> dégradation propre + escalade", latency_ms: Date.now() - start })],
    };
  }
}
