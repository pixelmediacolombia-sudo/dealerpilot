import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const feedsTable = pgTable("feeds", {
  id: serial("id").primaryKey(),
  dealerId: integer("dealer_id").notNull(),
  url: text("url").notNull(),
  format: text("format").notNull().default("xml"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFeedSchema = createInsertSchema(feedsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFeed = z.infer<typeof insertFeedSchema>;
export type Feed = typeof feedsTable.$inferSelect;
