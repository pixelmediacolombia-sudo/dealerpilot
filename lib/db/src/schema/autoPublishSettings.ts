import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const autoPublishSettingsTable = pgTable(
  "auto_publish_settings",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    vehiclesPerBatch: integer("vehicles_per_batch").notNull().default(4),
    frequencyDays: integer("frequency_days").notNull().default(2),
    preferredWindowStart: text("preferred_window_start").notNull().default("09:00"),
    preferredWindowEnd: text("preferred_window_end").notNull().default("17:00"),
    maxPostsPerDay: integer("max_posts_per_day").notNull().default(4),
    minDelayMinutes: integer("min_delay_minutes").notNull().default(10),
    maxDelayMinutes: integer("max_delay_minutes").notNull().default(20),
    requireApproval: boolean("require_approval").notNull().default(false),
    autoClickPublish: boolean("auto_click_publish").notNull().default(false),
    useOriginalPhotos: boolean("use_original_photos").notNull().default(true),
    aiCreativeIfLow: boolean("ai_creative_if_low").notNull().default(true),
    photoScoreThreshold: integer("photo_score_threshold").notNull().default(60),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("auto_publish_settings_dealer_idx").on(table.dealerId)],
);

export const insertAutoPublishSettingsSchema = createInsertSchema(autoPublishSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAutoPublishSettings = z.infer<typeof insertAutoPublishSettingsSchema>;
export type AutoPublishSettings = typeof autoPublishSettingsTable.$inferSelect;
