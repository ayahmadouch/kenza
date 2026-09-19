import type { FastifyInstance } from "fastify";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { pool } from "../../../packages/db/pool";
import { buildKenzaGraph, TURN_RESET } from "../../../packages/agent/graph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { loadCart } from "../../../packages/agent/tools/cart";
import { escalate } from "../../../packages/agent/tools/client_escalate";
import { safeReply } from "../../../packages/agent/nodes/escalation_node";
import { heuristicLangDetect } from "../../../packages/agent/rules";
import type { Langue } from "../../../packages/agent/types";

const IncomingSchema = z.object({
  type: z.enum(["text", "image", "audio"]).default("text"),
  conversationId: z.string().min(1).max(120),
  clientId: z.string().optional(),
  telephone: z.string().optional(),
  text: z.string().max(4000).optional(),
  base64: z.string().optional(),
  mime: z.string().optional(),
});
type Incoming = z.infer<typeof IncomingSchema>;

let graphPromise: Promise<ReturnType<typeof buildKenzaGraph>> | null = null;
function getGraph() {
  if (!graphPromise) {
    graphPromise = (async () => {
      const checkpointer = new PostgresSaver(pool);
      await checkpointer.setup(); // crée les tables de checkpoints LangGraph
      return buildKenzaGraph(checkpointer);
    })();
    graphPromise.catch(() => { graphPromise = null; });
  }
  return graphPromise;
}
export const warmGraph = () => getGraph();

interface ConvRow { id: string; client_id: string | null; telephone: string | null; langue: Langue; ville: string | null; human_active: boolean }

async function ensureConversation(msg: Incoming): Promise<ConvRow> {
  const existing = await pool.query(`SELECT * FROM conversations WHERE id = $1`, [msg.conversationId]);
  if (existing.rows[0]) return existing.rows[0] as ConvRow;

  let clientId = msg.clientId ?? null;
  let telephone = msg.telephone ?? null;
  let langue: Langue = "fr";
  let ville: string | null = null;
  const { rows } = await pool.query(`SELECT * FROM clients WHERE client_id = $1 OR ($2::text IS NOT NULL AND telephone = $2) LIMIT 1`, [clientId, telephone]);
  if (rows[0]) {
    clientId = rows[0].client_id; telephone = rows[0].telephone; langue = rows[0].langue_preferee ?? "fr"; ville = rows[0].ville ?? null;
  } else if (telephone) {
    // Nouveau client (numéro inconnu) : créé à la volée pour que l'identité soit persistante (thread LangGraph).
    clientId = `CLI-W${Date.now().toString(36).toUpperCase()}`;
    await pool.query(`INSERT INTO clients (client_id, nom, telephone, langue_preferee, premier_achat, nb_commandes, segment) VALUES ($1,$2,$3,'fr',CURRENT_DATE,0,'nouveau') ON CONFLICT DO NOTHING`, [clientId, `Client ${telephone}`, telephone]);
  }
  const created = await pool.query(
    `INSERT INTO conversations (id, client_id, telephone, canal, langue, ville, cart) VALUES ($1,$2,$3,'web',$4,$5,'[]'::jsonb) ON CONFLICT (id) DO UPDATE SET last_message_at = now() RETURNING *`,
    [msg.conversationId, clientId, telephone, langue, ville],
  );
  return created.rows[0] as ConvRow;
}

/** Messages agent/humain écrits hors boucle synchrone (relance du worker) : réinjectés dans le fil LangGraph. */
async function drainUnsynced(conversationId: string): Promise<BaseMessage[]> {
  const { rows } = await pool.query(`UPDATE messages SET synced = true WHERE conversation_id = $1 AND synced = false RETURNING role, texte, id`, [conversationId]);
  return rows.sort((a, b) => a.id - b.id).filter((r) => r.texte).map((r) => (r.role === "client" ? new HumanMessage(r.texte) : new AIMessage(r.texte)));
}

// Un tour à la fois par conversation (évite les courses sur le panier / le fil LangGraph).
const chains = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  chains.set(key, run);
  run.finally(() => { if (chains.get(key) === run) chains.delete(key); }).catch(() => undefined);
  return run;
}

type Send = (payload: unknown) => void;

async function handleTurn(msg: Incoming, send: Send, log: FastifyInstance["log"]) {
  const started = Date.now();
  const startedAt = new Date(started);
  const conv = await ensureConversation(msg);
  const isText = msg.type === "text";
  const rawText = (msg.text ?? "").trim();
  if (isText && !rawText) return;
  if (!isText && !msg.base64) { send({ type: "error", message: "Fichier vide." }); return; }

  send({ type: "ack", conversationId: conv.id });

  // Humain aux commandes : l'agent est désactivé, on journalise seulement le message du client.
  if (conv.human_active) {
    await pool.query(`INSERT INTO messages (conversation_id, role, texte, langue, created_at) VALUES ($1,'client',$2,$3,$4)`, [conv.id, isText ? rawText : `[${msg.type}]`, conv.langue, startedAt]);
    await pool.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [conv.id]);
    send({ type: "human_mode", conversationId: conv.id, message: "Un conseiller a repris la conversation : il vous répond ici." });
    return;
  }

  const graph = await getGraph();
  const threadId = conv.client_id || conv.telephone || conv.id; // identité persistante = mémoire longue
  const config = { configurable: { thread_id: threadId } };
  const pending = await drainUnsynced(conv.id);
  const cart = await loadCart(conv.id);
  const input = {
    ...TURN_RESET,
    conversationId: conv.id,
    clientId: conv.client_id ?? undefined,
    telephone: conv.telephone ?? undefined,
    langue: isText ? heuristicLangDetect(rawText) === "fr" ? conv.langue : heuristicLangDetect(rawText) : conv.langue,
    ville: conv.ville ?? undefined,
    cart,
    messages: isText ? [...pending, new HumanMessage(rawText)] : pending,
    media: isText ? null : { kind: msg.type, base64: msg.base64!, mime: msg.mime },
  };

  let values: Record<string, any> | null = null;
  try {
    for await (const chunk of await graph.stream(input as never, { ...config, streamMode: "updates" })) {
      for (const node of Object.keys(chunk as object)) send({ type: "node", node });
    }
    values = (await graph.getState(config)).values as Record<string, any>;
  } catch (err) {
    // Le graphe lui-même a planté : jamais de crash ni d'invention -> réponse sûre + escalade.
    log.error(err, "graphe Kenza en erreur");
    const langue = conv.langue ?? "fr";
    const draft = safeReply("llm_indisponible", langue);
    await escalate({ conversationId: conv.id, motif: `llm_indisponible: erreur interne du graphe (${String(err).slice(0, 120)})`, contexte: `Message client : ${isText ? rawText : `[${msg.type}]`}. Panier : ${JSON.stringify(cart)}.` }).catch(() => undefined);
    values = { draft, langue, needsHuman: true, trace: [{ node: "api", ts: new Date().toISOString(), decision: `erreur graphe -> dégradation propre + escalade`, result: { erreur: String(err).slice(0, 160) } }], escalation: { motif: "Erreur interne", contexte: "" }, cart };
  }

  const v = values!;
  const latency = Date.now() - started;
  const clientText = isText ? rawText : (v.transcript as string | undefined) ?? `[${msg.type}]`;
  const trace = (v.trace ?? []) as { tool?: string }[];
  const intention = v.intention ?? null;
  const draft = (v.draft as string | undefined) ?? safeReply("default", conv.langue);

  await pool.query(`INSERT INTO messages (conversation_id, role, texte, intention, langue, created_at) VALUES ($1,'client',$2,$3,$4,$5)`, [conv.id, clientText, intention, v.langue ?? conv.langue, startedAt]);
  await pool.query(
    `INSERT INTO messages (conversation_id, role, texte, intention, langue, tool_calls, guardrail, latency_ms, trace) VALUES ($1,'agent',$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb)`,
    [conv.id, draft, intention, v.langue ?? conv.langue, JSON.stringify(trace.filter((t) => t.tool)), JSON.stringify(v.guardrail ?? null), latency, JSON.stringify(trace)],
  );
  await pool.query(`UPDATE conversations SET last_message_at = now(), langue = $2, ville = COALESCE($3, ville) WHERE id = $1`, [conv.id, v.langue ?? conv.langue, v.ville ?? null]);
  const finalCart = await loadCart(conv.id);

  send({
    type: "agent_message",
    conversationId: conv.id,
    text: draft,
    transcript: isText ? undefined : clientText,
    intention,
    langue: v.langue ?? conv.langue,
    trace,
    guardrail: v.guardrail ?? null,
    escalation: v.needsHuman ? v.escalation ?? { motif: "escalade", contexte: "" } : null,
    needsHuman: !!v.needsHuman,
    cart: finalCart,
    orderId: v.orderId ?? null,
    latency_ms: latency,
  });
}

export function registerChatWs(app: FastifyInstance) {
  app.get("/ws/chat", { websocket: true }, (socket) => {
    const send: Send = (payload) => { if (socket.readyState === 1) socket.send(JSON.stringify(payload)); };
    socket.on("message", (raw: Buffer) => {
      let parsed: Incoming;
      try { parsed = IncomingSchema.parse(JSON.parse(raw.toString())); }
      catch { send({ type: "error", message: "Message invalide." }); return; }
      serialize(parsed.conversationId, () => handleTurn(parsed, send, app.log)).catch((err) => {
        app.log.error(err);
        send({ type: "error", message: "Erreur interne, réessayez." });
      });
    });
  });
}
