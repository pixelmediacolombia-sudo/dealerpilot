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

// Strategy recommendation for a vehicle, computed by the intelligence engine.
// One row per vehicle (upserted on each seed/refresh).
// recommendedPriceStrategy: full_price | down_payment | starting_down
// recommendedPhotoStrategy: original | ai_creative | mixed
// expectedLeadQuality: hot | warm | cold
//
// Opportunity Engine v1 (added columns):
// opportunityScore = weighted composite of 7 sub-scores (0–100)
// pricingPosition: "Below Market" | "Market Average" | "Above Market"
// opportunityFactors: JSON stringified string[]
export const vehicleIntelligenceTable = pgTable(
  "vehicle_intelligence",
  {
    id: serial("id").primaryKey(),
    vehicleId: integer("vehicle_id").notNull(),
    dealerId: integer("dealer_id").notNull(),
    recommendedPriceStrategy: text("recommended_price_strategy").notNull().default("full_price"),
    recommendedDownPayment: integer("recommended_down_payment"),
    recommendedPhotoStrategy: text("recommended_photo_strategy").notNull().default("original"),
    recommendedTemplateKey: text("recommended_template_key"),
    recommendedDayOfWeek: integer("recommended_day_of_week"),
    recommendedTimeOfDay: integer("recommended_time_of_day"),
    confidenceScore: integer("confidence_score").notNull().default(0),
    explanation: text("explanation"),
    expectedLeadQuality: text("expected_lead_quality").default("warm"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    // ── Opportunity Engine v1 ─────────────────────────────────────────────────
    opportunityScore: integer("opportunity_score"),
    marketDemandScore: integer("market_demand_score"),
    priceScore: integer("price_score"),
    seasonalScore: integer("seasonal_score"),
    dealerPerformanceScore: integer("dealer_performance_score"),
    buyerDemandScore: integer("buyer_demand_score"),
    inventoryHealthScore: integer("inventory_health_score"),
    creativePerformanceScore: integer("creative_performance_score"),
    pricingPosition: text("pricing_position"),
    daysOnLot: integer("days_on_lot"),
    opportunityFactors: text("opportunity_factors"),
  },
  (table) => [uniqueIndex("vehicle_intelligence_vehicle_idx").on(table.vehicleId)],
);

export const insertVehicleIntelligenceSchema = createInsertSchema(vehicleIntelligenceTable).omit({
  id: true,
  generatedAt: true,
});
export type InsertVehicleIntelligence = z.infer<typeof insertVehicleIntelligenceSchema>;
export type VehicleIntelligence = typeof vehicleIntelligenceTable.$inferSelect;
