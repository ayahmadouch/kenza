import { pool } from "../../db/pool";
import { relanceQueue } from "./queue";
import { abandonedThresholdMs, isShopOpen, nextOpeningFrom } from "./hours";
import { chooseVariant } from "../../agent/nodes/relance_node";

/**
 * Décide QUI relancer : conversation avec panier non converti, sans réponse du client depuis > seuil
 * (24 h, ou DEMO_DELAY_MINUTES), pas reprise par un humain, jamais relancée (1 relance max par panier).
 * Décide QUAND : maintenant si la boutique est ouverte, sinon au prochain créneau d'ouverture.
 * Le job est planifié dans BullMQ (Redis) : il survit à un redémarrage, contrairement à un setTimeout.
 */
export async function scanAbandonedCarts(): Promise<number> {
  const cutoff = new Date(Date.now() - abandonedThresholdMs());
  const { rows } = await pool.query(
    `SELECT c.id FROM conversations c
      WHERE jsonb_array_length(c.cart) > 0
        AND c.needs_human = false AND c.human_active = false
        AND c.statut <> 'closed'
        AND c.last_message_at < $1
        AND NOT EXISTS (SELECT 1 FROM relances r WHERE r.conversation_id = c.id)
      ORDER BY c.last_message_at ASC
      LIMIT 50`,
    [cutoff.toISOString()],
  );

  for (const conv of rows as { id: string }[]) {
    const now = new Date();
    const when = isShopOpen(now) ? now : nextOpeningFrom(now);
    const variante = chooseVariant(conv.id);
    // La contrainte "une seule relance" est garantie ici même en cas de scans concurrents.
    const ins = await pool.query(
      `INSERT INTO relances (conversation_id, variante, planifiee_a, resultat)
       SELECT $1,$2,$3,'pending' WHERE NOT EXISTS (SELECT 1 FROM relances WHERE conversation_id = $1) RETURNING id`,
      [conv.id, variante, when.toISOString()],
    );
    if (!ins.rows[0]) continue;
    const relanceId: number = ins.rows[0].id;
    await relanceQueue.add("send-relance", { conversationId: conv.id, relanceId }, {
      jobId: `relance-${relanceId}`,
      delay: Math.max(0, when.getTime() - now.getTime()),
      removeOnComplete: true,
      removeOnFail: 50,
    });
    console.log(`[worker] relance planifiée conv=${conv.id} variante=${variante} à ${when.toISOString()}`);
  }
  return rows.length;
}

/** Mesure de l'A/B : converted (commande de l'agent créée depuis) > replied (le client a répondu) > sent. */
export async function updateRelanceOutcomes(): Promise<void> {
  await pool.query(
    `UPDATE relances r SET resultat = 'converted',
            converted_order_id = (SELECT o.commande_id FROM orders o WHERE o.conversation_id = r.conversation_id AND o.created_by = 'agent' ORDER BY o.commande_id DESC LIMIT 1)
      WHERE r.resultat IN ('sent','replied') AND r.envoyee_a IS NOT NULL
        AND EXISTS (SELECT 1 FROM orders o WHERE o.conversation_id = r.conversation_id AND o.created_by = 'agent' AND o.date >= r.envoyee_a::date)`,
  );
  await pool.query(
    `UPDATE relances r SET resultat = 'replied'
      WHERE r.resultat = 'sent' AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = r.conversation_id AND m.role = 'client' AND m.created_at > r.envoyee_a)`,
  );
}
