import { pool } from "../../db/pool";
import type { CartItem } from "../types";
import { foldText } from "../text";
import { getProduct, search_catalog, type ProductRow } from "./catalog";

export interface UpdateCartArgs {
  conversationId: string;
  action: "add" | "remove" | "change_size" | "clear";
  ref?: string;
  modele?: string;
  couleur?: string;
  taille?: string;
  nouvelle_taille?: string;
  qte?: number;
}

export async function loadCart(conversationId: string): Promise<CartItem[]> {
  const { rows } = await pool.query(`SELECT cart FROM conversations WHERE id = $1`, [conversationId]);
  return ((rows[0]?.cart as CartItem[] | undefined) ?? []).map((c) => ({ ...c }));
}

async function saveCart(conversationId: string, cart: CartItem[]) {
  await pool.query(`UPDATE conversations SET cart = $2::jsonb, last_message_at = now() WHERE id = $1`, [
    conversationId,
    JSON.stringify(cart),
  ]);
}

export function cartTotal(cart: CartItem[]): number {
  return cart.reduce((s, c) => s + c.qte * c.prix_unitaire, 0);
}

function toItem(p: ProductRow, qte: number): CartItem {
  return { ref: p.ref, modele: p.modele, taille: p.taille, qte, prix_unitaire: p.prix_effectif_mad };
}

export type UpdateCartResult =
  | { ok: true; cart: CartItem[]; total_articles_mad: number; ajoute?: unknown; retire?: CartItem; changement?: unknown }
  | { ok: false; motif: string; cart: CartItem[]; total_articles_mad: number; candidats?: unknown; ref?: string; modele?: string; taille?: string; stock?: number; demande?: number; taille_demandee?: string; tailles_disponibles?: string[] };

type Resolution =
  | { status: "ok"; product: ProductRow }
  | { status: "ambigu"; candidats: { ref: string; modele: string; taille: string; stock: number }[] }
  | { status: "introuvable" };

/** Retrouve une référence unique. Ne devine JAMAIS : plusieurs candidats => "ambigu". */
async function resolveProduct(args: { ref?: string; modele?: string; couleur?: string; taille?: string }): Promise<Resolution> {
  if (args.ref) {
    const p = await getProduct(args.ref.trim().toUpperCase());
    return p ? { status: "ok", product: p } : { status: "introuvable" };
  }
  if (!args.modele && !args.couleur) return { status: "introuvable" };
  const found = await search_catalog({ modele: args.modele, couleur: args.couleur, taille: args.taille });
  if (found.length === 0) return { status: "introuvable" };
  if (found.length > 1) {
    return { status: "ambigu", candidats: found.map((f) => ({ ref: f.ref, modele: f.modele, taille: f.taille, stock: f.stock })) };
  }
  const p = await getProduct(found[0].ref);
  return p ? { status: "ok", product: p } : { status: "introuvable" };
}

function findCartIndex(cart: CartItem[], args: UpdateCartArgs): number {
  if (args.ref) {
    const byRef = cart.findIndex((c) => c.ref === args.ref!.toUpperCase());
    if (byRef >= 0) return byRef;
  }
  if (args.modele) {
    const m = foldText(args.modele);
    const idx = cart.findIndex((c) => foldText(c.modele).includes(m) && (!args.taille || c.taille.toLowerCase() === args.taille.toLowerCase()));
    if (idx >= 0) return idx;
  }
  if (cart.length === 1) return 0; // « finalement L » : un seul article => c'est lui
  return -1;
}

export async function update_cart(args: UpdateCartArgs): Promise<UpdateCartResult> {
  const cart = await loadCart(args.conversationId);
  const done = async (extra: Record<string, unknown> = {}): Promise<Extract<UpdateCartResult, { ok: true }>> => {
    await saveCart(args.conversationId, cart);
    return { ok: true, cart, total_articles_mad: cartTotal(cart), ...extra } as Extract<UpdateCartResult, { ok: true }>;
  };

  if (args.action === "clear") {
    cart.length = 0;
    return done();
  }

  if (args.action === "add") {
    const r = await resolveProduct(args);
    if (r.status === "introuvable") return { ok: false, motif: "produit_introuvable", cart, total_articles_mad: cartTotal(cart) };
    if (r.status === "ambigu") return { ok: false, motif: "reference_ambigue", candidats: r.candidats, cart, total_articles_mad: cartTotal(cart) };
    const p = r.product;
    const qte = Math.max(1, Math.floor(args.qte ?? 1));
    const existing = cart.find((c) => c.ref === p.ref);
    const wanted = (existing?.qte ?? 0) + qte;
    if (p.stock <= 0) return { ok: false, motif: "rupture", ref: p.ref, modele: p.modele, taille: p.taille, stock: 0, cart, total_articles_mad: cartTotal(cart) };
    if (p.stock < wanted) return { ok: false, motif: "stock_insuffisant", ref: p.ref, stock: p.stock, demande: wanted, cart, total_articles_mad: cartTotal(cart) };
    if (existing) {
      existing.qte = wanted;
      existing.prix_unitaire = p.prix_effectif_mad; // toujours le prix DB courant
    } else {
      cart.push(toItem(p, qte));
    }
    return done({ ajoute: { ref: p.ref, modele: p.modele, taille: p.taille, prix_unitaire: p.prix_effectif_mad } });
  }

  if (args.action === "remove") {
    const idx = findCartIndex(cart, args);
    if (idx < 0) return { ok: false, motif: "article_absent_du_panier", cart, total_articles_mad: cartTotal(cart) };
    const [removed] = cart.splice(idx, 1);
    return done({ retire: removed });
  }

  // change_size : une taille = une référence distincte. On bascule vers la
  // variante (même modèle + même couleur) et on reprend son prix/stock réels.
  const idx = findCartIndex(cart, args);
  if (idx < 0) return { ok: false, motif: "article_absent_du_panier", cart, total_articles_mad: cartTotal(cart) };
  if (!args.nouvelle_taille) return { ok: false, motif: "nouvelle_taille_manquante", cart, total_articles_mad: cartTotal(cart) };

  const current = cart[idx];
  const currentProduct = await getProduct(current.ref);
  if (!currentProduct) return { ok: false, motif: "produit_introuvable", cart, total_articles_mad: cartTotal(cart) };

  const variants = await search_catalog({ modele: currentProduct.modele, couleur: currentProduct.couleur });
  const sameModel = variants.filter((v) => foldText(v.modele) === foldText(currentProduct.modele) && foldText(v.couleur) === foldText(currentProduct.couleur));
  const target = sameModel.find((v) => v.taille.toLowerCase() === args.nouvelle_taille!.trim().toLowerCase());
  const tailles_disponibles = sameModel.filter((v) => v.stock > 0).map((v) => v.taille);

  if (!target) {
    return { ok: false, motif: "taille_inexistante", taille_demandee: args.nouvelle_taille, tailles_disponibles, cart, total_articles_mad: cartTotal(cart) };
  }
  if (target.stock < current.qte) {
    return {
      ok: false,
      motif: target.stock <= 0 ? "rupture" : "stock_insuffisant",
      ref: target.ref,
      taille: target.taille,
      stock: target.stock,
      tailles_disponibles,
      cart,
      total_articles_mad: cartTotal(cart),
    };
  }
  const before = { ...current };
  cart[idx] = { ref: target.ref, modele: target.modele, taille: target.taille, qte: current.qte, prix_unitaire: target.prix_effectif_mad };
  return done({ changement: { avant: before, apres: cart[idx] } });
}
