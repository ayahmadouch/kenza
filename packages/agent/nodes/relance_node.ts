import { createHash } from "crypto";
import { pool } from "../../db/pool";
import { buildLlm, contentToText, invokeLogged, llmConfigured } from "../llm";
import { getProduct } from "../tools/catalog";
import { extractNumbers } from "../guardrails/guardrail";
import type { CartItem, Langue } from "../types";

/**
 * relance_node — l'agent de relance. Exécuté HORS boucle synchrone, par le worker BullMQ.
 * Il décide : qui relancer (paniers non convertis), quand (horaires boutique, géré par le worker),
 * quelle variante (A/B déterministe, donc reproductible) et quel message (personnalisé, vérifié).
 */
export type Variante = "A" | "B";

export interface RelanceDraft {
  variante: Variante;
  langue: Langue;
  texte: string;
  items: CartItem[];
  total: number;
  source: "llm" | "template";
}

/** A/B déterministe sur l'identifiant de conversation : ~50/50 et reproductible. */
export function chooseVariant(conversationId: string): Variante {
  return createHash("sha1").update(conversationId).digest()[0] % 2 === 0 ? "A" : "B";
}

const money = (n: number) => `${n} MAD`;
const list = (items: CartItem[]) => items.map((i) => (i.qte > 1 ? `${i.qte}× ${i.modele}` : i.modele)).join(", ");

/** A = rappel direct et factuel ; B = ton chaleureux + question ouverte. Aucun délai/réassort promis. */
const TEMPLATES: Record<Langue, Record<Variante, (n: string, items: string, total: string) => string>> = {
  fr: {
    A: (n, items, total) => `Bonjour${n} ! Il reste dans votre panier : ${items} (${total}). Souhaitez-vous que je finalise votre commande ?`,
    B: (n, items, total) => `Bonjour${n} 😊 On a gardé votre sélection au chaud : ${items} (${total}). Une question avant de valider ? Je suis là pour vous aider.`,
  },
  ar: {
    A: (n, items, total) => `مرحبا${n}! ما زال في سلتكم: ${items} (${total}). هل تريدون أن أتمم طلبكم؟`,
    B: (n, items, total) => `مرحبا${n} 😊 احتفظنا لكم بالاختيار: ${items} (${total}). هل لديكم سؤال قبل التأكيد؟ أنا هنا لمساعدتكم.`,
  },
  darija: {
    A: (n, items, total) => `Salam${n} ! Baqi f panier dyalek : ${items} (${total}). Bghiti nsajel lik la commande ?`,
    B: (n, items, total) => `Salam${n} 😊 7bsna lik li khtariti : ${items} (${total}). 3ndek chi so2al qbel ma nsajlo ? Ana hna bach n3awnek.`,
  },
};

/** Compose la relance depuis des données RÉELLES (panier re-tarifé en base) ; le LLM ne fait que reformuler. */
export async function composeRelance(conversationId: string): Promise<RelanceDraft | { skip: string }> {
  const { rows } = await pool.query(
    `SELECT c.cart, c.langue, cl.nom FROM conversations c LEFT JOIN clients cl ON cl.client_id = c.client_id WHERE c.id = $1`,
    [conversationId],
  );
  const conv = rows[0];
  if (!conv || !Array.isArray(conv.cart) || conv.cart.length === 0) return { skip: "panier_vide" };

  // Re-tarification et stock réels : on ne relance jamais avec un prix périmé ni un article épuisé.
  const items: CartItem[] = [];
  for (const it of conv.cart as CartItem[]) {
    const p = await getProduct(it.ref);
    if (p && p.stock > 0) items.push({ ...it, prix_unitaire: p.prix_effectif_mad });
  }
  if (items.length === 0) return { skip: "articles_indisponibles" };

  const langue: Langue = (["fr", "ar", "darija"] as const).includes(conv.langue) ? conv.langue : "fr";
  const total = items.reduce((s, i) => s + i.qte * i.prix_unitaire, 0);
  const variante = chooseVariant(conversationId);
  const prenom = conv.nom ? ` ${String(conv.nom).split(" ")[0]}` : "";
  const template = TEMPLATES[langue][variante](prenom, list(items), money(total));

  if (llmConfigured() && process.env.RELANCE_LLM !== "0") {
    try {
      const res = await invokeLogged("relance", buildLlm(), [
        { role: "system", content: `Tu es Kenza, vendeuse d'une boutique de mode marocaine. Réécris ce message de relance de panier abandonné en ${langue === "fr" ? "français" : langue === "ar" ? "arabe standard" : "darija marocaine (lettres latines)"}, chaleureux, 2 phrases max, 1 emoji max. Conserve EXACTEMENT les articles et le montant. N'ajoute AUCUN autre chiffre, aucune remise, aucun délai, aucune date de retour en stock. Réponds avec le message seul.` },
        { role: "user", content: template },
      ]);
      const texte = contentToText(res.content).trim();
      const allowed = new Set<number>([total, ...items.flatMap((i) => [i.qte, i.prix_unitaire])]);
      const clean = texte.length > 0 && texte.length < 400 && extractNumbers(texte).every((n) => allowed.has(n.value)) && !/reassort|réassort|restock|remise|promo|غادي|سيتوفر/i.test(texte);
      if (clean) return { variante, langue, texte, items, total, source: "llm" };
    } catch { /* LLM indisponible : le gabarit vérifié suffit */ }
  }
  return { variante, langue, texte: template, items, total, source: "template" };
}
