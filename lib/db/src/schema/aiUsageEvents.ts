import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One row per real, billable AI provider call (e.g. one OpenAI classify()
// call per photo image). This is a real counter — not an estimate derived
// from job counts — so daily budget enforcement can be accurate at the
// per-image granularity the Photo Worker actually spends at.
// provider: openai | fal
// purpose: photo_classification | photo_background_removal
export const aiUsageEventsTable = pgTable(
  "ai_usage_events",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    purpose: text("purpose").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ai_usage_events_provider_idx").on(table.provider),
    index("ai_usage_events_created_idx").on(table.createdAt),
  ],
);

export const insertAiUsageEventSchema = createInsertSchema(aiUsageEventsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAiUsageEvent = z.infer<typeof insertAiUsageEventSchema>;
export type AiUsageEvent = typeof aiUsageEventsTable.$inferSelect;
