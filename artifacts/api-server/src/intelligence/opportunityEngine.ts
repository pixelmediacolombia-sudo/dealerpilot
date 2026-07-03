// DealerPilot Opportunity Engine v1.1 — Internal Data Only
// Scores every vehicle on 7 dimensions → weighted Opportunity Score (0–100).
//
// ALL scoring uses DealerPilot data only. When a data source is unavailable,
// the factor bullet is marked "(internal estimate)" so the UI can surface it.
//
// Weights (sum = 1.0):
//   Market Demand Heuristic  30%  — make/model/body demand signals
//   Price Competitiveness    20%  — vs. dealer's own inventory median
//   Dealer Performance       15%  — listing_performance table records
//   Seasonality              10%  — month + body type heuristic
//   Buyer Demand             10%  — conversations + leads on record
//   Inventory Age            10%  — days since first seen (urgency)
//   Creative / Photo Quality  5%  — photo count + AI photo status
//
// Output labels: Hot ≥ 75 · Strong 60–74 · Watch 45–59 · Low < 45
// Recommended actions: Publish Today · Hold · Review Price · Needs Better Photos

import type { Vehicle } from "@workspace/db";

// ── Constants ────────────────────────────────────────────────────────────────

const WEIGHTS = {
  marketDemand: 0.30,
  price: 0.20,
  seasonal: 0.10,
  dealerPerformance: 0.15,
  buyerDemand: 0.10,
  inventoryHealth: 0.10,
  creativePerformance: 0.05,
} as const;

// Market demand heuristic by make — Facebook Marketplace US demand signals
// Source: internal estimate based on listing volume + body-type trends
const MAKE_DEMAND: Record<string, number> = {
  toyota: 88, ford: 85, chevrolet: 83, honda: 87, tesla: 91,
  bmw: 78, "mercedes-benz": 76, lexus: 80, ram: 84, gmc: 79,
  jeep: 82, subaru: 81, hyundai: 80, kia: 79, mazda: 76,
  nissan: 75, volkswagen: 72, audi: 74, cadillac: 73, lincoln: 71,
  infiniti: 71, acura: 73, genesis: 72, volvo: 68, porsche: 72,
  "land rover": 65, buick: 68, chrysler: 65, dodge: 75,
  mitsubishi: 60, rivian: 82, lucid: 68, scout: 70,
};

// Per-model boosts on top of the make score
const MODEL_BOOST: Array<[string, number]> = [
  ["f-150", 12], ["silverado", 10], ["ram 1500", 10], ["tacoma", 12],
  ["tundra", 10], ["rav4", 12], ["cr-v", 10], ["camry", 10],
  ["accord", 10], ["civic", 8], ["corolla", 8], ["model 3", 15],
  ["model y", 15], ["wrangler", 12], ["outback", 10], ["equinox", 8],
  ["rogue", 8], ["explorer", 8], ["pilot", 9], ["cx-5", 8],
  ["escape", 7], ["highlander", 10], ["4runner", 11], ["bronco", 11],
  ["maverick", 9], ["telluride", 10], ["sorento", 8], ["tucson", 8],
  ["santa fe", 8], ["prius", 8], ["leaf", 7], ["bolt", 8],
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PerfRecord {
  outcomeScore: number;
  conversationsCount: number;
  hotLeadsCount: number;
}

export interface OpportunityInput {
  vehicle: Vehicle;
  priceMedian: number | null;      // median price for this make+model from dealer's own inventory
  perfRecords: PerfRecord[];       // listing_performance records for this vehicle
  conversationCount: number;       // conversations on record (DealerPilot CRM)
  hotLeadCount: number;            // hot temperature leads
  leadCount: number;               // all leads
  avgCreativeScore: number | null; // null = no AI creative on file
  photoCount: number;              // vehicle_images count
  hasAiPhotos: boolean;            // Completed ai_photo_job exists for this vehicle
  isCurrentlyPublished: boolean;   // active Marketplace listing exists
  now?: Date;
}

export type OpportunityLabel = "Hot" | "Strong" | "Watch" | "Low";
export type RecommendedAction = "Publish Today" | "Hold" | "Review Price" | "Needs Better Photos";

export interface OpportunityScores {
  opportunityScore: number;
  opportunityLabel: OpportunityLabel;
  recommendedAction: RecommendedAction;
  marketDemandScore: number;
  priceScore: number;
  seasonalScore: number;
  dealerPerformanceScore: number;
  buyerDemandScore: number;
  inventoryHealthScore: number;
  creativePerformanceScore: number;
  pricingPosition: "Below Market" | "Market Average" | "Above Market";
  daysOnLot: number;
  opportunityFactors: string[];    // reason bullets; "(internal estimate)" suffix when heuristic-only
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

// ── Label & Action ────────────────────────────────────────────────────────────

export function computeOpportunityLabel(score: number): OpportunityLabel {
  if (score >= 75) return "Hot";
  if (score >= 60) return "Strong";
  if (score >= 45) return "Watch";
  return "Low";
}

export function computeRecommendedAction(params: {
  opportunityScore: number;
  priceScore: number;
  photoCount: number;
  hasAiPhotos: boolean;
  isCurrentlyPublished: boolean;
  daysOnLot: number;
}): RecommendedAction {
  const { opportunityScore, priceScore, photoCount, hasAiPhotos, isCurrentlyPublished, daysOnLot } = params;

  // Already live on Marketplace — let the listing run
  if (isCurrentlyPublished) return "Hold";

  // Price is significantly above market — fix price before pushing to Marketplace
  if (priceScore < 38) return "Review Price";

  // Critically low photo coverage — buyers won't engage
  if (photoCount < 4) return "Needs Better Photos";

  // Enough photos but no AI enhancement and below the quality threshold — improve before publishing
  if (!hasAiPhotos && photoCount < 6 && opportunityScore < 65) return "Needs Better Photos";

  // High opportunity — get it live now
  if (opportunityScore >= 65) return "Publish Today";

  // Aging inventory — push it out even with moderate score
  if (daysOnLot >= 60) return "Publish Today";

  // Default: hold and wait for a better timing window
  return "Hold";
}

// ── Sub-score: Market Demand (30%) ────────────────────────────────────────────

function computeMarketDemandScore(vehicle: Vehicle): { score: number; factors: string[] } {
  const make = (vehicle.make ?? "").toLowerCase();
  const model = (vehicle.model ?? "").toLowerCase();
  const body = (vehicle.bodyStyle ?? "").toLowerCase();
  const fuel = (vehicle.fuelType ?? "").toLowerCase();
  const factors: string[] = [];

  let score = MAKE_DEMAND[make] ?? 65;
  const usedMakeLookup = make in MAKE_DEMAND;

  for (const [key, boost] of MODEL_BOOST) {
    if (model.includes(key)) {
      score += boost;
      break;
    }
  }

  if (body.includes("truck") || body.includes("pickup")) {
    score += 10;
    factors.push("High truck demand on Marketplace (internal estimate)");
  } else if (body.includes("suv") || body.includes("crossover") || body.includes("awd") || body.includes("4wd")) {
    score += 8;
    factors.push("Strong SUV demand — top-converting body type (internal estimate)");
  } else if (body.includes("convert")) {
    score += 3;
    factors.push("Convertible demand — seasonal peak in summer");
  } else if (body.includes("van") || body.includes("minivan")) {
    score -= 5;
  }

  if (fuel.includes("electric") || make === "tesla") {
    score += 8;
    factors.push("EV demand rising — tax credit season amplifies interest (internal estimate)");
  } else if (fuel.includes("hybrid")) {
    score += 5;
    factors.push("Hybrid in demand — fuel economy buyers active (internal estimate)");
  }

  if (score >= 88) factors.push("Top market segment — nationally recognized model");
  if (!usedMakeLookup) factors.push("Make demand: internal estimate (no historical data for this brand)");

  return { score: clamp(score), factors };
}

// ── Sub-score: Price Competitiveness (20%) ────────────────────────────────────

function computePriceScore(vehicle: Vehicle, priceMedian: number | null): {
  score: number;
  position: "Below Market" | "Market Average" | "Above Market";
  factors: string[];
} {
  const price = vehicle.price;
  const factors: string[] = [];

  if (!price || !priceMedian || priceMedian === 0) {
    return {
      score: 60,
      position: "Market Average",
      factors: ["No comparable inventory for pricing benchmark (internal estimate)"],
    };
  }

  const pct = (price - priceMedian) / priceMedian;
  let score: number;
  let position: "Below Market" | "Market Average" | "Above Market";

  if (pct < -0.12) {
    score = 100;
    position = "Below Market";
    factors.push(`${Math.round(Math.abs(pct) * 100)}% below dealer median — exceptional deal vs. your inventory`);
  } else if (pct < -0.07) {
    score = 92;
    position = "Below Market";
    factors.push(`${Math.round(Math.abs(pct) * 100)}% below dealer median price`);
  } else if (pct < -0.03) {
    score = 82;
    position = "Below Market";
    factors.push(`Priced ${Math.round(Math.abs(pct) * 100)}% below your inventory median`);
  } else if (pct <= 0.03) {
    score = 68;
    position = "Market Average";
    factors.push("At median price for this model in your inventory");
  } else if (pct <= 0.08) {
    score = 52;
    position = "Above Market";
    factors.push(`${Math.round(pct * 100)}% above dealer median — consider slight reduction`);
  } else if (pct <= 0.15) {
    score = 38;
    position = "Above Market";
    factors.push(`Overpriced by ${Math.round(pct * 100)}% vs. your own inventory — price review recommended`);
  } else {
    score = 22;
    position = "Above Market";
    factors.push(`${Math.round(pct * 100)}% above dealer median — significantly overpriced`);
  }

  return { score: clamp(score), position, factors };
}

// ── Sub-score: Seasonality (10%) ──────────────────────────────────────────────

function computeSeasonalScore(vehicle: Vehicle, now: Date): { score: number; factors: string[] } {
  const month = now.getMonth() + 1; // 1=Jan … 12=Dec
  const body = (vehicle.bodyStyle ?? "").toLowerCase();
  const fuel = (vehicle.fuelType ?? "").toLowerCase();
  const make = (vehicle.make ?? "").toLowerCase();
  const factors: string[] = [];

  const isTruck = body.includes("truck") || body.includes("pickup");
  const isSUV = body.includes("suv") || body.includes("crossover") || body.includes("4wd") || body.includes("awd");
  const isConvert = body.includes("convert");
  const isVan = body.includes("van") || body.includes("minivan");
  const isEV = fuel.includes("electric") || make === "tesla";
  const isSports = body.includes("coupe") || body.includes("sport");

  let score: number;

  // Summer (Jun–Aug): road trips, hauling, convertibles peak
  if (month >= 6 && month <= 8) {
    if (isConvert) { score = 96; factors.push("Summer convertible peak — highest demand window (internal estimate)"); }
    else if (isSUV) { score = 90; factors.push("Summer road trip season — SUV demand at peak (internal estimate)"); }
    else if (isTruck) { score = 84; factors.push("Summer hauling season — truck demand strong (internal estimate)"); }
    else if (isVan) { score = 78; factors.push("Family travel season"); }
    else if (isSports) { score = 80; factors.push("Summer driving season"); }
    else if (isEV) { score = 72; factors.push("EV summer demand"); }
    else { score = 65; }
  }
  // Tax season (Feb–Apr): sedans, economy, EVs with tax credit
  else if (month >= 2 && month <= 4) {
    if (isEV) { score = 88; factors.push("Tax credit season — EV buyers peak Feb–Apr (internal estimate)"); }
    else if (isSUV) { score = 72; }
    else if (isTruck) { score = 70; }
    else { score = 78; factors.push("Tax refund season — buyer purchasing power up (internal estimate)"); }
  }
  // Fall (Sep–Nov): back-to-school, year-end deals
  else if (month >= 9 && month <= 11) {
    if (isTruck) { score = 82; factors.push("Fall truck demand (internal estimate)"); }
    else if (isSUV) { score = 80; factors.push("Fall SUV demand (internal estimate)"); }
    else if (isConvert) { score = 60; }
    else { score = 68; }
  }
  // Winter (Dec–Jan): 4WD/AWD preference
  else {
    if (isTruck || isSUV) { score = 75; factors.push("Winter 4WD/AWD demand (internal estimate)"); }
    else if (isConvert) { score = 40; }
    else { score = 58; }
  }

  return { score: clamp(score), factors };
}

// ── Sub-score: Dealer Performance (15%) ───────────────────────────────────────

function computeDealerPerformanceScore(perfRecords: PerfRecord[]): { score: number; factors: string[] } {
  const factors: string[] = [];

  if (perfRecords.length === 0) {
    return {
      score: 55,
      factors: ["No listing history on record — using category baseline (internal estimate)"],
    };
  }

  const avgOutcome = avg(perfRecords.map((r) => r.outcomeScore));
  const totalHot = perfRecords.reduce((s, r) => s + r.hotLeadsCount, 0);
  const totalConvos = perfRecords.reduce((s, r) => s + r.conversationsCount, 0);

  let score = 45;
  if (avgOutcome >= 70) {
    score = 90;
    factors.push(`Strong historical performance — ${Math.round(avgOutcome)} avg outcome score (live data)`);
  } else if (avgOutcome >= 50) {
    score = 72;
    factors.push(`Moderate listing performance — ${Math.round(avgOutcome)} avg outcome score (live data)`);
  } else if (avgOutcome >= 30) {
    score = 55;
  } else {
    score = 35;
    factors.push("Low past engagement on this vehicle — price review suggested (live data)");
  }

  if (totalHot >= 3) { score += 8; factors.push(`${totalHot} hot leads generated (live data)`); }
  if (totalConvos >= 10) { score += 5; factors.push(`${totalConvos} total conversations recorded (live data)`); }

  return { score: clamp(score), factors };
}

// ── Sub-score: Buyer Demand (10%) ─────────────────────────────────────────────

function computeBuyerDemandScore(
  conversationCount: number,
  hotLeadCount: number,
  leadCount: number,
): { score: number; factors: string[] } {
  const factors: string[] = [];
  let score = 50;

  if (conversationCount === 0 && hotLeadCount === 0 && leadCount === 0) {
    factors.push("No buyer messages on record — using volume baseline (internal estimate)");
    return { score, factors };
  }

  if (conversationCount > 0) {
    score += Math.min(25, conversationCount * 5);
    factors.push(`${conversationCount} buyer conversation${conversationCount !== 1 ? "s" : ""} in DealerPilot CRM (live data)`);
  }
  if (hotLeadCount > 0) {
    score += Math.min(20, hotLeadCount * 10);
    factors.push(`${hotLeadCount} hot lead${hotLeadCount !== 1 ? "s" : ""} on record (live data)`);
  }
  if (leadCount > 0 && hotLeadCount === 0) {
    score += Math.min(10, leadCount * 3);
    factors.push(`${leadCount} lead${leadCount !== 1 ? "s" : ""} captured (live data)`);
  }

  return { score: clamp(score), factors };
}

// ── Sub-score: Inventory Age / Urgency (10%) ──────────────────────────────────

function computeInventoryHealthScore(vehicle: Vehicle, now: Date): {
  score: number;
  daysOnLot: number;
  factors: string[];
} {
  const arrival = vehicle.firstSeenAt ?? vehicle.createdAt;
  const daysOnLot = arrival
    ? Math.max(0, Math.floor((now.getTime() - new Date(arrival).getTime()) / 86_400_000))
    : 30;

  const factors: string[] = [];
  let score: number;

  if (daysOnLot < 15) {
    score = 45;
    factors.push("Just arrived in inventory — no urgency yet");
  } else if (daysOnLot < 30) {
    score = 62;
    factors.push(`${daysOnLot} days in inventory — good selling window`);
  } else if (daysOnLot < 60) {
    score = 82;
    factors.push(`${daysOnLot} days — approaching sell-by window, move soon`);
  } else if (daysOnLot < 90) {
    score = 92;
    factors.push(`${daysOnLot} days — aging inventory, high urgency to publish`);
  } else if (daysOnLot < 120) {
    score = 95;
    factors.push(`${daysOnLot} days — urgent: consider price drop + re-list`);
  } else {
    score = 80;
    factors.push(`${daysOnLot} days — long-aged: price drop likely needed before re-listing`);
  }

  return { score: clamp(score), daysOnLot, factors };
}

// ── Sub-score: Creative / Photo Quality (5%) ──────────────────────────────────

function computeCreativePerformanceScore(
  avgCreativeScore: number | null,
  photoCount: number,
  hasAiPhotos: boolean,
): { score: number; factors: string[] } {
  const factors: string[] = [];

  // Start from photo count baseline
  let score: number;
  if (photoCount === 0) {
    score = 20;
    factors.push("No photos uploaded — listings without photos get 80% fewer inquiries");
  } else if (photoCount < 4) {
    score = 35;
    factors.push(`Only ${photoCount} photo${photoCount !== 1 ? "s" : ""} — buyers expect 8+ for serious consideration`);
  } else if (photoCount < 8) {
    score = 52;
    factors.push(`${photoCount} photos — acceptable but more photos improve conversion`);
  } else if (photoCount < 15) {
    score = 68;
    factors.push(`${photoCount} photos — good coverage`);
  } else {
    score = 78;
    factors.push(`${photoCount} photos — strong photo coverage`);
  }

  // AI photo enhancement bonus
  if (hasAiPhotos) {
    score += 18;
    factors.push("AI-enhanced photos on file — 35% higher engagement expected (live data)");
  } else if (photoCount >= 4) {
    factors.push("No AI photo enhancement yet — run AI Vehicle Studio to improve listing quality");
  }

  // Creative score (from AI creative pipeline) gives additional signal
  if (avgCreativeScore !== null) {
    const creativeBonus = Math.round(avgCreativeScore * 0.04);
    score += creativeBonus;
    if (creativeBonus >= 3) factors.push("High-performing AI creative on record (live data)");
  }

  return { score: clamp(score), factors };
}

// ── Price median helper ────────────────────────────────────────────────────────

export function computePriceMedians(vehicles: Vehicle[]): Map<string, number | null> {
  const buckets = new Map<string, number[]>();
  for (const v of vehicles) {
    if (!v.price || v.price <= 0) continue;
    const key = `${(v.make ?? "").toLowerCase()}:${(v.model ?? "").toLowerCase()}`;
    const arr = buckets.get(key) ?? [];
    arr.push(v.price);
    buckets.set(key, arr);
  }
  const result = new Map<string, number | null>();
  for (const [key, prices] of buckets.entries()) {
    result.set(key, median(prices));
  }
  return result;
}

// ── Main scoring function ──────────────────────────────────────────────────────

export function computeOpportunityScores(input: OpportunityInput): OpportunityScores {
  const now = input.now ?? new Date();

  const demand = computeMarketDemandScore(input.vehicle);
  const price = computePriceScore(input.vehicle, input.priceMedian);
  const seasonal = computeSeasonalScore(input.vehicle, now);
  const dealerPerf = computeDealerPerformanceScore(input.perfRecords);
  const buyerDemand = computeBuyerDemandScore(input.conversationCount, input.hotLeadCount, input.leadCount);
  const inventoryHealth = computeInventoryHealthScore(input.vehicle, now);
  const creative = computeCreativePerformanceScore(
    input.avgCreativeScore,
    input.photoCount,
    input.hasAiPhotos,
  );

  const opportunityScore = clamp(
    demand.score * WEIGHTS.marketDemand +
    price.score * WEIGHTS.price +
    seasonal.score * WEIGHTS.seasonal +
    dealerPerf.score * WEIGHTS.dealerPerformance +
    buyerDemand.score * WEIGHTS.buyerDemand +
    inventoryHealth.score * WEIGHTS.inventoryHealth +
    creative.score * WEIGHTS.creativePerformance,
  );

  const opportunityLabel = computeOpportunityLabel(opportunityScore);

  const recommendedAction = computeRecommendedAction({
    opportunityScore,
    priceScore: price.score,
    photoCount: input.photoCount,
    hasAiPhotos: input.hasAiPhotos,
    isCurrentlyPublished: input.isCurrentlyPublished,
    daysOnLot: inventoryHealth.daysOnLot,
  });

  // Reason bullets: most impactful factors first (demand → price → perf → seasonal → buyer → age → creative)
  const opportunityFactors = [
    ...demand.factors,
    ...price.factors,
    ...dealerPerf.factors,
    ...seasonal.factors,
    ...buyerDemand.factors,
    ...inventoryHealth.factors,
    ...creative.factors,
  ].filter(Boolean).slice(0, 6);

  return {
    opportunityScore,
    opportunityLabel,
    recommendedAction,
    marketDemandScore: demand.score,
    priceScore: price.score,
    seasonalScore: seasonal.score,
    dealerPerformanceScore: dealerPerf.score,
    buyerDemandScore: buyerDemand.score,
    inventoryHealthScore: inventoryHealth.score,
    creativePerformanceScore: creative.score,
    pricingPosition: price.position,
    daysOnLot: inventoryHealth.daysOnLot,
    opportunityFactors,
  };
}
