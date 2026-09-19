import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { KenzaState } from "./types";
import { multimodal_node } from "./nodes/multimodal_node";
import { intent_node } from "./nodes/intent_node";
import { catalogue_node } from "./nodes/catalogue_node";
import { conversation_node } from "./nodes/conversation_node";
import { guardrail_node, routeAfterGuardrail } from "./nodes/guardrail_node";
import { escalation_node } from "./nodes/escalation_node";
import { respond_node } from "./nodes/respond_node";

/**
 * Canal "dernier écrasant". `null` en entrée = remise à zéro (utilisé par ws.ts
 * pour réinitialiser les champs propres à UN tour, sans toucher à la mémoire longue).
 */
function last<T>(def?: () => T) {
  return Annotation<T | undefined>({ reducer: (_a, b) => (b === null ? undefined : (b as T | undefined)), default: def ? def : () => undefined });
}
function lastList<T>() {
  return Annotation<T[]>({ reducer: (_a, b) => (b ?? []) as T[], default: () => [] });
}

/**
 * État du graphe = KenzaState (types.ts).
 * - `messages` est CUMULATIF : c'est la mémoire longue persistée par le checkpointer PostgreSQL (thread = client).
 * - tout le reste est propre au tour ou reconstruit depuis PostgreSQL (panier, ville...).
 */
export const StateAnnotation = Annotation.Root({
  conversationId: Annotation<string>(),
  clientId: last<string>(),
  telephone: last<string>(),
  langue: Annotation<KenzaState["langue"]>({ reducer: (_a, b) => b ?? "fr", default: () => "fr" }),
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  intention: last<KenzaState["intention"]>(),
  intentConfidence: last<number>(),
  escalationCode: last<string>(),
  facts: lastList<KenzaState["facts"][number]>(),
  cart: lastList<KenzaState["cart"][number]>(),
  ville: last<string>(),
  shipping: last<KenzaState["shipping"]>(),
  remise: last<KenzaState["remise"]>(),
  draft: last<string>(),
  guardrail: last<KenzaState["guardrail"]>(),
  escalation: last<KenzaState["escalation"]>(),
  orderId: last<string>(),
  needsHuman: Annotation<boolean>({ reducer: (_a, b) => b ?? false, default: () => false }),
  media: last<KenzaState["media"]>(),
  transcript: last<string>(),
  confirmation: last<boolean>(),
  trace: lastList<KenzaState["trace"][number]>(),
});

type S = typeof StateAnnotation.State;
// Les nœuds sont typés sur KenzaState ; les deux types sont structurellement équivalents.
const asNode = (fn: (s: KenzaState) => Promise<Partial<KenzaState>>) => fn as unknown as (s: S) => Promise<Partial<S>>;

/** Après multimodal : panne STT/vision => escalade directe ; sinon classification. */
export function routeAfterMultimodal(state: Pick<S, "needsHuman">): "escalation" | "intent" {
  return state.needsHuman ? "escalation" : "intent";
}

/**
 * Après intent :
 *  - règle d'escalade déterministe déclenchée (ICE, réclamation, 30 %, ville inconnue...) => escalation
 *  - confiance faible / inconnu => conversation (question de clarification, jamais de supposition)
 *  - sinon => catalogue (tools réels)
 */
export function routeAfterIntent(state: Pick<S, "needsHuman" | "intention">): "escalation" | "catalogue" | "conversation" {
  if (state.needsHuman) return "escalation";
  if (state.intention === "inconnu") return "conversation";
  return "catalogue";
}

/** Après catalogue : un tool a imposé une escalade (ville hors grille, remise > plafond, produit inconnu...). */
export function routeAfterCatalogue(state: Pick<S, "needsHuman">): "escalation" | "conversation" {
  return state.needsHuman ? "escalation" : "conversation";
}

/** Après conversation : LLM indisponible => escalade propre, sinon guardrail. */
export function routeAfterConversation(state: Pick<S, "needsHuman">): "escalation" | "guardrail" {
  return state.needsHuman ? "escalation" : "guardrail";
}

export function buildKenzaGraph(checkpointer: PostgresSaver) {
  return new StateGraph(StateAnnotation)
    .addNode("multimodal", asNode(multimodal_node))
    .addNode("intent", asNode(intent_node))
    .addNode("catalogue", asNode(catalogue_node))
    .addNode("conversation", asNode(conversation_node))
    .addNode("guardrail_check", asNode(guardrail_node))
    .addNode("respond", asNode(respond_node))
    .addNode("escalation_handler", asNode(escalation_node))
    .addEdge(START, "multimodal")
    .addConditionalEdges("multimodal", routeAfterMultimodal, { escalation: "escalation_handler", intent: "intent" })
    .addConditionalEdges("intent", routeAfterIntent, { escalation: "escalation_handler", catalogue: "catalogue", conversation: "conversation" })
    .addConditionalEdges("catalogue", routeAfterCatalogue, { escalation: "escalation_handler", conversation: "conversation" })
    .addConditionalEdges("conversation", routeAfterConversation, { escalation: "escalation_handler", guardrail: "guardrail_check" })
    .addConditionalEdges("guardrail_check", routeAfterGuardrail, { valid: "respond", retry: "conversation", escalate: "escalation_handler" })
    .addEdge("respond", END)
    .addEdge("escalation_handler", END)
    .compile({ checkpointer });
}

/** Valeurs de remise à zéro passées à chaque nouveau tour (voir `last`). */
export const TURN_RESET = {
  intention: null, intentConfidence: null, escalationCode: null, facts: null, draft: null, guardrail: null,
  escalation: null, orderId: null, needsHuman: false, media: null, transcript: null, confirmation: null,
  shipping: null, remise: null, trace: null,
} as unknown as Partial<S>;
