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

// A deterministic 0-100 quality score for a specific listing version, broken
// down into component sub-scores. Recomputed whenever a version is generated or
// edited; one score row per evaluation is kept for history.
export const listingScoresTable = pgTable(
  "listing_scores",
  {
    id: serial("id").primaryKey(),
    listingVersionId: integer("listing_version_id").notNull(),
    vehicleId: integer("vehicle_id").notNull(),
    titleQuality: integer("title_quality").notNull(),
    descriptionQuality: integer("description_quality").notNull(),
    priceStrategy: integer("price_strategy").notNull(),
    downPaymentStrategy: integer("down_payment_strategy").notNull(),
    photoScore: integer("photo_score").notNull(),
    overall: integer("overall").notNull(),
    rating: text("rating").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("listing_scores_version_idx").on(table.listingVersionId)],
);

export const insertListingScoreSchema = createInsertSchema(listingScoresTable).omit({
  id: true,
  createdAt: true,
});
export type InsertListingScore = z.infer<typeof insertListingScoreSchema>;
export type ListingScore = typeof listingScoresTable.$inferSelect;
