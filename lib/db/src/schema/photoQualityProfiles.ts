import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// photo_quality_profiles — configurable quality gate thresholds.
//
// Two built-in profiles are seeded at startup:
//   1. Dealer Lot Photography (default/active) — realistic for outdoor/smartphone inventory shots.
//   2. Professional Studio                     — strict, for controlled-light premium shoots.
//
// Only one profile has is_active = true at any time.
// The enhancement pipeline reads the active profile at runtime — no thresholds in code.
export const photoQualityProfilesTable = pgTable("photo_quality_profiles", {
  id:   serial("id").primaryKey(),
  name: text("name").notNull(),

  // Quality gate thresholds (0–100). Enhanced photo must meet ALL to earn "Use Enhanced".
  marketplaceReadyThreshold: integer("marketplace_ready_threshold").notNull(),
  naturalnessThreshold:      integer("naturalness_threshold").notNull(),
  artifactThreshold:         integer("artifact_threshold").notNull(),
  improvementDelta:          integer("improvement_delta").notNull(),   // minimum overall score increase

  // Human-readable description shown in the report header.
  description: text("description"),

  // Exactly one profile is active at a time.
  isActive: boolean("is_active").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertPhotoQualityProfileSchema = createInsertSchema(
  photoQualityProfilesTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertPhotoQualityProfile = z.infer<typeof insertPhotoQualityProfileSchema>;
export type PhotoQualityProfile = typeof photoQualityProfilesTable.$inferSelect;
