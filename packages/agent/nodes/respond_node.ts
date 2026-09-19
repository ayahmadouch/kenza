import { AIMessage } from "@langchain/core/messages";
import type { KenzaState } from "../types";
import { setShortState } from "../memory";
import { ev } from "./util";

/** Réponse validée par le guardrail : mémorisée dans le fil LangGraph (mémoire longue) et l'état court Redis. */
export async function respond_node(state: KenzaState): Promise<Partial<KenzaState>> {
  try {
    await setShortState(state.conversationId, { langue: state.langue, intention: state.intention, ville: state.ville, at: Date.now() });
  } catch { /* Redis optionnel : ne bloque jamais la réponse */ }
  return {
    messages: [new AIMessage(state.draft ?? "")],
    trace: [...state.trace, ev("respond_node", { decision: "réponse envoyée au client" })],
  };
}
