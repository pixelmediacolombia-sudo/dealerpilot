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

// Per-listing performance snapshot. One row per listing attempt per vehicle.
// Populated by the intelligence seed on startup and updated as leads flow in.
// displayedPriceStrategy: full_price | down_payment | starting_down
// photoStrategy: original | ai_creative | mixed
export const listingPerformanceTable = pgTable(
  "listing_performance",
  {
    id: serial("id").primaryKey(),
    vehicleId: integer("vehicle_id").notNull(),
    listingId: integer("listing_id"),
    dealerId: integer("dealer_id").notNull(),
    marketplaceUrl: text("marketplace_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    dayOfWeek: integer("day_of_week").notNull(),
    timeOfDay: integer("time_of_day").notNull(),
    vehicleType: text("vehicle_type"),
    year: integer("year"),
    make: text("make"),
    model: text("model"),
    retailPrice: integer("retail_price"),
    displayedPriceStrategy: text("displayed_price_strategy").notNull().default("full_price"),
    publishedDownPayment: integer("published_down_payment"),
    listingVersion: integer("listing_version"),
    creativeVersion: integer("creative_version"),
    photoStrategy: text("photo_strategy").notNull().default("original"),
    publishingBatchId: integer("publishing_batch_id"),
    conversationsCount: integer("conversations_count").notNull().default(0),
    hotLeadsCount: integer("hot_leads_count").notNull().default(0),
    warmLeadsCount: integer("warm_leads_count").notNull().default(0),
    coldLeadsCount: integer("cold_leads_count").notNull().default(0),
    appointmentReadyCount: integer("appointment_ready_count").notNull().default(0),
    soldCount: integer("sold_count").notNull().default(0),
    outcomeScore: integer("outcome_score").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("listing_performance_vehicle_idx").on(table.vehicleId)],
);

export const insertListingPerformanceSchema = createInsertSchema(listingPerformanceTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertListingPerformance = z.infer<typeof insertListingPerformanceSchema>;
export type ListingPerformance = typeof listingPerformanceTable.$inferSelect;
