import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { conversationsTable } from "./conversations";

export const conversationMessagesTable = pgTable("conversation_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversationsTable.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  suggestedReply: text("suggested_reply"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertConversationMessageSchema = createInsertSchema(
  conversationMessagesTable,
).omit({ id: true, createdAt: true });

export type InsertConversationMessage = z.infer<
  typeof insertConversationMessageSchema
>;
export type ConversationMessage =
  typeof conversationMessagesTable.$inferSelect;
