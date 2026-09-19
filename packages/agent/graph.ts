import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { BaseMessage } from "@langchain/core/messages";
import type { CartItem, Fact, Intention, Langue, TraceEvent } from "./types";
import { intent_node, FORCED_ESCALATION_INTENTS } from "./nodes/intent_node";
import { catalogue_node } from "./nodes/catalogue_node";
import { conversation_node } from "./nodes/conversation_node";
import { guardrail_node, routeAfterGuardrail } from "./nodes/guardrail_node";
import { escalation_node } from "./nodes/escalation_node";

/**
 * État du graphe, aligné sur KenzaState (packages/agent/types.ts). Chaque
 * canal a une fonction de réduction "dernier écrasant" sauf les tableaux
 * cumulatifs (messages, facts, trace) qui se concatènent.
 */
export const StateAnnotation = Annotation.Root({
  conversationId: Annotation<string>(),
  clientId: Annotation<string | undefined>(),
  telephone: Annotation<string | undefined>(),
  langue: Annotation<Langue>({ reducer: (_, b) => b, default: () => "fr" }),
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  intention: Annotation<Intention | undefined>(),
  intentConfidence: Annotation<number | undefined>(),
  facts: Annotation<Fact[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  cart: Annotation<CartItem[]>({ reducer: (_, b) => b, default: () => [] }),
  ville: Annotation<string | undefined>(),
  shipping: Annotation<KenzaShipping | undefined>(),
  remise: Annotation<KenzaRemise | undefined>(),
  draft: Annotation<string | undefined>(),
  guardrail: Annotation<KenzaGuardrail | undefined>(),
  escalation: Annotation<KenzaEscalation | undefined>(),
  orderId: Annotation<string | undefined>(),
  needsHuman: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  trace: Annotation<TraceEvent[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

type KenzaShipping = { frais: number; delai_h: number; cod: boolean; retrait: boolean };
type KenzaRemise = { demandee_pct: number; accordee_pct: number };
type KenzaGuardrail = { ok: boolean; violations: string[]; retries: number };
type KenzaEscalation = { motif: string; contexte: string };

function routeAfterIntent(state: typeof StateAnnotation.State): "escalation" | "catalogue" | "conversation" {
  if (state.needsHuman) return "escalation"; // ex: dégradation multimodale déjà décidée
  if (state.intention && FORCED_ESCALATION_INTENTS.includes(state.intention)) return "escalation";
  if (state.intention === "inconnu" && (state.intentConfidence ?? 0) < 0.3) {
    // Confiance très faible : on laisse conversation_node poser une clarification
    // plutôt que d'escalader directement, sauf si le message évoque déjà une
    // situation sensible (détecté plus tard par le guardrail sur le brouillon).
    return "conversation";
  }
  return "catalogue";
}

export function buildKenzaGraph(checkpointer: PostgresSaver) {
  const graph = new StateGraph(StateAnnotation)
    .addNode("intent", intent_node)
    .addNode("catalogue", catalogue_node)
    .addNode("conversation", conversation_node)
    .addNode("guardrail", guardrail_node)
    .addNode("escalation", escalation_node)
    .addEdge(START, "intent")
    .addConditionalEdges("intent", routeAfterIntent, {
      escalation: "escalation",
      catalogue: "catalogue",
      conversation: "conversation",
    })
    .addEdge("catalogue", "conversation")
    .addEdge("conversation", "guardrail")
    .addConditionalEdges("guardrail", routeAfterGuardrail, {
      valid: END,
      retry: "conversation",
      escalate: "escalation",
    })
    .addEdge("escalation", END);

  return graph.compile({ checkpointer });
}

/**
 * NB multimodal_node: la conversion audio/image -> texte est effectuée en
 * amont de l'invocation du graphe (apps/api), car elle transforme l'entrée
 * brute (base64) en message texte avant que l'état LangGraph ne soit
 * construit pour ce tour. Voir apps/api/src/ws.ts.
 */
