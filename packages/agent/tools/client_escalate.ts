import { pool } from "../../db/pool";

export async function get_client_history(args: { clientId?: string; telephone?: string }) {
  if (!args.clientId && !args.telephone) return { trouve: false };

  const { rows: clientRows } = await pool.query(
    `SELECT * FROM clients WHERE client_id = $1 OR telephone = $2 ORDER BY (client_id = $1) DESC LIMIT 1`,
    [args.clientId ?? null, args.telephone ?? null]
  );
  if (!clientRows[0]) return { trouve: false };
  const c = clientRows[0];

  const { rows: orders } = await pool.query(
    `SELECT o.commande_id, o.date::text AS date, o.statut, o.total_mad, o.ville_livraison, o.paiement, o.created_by,
            (SELECT json_agg(json_build_object('modele', oi.modele, 'taille', oi.taille, 'qte', oi.quantite))
             FROM order_items oi WHERE oi.commande_id = o.commande_id) AS articles
     FROM orders o
     WHERE o.client_id = $1 AND o.statut NOT IN ('panier abandonné')
     ORDER BY o.date DESC, o.commande_id DESC LIMIT 3`,
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
    derniere_ville_livraison: orders[0]?.ville_livraison ?? c.ville ?? null,
    conversations_precedentes: convs,
  };
}

export interface EscalateArgs {
  conversationId: string;
  motif: string;
  contexte: string;
  payload?: Record<string, unknown>;
}

/**
 * Crée (ou met à jour) l'escalade. Une seule escalade ouverte par
 * conversation et par motif : un client insistant ne génère pas de doublons.
 */
export async function escalate(args: EscalateArgs) {
  const payload = JSON.stringify({ motif: args.motif, contexte: args.contexte, ...(args.payload ?? {}) });
  const { rows: existing } = await pool.query(
    `SELECT id FROM escalations WHERE conversation_id = $1 AND motif = $2 AND statut IN ('NEEDS_HUMAN_REVIEW','IN_PROGRESS') ORDER BY id DESC LIMIT 1`,
    [args.conversationId, args.motif]
  );
  let id: number;
  if (existing[0]) {
    id = existing[0].id;
    await pool.query(`UPDATE escalations SET contexte_resume = $2, payload = $3::jsonb WHERE id = $1`, [id, args.contexte, payload]);
  } else {
    const { rows } = await pool.query(
      `INSERT INTO escalations (conversation_id, motif, contexte_resume, payload) VALUES ($1,$2,$3,$4::jsonb) RETURNING id`,
      [args.conversationId, args.motif, args.contexte, payload]
    );
    id = rows[0].id;
  }
  await pool.query(`UPDATE conversations SET needs_human = true, statut = 'needs_human' WHERE id = $1`, [args.conversationId]);
  return { escalation_id: id, needsHuman: true, deduplique: !!existing[0] };
}
