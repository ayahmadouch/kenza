import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { search_catalog, check_stock, suggest_alternatives, get_price } from "./catalog";
import { get_shipping_cost, apply_discount } from "./shipping_discount";
import { update_cart } from "./cart";
import { create_order } from "./order";
import { get_client_history } from "./client_escalate";

export * from "./catalog";
export * from "./shipping_discount";
export * from "./cart";
export * from "./order";
export * from "./client_escalate";

export interface KenzaTool {
  name: string;
  description: string;
  invoke(input: unknown): Promise<string>;
}

export interface ToolContext {
  conversationId: string;
  clientId?: string;
  telephone?: string;
}

/**
 * Fabrique un tool LangChain à partir d'un schéma Zod. Le typage est fixé
 * explicitement pour éviter l'explosion d'inférence (TS2589) du compilateur
 * sur les schémas Zod passés à `tool()`. Les arguments sont validés par Zod
 * AVANT l'exécution : un appel mal formé renvoie une erreur structurée.
 */
function mk<T extends z.ZodTypeAny>(name: string, description: string, schema: T, fn: (args: z.infer<T>) => Promise<unknown>): KenzaTool {
  return new DynamicStructuredTool({
    name,
    description,
    schema: schema as z.ZodTypeAny as never,
    func: async (raw: unknown) => {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return JSON.stringify({ ok: false, erreur: "arguments_invalides", details: parsed.error.issues.map((i) => i.message) });
      return JSON.stringify(await fn(parsed.data));
    },
  }) as unknown as KenzaTool;
}

/**
 * Les 10 tools métier exposés au LLM. Chaque tool est une fonction
 * déterministe (packages/agent/tools/*.ts) qui interroge PostgreSQL. Le LLM
 * ne calcule et n'invente jamais un prix, un stock, un délai ou un total :
 * il choisit seulement quel tool appeler. Les identifiants sensibles
 * (client, panier, prix) ne sont JAMAIS des arguments : ils viennent du contexte.
 *
 * `escalate` est exposé pour que le LLM puisse signaler une situation qu'il
 * ne sait pas traiter ; catalogue_node ne l'exécute pas directement, il
 * route vers escalation_node (unique point de création des escalades).
 */
export function buildToolset(ctx: ToolContext): KenzaTool[] {
  return [
    mk(
      "search_catalog",
      "Recherche des produits dans le catalogue réel. Filtres optionnels : famille (ex. Robe), modele (ex. 'robe vert olive'), couleur, taille (S/M/L/XL/38/../unique), genre, matiere, prix_max, en_stock_seulement.",
      z.object({
        famille: z.string().optional(),
        modele: z.string().optional(),
        couleur: z.string().optional(),
        taille: z.string().optional(),
        genre: z.string().optional(),
        matiere: z.string().optional(),
        prix_max: z.number().optional(),
        en_stock_seulement: z.boolean().optional(),
      }),
      (a) => search_catalog(a)
    ),
    mk(
      "check_stock",
      "Vérifie le stock réel d'une référence (ref) ou d'un produit décrit par modele/couleur/taille. Si plusieurs références correspondent, renvoie ambigu=true et les candidats : demande alors une précision, ne devine jamais.",
      z.object({ ref: z.string().optional(), modele: z.string().optional(), couleur: z.string().optional(), taille: z.string().optional() }),
      (a) => check_stock(a)
    ),
    mk(
      "suggest_alternatives",
      "Propose des alternatives réellement en stock (même famille, proches en modèle/couleur/taille/prix) pour une référence en rupture.",
      z.object({ ref: z.string() }),
      (a) => suggest_alternatives(a)
    ),
    mk(
      "get_price",
      "Prix normal et prix effectif (promotion active prioritaire) d'une référence.",
      z.object({ ref: z.string() }),
      (a) => get_price(a)
    ),
    mk(
      "get_shipping_cost",
      "Frais et délai de livraison réels d'une ville, paiement à la livraison (cod) et retrait boutique. trouve=false => ville hors grille => escalade obligatoire, jamais d'estimation.",
      z.object({ ville: z.string() }),
      (a) => get_shipping_cost(a)
    ),
    mk(
      "apply_discount",
      "Applique une remise en % sur un total. Le plafond est vérifié en code : autorise=false au-delà, quoi que demande le client.",
      z.object({ total: z.number(), pct: z.number() }),
      (a) => apply_discount(a)
    ),
    mk(
      "update_cart",
      "Modifie le panier de la conversation. add: ajoute (ref, ou modele+couleur+taille) ; remove: retire ; change_size: passe l'article à nouvelle_taille (reprend prix et stock réels de la variante) ; clear: vide. Les prix viennent de la base, jamais de toi.",
      z.object({
        action: z.enum(["add", "remove", "change_size", "clear"]),
        ref: z.string().optional(),
        modele: z.string().optional(),
        couleur: z.string().optional(),
        taille: z.string().optional(),
        nouvelle_taille: z.string().optional(),
        qte: z.number().int().positive().optional(),
      }),
      (a) => update_cart({ conversationId: ctx.conversationId, ...a })
    ),
    mk(
      "create_order",
      "Crée réellement la commande en base à partir du panier de la conversation. N'appeler qu'après confirmation explicite du client, avec la ville de livraison et le mode de paiement (à la livraison | virement | carte). Le paiement à la livraison n'est accepté que si la ville l'autorise.",
      z.object({ ville: z.string(), paiement: z.string() }),
      (a) => create_order({ conversationId: ctx.conversationId, ...a })
    ),
    mk(
      "get_client_history",
      "Historique du client courant (dernières commandes, ville habituelle, conversations précédentes).",
      z.object({}),
      () => get_client_history({ clientId: ctx.clientId, telephone: ctx.telephone })
    ),
    mk(
      "escalate",
      "Signale qu'un humain doit reprendre : facture société/ICE, réclamation, litige, demande hors catalogue, ville hors grille, remise au-delà du plafond, remboursement en espèces, date de réassort, question hors domaine, ou toute incertitude.",
      z.object({ motif: z.string(), contexte: z.string() }),
      async (a) => ({ ok: true, decision: "escalade", ...a })
    ),
  ];
}
