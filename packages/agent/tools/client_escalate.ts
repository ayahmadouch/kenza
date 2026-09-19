import { pool } from "../../db/pool";

export async function get_client_history(args: { clientId?: string; telephone?: string }) {
  if (!args.clientId && !args.telephone) return { trouve: false };

  const { rows: clientRows } = await pool.query(
    `SELECT * FROM clients WHERE client_id = $1 OR telephone = $2 LIMIT 1`,
    [args.clientId ?? null, args.telephone ?? null]
  );
  if (!clientRows[0]) return { trouve: false };
  const c = clientRows[0];

  const { rows: orders } = await pool.query(
    `SELECT commande_id, date, statut, total_mad, created_by FROM orders WHERE client_id = $1 ORDER BY date DESC LIMIT 5`,
    [c.client_id]
  );

  const { rows: convs } = await pool.query(
    `SELECT id, statut, last_message_at FROM conversations WHERE client_id = $1 ORDER BY last_message_at DESC LIMIT 3`,
    [c.client_id]
  );

  return {
    trouve: true,
    client: {
      client_id: c.client_id,
      nom: c.nom,
      ville: c.ville,
      langue_preferee: c.langue_preferee,
      segment: c.segment,
      nb_commandes: c.nb_commandes,
    },
    dernieres_commandes: orders,
    conversations_precedentes: convs,
  };
}

export async function escalate(args: { conversationId: string; motif: string; contexte: string }) {
  const { rows } = await pool.query(
    `INSERT INTO escalations (conversation_id, motif, contexte_resume, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [args.conversationId, args.motif, args.contexte, JSON.stringify({ motif: args.motif, contexte: args.contexte })]
  );
  await pool.query(
    `UPDATE conversations SET needs_human = true, statut = 'needs_human' WHERE id = $1`,
    [args.conversationId]
  );
  return { escalation_id: rows[0].id, needsHuman: true };
}
