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

// Photo quality analysis result per vehicle.
// photoDecision: "use_original" | "use_original_recommend_ai_cover" | "generate_ai_creative" | "needs_review"
export const vehiclePhotoScoresTable = pgTable(
  "vehicle_photo_scores",
  {
    id: serial("id").primaryKey(),
    vehicleId: integer("vehicle_id").notNull(),
    dealerId: integer("dealer_id").notNull(),
    photoScore: integer("photo_score").notNull().default(0),
    photoLabel: text("photo_label").notNull().default("Unknown"),
    photoDecision: text("photo_decision").notNull().default("needs_review"),
    totalPhotos: integer("total_photos").notNull().default(0),
    uniquePhotos: integer("unique_photos").notNull().default(0),
    recommendedCoverUrl: text("recommended_cover_url"),
    needsAiCreative: integer("needs_ai_creative").notNull().default(0),
    scoreBreakdown: text("score_breakdown"),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("vehicle_photo_scores_vehicle_idx").on(table.vehicleId)],
);

export const insertVehiclePhotoScoreSchema = createInsertSchema(vehiclePhotoScoresTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVehiclePhotoScore = z.infer<typeof insertVehiclePhotoScoreSchema>;
export type VehiclePhotoScore = typeof vehiclePhotoScoresTable.$inferSelect;
