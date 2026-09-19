import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { search_catalog, check_stock, suggest_alternatives, get_price } from "./catalog";
import { get_shipping_cost, apply_discount } from "./shipping_discount";
import { update_cart } from "./cart";
import { create_order } from "./order";
import { get_client_history, escalate } from "./client_escalate";

export * from "./catalog";
export * from "./shipping_discount";
export * from "./cart";
export * from "./order";
export * from "./client_escalate";

/**
 * Les 10 tools métier exposés au LLM. Chaque tool est une fonction
 * déterministe (packages/agent/tools/*.ts) qui interroge PostgreSQL. Le
 * LLM ne calcule et n'invente jamais un prix, un stock, un délai ou un
 * total : il ne fait que choisir quel tool appeler et avec quels arguments.
 */
export function buildToolset(conversationId: string) {
  return [
    tool(
      async (args) => JSON.stringify(await search_catalog(args)),
      {
        name: "search_catalog",
        description: "Recherche des produits dans le catalogue réel (famille, couleur, taille, genre, matière, prix max, en stock seulement).",
        schema: z.object({
          famille: z.string().optional(),
          couleur: z.string().optional(),
          taille: z.string().optional(),
          genre: z.string().optional(),
          matiere: z.string().optional(),
          prix_max: z.number().optional(),
          en_stock_seulement: z.boolean().optional(),
        }),
      }
    ),
    tool(
      async (args) => JSON.stringify(await check_stock(args)),
      {
        name: "check_stock",
        description: "Vérifie le stock réel d'une référence ou d'un produit décrit par modèle/couleur/taille.",
        schema: z.object({
          ref: z.string().optional(),
          modele: z.string().optional(),
          couleur: z.string().optional(),
          taille: z.string().optional(),
        }),
      }
    ),
    tool(
      async (args) => JSON.stringify(await suggest_alternatives(args)),
      {
        name: "suggest_alternatives",
        description: "Propose des alternatives réellement en stock (même famille, couleur/taille/prix proches) pour une référence en rupture.",
        schema: z.object({ ref: z.string() }),
      }
    ),
    tool(
      async (args) => JSON.stringify(await get_price(args)),
      {
        name: "get_price",
        description: "Récupère le prix normal et le prix effectif (promo active si applicable) d'une référence.",
        schema: z.object({ ref: z.string() }),
      }
    ),
    tool(
      async (args) => JSON.stringify(await get_shipping_cost(args)),
      {
        name: "get_shipping_cost",
        description: "Récupère les frais et délai de livraison réels pour une ville, et si le paiement à la livraison / le retrait boutique sont possibles. trouve=false si la ville n'est pas dans la grille -> escalade obligatoire.",
        schema: z.object({ ville: z.string() }),
      }
    ),
    tool(
      async (args) => JSON.stringify(await apply_discount(args)),
      {
        name: "apply_discount",
        description: "Applique une remise sur un total. Le plancher (10% max) est vérifié en code : autorise=false si dépassé, quel que soit ce que demande le client.",
        schema: z.object({ total: z.number(), pct: z.number() }),
      }
    ),
    tool(
      async (args) => JSON.stringify(await update_cart({ conversationId, ...args })),
      {
        name: "update_cart",
        description: "Ajoute, retire, change de taille ou vide le panier de la conversation en cours.",
        schema: z.object({
          action: z.enum(["add", "remove", "change_size", "clear"]),
          ref: z.string().optional(),
          modele: z.string().optional(),
          taille: z.string().optional(),
          nouvelle_taille: z.string().optional(),
          qte: z.number().optional(),
          prix_unitaire: z.number().optional(),
        }),
      }
    ),
    tool(
      async (args) => JSON.stringify(await create_order({ conversationId, ...args })),
      {
        name: "create_order",
        description: "Crée réellement une commande en base (transactionnelle, décrémente le stock). N'appeler qu'après confirmation explicite du client, avec un panier et une ville validés.",
        schema: z.object({
          clientId: z.string(),
          items: z.array(z.object({
            ref: z.string(), modele: z.string(), taille: z.string(), qte: z.number(), prix_unitaire: z.number(),
          })),
          ville: z.string(),
          paiement: z.string(),
          frais_livraison_mad: z.number(),
        }),
      }
    ),
    tool(
      async (args) => JSON.stringify(await get_client_history(args)),
      {
        name: "get_client_history",
        description: "Récupère l'historique d'un client (commandes récentes, conversations précédentes) par client_id ou téléphone.",
        schema: z.object({ clientId: z.string().optional(), telephone: z.string().optional() }),
      }
    ),
    tool(
      async (args) => JSON.stringify(await escalate({ conversationId, ...args })),
      {
        name: "escalate",
        description: "Transfère la conversation à un humain avec le contexte complet. Obligatoire pour: facture société/ICE, réclamation, litige, hors catalogue, ville hors grille, remise sous plancher, remboursement espèces, date de réassort, ou toute incertitude.",
        schema: z.object({ motif: z.string(), contexte: z.string() }),
      }
    ),
  ];
}
