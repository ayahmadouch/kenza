import { pgTable, text, integer, index } from "drizzle-orm/pg-core";

/**
 * Source de vérité catalogue. Alimenté uniquement par le seeder depuis
 * data/catalogue.csv (80 lignes attendues). Jamais modifié par le LLM.
 */
export const products = pgTable(
  "products",
  {
    ref: text("ref").primaryKey(),
    modele: text("modele").notNull(),
    famille: text("famille").notNull(),
    genre: text("genre").notNull(),
    couleur: text("couleur").notNull(),
    taille: text("taille").notNull(),
    matiere: text("matiere").notNull(),
    saison: text("saison").notNull(),
    prixMad: integer("prix_mad").notNull(),
    stock: integer("stock").notNull(),
    // Indicatif interne uniquement : jamais communiqué au client (règle métier §5.3).
    delaiReassortJours: integer("delai_reassort_jours"),
    codeBarre: text("code_barre").notNull(),
    poidsG: integer("poids_g").notNull(),
  },
  (table) => ({
    famCouleurTailleIdx: index("products_famille_couleur_taille_idx").on(
      table.famille,
      table.couleur,
      table.taille
    ),
    stockIdx: index("products_stock_idx").on(table.stock),
  })
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
