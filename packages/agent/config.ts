/**
 * Constantes métier centralisées. Aucune valeur de prix/stock/frais ici :
 * uniquement des règles issues de data/politique-commerciale.md et de
 * data/faq-boutique.md.
 */
export const DISCOUNT_MAX_PCT = Number(process.env.DISCOUNT_MAX_PCT ?? 10);
export const LLM_BASE_URL = process.env.LLM_BASE_URL ?? process.env.LLM_URL ?? "";

export const POLICY = {
  retour_jours: 7, // échange ou avoir sous 7 jours (politique-commerciale.md)
  garantie_jours: 30, // défauts de fabrication (faq-boutique.md)
  ouverture_h: Number(process.env.SHOP_OPEN_HOUR ?? 10),
  fermeture_h: Number(process.env.SHOP_CLOSE_HOUR ?? 20),
  retrait_villes: ["Casablanca", "Fès"],
  retrait_delai_h: 24,
} as const;

export const PAYMENT_METHODS = ["à la livraison", "virement", "carte"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Nombre de messages récents transmis au LLM (le reste vit dans le checkpointer). */
export const LLM_HISTORY_WINDOW = 24;

/** Nombre max de tours de tool-calling par message client. */
export const MAX_TOOL_ROUNDS = 5;
