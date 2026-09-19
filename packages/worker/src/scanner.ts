import { pool } from "../../db/pool";
import { relanceQueue } from "./queue";
import { abandonedThresholdMs, isShopOpen, nextOpeningFrom } from "./hours";

let lastVariant: "A" | "B" = "B"; // alterne A/B à chaque relance planifiée, pour l'A/B testing

function nextVariant(): "A" | "B" {
  lastVariant = lastVariant === "A" ? "B" : "A";
  return lastVariant;
}

/**
 * Identifie les conversations avec panier non converti et sans activité
 * client depuis > seuil (24h, ou DEMO_DELAY_MINUTES pour la démo), qui
 * n'ont pas encore reçu de relance et ne sont pas déjà prises en charge
 * par un humain. Une seule relance est planifiée par panier (jointure
 * anti-doublon sur relances.conversation_id).
 */
export async function scanAbandonedCarts() {
  const thresholdMs = abandonedThresholdMs();
  const cutoff = new Date(Date.now() - thresholdMs);

  const { rows } = await pool.query(
    `SELECT c.id, c.cart, c.last_message_at
     FROM conversations c
     WHERE jsonb_array_length(c.cart) > 0
       AND c.needs_human = false
       AND c.statut != 'closed'
       AND c.last_message_at < $1
       AND NOT EXISTS (SELECT 1 FROM relances r WHERE r.conversation_id = c.id)
     LIMIT 50`,
    [cutoff.toISOString()]
  );

  for (const conv of rows) {
    const variante = nextVariant();
    const now = new Date();
    const planifieeA = isShopOpen(now) ? now : nextOpeningFrom(now);

    const { rows: inserted } = await pool.query(
      `INSERT INTO relances (conversation_id, variante, planifiee_a, resultat)
       VALUES ($1,$2,$3,'pending') RETURNING id`,
      [conv.id, variante, planifieeA.toISOString()]
    );
    const relanceId = inserted[0].id;

    const delay = Math.max(0, planifieeA.getTime() - now.getTime());
    await relanceQueue.add(
      "send-relance",
      { conversationId: conv.id, variante, relanceId },
      { delay, removeOnComplete: true, removeOnFail: 50 }
    );

    console.log(`[worker] relance planifiée pour ${conv.id} (variante ${variante}, dans ${Math.round(delay / 1000)}s)`);
  }

  return rows.length;
}
