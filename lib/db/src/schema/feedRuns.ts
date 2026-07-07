import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const feedRunsTable = pgTable("feed_runs", {
  id: serial("id").primaryKey(),
  dealerId: integer("dealer_id").notNull(),
  feedId: integer("feed_id"),
  status: text("status").notNull(),
  /** How this sync was triggered: "auto" (scheduler), "manual" (API call), "seed" (startup seed) */
  triggerType: text("trigger_type").notNull().default("auto"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  vehiclesImported: integer("vehicles_imported").notNull().default(0),
  vehiclesNew: integer("vehicles_new").notNull().default(0),
  vehiclesUpdated: integer("vehicles_updated").notNull().default(0),
  vehiclesRemoved: integer("vehicles_removed").notNull().default(0),
  vehiclesActive: integer("vehicles_active").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  errorMessage: text("error_message"),
});

export const insertFeedRunSchema = createInsertSchema(feedRunsTable).omit({
  id: true,
});
export type InsertFeedRun = z.infer<typeof insertFeedRunSchema>;
export type FeedRun = typeof feedRunsTable.$inferSelect;
