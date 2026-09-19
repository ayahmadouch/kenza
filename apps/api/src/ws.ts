import type { FastifyInstance } from "fastify";
import { HumanMessage } from "@langchain/core/messages";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { pool } from "../../../packages/db/pool";
import { buildKenzaGraph } from "../../../packages/agent/graph";
import { multimodal_node } from "../../../packages/agent/nodes/multimodal_node";
import type { KenzaState, Langue } from "../../../packages/agent/types";

let graphPromise: ReturnType<typeof initGraph> | null = null;

async function initGraph() {
  const checkpointer = new PostgresSaver(pool);
  await checkpointer.setup();
  return buildKenzaGraph(checkpointer);
}

function getGraph() {
  if (!graphPromise) graphPromise = initGraph();
  return graphPromise;
}

interface IncomingMessage {
  type: "text" | "image" | "audio";
  conversationId: string;
  clientId?: string;
  telephone?: string;
  ville?: string;
  text?: string;
  base64?: string;
}

async function ensureConversation(msg: IncomingMessage) {
  const { rows } = await pool.query(`SELECT * FROM conversations WHERE id = $1`, [msg.conversationId]);
  if (rows[0]) return rows[0];

  let clientId = msg.clientId;
  let langue: Langue = "fr";
  let ville = msg.ville;
  if (!clientId && msg.telephone) {
    const { rows: cli } = await pool.query(`SELECT * FROM clients WHERE telephone = $1`, [msg.telephone]);
    if (cli[0]) {
      clientId = cli[0].client_id;
      langue = cli[0].langue_preferee;
      ville = ville ?? cli[0].ville;
    }
  } else if (clientId) {
    const { rows: cli } = await pool.query(`SELECT * FROM clients WHERE client_id = $1`, [clientId]);
    if (cli[0]) {
      langue = cli[0].langue_preferee;
      ville = ville ?? cli[0].ville;
    }
  }

  const { rows: created } = await pool.query(
    `INSERT INTO conversations (id, client_id, telephone, canal, langue, ville, cart)
     VALUES ($1,$2,$3,'web',$4,$5,'[]'::jsonb) RETURNING *`,
    [msg.conversationId, clientId ?? null, msg.telephone ?? null, langue, ville ?? null]
  );
  return created[0];
}

export function registerChatWs(app: FastifyInstance) {
  app.get("/ws/chat", { websocket: true }, (socket) => {
    socket.on("message", async (raw: Buffer) => {
      const started = Date.now();
      try {
        const msg = JSON.parse(raw.toString()) as IncomingMessage;
        const conv = await ensureConversation(msg);

        if (conv.human_active || conv.needs_human) {
          const handoff = "Cette conversation est actuellement prise en charge par notre équipe. Merci de patienter, nous revenons vers vous rapidement.";
          await pool.query(
            `INSERT INTO messages (conversation_id, role, texte, langue) VALUES ($1,'system',$2,$3)`,
            [conv.id, handoff, conv.langue]
          );
          socket.send(JSON.stringify({ type: "agent_message", conversationId: conv.id, draft: handoff, langue: conv.langue, needsHuman: true, trace: [] }));
          return;
        }

        let userText = msg.text ?? "";
        let preEscalation: Partial<KenzaState> = {};

        if (msg.type !== "text") {
          const mm = await multimodal_node(
            { trace: [], messages: [], cart: [], facts: [], needsHuman: false, langue: conv.langue, conversationId: conv.id } as unknown as KenzaState,
            { kind: msg.type, audioBase64: msg.type === "audio" ? msg.base64 : undefined, imageBase64: msg.type === "image" ? msg.base64 : undefined }
          );
          const transcript = (mm as Record<string, unknown>).__transcript as string | undefined;
          if (transcript) userText = transcript;
          if (mm.needsHuman) preEscalation = mm;
        }

        await pool.query(
          `INSERT INTO messages (conversation_id, role, texte, langue) VALUES ($1,'client',$2,$3)`,
          [conv.id, userText, conv.langue]
        );

        const graph = await getGraph();
        const threadId = conv.client_id || conv.telephone || conv.id;

        const result = await graph.invoke(
          {
            conversationId: conv.id,
            clientId: conv.client_id ?? undefined,
            telephone: conv.telephone ?? undefined,
            langue: conv.langue,
            ville: msg.ville ?? conv.ville ?? undefined,
            messages: [new HumanMessage(userText)],
            needsHuman: preEscalation.needsHuman ?? false,
            escalation: preEscalation.escalation,
            trace: [],
            facts: [],
            cart: [],
          },
          { configurable: { thread_id: threadId } }
        );

        const latency = Date.now() - started;

        await pool.query(
          `INSERT INTO messages (conversation_id, role, texte, intention, langue, tool_calls, guardrail, latency_ms)
           VALUES ($1,'agent',$2,$3,$4,$5,$6,$7)`,
          [
            conv.id, result.draft, result.intention, result.langue,
            JSON.stringify(result.trace.filter((t: { tool?: string }) => t.tool)),
            JSON.stringify(result.guardrail ?? null),
            latency,
          ]
        );

        await pool.query(`UPDATE conversations SET last_message_at = now(), langue = $2 WHERE id = $1`, [conv.id, result.langue]);
        if (result.needsHuman) {
          await pool.query(`UPDATE conversations SET needs_human = true, human_active = true, statut = 'needs_human' WHERE id = $1`, [conv.id]);
        }

        socket.send(JSON.stringify({
          type: "agent_message",
          conversationId: conv.id,
          draft: result.draft,
          intention: result.intention,
          langue: result.langue,
          trace: result.trace,
          guardrail: result.guardrail,
          escalation: result.escalation,
          needsHuman: result.needsHuman,
          cart: result.cart,
          orderId: result.orderId,
          latency_ms: latency,
        }));
      } catch (err) {
        app.log.error(err);
        socket.send(JSON.stringify({ type: "error", message: String(err) }));
      }
    });
  });
}
