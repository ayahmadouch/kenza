import { pgTable, text, jsonb, timestamp, serial, integer, boolean, index } from "drizzle-orm/pg-core";

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  clientId: text("client_id"),
  telephone: text("telephone"),
  canal: text("canal").notNull().default("web"),
  langue: text("langue"),
  statut: text("statut").notNull().default("en_cours"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  cart: jsonb("cart").$type<CartItem[]>().notNull().default([]),
  // true dès que le commerçant a repris la main : l'agent est alors désactivé
  // pour cette conversation (bouton dashboard "Reprendre la main").
  needsHuman: boolean("needs_human").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CartItem = {
  ref: string;
  modele: string;
  taille: string;
  qte: number;
  prix_unitaire: number;
};

/**
 * guardrail : verdict structuré { ok, violations[], retries } — jamais le
 * raisonnement libre du LLM (règle de traçabilité §23).
 * tool_calls : liste des appels d'outils { tool, args, result } pour ce tour.
 */
export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    role: text("role").notNull(), // 'client' | 'agent' | 'humain' | 'system'
    texte: text("texte").notNull(),
    intention: text("intention"),
    langue: text("langue"),
    toolCalls: jsonb("tool_calls"),
    guardrail: jsonb("guardrail"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    convCreatedIdx: index("messages_conversation_id_created_at_idx").on(
      table.conversationId,
      table.createdAt
    ),
  })
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
