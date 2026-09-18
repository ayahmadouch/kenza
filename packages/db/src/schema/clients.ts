import { pgTable, text, integer, date } from "drizzle-orm/pg-core";

export const clients = pgTable("clients", {
  clientId: text("client_id").primaryKey(),
  nom: text("nom").notNull(),
  telephone: text("telephone").notNull().unique(),
  ville: text("ville").notNull(),
  languePreferee: text("langue_preferee").notNull(),
  premierAchat: date("premier_achat"),
  nbCommandes: integer("nb_commandes").notNull().default(0),
  segment: text("segment"),
});

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
