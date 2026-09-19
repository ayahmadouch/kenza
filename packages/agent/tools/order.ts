import type { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { PAYMENT_METHODS, type PaymentMethod } from "../config";
import type { CartItem } from "../types";
import { today } from "./catalog";
import { apply_discount, get_shipping_cost } from "./shipping_discount";

export interface CreateOrderArgs {
  conversationId: string;
  ville: string;
  paiement: string;
}

export type CreateOrderResult =
  | {
      ok: true;
      commande_id: string;
      total_mad: number;
      total_articles_mad: number;
      remise_mad: number;
      frais_livraison_mad: number;
      delai_heures: number;
      ville: string;
      paiement: PaymentMethod;
      items: { ref: string; modele: string; taille: string; qte: number; prix_unitaire: number }[];
    }
  | { ok: false; motif: string; [k: string]: unknown };

function normalizePayment(p: string): PaymentMethod | null {
  const f = p.toLowerCase();
  if (/livraison|cod|cash|espece|main/.test(f)) return "à la livraison";
  if (/virement|bancaire|transfer/.test(f)) return "virement";
  if (/carte|card|cb|lien/.test(f)) return "carte";
  return (PAYMENT_METHODS as readonly string[]).includes(p) ? (p as PaymentMethod) : null;
}

/**
 * Création de commande 100 % déterministe et transactionnelle.
 *  - le panier, le client et la remise sont lus en base (jamais fournis par le LLM) ;
 *  - les prix sont recalculés sous verrou (prix normal ou promo active) ;
 *  - les frais viennent de shipping_rates ; le COD n'est accepté que si la grille l'autorise ;
 *  - SELECT ... FOR UPDATE + revérification du stock + décrément : deux commandes
 *    simultanées ne peuvent jamais vendre la même dernière unité.
 */
export async function create_order(args: CreateOrderArgs): Promise<CreateOrderResult> {
  const paiement = normalizePayment(args.paiement ?? "");
  if (!paiement) return { ok: false, motif: "paiement_invalide", methodes: [...PAYMENT_METHODS] };

  const shipping = await get_shipping_cost({ ville: args.ville ?? "" });
  if (!shipping.trouve || shipping.frais_mad === null || shipping.delai_heures === null) {
    return { ok: false, motif: "ville_hors_grille" };
  }
  if (paiement === "à la livraison" && !shipping.cod) {
    return { ok: false, motif: "cod_indisponible", ville: shipping.ville };
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: convRows } = await client.query(
      `SELECT id, client_id, cart, remise_pct FROM conversations WHERE id = $1 FOR UPDATE`,
      [args.conversationId]
    );
    const conv = convRows[0];
    if (!conv) {
      await client.query("ROLLBACK");
      return { ok: false, motif: "conversation_inconnue" };
    }
    const cart = (conv.cart as CartItem[]) ?? [];
    if (cart.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, motif: "panier_vide" };
    }
    if (!conv.client_id) {
      await client.query("ROLLBACK");
      return { ok: false, motif: "client_inconnu" };
    }

    // Verrouillage dans un ordre stable (évite les deadlocks) puis revérification.
    const refs = [...new Set(cart.map((i) => i.ref))].sort();
    const { rows: locked } = await client.query(
      `SELECT p.ref, p.modele, p.taille, p.stock, p.prix_mad,
              COALESCE(pr.prix_promo_mad, p.prix_mad) AS prix_effectif
       FROM products p
       LEFT JOIN LATERAL (
         SELECT prix_promo_mad FROM promotions
         WHERE ref = p.ref AND debut <= $2::date AND fin >= $2::date
         ORDER BY id DESC LIMIT 1
       ) pr ON true
       WHERE p.ref = ANY($1::text[]) ORDER BY p.ref FOR UPDATE OF p`,
      [refs, today()]
    );
    const byRef = new Map(locked.map((r) => [r.ref as string, r]));

    const requested = new Map<string, number>();
    for (const it of cart) requested.set(it.ref, (requested.get(it.ref) ?? 0) + it.qte);

    const insuffisants = [...requested]
      .map(([ref, demande]) => ({ ref, demande, disponible: (byRef.get(ref)?.stock as number | undefined) ?? 0 }))
      .filter((x) => x.disponible < x.demande);
    if (insuffisants.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, motif: "stock_insuffisant", insuffisants };
    }

    for (const [ref, qte] of requested) {
      await client.query(`UPDATE products SET stock = stock - $2 WHERE ref = $1`, [ref, qte]);
    }

    const items = cart.map((i) => {
      const row = byRef.get(i.ref)!;
      return { ref: i.ref, modele: row.modele as string, taille: row.taille as string, qte: i.qte, prix_unitaire: row.prix_effectif as number };
    });
    const totalArticles = items.reduce((s, i) => s + i.qte * i.prix_unitaire, 0);
    const disc = await apply_discount({ total: totalArticles, pct: conv.remise_pct ?? 0 });
    const remise = disc.autorise ? disc.montant_remise : 0;
    const totalMad = totalArticles - remise + shipping.frais_mad;

    const { rows: seq } = await client.query(`SELECT nextval('agent_order_seq') AS n`);
    const commandeId = `CMD-A${String(seq[0].n).padStart(5, "0")}`;

    await client.query(
      `INSERT INTO orders (commande_id, client_id, date, canal, statut, total_articles_mad, frais_livraison_mad, total_mad,
                           ville_livraison, paiement, created_by, conversation_id, remise_mad)
       VALUES ($1,$2,CURRENT_DATE,'web','en préparation',$3,$4,$5,$6,$7,'agent',$8,$9)`,
      [commandeId, conv.client_id, totalArticles, shipping.frais_mad, totalMad, shipping.ville, paiement, args.conversationId, remise]
    );
    for (const it of items) {
      await client.query(
        `INSERT INTO order_items (commande_id, ref, modele, taille, quantite, prix_unitaire_mad) VALUES ($1,$2,$3,$4,$5,$6)`,
        [commandeId, it.ref, it.modele, it.taille, it.qte, it.prix_unitaire]
      );
    }
    await client.query(
      `UPDATE clients SET nb_commandes = COALESCE(nb_commandes,0) + 1, premier_achat = COALESCE(premier_achat, CURRENT_DATE), ville = COALESCE(ville, $2) WHERE client_id = $1`,
      [conv.client_id, shipping.ville]
    );
    await client.query(
      `UPDATE conversations SET cart = '[]'::jsonb, remise_pct = 0, statut = 'converted', ville = $2, last_message_at = now() WHERE id = $1`,
      [args.conversationId, shipping.ville]
    );
    // Une commande passée après une relance marque cette relance comme convertie (A/B testing).
    await client.query(
      `UPDATE relances SET resultat = 'converted', converted_order_id = $2
       WHERE conversation_id = $1 AND envoyee_a IS NOT NULL AND resultat = 'sent'`,
      [args.conversationId, commandeId]
    );

    await client.query("COMMIT");
    return {
      ok: true,
      commande_id: commandeId,
      total_mad: totalMad,
      total_articles_mad: totalArticles,
      remise_mad: remise,
      frais_livraison_mad: shipping.frais_mad,
      delai_heures: shipping.delai_heures,
      ville: shipping.ville!,
      paiement,
      items,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
