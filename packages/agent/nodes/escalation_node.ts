import type { KenzaState } from "../types";
import { escalate } from "../tools/client_escalate";

const SAFE_REPLY: Record<KenzaState["langue"], string> = {
  fr: "Je transmets votre demande à notre équipe pour qu'elle puisse vous répondre précisément. Elle revient vers vous rapidement.",
  ar: "سأحيل طلبك إلى فريقنا حتى يتمكن من الرد عليك بدقة. سيتواصل معك قريبا.",
  darija: "Ghadi ntranchi talab dyalek l l'équipe bach y7allo liya b dakik. Ghadi yjiwek daba daba.",
};

/**
 * Crée l'escalade en base (motif + contexte complet de la conversation) et
 * répond au client sans improviser : le client ne doit jamais avoir à se
 * répéter, l'humain reprend avec tout l'historique déjà transmis.
 */
export async function escalation_node(state: KenzaState): Promise<Partial<KenzaState>> {
  const start = Date.now();

  const motif = state.escalation?.motif ?? deriveMotif(state);
  const contexte = state.escalation?.contexte ?? buildContext(state);

  const result = await escalate({ conversationId: state.conversationId, motif, contexte });

  return {
    needsHuman: true,
    draft: SAFE_REPLY[state.langue],
    escalation: { motif, contexte },
    trace: [
      ...state.trace,
      {
        node: "escalation_node",
        ts: new Date().toISOString(),
        tool: "escalate",
        args: { motif },
        result,
        decision: "escalade créée, contrôle transféré à l'humain",
        latency_ms: Date.now() - start,
      },
    ],
  };
}

function deriveMotif(state: KenzaState): string {
  if (state.guardrail && !state.guardrail.ok) return `guardrail: ${state.guardrail.violations.join("; ")}`;
  if (state.intention) return `intention: ${state.intention}`;
  return "incertitude";
}

function buildContext(state: KenzaState): string {
  const lastMessages = state.messages.slice(-6).map((m) => `${m.getType?.() ?? "?"}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`);
  return [
    `Conversation ${state.conversationId}`,
    state.clientId ? `Client ${state.clientId}` : state.telephone ? `Téléphone ${state.telephone}` : "Client non identifié",
    `Intention détectée: ${state.intention ?? "inconnue"}`,
    `Panier: ${JSON.stringify(state.cart)}`,
    `Derniers messages: ${lastMessages.join(" || ")}`,
  ].join("\n");
}
