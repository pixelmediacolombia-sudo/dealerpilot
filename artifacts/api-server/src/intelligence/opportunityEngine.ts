// DealerPilot Opportunity Engine v1.0
// Scores every vehicle on 7 dimensions → weighted Opportunity Score (0–100).
//
// Weights (sum = 1.0):
//   Market Demand       30%
//   Price               20%
//   Seasonal            10%
//   Dealer Performance  15%
//   Buyer Demand        10%
//   Inventory Health    10%
//   Creative             5%

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

// Market demand baseline by make (Facebook Marketplace US demand signals)
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
  priceMedian: number | null;   // median price for this make+model bucket
  perfRecords: PerfRecord[];
  conversationCount: number;
  hotLeadCount: number;
  leadCount: number;
  avgCreativeScore: number | null; // null = no creative
  now?: Date;
}

export interface OpportunityScores {
  opportunityScore: number;
  marketDemandScore: number;
  priceScore: number;
  seasonalScore: number;
  dealerPerformanceScore: number;
  buyerDemandScore: number;
  inventoryHealthScore: number;
  creativePerformanceScore: number;
  pricingPosition: "Below Market" | "Market Average" | "Above Market";
  daysOnLot: number;
  opportunityFactors: string[];
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

// ── Sub-score: Market Demand (30%) ────────────────────────────────────────────

function computeMarketDemandScore(vehicle: Vehicle): { score: number; factors: string[] } {
  const make = (vehicle.make ?? "").toLowerCase();
  const model = (vehicle.model ?? "").toLowerCase();
  const body = (vehicle.bodyStyle ?? "").toLowerCase();
  const fuel = (vehicle.fuelType ?? "").toLowerCase();
  const factors: string[] = [];

  let score = MAKE_DEMAND[make] ?? 65;

  for (const [key, boost] of MODEL_BOOST) {
    if (model.includes(key)) {
      score += boost;
      break;
    }
  }

  if (body.includes("truck") || body.includes("pickup")) {
    score += 10;
    factors.push("High truck demand");
  } else if (body.includes("suv") || body.includes("crossover") || body.includes("awd") || body.includes("4wd")) {
    score += 8;
    factors.push("Strong SUV demand");
  } else if (body.includes("convert")) {
    score += 3;
    factors.push("Convertible demand");
  } else if (body.includes("van") || body.includes("minivan")) {
    score -= 5;
  }

  if (fuel.includes("electric") || make === "tesla") {
    score += 8;
    factors.push("EV demand rising");
  } else if (fuel.includes("hybrid")) {
    score += 5;
    factors.push("Hybrid in demand");
  }

  if (score >= 88) factors.push("Top market segment");

  return { score: clamp(score), factors };
}

// ── Sub-score: Price Competitiveness (20%) ────────────────────────────────────

function computePriceScore(vehicle: Vehicle, median: number | null): {
  score: number;
  position: "Below Market" | "Market Average" | "Above Market";
  factors: string[];
} {
  const price = vehicle.price;
  const factors: string[] = [];

  if (!price || !median || median === 0) {
    return { score: 60, position: "Market Average", factors };
  }

  const pct = (price - median) / median;

  let score: number;
  let position: "Below Market" | "Market Average" | "Above Market";

  if (pct < -0.12) {
    score = 100;
    position = "Below Market";
    factors.push(`${Math.round(Math.abs(pct) * 100)}% below market — exceptional deal`);
  } else if (pct < -0.07) {
    score = 92;
    position = "Below Market";
    factors.push(`${Math.round(Math.abs(pct) * 100)}% below market`);
  } else if (pct < -0.03) {
    score = 82;
    position = "Below Market";
    factors.push(`Priced ${Math.round(Math.abs(pct) * 100)}% below market`);
  } else if (pct <= 0.03) {
    score = 68;
    position = "Market Average";
    factors.push("At market price");
  } else if (pct <= 0.08) {
    score = 52;
    position = "Above Market";
    factors.push(`${Math.round(pct * 100)}% above market`);
  } else if (pct <= 0.15) {
    score = 38;
    position = "Above Market";
    factors.push(`Overpriced by ${Math.round(pct * 100)}% — price review recommended`);
  } else {
    score = 22;
    position = "Above Market";
    factors.push(`Significantly overpriced (${Math.round(pct * 100)}% above market)`);
  }

  return { score: clamp(score), position, factors };
}

// ── Sub-score: Seasonal (10%) ─────────────────────────────────────────────────

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
    if (isConvert) { score = 96; factors.push("Summer convertible peak"); }
    else if (isSUV) { score = 90; factors.push("Summer road trip season"); }
    else if (isTruck) { score = 84; factors.push("Summer hauling season"); }
    else if (isVan) { score = 78; factors.push("Family travel season"); }
    else if (isSports) { score = 80; factors.push("Summer driving season"); }
    else if (isEV) { score = 72; factors.push("EV summer demand"); }
    else { score = 65; }
  }
  // Tax season (Feb–Apr): sedans, economy vehicles
  else if (month >= 2 && month <= 4) {
    if (isEV) { score = 88; factors.push("Tax credit season"); }
    else if (isSUV) { score = 72; }
    else if (isTruck) { score = 70; }
    else { score = 78; factors.push("Tax refund season"); }
  }
  // Fall (Sep–Nov): back-to-school, year-end deals
  else if (month >= 9 && month <= 11) {
    if (isTruck) { score = 82; factors.push("Fall truck demand"); }
    else if (isSUV) { score = 80; factors.push("Fall SUV demand"); }
    else if (isConvert) { score = 60; }
    else { score = 68; }
  }
  // Winter (Dec–Jan): 4WD/AWD preference
  else {
    if (isTruck || isSUV) { score = 75; factors.push("Winter 4WD demand"); }
    else if (isConvert) { score = 40; }
    else { score = 58; }
  }

  return { score: clamp(score), factors };
}

// ── Sub-score: Dealer Performance (15%) ───────────────────────────────────────

function computeDealerPerformanceScore(perfRecords: PerfRecord[]): { score: number; factors: string[] } {
  const factors: string[] = [];
  if (perfRecords.length === 0) {
    return { score: 55, factors: ["No listing history yet"] };
  }

  const avgOutcome = avg(perfRecords.map((r) => r.outcomeScore));
  const totalHot = perfRecords.reduce((s, r) => s + r.hotLeadsCount, 0);
  const totalConvos = perfRecords.reduce((s, r) => s + r.conversationsCount, 0);

  let score = 45;
  if (avgOutcome >= 70) { score = 90; factors.push(`Strong historical performance (score ${Math.round(avgOutcome)})`); }
  else if (avgOutcome >= 50) { score = 72; factors.push(`Moderate performance history`); }
  else if (avgOutcome >= 30) { score = 55; }
  else { score = 35; factors.push("Low past engagement — price review suggested"); }

  if (totalHot >= 3) { score += 8; factors.push(`${totalHot} hot leads generated`); }
  if (totalConvos >= 10) { score += 5; }

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

  if (conversationCount > 0) {
    score += Math.min(25, conversationCount * 5);
    factors.push(`${conversationCount} buyer conversation${conversationCount !== 1 ? "s" : ""}`);
  }
  if (hotLeadCount > 0) {
    score += Math.min(20, hotLeadCount * 10);
    factors.push(`${hotLeadCount} hot lead${hotLeadCount !== 1 ? "s" : ""}`);
  }
  if (leadCount > 0 && hotLeadCount === 0) {
    score += Math.min(10, leadCount * 3);
  }

  return { score: clamp(score), factors };
}

// ── Sub-score: Inventory Health / Urgency (10%) ───────────────────────────────

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
    factors.push("Just arrived");
  } else if (daysOnLot < 30) {
    score = 62;
    factors.push(`${daysOnLot} days in inventory`);
  } else if (daysOnLot < 60) {
    score = 82;
    factors.push(`${daysOnLot} days — sell soon`);
  } else if (daysOnLot < 90) {
    score = 92;
    factors.push(`${daysOnLot} days — aging, high urgency`);
  } else if (daysOnLot < 120) {
    score = 95;
    factors.push(`${daysOnLot} days — urgent to move`);
  } else {
    score = 80;
    factors.push(`${daysOnLot} days — consider price drop`);
  }

  return { score: clamp(score), daysOnLot, factors };
}

// ── Sub-score: Creative Performance (5%) ──────────────────────────────────────

function computeCreativePerformanceScore(avgCreativeScore: number | null): {
  score: number;
  factors: string[];
} {
  const factors: string[] = [];
  if (avgCreativeScore === null) {
    return { score: 50, factors: ["No AI creative on file"] };
  }
  const score = clamp(50 + avgCreativeScore * 0.5);
  if (score >= 75) factors.push("High-performing AI creative");
  else if (score >= 62) factors.push("AI creative available");
  return { score, factors };
}

// ── Price median helper (call once outside, pass result in) ───────────────────

export function computePriceMedians(vehicles: Vehicle[]): Map<string, number | null> {
  // Group by make+model, return median price per bucket
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

// ── Main scoring function ────────────────────────────────────────────────────

export function computeOpportunityScores(input: OpportunityInput): OpportunityScores {
  const now = input.now ?? new Date();

  const demand = computeMarketDemandScore(input.vehicle);
  const price = computePriceScore(input.vehicle, input.priceMedian);
  const seasonal = computeSeasonalScore(input.vehicle, now);
  const dealerPerf = computeDealerPerformanceScore(input.perfRecords);
  const buyerDemand = computeBuyerDemandScore(input.conversationCount, input.hotLeadCount, input.leadCount);
  const inventoryHealth = computeInventoryHealthScore(input.vehicle, now);
  const creative = computeCreativePerformanceScore(input.avgCreativeScore);

  const opportunityScore = clamp(
    demand.score * WEIGHTS.marketDemand +
    price.score * WEIGHTS.price +
    seasonal.score * WEIGHTS.seasonal +
    dealerPerf.score * WEIGHTS.dealerPerformance +
    buyerDemand.score * WEIGHTS.buyerDemand +
    inventoryHealth.score * WEIGHTS.inventoryHealth +
    creative.score * WEIGHTS.creativePerformance,
  );

  // Top factors: deduplicate + pick most impactful
  const allFactors = [
    ...demand.factors,
    ...price.factors,
    ...seasonal.factors,
    ...dealerPerf.factors,
    ...buyerDemand.factors,
    ...inventoryHealth.factors,
    ...creative.factors,
  ].filter(Boolean).slice(0, 5);

  return {
    opportunityScore,
    marketDemandScore: demand.score,
    priceScore: price.score,
    seasonalScore: seasonal.score,
    dealerPerformanceScore: dealerPerf.score,
    buyerDemandScore: buyerDemand.score,
    inventoryHealthScore: inventoryHealth.score,
    creativePerformanceScore: creative.score,
    pricingPosition: price.position,
    daysOnLot: inventoryHealth.daysOnLot,
    opportunityFactors: allFactors,
  };
}
