import { pgTable, text, integer, date, serial, index } from "drizzle-orm/pg-core";
import { clients } from "./clients.js";
import { products } from "./products.js";

/**
 * created_by distingue les commandes historiques importées ('humain', valeur
 * par défaut du seed) des commandes réellement créées par l'agent Kenza
 * ('agent', forcé exclusivement par le tool create_order). Sert au KPI EX-03.
 */
export const orders = pgTable("orders", {
  commandeId: text("commande_id").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.clientId),
  date: date("date").notNull(),
  canal: text("canal").notNull(),
  statut: text("statut").notNull(),
  totalArticlesMad: integer("total_articles_mad").notNull(),
  fraisLivraisonMad: integer("frais_livraison_mad").notNull(),
  totalMad: integer("total_mad").notNull(),
  villeLivraison: text("ville_livraison").notNull(),
  paiement: text("paiement").notNull(),
  createdBy: text("created_by").notNull().default("humain"),
});

export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    commandeId: text("commande_id")
      .notNull()
      .references(() => orders.commandeId),
    ref: text("ref")
      .notNull()
      .references(() => products.ref),
    modele: text("modele").notNull(),
    taille: text("taille").notNull(),
    quantite: integer("quantite").notNull(),
    prixUnitaireMad: integer("prix_unitaire_mad").notNull(),
    // Rang technique de dédoublonnage pour le seed idempotent — voir migration
    // 0001_init.sql. Sans signification métier.
    seedOccurrence: integer("seed_occurrence").notNull().default(0),
  },
  (table) => ({
    commandeIdx: index("order_items_commande_id_idx").on(table.commandeId),
  })
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
