import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Computed priority score per vehicle for auto-publish selection.
// Higher score = selected first in a batch.
export const publishPriorityScoresTable = pgTable(
  "publish_priority_scores",
  {
    id: serial("id").primaryKey(),
    vehicleId: integer("vehicle_id").notNull(),
    dealerId: integer("dealer_id").notNull(),
    priorityScore: integer("priority_score").notNull().default(0),
    bodyStyleBonus: integer("body_style_bonus").notNull().default(0),
    priceBonus: integer("price_bonus").notNull().default(0),
    freshnessBonus: integer("freshness_bonus").notNull().default(0),
    photoBonus: integer("photo_bonus").notNull().default(0),
    neverPublishedBonus: integer("never_published_bonus").notNull().default(0),
    eligible: integer("eligible").notNull().default(1),
    ineligibleReason: text("ineligible_reason"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("publish_priority_scores_vehicle_idx").on(table.vehicleId)],
);

export const insertPublishPriorityScoreSchema = createInsertSchema(publishPriorityScoresTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPublishPriorityScore = z.infer<typeof insertPublishPriorityScoreSchema>;
export type PublishPriorityScore = typeof publishPriorityScoresTable.$inferSelect;
