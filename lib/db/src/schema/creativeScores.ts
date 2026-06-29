import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A deterministic 0-100 quality score for a creative version, broken into
// component sub-scores. One row per evaluation, kept for history. No AI is used:
// every input is measurable from the vehicle, Brand DNA, and template.
export const creativeScoresTable = pgTable(
  "creative_scores",
  {
    id: serial("id").primaryKey(),
    creativeVersionId: integer("creative_version_id").notNull(),
    vehicleId: integer("vehicle_id").notNull(),
    brandConsistency: integer("brand_consistency").notNull(),
    vehicleVisibility: integer("vehicle_visibility").notNull(),
    lighting: integer("lighting").notNull(),
    composition: integer("composition").notNull(),
    ctrPrediction: integer("ctr_prediction").notNull(),
    overall: integer("overall").notNull(),
    rating: text("rating").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("creative_scores_version_idx").on(table.creativeVersionId)],
);

export const insertCreativeScoreSchema = createInsertSchema(creativeScoresTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCreativeScore = z.infer<typeof insertCreativeScoreSchema>;
export type CreativeScore = typeof creativeScoresTable.$inferSelect;
