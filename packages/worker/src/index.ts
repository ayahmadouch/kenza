import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { connection, relanceQueue, QUEUE_NAME, type RelanceJobData } from "./queue";
import { scanAbandonedCarts, updateRelanceOutcomes } from "./scanner";
import { isShopOpen, nextOpeningFrom } from "./hours";
import { composeRelance } from "../../agent/nodes/relance_node";
import { pool } from "../../db/pool";

async function sendRelance(job: Job<RelanceJobData>) {
  const { conversationId, relanceId } = job.data;
  const now = new Date();

  // Horaires boutique : hors 10h-20h (lun→sam), on reporte au prochain créneau — jamais de message nocturne.
  if (!isShopOpen(now)) {
    const reporte = nextOpeningFrom(now);
    await pool.query(`UPDATE relances SET planifiee_a = $2 WHERE id = $1`, [relanceId, reporte.toISOString()]);
    await relanceQueue.add("send-relance", job.data, { jobId: `relance-${relanceId}-${reporte.getTime()}`, delay: reporte.getTime() - now.getTime(), removeOnComplete: true, removeOnFail: 50 });
    return { reporte: reporte.toISOString() };
  }

  const { rows } = await pool.query(`SELECT needs_human, human_active FROM conversations WHERE id = $1`, [conversationId]);
  const conv = rows[0];
  if (!conv || conv.needs_human || conv.human_active) {
    await pool.query(`UPDATE relances SET resultat = 'skipped_human', envoyee_a = now() WHERE id = $1`, [relanceId]);
    return { skipped: "humain" };
  }

  const draft = await composeRelance(conversationId);
  if ("skip" in draft) {
    await pool.query(`UPDATE relances SET resultat = $2, envoyee_a = now() WHERE id = $1`, [relanceId, `skipped_${draft.skip}`]);
    return { skipped: draft.skip };
  }

  const trace = [{ node: "relance_node", ts: now.toISOString(), decision: `relance variante ${draft.variante} (${draft.source}), langue ${draft.langue}, ${draft.items.length} article(s)`, tool: "bullmq:send-relance", args: { relanceId, conversationId } }];
  await pool.query(
    `INSERT INTO messages (conversation_id, role, texte, intention, langue, tool_calls, trace, synced) VALUES ($1,'agent',$2,'panier_abandonne',$3,'[]'::jsonb,$4::jsonb,false)`,
    [conversationId, draft.texte, draft.langue, JSON.stringify(trace)],
  );
  await pool.query(`UPDATE relances SET variante = $2, texte = $3, envoyee_a = now(), resultat = 'sent' WHERE id = $1`, [relanceId, draft.variante, draft.texte]);
  await pool.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [conversationId]);
  console.log(`[worker] relance envoyée conv=${conversationId} variante=${draft.variante} source=${draft.source}`);
  return { sent: true, variante: draft.variante };
}

async function main() {
  console.log("[worker] démarrage (BullMQ, file « relances »)");
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name === "scan-abandoned-carts") {
        const n = await scanAbandonedCarts();
        await updateRelanceOutcomes();
        return { planifiees: n };
      }
      if (job.name === "send-relance") return sendRelance(job as Job<RelanceJobData>);
      return undefined;
    },
    { connection, concurrency: 2 },
  );
  worker.on("failed", (job, err) => console.error(`[worker] job ${job?.name} en échec:`, err.message));

  // Scan périodique : un « job scheduler » BullMQ persistant dans Redis (idempotent au redémarrage).
  await relanceQueue.upsertJobScheduler("scan-abandoned", { every: Number(process.env.SCAN_EVERY_MS || 15_000) }, { name: "scan-abandoned-carts", opts: { removeOnComplete: true, removeOnFail: 20 } });
  console.log(`[worker] prêt — seuil panier abandonné : ${process.env.DEMO_DELAY_MINUTES ? `${process.env.DEMO_DELAY_MINUTES} min (démo)` : "24 h"}`);
}

main().catch((err) => { console.error("[worker] erreur fatale:", err); process.exit(1); });
