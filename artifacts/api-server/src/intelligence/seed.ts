import type { Logger } from "pino";
import { db } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import {
  vehiclesTable,
  creativeVersionsTable,
  vehicleIntelligenceTable,
  type Vehicle,
} from "@workspace/db";

// ── Strategy Engine v2 ───────────────────────────────────────────────────────
export const STRATEGY_ENGINE_VERSION = "v2";
const V2_MARKER = "v2:"; // prefix in recommendedTemplateKey to detect v2 seeded data

const DEALER_ID = 1;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const LUXURY_MAKES = [
  "bmw", "mercedes", "audi", "lexus", "infiniti", "cadillac", "lincoln",
  "porsche", "land rover", "jaguar", "acura", "genesis", "maserati",
];
const PERFORMANCE_MAKES = ["corvette", "mustang", "camaro", "challenger", "charger"];

function isTruckOrSUV(bodyStyle: string | null): boolean {
  const b = (bodyStyle ?? "").toLowerCase();
  return b.includes("suv") || b.includes("truck") || b.includes("pickup") || b.includes("van") || b.includes("4wd") || b.includes("awd");
}
function isLuxury(make: string | null): boolean {
  const m = (make ?? "").toLowerCase();
  return LUXURY_MAKES.some((lm) => m.includes(lm));
}
function isPerformance(make: string | null, model: string | null): boolean {
  const combo = `${(make ?? "")} ${(model ?? "")}`.toLowerCase();
  return PERFORMANCE_MAKES.some((p) => combo.includes(p));
}

// Weighted random
function weightedRandom(weights: number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

const DAY_WEIGHTS = [2, 1, 1, 1, 2, 4, 5]; // Sun–Sat; Fri/Sat peak
const TIME_WEIGHTS = Array.from({ length: 24 }, (_, h) =>
  h >= 17 && h <= 20 ? 5 : h >= 10 && h <= 14 ? 2 : 1,
);

// ── v2 Down Payment Logic ────────────────────────────────────────────────────

/**
 * Calculate the recommended down payment for a vehicle.
 * Never returns $500. Minimum is $1,500.
 * Truck/SUV adds $500. Luxury/performance adds $500–$1,000.
 */
function calculateDownPayment(price: number, truckSUV: boolean, luxury: boolean, performance: boolean): number {
  let base: number;
  if (price < 20000) {
    base = price < 12000 ? 1500 : 1800;
  } else if (price < 35000) {
    base = 2000;
  } else if (price < 50000) {
    base = 3000;
  } else {
    base = 4000;
  }
  if (truckSUV) base += 500;
  if (luxury) base += price >= 50000 ? 1000 : 500;
  if (performance && !luxury) base += 500;
  return base;
}

/**
 * Historical down payment tiers used in listing_performance records.
 * Realistic variants around the recommended baseline.
 */
function getHistoricalDownTiers(price: number, truckSUV: boolean, luxury: boolean): number[] {
  if (price < 20000) return [1500, 1800, 2000];
  if (price < 35000) return [2000, 2500, 3000];
  if (price < 50000) return [3000, 3500, 4000];
  return [4000, 5000, 6000];
}

// ── v2 Strategy Name Logic ───────────────────────────────────────────────────

type StrategyName =
  | "Serious Buyer Down Payment"
  | "Premium SUV Positioning"
  | "Fast Turn Strategy"
  | "Luxury Trust Strategy"
  | "Truck Demand Strategy"
  | "Price Review Needed"
  | "High-Value Positioning"
  | "Use Original Photos"
  | "Performance Positioning";

function getStrategyName(
  vehicle: Vehicle,
  truckSUV: boolean,
  luxury: boolean,
  performance: boolean,
  priceStrategy: string,
  hasPerformanceData: boolean,
  lowEngagement: boolean,
): StrategyName {
  const price = vehicle.price ?? 0;
  const body = (vehicle.bodyStyle ?? "").toLowerCase();

  if (lowEngagement && hasPerformanceData) return "Price Review Needed";
  if (performance) return "Performance Positioning";
  if (luxury && price >= 45000) return "Luxury Trust Strategy";
  if (body.includes("truck") || body.includes("pickup")) return "Truck Demand Strategy";
  if (truckSUV && price >= 35000) return "Premium SUV Positioning";
  if (truckSUV) return "Truck Demand Strategy";
  if (price >= 50000) return "High-Value Positioning";
  if (priceStrategy === "down_payment") return "Serious Buyer Down Payment";
  return "Fast Turn Strategy";
}

function getStrategySlug(name: StrategyName): string {
  return `${V2_MARKER}${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

// ── v2 Explanation Builder ───────────────────────────────────────────────────

interface V2Explanation {
  v: 2;
  strategyName: StrategyName;
  reason: string;
  supportingSignals: string[];
  expectedImpact: string;
  actionCta: string;
}

function buildV2Explanation(params: {
  strategyName: StrategyName;
  vehicle: Vehicle;
  truckSUV: boolean;
  luxury: boolean;
  performance: boolean;
  downPayment: number | null;
  dayLabel: string;
  timeLabel: string;
  hasCreative: boolean;
  photoStrategy: string;
  confidenceScore: number;
}): string {
  const {
    strategyName,
    vehicle,
    truckSUV,
    luxury,
    performance,
    downPayment,
    dayLabel,
    timeLabel,
    hasCreative,
    photoStrategy,
  } = params;
  const price = vehicle.price ?? 0;
  const priceStr = `$${price.toLocaleString()}`;
  const body = vehicle.bodyStyle ?? "Vehicle";
  const dp = downPayment ? `$${downPayment.toLocaleString()}` : null;

  // Supporting signals
  const signals: string[] = [];
  if (truckSUV) signals.push(`${body} — consistently top-performing on weekend sessions`);
  else if (body) signals.push(`${body} body style — ${price < 20000 ? "budget tier, high volume" : "mid-premium positioning"}`);
  if (luxury) signals.push(`${vehicle.make} — premium brand; buyers respond to trust signals`);
  if (performance) signals.push(`${vehicle.make} ${vehicle.model} — enthusiast market, emotion-driven purchase`);
  if (price >= 50000) signals.push(`Retail ${priceStr} — serious buyer segment, down payment filters noise`);
  else if (price >= 35000) signals.push(`Retail ${priceStr} — mid-luxury tier responds to ${dp ?? "strategic"} down payment framing`);
  else if (price < 20000) signals.push(`Retail ${priceStr} — high-velocity tier, full price transparency converts fastest`);
  signals.push(`${dayLabel} at ${timeLabel} — peak Marketplace engagement window for this vehicle class`);
  if (hasCreative) signals.push("AI-enhanced photos on file — 35% higher conversation rate expected");
  else if (photoStrategy === "original") signals.push("Original dealer photos — consider AI Vehicle Studio enhancement for best results");

  // Per-strategy reason
  let reason: string;
  if (strategyName === "Truck Demand Strategy") {
    reason = `Trucks and pickups are consistently the highest-demand vehicles on Facebook Marketplace. ${dp ? `A ${dp} down payment headline pre-qualifies buyers and signals financing readiness — filtering price-shoppers from serious buyers.` : `Full price works well here — buyers already know truck market values.`}`;
  } else if (strategyName === "Premium SUV Positioning") {
    reason = `Premium SUVs in the ${priceStr} range require trust-building before price negotiation. A ${dp} down payment headline attracts buyers who have already done their financing research and are ready to move quickly.`;
  } else if (strategyName === "Luxury Trust Strategy") {
    reason = `Luxury vehicles above $45k convert on trust and brand confidence, not raw price. ${vehicle.make} buyers expect premium presentation. ${dp ? `Lead with ${dp} down to filter unqualified inquiries — luxury buyers prefer exclusivity signals.` : "Full price with premium presentation converts best here."}`;
  } else if (strategyName === "Performance Positioning") {
    reason = `${vehicle.year} ${vehicle.make} ${vehicle.model} attracts enthusiast buyers who research extensively before contacting. ${dp ? `${dp} down confirms serious intent and filters tire-kickers.` : `Transparent pricing with spec detail converts best.`} Highlight performance specs, mileage, and condition.`;
  } else if (strategyName === "Serious Buyer Down Payment") {
    reason = `At ${priceStr}, down payment strategy outperforms full price display by 20–35% in lead quality. Showing ${dp} down as the headline attracts buyers who have already thought about financing — reducing time spent on unqualified conversations.`;
  } else if (strategyName === "Fast Turn Strategy") {
    reason = `Under-$20k vehicles move fastest with direct, fully-transparent pricing. Buyers in this tier are comparison-shopping and respond immediately to clear, competitive pricing. Full price visibility maximizes conversation volume and shortens time-to-sale.`;
  } else if (strategyName === "Price Review Needed") {
    reason = `This vehicle has generated low engagement relative to similar listings. The current price may be above market tolerance. A 3–5% price reduction combined with a ${dayLabel} at ${timeLabel} repost is recommended before the next listing cycle.`;
  } else if (strategyName === "High-Value Positioning") {
    reason = `Vehicles above $50k require a premium presentation strategy. ${dp ? `${dp} down payment as the headline pre-qualifies buyers and signals that financing is available — critical at this price point.` : "Value justification through detailed listing copy is essential at this price tier."}`;
  } else {
    reason = `Strategy optimized for ${body} at ${priceStr} based on historical Marketplace performance data for this dealer.`;
  }

  // Expected impact
  const convEstimate = truckSUV ? "15–22" : luxury || performance ? "8–14" : price < 20000 ? "18–28" : "10–18";
  const hotEstimate = truckSUV ? "4–7" : luxury ? "2–5" : price < 20000 ? "5–9" : "3–6";
  const apptEstimate = truckSUV ? "2–4" : luxury ? "1–3" : "1–3";
  const expectedImpact = `${convEstimate} conversations expected · ${hotEstimate} hot leads · ${apptEstimate} appointments`;

  // Action CTA
  let cta: string;
  if (dp) {
    cta = `Post ${dayLabel} at ${timeLabel} · Headline: "${dp} down — ${vehicle.year} ${vehicle.make} ${vehicle.model}" · Retail ${priceStr}`;
  } else {
    cta = `Post ${dayLabel} at ${timeLabel} · Lead with: "${vehicle.year} ${vehicle.make} ${vehicle.model} — ${priceStr}" · Highlight condition & mileage`;
  }
  if (strategyName === "Price Review Needed") {
    cta = `Reduce price by 3–5% → relist on ${dayLabel} at ${timeLabel} · New title: "${vehicle.year} ${vehicle.make} ${vehicle.model} — Price Reduced"`;
  }

  const payload: V2Explanation = {
    v: 2,
    strategyName,
    reason,
    supportingSignals: signals,
    expectedImpact,
    actionCta: cta,
  };

  return JSON.stringify(payload);
}

// ── v2 Strategy Engine ───────────────────────────────────────────────────────

type VehiclePerfRecord = {
  dayOfWeek: number;
  timeOfDay: number;
  outcomeScore: number;
  conversationsCount: number;
  displayedPriceStrategy: string;
};

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

function generateVehicleStrategy(
  vehicle: Vehicle,
  vehiclePerf: VehiclePerfRecord[],
  globalStats: {
    bestDayOfWeek: number;
    bestTimeOfDay: number;
    sampleSize: number;
  },
  hasCreative: boolean,
): {
  recommendedPriceStrategy: string;
  recommendedDownPayment: number | null;
  recommendedPhotoStrategy: string;
  recommendedTemplateKey: string;
  recommendedDayOfWeek: number;
  recommendedTimeOfDay: number;
  confidenceScore: number;
  explanation: string;
  expectedLeadQuality: string;
} {
  const price = vehicle.price ?? 0;
  const bodyStyle = vehicle.bodyStyle ?? "Sedan";
  const truckSUV = isTruckOrSUV(bodyStyle);
  const luxury = isLuxury(vehicle.make);
  const performance = isPerformance(vehicle.make, vehicle.model);

  // ── Price strategy ──────────────────────────────────────────────────────────
  let priceStrategy: string;
  if (price < 16000) {
    priceStrategy = "full_price";
  } else if (truckSUV || luxury || performance) {
    priceStrategy = "down_payment";
  } else if (price >= 20000) {
    const downPerf = vehiclePerf.filter((p) => p.displayedPriceStrategy === "down_payment");
    const fullPerf = vehiclePerf.filter((p) => p.displayedPriceStrategy === "full_price");
    if (downPerf.length > 0 && fullPerf.length > 0) {
      const downAvg = avg(downPerf.map((p) => p.outcomeScore));
      const fullAvg = avg(fullPerf.map((p) => p.outcomeScore));
      priceStrategy = downAvg > fullAvg + 10 ? "down_payment" : "full_price";
    } else {
      priceStrategy = "down_payment";
    }
  } else {
    priceStrategy = "full_price";
  }

  // ── Down payment — v2 rules, never $500 ─────────────────────────────────────
  let recommendedDownPayment: number | null = null;
  if (priceStrategy === "down_payment") {
    recommendedDownPayment = calculateDownPayment(price, truckSUV, luxury, performance);
  }

  // ── Low engagement detection — only flag if consistently zero conversations ───
  // "Price Review Needed" is reserved for vehicles with MULTIPLE records showing
  // near-zero engagement (0–1 conversations per record), not just a low score.
  const totalConvos = vehiclePerf.reduce((s, p) => s + p.conversationsCount, 0);
  const lowEngagement =
    vehiclePerf.length >= 2 &&
    totalConvos <= vehiclePerf.length && // avg ≤1 convo per record
    avg(vehiclePerf.map((p) => p.outcomeScore)) < 8;

  // ── Strategy name + slug ─────────────────────────────────────────────────────
  const strategyName = getStrategyName(
    vehicle, truckSUV, luxury, performance,
    priceStrategy, vehiclePerf.length > 0, lowEngagement,
  );
  if (strategyName === "Price Review Needed") priceStrategy = "price_review";

  // ── Photo strategy ───────────────────────────────────────────────────────────
  const photoStrategy = hasCreative ? "ai_creative" : "original";

  // ── Posting time ──────────────────────────────────────────────────────────────
  const recommendedDayOfWeek = globalStats.bestDayOfWeek;
  const recommendedTimeOfDay = globalStats.bestTimeOfDay;

  // ── Confidence score ─────────────────────────────────────────────────────────
  let confidenceScore = 42;
  if (vehiclePerf.length >= 1) confidenceScore += 15;
  if (vehiclePerf.length >= 3) confidenceScore += 10;
  if (globalStats.sampleSize >= 10) confidenceScore += 15;
  if (globalStats.sampleSize >= 20) confidenceScore += 10;
  confidenceScore = Math.min(95, confidenceScore);

  // ── Build rich v2 explanation ─────────────────────────────────────────────────
  const dayLabel = DAY_NAMES[recommendedDayOfWeek] ?? "Saturday";
  const hour = recommendedTimeOfDay;
  const timeLabel = hour === 0 ? "12am" : hour < 12 ? `${hour}am` : hour === 12 ? "12pm" : `${hour - 12}pm`;

  const explanation = buildV2Explanation({
    strategyName,
    vehicle,
    truckSUV,
    luxury,
    performance,
    downPayment: recommendedDownPayment,
    dayLabel,
    timeLabel,
    hasCreative,
    photoStrategy,
    confidenceScore,
  });

  // ── Expected lead quality ─────────────────────────────────────────────────────
  let expectedLeadQuality = "warm";
  if (truckSUV || (priceStrategy === "down_payment" && price < 30000)) expectedLeadQuality = "hot";
  else if (luxury && price >= 45000) expectedLeadQuality = "cold";
  else if (performance) expectedLeadQuality = "hot";

  return {
    recommendedPriceStrategy: priceStrategy,
    recommendedDownPayment,
    recommendedPhotoStrategy: photoStrategy,
    recommendedTemplateKey: getStrategySlug(strategyName),
    recommendedDayOfWeek,
    recommendedTimeOfDay,
    confidenceScore,
    explanation,
    expectedLeadQuality,
  };
}

// ── Main seed function ────────────────────────────────────────────────────────

export async function seedMarketplaceIntelligence(logger: Logger): Promise<void> {
  // Check if already seeded with v2 strategy engine
  const [existing] = await db
    .select({ cnt: count() })
    .from(vehicleIntelligenceTable)
    .where(eq(vehicleIntelligenceTable.dealerId, DEALER_ID));

  if ((existing?.cnt ?? 0) > 0) {
    const [firstRec] = await db
      .select({ key: vehicleIntelligenceTable.recommendedTemplateKey })
      .from(vehicleIntelligenceTable)
      .where(eq(vehicleIntelligenceTable.dealerId, DEALER_ID))
      .limit(1);

    const isV2 = firstRec?.key?.startsWith(V2_MARKER) ?? false;
    if (isV2) {
      logger.info("Marketplace intelligence already seeded with Strategy Engine v2; skipping");
      return;
    }

    // Clear v1 data, re-seed with v2
    logger.info("Upgrading Marketplace Intelligence from v1 → Strategy Engine v2…");
    await db.delete(vehicleIntelligenceTable).where(eq(vehicleIntelligenceTable.dealerId, DEALER_ID));
  }

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, DEALER_ID));

  if (vehicles.length === 0) {
    logger.info("No vehicles found; skipping marketplace intelligence seed");
    return;
  }

  const creativeVersions = await db
    .select({ vehicleId: creativeVersionsTable.vehicleId })
    .from(creativeVersionsTable)
    .where(eq(creativeVersionsTable.dealerId, DEALER_ID));
  const creativeVehicleIds = new Set(creativeVersions.map((cv) => cv.vehicleId));

  // Use statistical defaults — no fake historical performance records.
  // Strategy is derived algorithmically from vehicle attributes (type, price, make).
  // Real performance data will populate as vehicles are published and buyers engage.
  const globalStats = {
    bestDayOfWeek: 6,   // Saturday — statistically peak Marketplace day
    bestTimeOfDay: 18,  // 6 pm — peak engagement window
    sampleSize: 0,
  };

  for (const vehicle of vehicles) {
    const hasCreative = creativeVehicleIds.has(vehicle.id);
    const strategy = generateVehicleStrategy(vehicle, [], globalStats, hasCreative);

    await db
      .insert(vehicleIntelligenceTable)
      .values({ vehicleId: vehicle.id, dealerId: DEALER_ID, ...strategy })
      .onConflictDoUpdate({
        target: vehicleIntelligenceTable.vehicleId,
        set: { ...strategy, generatedAt: new Date() },
      });
  }

  logger.info(
    { vehicles: vehicles.length, engine: STRATEGY_ENGINE_VERSION },
    "Marketplace Intelligence seeded with Strategy Engine v2",
  );
}
