import { pgTable, text, integer, boolean, date, serial } from "drizzle-orm/pg-core";
import { products } from "./products.js";

/**
 * Grille de livraison fermée : 12 villes exactement (data/livraison.csv).
 * Toute ville absente de cette table doit déclencher une escalade côté
 * tool get_shipping_cost — jamais une estimation.
 */
export const shippingRates = pgTable("shipping_rates", {
  ville: text("ville").primaryKey(),
  fraisMad: integer("frais_mad").notNull(),
  delaiHeures: integer("delai_heures").notNull(),
  paiementALaLivraison: boolean("paiement_a_la_livraison").notNull(),
  retraitBoutique: boolean("retrait_boutique").notNull(),
});

/**
 * Promotions datées. Une promotion active à la date du jour prime sur le
 * prix normal (règle métier §5.1). L'existence d'une promo sur un ref ne
 * garantit jamais sa disponibilité : à croiser systématiquement avec
 * products.stock (piège REF-0019/0020/0021, voir README).
 */
export const promotions = pgTable("promotions", {
  id: serial("id").primaryKey(),
  ref: text("ref")
    .notNull()
    .references(() => products.ref),
  prixNormalMad: integer("prix_normal_mad").notNull(),
  prixPromoMad: integer("prix_promo_mad").notNull(),
  debut: date("debut").notNull(),
  fin: date("fin").notNull(),
  condition: text("condition"),
});

export type ShippingRate = typeof shippingRates.$inferSelect;
export type NewShippingRate = typeof shippingRates.$inferInsert;
export type Promotion = typeof promotions.$inferSelect;
export type NewPromotion = typeof promotions.$inferInsert;
