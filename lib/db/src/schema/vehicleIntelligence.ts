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
// opportunityScore = weighted composite of 9 sub-scores (0–100)
// pricingPosition: "Below Market" | "Market Average" | "Above Market"
// opportunityFactors: JSON stringified string[]
//
// Marketplace Demand Engine v1 (added columns):
// demandScore = 12-signal composite (0–100) — primary ranking metric
// demandLabel: "Hot Demand" | "Strong" | "Moderate" | "Slow"
// demandFactors: JSON stringified string[] — plain-English demand bullets
// Sub-scores stored for breakdown display and weight calibration:
//   marketplacePopularityScore, latinoPreferenceScore,
//   financingProbabilityScore, historicalEngagementScore, duplicateSaturationScore
// demandWeightsVersion: tracks which learned weights were used
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
    opportunityLabel: text("opportunity_label"),
    recommendedAction: text("recommended_action"),
    // ── Opportunity Engine v1.2 — Buyer Segment Layer ─────────────────────────
    vehicleQualityScore: integer("vehicle_quality_score"),
    buyerSegmentScore: integer("buyer_segment_score"),
    primarySegment: text("primary_segment"),
    secondarySegment: text("secondary_segment"),
    adAngle: text("ad_angle"),
    suggestedLanguage: text("suggested_language"),
    whyThisAudience: text("why_this_audience"),
    // ── Marketplace Demand Engine v1 ──────────────────────────────────────────
    demandScore: integer("demand_score"),
    demandLabel: text("demand_label"),
    demandFactors: text("demand_factors"),
    marketplacePopularityScore: integer("marketplace_popularity_score"),
    latinoPreferenceScore: integer("latino_preference_score"),
    financingProbabilityScore: integer("financing_probability_score"),
    historicalEngagementScore: integer("historical_engagement_score"),
    duplicateSaturationScore: integer("duplicate_saturation_score"),
    demandWeightsVersion: text("demand_weights_version"),
  },
  (table) => [uniqueIndex("vehicle_intelligence_vehicle_idx").on(table.vehicleId)],
);

export const insertVehicleIntelligenceSchema = createInsertSchema(vehicleIntelligenceTable).omit({
  id: true,
  generatedAt: true,
});
export type InsertVehicleIntelligence = z.infer<typeof insertVehicleIntelligenceSchema>;
export type VehicleIntelligence = typeof vehicleIntelligenceTable.$inferSelect;
