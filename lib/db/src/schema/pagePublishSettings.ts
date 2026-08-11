import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dealersTable } from "./dealers";

export const pagePublishSettingsTable = pgTable(
  "page_publish_settings",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id").notNull().references(() => dealersTable.id),
    enabled: boolean("enabled").notNull().default(false),
    vehiclesPerBatch: integer("vehicles_per_batch").notNull().default(3),
    frequencyDays: integer("frequency_days").notNull().default(1),
    preferredWindowStart: text("preferred_window_start").notNull().default("09:00"),
    preferredWindowEnd: text("preferred_window_end").notNull().default("17:00"),
    maxPostsPerDay: integer("max_posts_per_day").notNull().default(3),
    minDelayMinutes: integer("min_delay_minutes").notNull().default(30),
    requireApproval: boolean("require_approval").notNull().default(false),
    useOriginalPhotos: boolean("use_original_photos").notNull().default(true),
    aiCreativeIfLow: boolean("ai_creative_if_low").notNull().default(true),
    photoScoreThreshold: integer("photo_score_threshold").notNull().default(60),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("page_publish_settings_dealer_idx").on(table.dealerId)],
);

export const insertPagePublishSettingsSchema = createInsertSchema(pagePublishSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPagePublishSettings = z.infer<typeof insertPagePublishSettingsSchema>;
export type PagePublishSettings = typeof pagePublishSettingsTable.$inferSelect;
