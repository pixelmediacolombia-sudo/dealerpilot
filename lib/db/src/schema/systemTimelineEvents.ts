import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Human-readable feed of notable automated activity across the system.
// category: inventory | opportunity | market | photo | publishing | learning
export const systemTimelineEventsTable = pgTable(
  "system_timeline_events",
  {
    id: serial("id").primaryKey(),
    category: text("category").notNull(),
    workerId: text("worker_id"),
    message: text("message").notNull(),
    detailJson: text("detail_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("system_timeline_events_category_idx").on(table.category),
    index("system_timeline_events_created_idx").on(table.createdAt),
  ],
);

export const insertSystemTimelineEventSchema = createInsertSchema(
  systemTimelineEventsTable,
).omit({ id: true, createdAt: true });
export type InsertSystemTimelineEvent = z.infer<typeof insertSystemTimelineEventSchema>;
export type SystemTimelineEvent = typeof systemTimelineEventsTable.$inferSelect;
