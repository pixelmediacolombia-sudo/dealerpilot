import type { Logger } from "pino";
import { db } from "@workspace/db";
import { eq, count, isNull, or, and, sql } from "drizzle-orm";
import {
  vehiclesTable,
  creativeVersionsTable,
  creativeScoresTable,
  vehicleIntelligenceTable,
  listingPerformanceTable,
  conversationsTable,
  leadsTable,
  vehicleImagesTable,
  aiPhotoJobsTable,
  listingsTable,
  workerStateTable,
  type Vehicle,
} from "@workspace/db";
import {
  computeOpportunityScores,
  computePriceMedians,
  type PerfRecord,
} from "./opportunityEngine";
import {
  computeDemandScores,
  DEFAULT_DEMAND_WEIGHTS,
  DEMAND_WEIGHTS_VERSION,
  type DemandWeights,
} from "./demandEngine";

// ── Strategy Engine v2 ───────────────────────────────────────────────────────
export const STRATEGY_ENGINE_VERSION = "v2";
const V2_MARKER = "v2:"; // prefix in recommendedTemplateKey to detect v2 seeded data

const DEALER_ID = 1;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function ensureVehicleIntelligenceUpsertTarget(logger: Logger): Promise<void> {
  try {
    await db.execute(sql`
      with ranked as (
        select
          id,
          row_number() over (
            partition by vehicle_id
            order by generated_at desc nulls last, id desc
          ) as rn
        from vehicle_intelligence
      )
      delete from vehicle_intelligence vi
      using ranked r
      where vi.id = r.id
        and r.rn > 1
    `);

    await db.execute(sql`
      create unique index if not exists vehicle_intelligence_vehicle_idx
      on vehicle_intelligence (vehicle_id)
    `);

    await db.execute(sql`
      create unique index if not exists vehicle_intelligence_vehicle_id_unique_idx
      on vehicle_intelligence (vehicle_id)
    `);
  } catch (err) {
    logger.error({ err }, "Failed to ensure vehicle_intelligence upsert target");
    throw err;
  }
}

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

  const convEstimate = truckSUV ? "15–22" : luxury || performance ? "8–14" : price < 20000 ? "18–28" : "10–18";
  const hotEstimate = truckSUV ? "4–7" : luxury ? "2–5" : price < 20000 ? "5–9" : "3–6";
  const apptEstimate = truckSUV ? "2–4" : luxury ? "1–3" : "1–3";
  const expectedImpact = `${convEstimate} conversations expected · ${hotEstimate} hot leads · ${apptEstimate} appointments`;

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

  let recommendedDownPayment: number | null = null;
  if (priceStrategy === "down_payment") {
    recommendedDownPayment = calculateDownPayment(price, truckSUV, luxury, performance);
  }

  const totalConvos = vehiclePerf.reduce((s, p) => s + p.conversationsCount, 0);
  const lowEngagement =
    vehiclePerf.length >= 2 &&
    totalConvos <= vehiclePerf.length &&
    avg(vehiclePerf.map((p) => p.outcomeScore)) < 8;

  const strategyName = getStrategyName(
    vehicle, truckSUV, luxury, performance,
    priceStrategy, vehiclePerf.length > 0, lowEngagement,
  );
  if (strategyName === "Price Review Needed") priceStrategy = "price_review";

  const photoStrategy = hasCreative ? "ai_creative" : "original";

  const recommendedDayOfWeek = globalStats.bestDayOfWeek;
  const recommendedTimeOfDay = globalStats.bestTimeOfDay;

  let confidenceScore = 42;
  if (vehiclePerf.length >= 1) confidenceScore += 15;
  if (vehiclePerf.length >= 3) confidenceScore += 10;
  if (globalStats.sampleSize >= 10) confidenceScore += 15;
  if (globalStats.sampleSize >= 20) confidenceScore += 10;
  confidenceScore = Math.min(95, confidenceScore);

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

// ── Opportunity Score Seed ────────────────────────────────────────────────────

export async function seedOpportunityScores(
  logger: Logger,
  opts?: { forceRefresh?: boolean; force?: boolean },
): Promise<void> {
  await ensureVehicleIntelligenceUpsertTarget(logger);

  // Check if any rows are missing v1.2 buyer segment fields
  const [nullCheck] = await db
    .select({ cnt: count() })
    .from(vehicleIntelligenceTable)
    .where(
      and(
        eq(vehicleIntelligenceTable.dealerId, DEALER_ID),
        or(
          isNull(vehicleIntelligenceTable.opportunityScore),
          isNull(vehicleIntelligenceTable.recommendedAction),
          isNull(vehicleIntelligenceTable.primarySegment),
        ),
      ),
    );

  const [vehicleCount] = await db
    .select({ cnt: count() })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, DEALER_ID));

  const [intelligenceCount] = await db
    .select({ cnt: count() })
    .from(vehicleIntelligenceTable)
    .where(eq(vehicleIntelligenceTable.dealerId, DEALER_ID));

  const needsScoring =
    (opts?.forceRefresh ?? opts?.force ?? false) ||
    (nullCheck?.cnt ?? 0) > 0 ||
    (intelligenceCount?.cnt ?? 0) < (vehicleCount?.cnt ?? 0);
  if (!needsScoring) {
    logger.info("Opportunity scores already computed; skipping");
    return;
  }

  logger.info("Computing Opportunity Scores for all vehicles…");

  // Fetch all active vehicles
  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, DEALER_ID));

  if (vehicles.length === 0) return;

  // Load calibrated demand weights from the learning worker's last run
  // (falls back to hardcoded defaults on first run or if no calibration exists)
  let demandWeights: DemandWeights = DEFAULT_DEMAND_WEIGHTS;
  let demandWeightsVersion = DEMAND_WEIGHTS_VERSION;
  try {
    const [learningState] = await db
      .select({ lastResultJson: workerStateTable.lastResultJson })
      .from(workerStateTable)
      .where(eq(workerStateTable.workerId, "learning"))
      .limit(1);

    if (learningState?.lastResultJson) {
      const stored = JSON.parse(learningState.lastResultJson) as {
        detail?: { demandWeights?: DemandWeights; demandWeightsVersion?: string };
      };
      const w = stored.detail?.demandWeights;
      const v = stored.detail?.demandWeightsVersion;
      if (w && typeof w === "object" && Object.keys(w).length >= 10) {
        demandWeights = w;
        demandWeightsVersion = v ?? demandWeightsVersion;
        logger.info({ version: demandWeightsVersion }, "Demand weights loaded from learning worker");
      }
    }
  } catch {
    logger.info("Using default demand weights (no calibration data yet)");
  }

  // Batch-fetch all supporting data in one round-trip
  const [
    allPerf,
    allConvos,
    allLeads,
    allCreativeVersions,
    allCreativeScores,
    allPhotoCounts,
    allAiJobs,
    allPublishedListings,
    spanishConvoCount,
    totalConvoCount,
  ] = await Promise.all([
    db.select().from(listingPerformanceTable).where(eq(listingPerformanceTable.dealerId, DEALER_ID)),
    db.select({ vehicleId: conversationsTable.vehicleId, id: conversationsTable.id })
      .from(conversationsTable).where(eq(conversationsTable.dealerId, DEALER_ID)),
    db.select({ vehicleId: leadsTable.vehicleId, temperature: leadsTable.temperature })
      .from(leadsTable).where(eq(leadsTable.dealerId, DEALER_ID)),
    db.select({ vehicleId: creativeVersionsTable.vehicleId, id: creativeVersionsTable.id })
      .from(creativeVersionsTable).where(eq(creativeVersionsTable.dealerId, DEALER_ID)),
    db.select({ creativeVersionId: creativeScoresTable.creativeVersionId, overallScore: creativeScoresTable.overall })
      .from(creativeScoresTable),
    // Photo counts per vehicle
    db.select({ vehicleId: vehicleImagesTable.vehicleId, id: vehicleImagesTable.id })
      .from(vehicleImagesTable),
    // AI photo jobs — only Completed ones signal actual enhanced photos
    db.select({ vehicleId: aiPhotoJobsTable.vehicleId, status: aiPhotoJobsTable.status })
      .from(aiPhotoJobsTable),
    // Currently Published Marketplace listings
    db.select({ vehicleId: listingsTable.vehicleId })
      .from(listingsTable)
      .where(eq(listingsTable.status, "Published")),
    // Spanish conversation count (for Latino buyer preference signal)
    db.select({ cnt: count() })
      .from(conversationsTable)
      .where(and(eq(conversationsTable.dealerId, DEALER_ID), eq(conversationsTable.language, "es"))),
    // Total conversation count (denominator for Spanish ratio)
    db.select({ cnt: count() })
      .from(conversationsTable)
      .where(eq(conversationsTable.dealerId, DEALER_ID)),
  ]);

  // Build lookup maps
  const photoCountByVehicle = new Map<number, number>();
  for (const r of allPhotoCounts) {
    photoCountByVehicle.set(r.vehicleId, (photoCountByVehicle.get(r.vehicleId) ?? 0) + 1);
  }

  const aiPhotosCompletedByVehicle = new Set<number>();
  for (const r of allAiJobs) {
    if (r.status === "Completed") aiPhotosCompletedByVehicle.add(r.vehicleId);
  }

  const publishedVehicleIds = new Set<number>(allPublishedListings.map((r) => r.vehicleId));

  const perfByVehicle = new Map<number, PerfRecord[]>();
  for (const r of allPerf) {
    const arr = perfByVehicle.get(r.vehicleId) ?? [];
    arr.push({ outcomeScore: r.outcomeScore, conversationsCount: r.conversationsCount, hotLeadsCount: r.hotLeadsCount });
    perfByVehicle.set(r.vehicleId, arr);
  }

  const convosByVehicle = new Map<number, number>();
  for (const r of allConvos) {
    if (r.vehicleId == null) continue;
    convosByVehicle.set(r.vehicleId, (convosByVehicle.get(r.vehicleId) ?? 0) + 1);
  }

  const hotLeadsByVehicle = new Map<number, number>();
  const leadsByVehicle = new Map<number, number>();
  for (const r of allLeads) {
    if (r.vehicleId == null) continue;
    leadsByVehicle.set(r.vehicleId, (leadsByVehicle.get(r.vehicleId) ?? 0) + 1);
    if (r.temperature === "Hot") {
      hotLeadsByVehicle.set(r.vehicleId, (hotLeadsByVehicle.get(r.vehicleId) ?? 0) + 1);
    }
  }

  // ── Demand Engine signal maps ───────────────────────────────────────────────

  // Spanish conversation ratio (dealer-wide — used as a market signal for all vehicles)
  const totalConvos = Number(totalConvoCount[0]?.cnt ?? 0);
  const spanishConvos = Number(spanishConvoCount[0]?.cnt ?? 0);
  const spanishConversationRatio = totalConvos > 0 ? spanishConvos / totalConvos : 0;

  // Appointment and sales counts per vehicle (from listing_performance)
  const apptCountByVehicle = new Map<number, number>();
  const salesCountByVehicle = new Map<number, number>();
  for (const r of allPerf) {
    apptCountByVehicle.set(r.vehicleId, (apptCountByVehicle.get(r.vehicleId) ?? 0) + r.appointmentReadyCount);
    salesCountByVehicle.set(r.vehicleId, (salesCountByVehicle.get(r.vehicleId) ?? 0) + r.soldCount);
  }

  // Body-type level outcome aggregates (marketplace popularity signal)
  // vehicleId → bodyStyle lookup (built from vehicles we already have)
  const bodyStyleByVehicle = new Map<number, string>();
  for (const v of vehicles) {
    if (v.bodyStyle) bodyStyleByVehicle.set(v.id, v.bodyStyle);
  }

  const bodyTypeOutcomeMap = new Map<string, { total: number; count: number }>();
  for (const r of allPerf) {
    const bs = bodyStyleByVehicle.get(r.vehicleId);
    if (!bs) continue;
    const existing = bodyTypeOutcomeMap.get(bs) ?? { total: 0, count: 0 };
    existing.total += r.outcomeScore;
    existing.count += 1;
    bodyTypeOutcomeMap.set(bs, existing);
  }

  // Creative scores: version → score
  const creativeScoreByVersion = new Map<number, number>();
  for (const cs of allCreativeScores) {
    if (cs.overallScore != null) creativeScoreByVersion.set(cs.creativeVersionId, cs.overallScore);
  }

  // creative version id by vehicle
  const creativeVersionsByVehicle = new Map<number, number[]>();
  for (const cv of allCreativeVersions) {
    const arr = creativeVersionsByVehicle.get(cv.vehicleId) ?? [];
    arr.push(cv.id);
    creativeVersionsByVehicle.set(cv.vehicleId, arr);
  }

  function avgCreativeScoreForVehicle(vehicleId: number): number | null {
    const versionIds = creativeVersionsByVehicle.get(vehicleId) ?? [];
    if (versionIds.length === 0) return null;
    const scores = versionIds
      .map((id) => creativeScoreByVersion.get(id))
      .filter((s): s is number => s != null);
    if (scores.length === 0) return null;
    return scores.reduce((s, n) => s + n, 0) / scores.length;
  }

  // Compute price medians from all vehicles (Active + others for better median)
  const priceMedians = computePriceMedians(vehicles);

  const now = new Date();
  let updated = 0;

  for (const vehicle of vehicles) {
    const medianKey = `${(vehicle.make ?? "").toLowerCase()}:${(vehicle.model ?? "").toLowerCase()}`;
    const scores = computeOpportunityScores({
      vehicle,
      priceMedian: priceMedians.get(medianKey) ?? null,
      perfRecords: perfByVehicle.get(vehicle.id) ?? [],
      conversationCount: convosByVehicle.get(vehicle.id) ?? 0,
      hotLeadCount: hotLeadsByVehicle.get(vehicle.id) ?? 0,
      leadCount: leadsByVehicle.get(vehicle.id) ?? 0,
      avgCreativeScore: avgCreativeScoreForVehicle(vehicle.id),
      photoCount: photoCountByVehicle.get(vehicle.id) ?? 0,
      hasAiPhotos: aiPhotosCompletedByVehicle.has(vehicle.id),
      isCurrentlyPublished: publishedVehicleIds.has(vehicle.id),
      now,
    });

    // ── Compute Marketplace Demand Score ──────────────────────────────────────
    const bodyStyle = vehicle.bodyStyle ?? "";
    const bodyTypeData = bodyTypeOutcomeMap.get(bodyStyle);
    const bodyTypeAvgOutcome = bodyTypeData ? Math.round(bodyTypeData.total / bodyTypeData.count) : 0;
    const bodyTypeListingCount = bodyTypeData?.count ?? 0;

    const demand = computeDemandScores({
      opportunityScore:          scores.opportunityScore,
      buyerSegmentScore:         scores.buyerSegmentScore,
      priceScore:                scores.priceScore,
      inventoryHealthScore:      scores.inventoryHealthScore,
      seasonalScore:             scores.seasonalScore,
      suggestedLanguage:         scores.suggestedLanguage,
      opportunityFactors:        scores.opportunityFactors,
      vehiclePrice:              vehicle.price ?? null,
      bodyTypeAvgOutcome,
      bodyTypeListingCount,
      spanishConversationRatio,
      vehicleConversations:      convosByVehicle.get(vehicle.id) ?? 0,
      vehicleHotLeads:           hotLeadsByVehicle.get(vehicle.id) ?? 0,
      vehicleAppointments:       apptCountByVehicle.get(vehicle.id) ?? 0,
      vehicleSales:              salesCountByVehicle.get(vehicle.id) ?? 0,
      duplicateConflictCount:    0, // populated by market scan worker when available
      learnedWeights:            demandWeights,
      weightsVersion:            demandWeightsVersion,
    });

    await db
      .insert(vehicleIntelligenceTable)
      .values({
        vehicleId: vehicle.id,
        dealerId: DEALER_ID,
        ...scores,
        opportunityFactors: JSON.stringify(scores.opportunityFactors),
        demandScore: demand.demandScore,
        demandLabel: demand.demandLabel,
        demandFactors: JSON.stringify(demand.demandFactors),
        marketplacePopularityScore: demand.marketplacePopularityScore,
        latinoPreferenceScore: demand.latinoPreferenceScore,
        financingProbabilityScore: demand.financingProbabilityScore,
        historicalEngagementScore: demand.historicalEngagementScore,
        duplicateSaturationScore: demand.duplicateSaturationScore,
        demandWeightsVersion: demand.demandWeightsVersion,
      })
      .onConflictDoUpdate({
        target: vehicleIntelligenceTable.vehicleId,
        set: {
          opportunityScore: scores.opportunityScore,
          opportunityLabel: scores.opportunityLabel,
          recommendedAction: scores.recommendedAction,
          marketDemandScore: scores.marketDemandScore,
          priceScore: scores.priceScore,
          vehicleQualityScore: scores.vehicleQualityScore,
          buyerSegmentScore: scores.buyerSegmentScore,
          seasonalScore: scores.seasonalScore,
          dealerPerformanceScore: scores.dealerPerformanceScore,
          buyerDemandScore: scores.buyerDemandScore,
          inventoryHealthScore: scores.inventoryHealthScore,
          creativePerformanceScore: scores.creativePerformanceScore,
          pricingPosition: scores.pricingPosition,
          daysOnLot: scores.daysOnLot,
          opportunityFactors: JSON.stringify(scores.opportunityFactors),
          primarySegment: scores.primarySegment,
          secondarySegment: scores.secondarySegment ?? null,
          adAngle: scores.adAngle,
          suggestedLanguage: scores.suggestedLanguage,
          whyThisAudience: scores.whyThisAudience,
          // Demand Engine v1
          demandScore: demand.demandScore,
          demandLabel: demand.demandLabel,
          demandFactors: JSON.stringify(demand.demandFactors),
          marketplacePopularityScore: demand.marketplacePopularityScore,
          latinoPreferenceScore: demand.latinoPreferenceScore,
          financingProbabilityScore: demand.financingProbabilityScore,
          historicalEngagementScore: demand.historicalEngagementScore,
          duplicateSaturationScore: demand.duplicateSaturationScore,
          demandWeightsVersion: demand.demandWeightsVersion,
        },
      });
    updated++;
  }

  logger.info({ updated }, "Opportunity + Demand Scores seeded");
}

// ── Main seed function ────────────────────────────────────────────────────────

export async function seedMarketplaceIntelligence(logger: Logger): Promise<void> {
  await ensureVehicleIntelligenceUpsertTarget(logger);

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
      logger.info("Marketplace intelligence already seeded with Strategy Engine v2; skipping strategy seed");
      // Always run opportunity scoring (idempotent — skips if already scored)
      await seedOpportunityScores(logger);
      return;
    }

    logger.info("Upgrading Marketplace Intelligence from v1 to Strategy Engine v2 without clearing existing opportunities");
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

  const globalStats = {
    bestDayOfWeek: 6,   // Saturday
    bestTimeOfDay: 18,  // 6pm
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

  // Always run opportunity scoring after strategy seed
  await seedOpportunityScores(logger);
}
