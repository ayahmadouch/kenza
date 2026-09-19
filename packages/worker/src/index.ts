import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { connection, relanceQueue, type RelanceJobData } from "./queue";
import { scanAbandonedCarts } from "./scanner";
import { isShopOpen, nextOpeningFrom } from "./hours";
import { pool } from "../../db/pool";
import type { CartItem } from "../../agent/types";

const VARIANT_TEMPLATES: Record<"A" | "B", (items: CartItem[], total: number) => string> = {
  A: (items, total) =>
    `Bonjour ! Il vous reste ${items.length} article(s) dans votre panier (${total} MAD). Voulez-vous que je finalise votre commande ?`,
  B: (items, total) =>
    `On garde votre panier au chaud (${items.length} article(s), ${total} MAD) ? Dites-moi si vous voulez que je valide la commande.`,
};

async function sendRelance(job: Job<RelanceJobData>) {
  const { conversationId, variante, relanceId } = job.data;
  const now = new Date();

  if (!isShopOpen(now)) {
    const reporte = nextOpeningFrom(now);
    await pool.query(`UPDATE relances SET planifiee_a = $2, resultat = 'skipped_out_of_hours' WHERE id = $1`, [
      relanceId, reporte.toISOString(),
    ]);
    const delay = Math.max(0, reporte.getTime() - now.getTime());
    await relanceQueue.add("send-relance", job.data, { delay, removeOnComplete: true, removeOnFail: 50 });
    return { reported: true };
  }

  const { rows } = await pool.query(`SELECT cart, telephone, langue, needs_human FROM conversations WHERE id = $1`, [conversationId]);
  const conv = rows[0];
  if (!conv || conv.needs_human || !conv.cart || conv.cart.length === 0) {
    await pool.query(`UPDATE relances SET resultat = 'skipped_converted_or_taken' , envoyee_a = now() WHERE id = $1`, [relanceId]);
    return { skipped: true };
  }

  const items: CartItem[] = conv.cart;
  const total = items.reduce((s, i) => s + i.qte * i.prix_unitaire, 0);
  const texte = VARIANT_TEMPLATES[variante](items, total);

  await pool.query(
    `INSERT INTO messages (conversation_id, role, texte, intention, langue) VALUES ($1,'agent',$2,'panier_abandonne',$3)`,
    [conversationId, texte, conv.langue]
  );
  await pool.query(`UPDATE relances SET envoyee_a = now(), resultat = 'sent' WHERE id = $1`, [relanceId]);
  await pool.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [conversationId]);

  console.log(`[worker] relance envoyée -> ${conversationId} (variante ${variante})`);
  return { sent: true };
}

async function main() {
  console.log("[worker] démarrage du worker BullMQ (relances)...");

  new Worker(
    "relances",
    async (job: Job) => {
      if (job.name === "scan-abandoned-carts") {
        const n = await scanAbandonedCarts();
        if (n > 0) console.log(`[worker] ${n} panier(s) abandonné(s) planifié(s) pour relance.`);
        return { scanned: n };
      }
      if (job.name === "send-relance") {
        return sendRelance(job as Job<RelanceJobData>);
      }
    },
    { connection }
  );

  // Scan périodique des paniers abandonnés via un job répétable BullMQ
  // (jamais un setTimeout() côté API, qui disparaîtrait au redémarrage).
  await relanceQueue.add(
    "scan-abandoned-carts",
    {},
    { repeat: { every: 30_000 }, removeOnComplete: true, removeOnFail: true }
  );

  console.log("[worker] prêt. Scan des paniers abandonnés toutes les 30s.");
}

main().catch((err) => {
  console.error("[worker] erreur fatale:", err);
  process.exit(1);
});
