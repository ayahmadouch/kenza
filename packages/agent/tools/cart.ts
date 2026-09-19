import { pool } from "../../db/pool";
import type { CartItem } from "../types";

export interface UpdateCartArgs {
  conversationId: string;
  action: "add" | "remove" | "change_size" | "clear";
  ref?: string;
  modele?: string;
  taille?: string;
  nouvelle_taille?: string;
  qte?: number;
  prix_unitaire?: number;
}

async function loadCart(conversationId: string): Promise<CartItem[]> {
  const { rows } = await pool.query(`SELECT cart FROM conversations WHERE id = $1`, [conversationId]);
  if (!rows[0]) return [];
  return (rows[0].cart as CartItem[]) ?? [];
}

async function saveCart(conversationId: string, cart: CartItem[]) {
  await pool.query(`UPDATE conversations SET cart = $2, last_message_at = now() WHERE id = $1`, [
    conversationId,
    JSON.stringify(cart),
  ]);
}

export async function update_cart(args: UpdateCartArgs) {
  let cart = await loadCart(args.conversationId);

  if (args.action === "clear") {
    cart = [];
  } else if (args.action === "add" && args.ref) {
    const idx = cart.findIndex((c) => c.ref === args.ref && c.taille === args.taille);
    if (idx >= 0) {
      cart[idx].qte += args.qte ?? 1;
    } else {
      cart.push({
        ref: args.ref,
        modele: args.modele ?? "",
        taille: args.taille ?? "",
        qte: args.qte ?? 1,
        prix_unitaire: args.prix_unitaire ?? 0,
      });
    }
  } else if (args.action === "remove" && args.ref) {
    cart = cart.filter((c) => !(c.ref === args.ref && (args.taille ? c.taille === args.taille : true)));
  } else if (args.action === "change_size" && args.ref && args.nouvelle_taille) {
    const idx = cart.findIndex((c) => c.ref === args.ref && c.taille === args.taille);
    if (idx >= 0) cart[idx].taille = args.nouvelle_taille;
  }

  await saveCart(args.conversationId, cart);
  const total = cart.reduce((s, c) => s + c.qte * c.prix_unitaire, 0);
  return { cart, total_articles_mad: total };
}
