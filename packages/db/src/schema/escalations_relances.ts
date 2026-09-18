import { pgTable, text, jsonb, timestamp, serial } from "drizzle-orm/pg-core";
import { conversations } from "./conversation.js";

/**
 * Une escalade transmet TOUJOURS le contexte complet (contexte_resume,
 * payload) : le client ne doit jamais avoir à se répéter (règle métier §5.6).
 */
export const escalations = pgTable("escalations", {
  id: serial("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id),
  motif: text("motif").notNull(),
  contexteResume: text("contexte_resume").notNull(),
  payload: jsonb("payload"),
  statut: text("statut").notNull().default("NEEDS_HUMAN_REVIEW"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

/**
 * Une ligne par relance planifiée. variante = 'A' | 'B' pour l'A/B testing.
 * resultat renseigné après réponse (ou absence de réponse) du client.
 */
export const relances = pgTable("relances", {
  id: serial("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id),
  variante: text("variante").notNull(), // 'A' | 'B'
  planifieeA: timestamp("planifiee_a", { withTimezone: true }).notNull(),
  envoyeeA: timestamp("envoyee_a", { withTimezone: true }),
  resultat: text("resultat"), // 'converti' | 'ouvert' | 'sans_reponse' | null
});

export type Escalation = typeof escalations.$inferSelect;
export type NewEscalation = typeof escalations.$inferInsert;
export type Relance = typeof relances.$inferSelect;
export type NewRelance = typeof relances.$inferInsert;
