import { pool } from "../../db/pool";

export interface CreateOrderItem {
  ref: string;
  modele: string;
  taille: string;
  qte: number;
  prix_unitaire: number;
}

export interface CreateOrderArgs {
  conversationId: string;
  clientId: string;
  items: CreateOrderItem[];
  ville: string;
  paiement: string;
  frais_livraison_mad: number;
}

/**
 * Transactionnel : verrouille les lignes produit concernées (SELECT ...
 * FOR UPDATE), revérifie la disponibilité après verrouillage, décrémente
 * le stock, crée la commande + les lignes, puis commit. Deux commandes
 * concurrentes ne peuvent jamais vendre la même dernière unité : la
 * seconde transaction attend le verrou puis voit le stock déjà décrémenté.
 */
export async function create_order(args: CreateOrderArgs) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verrouille les refs concernées dans un ordre stable (évite les deadlocks).
    const refs = [...new Set(args.items.map((i) => i.ref))].sort();
    const { rows: locked } = await client.query(
      `SELECT ref, stock FROM products WHERE ref = ANY($1::text[]) ORDER BY ref FOR UPDATE`,
      [refs]
    );
    const stockByRef = new Map(locked.map((r) => [r.ref, r.stock as number]));

    const requestedByRef = new Map<string, number>();
    for (const item of args.items) {
      requestedByRef.set(item.ref, (requestedByRef.get(item.ref) ?? 0) + item.qte);
    }

    const insuffisants: { ref: string; demande: number; disponible: number }[] = [];
    for (const [ref, qte] of requestedByRef) {
      const dispo = stockByRef.get(ref) ?? 0;
      if (dispo < qte) insuffisants.push({ ref, demande: qte, disponible: dispo });
    }

    if (insuffisants.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, motif: "stock_insuffisant", insuffisants };
    }

    for (const [ref, qte] of requestedByRef) {
      await client.query(`UPDATE products SET stock = stock - $2 WHERE ref = $1`, [ref, qte]);
    }

    const totalArticles = args.items.reduce((s, i) => s + i.qte * i.prix_unitaire, 0);
    const totalMad = totalArticles + args.frais_livraison_mad;

    const { rows: seqRows } = await client.query(`SELECT nextval('agent_order_seq') AS n`);
    const commandeId = `CMD-A${String(seqRows[0].n).padStart(5, "0")}`;

    await client.query(
      `INSERT INTO orders (commande_id, client_id, date, canal, statut, total_articles_mad, frais_livraison_mad, total_mad, ville_livraison, paiement, created_by)
       VALUES ($1,$2, CURRENT_DATE, 'web', 'en préparation', $3, $4, $5, $6, $7, 'agent')`,
      [commandeId, args.clientId, totalArticles, args.frais_livraison_mad, totalMad, args.ville, args.paiement]
    );

    for (const item of args.items) {
      await client.query(
        `INSERT INTO order_items (commande_id, ref, modele, taille, quantite, prix_unitaire_mad)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [commandeId, item.ref, item.modele, item.taille, item.qte, item.prix_unitaire]
      );
    }

    await client.query(
      `UPDATE clients SET nb_commandes = nb_commandes + 1 WHERE client_id = $1`,
      [args.clientId]
    );

    await client.query(
      `UPDATE conversations SET cart = '[]'::jsonb WHERE id = $1`,
      [args.conversationId]
    );

    await client.query("COMMIT");
    return { ok: true, commande_id: commandeId, total_mad: totalMad };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
