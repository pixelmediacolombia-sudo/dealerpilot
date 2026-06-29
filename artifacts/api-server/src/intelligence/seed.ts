import type { Logger } from "pino";
import { db } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import {
  vehiclesTable,
  creativeVersionsTable,
  listingPerformanceTable,
  vehicleIntelligenceTable,
  type Vehicle,
  type ListingPerformance,
} from "@workspace/db";

const DEALER_ID = 1;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const LUXURY_MAKES = ["bmw", "mercedes", "audi", "lexus", "infiniti", "cadillac", "lincoln", "porsche", "land rover", "jaguar", "acura"];

function isTruckOrSUV(bodyStyle: string | null): boolean {
  const b = (bodyStyle ?? "").toLowerCase();
  return b.includes("suv") || b.includes("truck") || b.includes("pickup") || b.includes("van") || b.includes("4wd") || b.includes("awd");
}

function isLuxury(make: string | null): boolean {
  const m = (make ?? "").toLowerCase();
  return LUXURY_MAKES.some((lm) => m.includes(lm));
}

// Weighted random: higher weight = more likely to be chosen
function weightedRandom(weights: number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// Fri/Sat bias for day of week, evening bias for time
const DAY_WEIGHTS = [2, 1, 1, 1, 2, 4, 5]; // Sun–Sat
const TIME_WEIGHTS = Array.from({ length: 24 }, (_, h) =>
  h >= 17 && h <= 20 ? 5 : h >= 10 && h <= 14 ? 2 : 1,
);

const DOWN_TIERS = [500, 1000, 1500, 2000, 2500];

function computeOutcomeScore(
  conversationsCount: number,
  hotLeadsCount: number,
  warmLeadsCount: number,
  appointmentReadyCount: number,
  soldCount: number,
): number {
  if (conversationsCount === 0) return 0;
  const raw =
    hotLeadsCount * 25 +
    warmLeadsCount * 10 +
    appointmentReadyCount * 30 +
    soldCount * 50;
  return Math.min(100, Math.round(raw / conversationsCount));
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

function computeBestDayOfWeek(records: ListingPerformance[]): number {
  if (records.length === 0) return 6; // Saturday default
  const byDay = new Map<number, number[]>();
  for (const r of records) {
    const arr = byDay.get(r.dayOfWeek) ?? [];
    arr.push(r.outcomeScore);
    byDay.set(r.dayOfWeek, arr);
  }
  let bestDay = 6;
  let bestScore = -1;
  for (const [day, scores] of byDay.entries()) {
    const a = avg(scores);
    if (a > bestScore) { bestScore = a; bestDay = day; }
  }
  return bestDay;
}

function computeBestTimeOfDay(records: ListingPerformance[]): number {
  if (records.length === 0) return 18; // 6pm default
  const byTime = new Map<number, number[]>();
  for (const r of records) {
    const arr = byTime.get(r.timeOfDay) ?? [];
    arr.push(r.outcomeScore);
    byTime.set(r.timeOfDay, arr);
  }
  let bestTime = 18;
  let bestScore = -1;
  for (const [time, scores] of byTime.entries()) {
    const a = avg(scores);
    if (a > bestScore) { bestScore = a; bestTime = time; }
  }
  return bestTime;
}

function computeBestDownByType(records: ListingPerformance[]): Record<string, number> {
  const byType = new Map<string, Map<number, number[]>>();
  for (const r of records) {
    if (r.displayedPriceStrategy !== "down_payment" || !r.publishedDownPayment || !r.vehicleType) continue;
    const typeMap = byType.get(r.vehicleType) ?? new Map<number, number[]>();
    const arr = typeMap.get(r.publishedDownPayment) ?? [];
    arr.push(r.outcomeScore);
    typeMap.set(r.publishedDownPayment, arr);
    byType.set(r.vehicleType, typeMap);
  }
  const result: Record<string, number> = {};
  for (const [type, typeMap] of byType.entries()) {
    let bestDown = 1000;
    let bestScore = -1;
    for (const [down, scores] of typeMap.entries()) {
      const a = avg(scores);
      if (a > bestScore) { bestScore = a; bestDown = down; }
    }
    result[type] = bestDown;
  }
  return result;
}

function generateVehicleStrategy(
  vehicle: Vehicle,
  vehiclePerf: ListingPerformance[],
  globalStats: {
    bestDayOfWeek: number;
    bestTimeOfDay: number;
    bestDownByType: Record<string, number>;
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

  // Price strategy rules
  let recommendedPriceStrategy = "full_price";
  if (price < 16000) {
    recommendedPriceStrategy = "full_price";
  } else if (truckSUV) {
    recommendedPriceStrategy = "down_payment";
  } else if (luxury && price >= 30000) {
    recommendedPriceStrategy = "down_payment";
  } else if (price >= 20000) {
    // Check performance data override
    const downPerf = vehiclePerf.filter((p) => p.displayedPriceStrategy === "down_payment");
    const fullPerf = vehiclePerf.filter((p) => p.displayedPriceStrategy === "full_price");
    if (downPerf.length > 0 && fullPerf.length > 0) {
      const downAvg = avg(downPerf.map((p) => p.outcomeScore));
      const fullAvg = avg(fullPerf.map((p) => p.outcomeScore));
      recommendedPriceStrategy = downAvg > fullAvg + 10 ? "down_payment" : "full_price";
    } else {
      recommendedPriceStrategy = "down_payment"; // default for higher-priced non-luxury
    }
  }

  // Recommended down payment
  let recommendedDownPayment: number | null = null;
  if (recommendedPriceStrategy === "down_payment") {
    const baseline = truckSUV ? 2000 : 1500;
    const typeBestDown = globalStats.bestDownByType[bodyStyle];
    const selected = typeBestDown ?? baseline;
    // Cap at 10% of retail price for expensive vehicles
    const cap = price > 0 ? Math.round(price * 0.1) : selected;
    recommendedDownPayment = Math.max(500, Math.min(selected, cap));
  }

  // Photo strategy
  const recommendedPhotoStrategy = hasCreative ? "ai_creative" : "original";

  // Template key
  const templateMap: Record<string, string> = {
    suv: "suv_down_payment",
    truck: "truck_down_payment",
    pickup: "truck_down_payment",
    van: "van_family",
    sedan: "sedan_full_price",
    coupe: "sedan_full_price",
    convertible: "luxury_highlight",
    hatchback: "sedan_full_price",
    wagon: "sedan_full_price",
  };
  const bsLower = bodyStyle.toLowerCase();
  const matchedKey = Object.keys(templateMap).find((k) => bsLower.includes(k));
  const recommendedTemplateKey = matchedKey ? (templateMap[matchedKey] ?? "standard_listing") : "standard_listing";

  // Best posting time
  const recommendedDayOfWeek = globalStats.bestDayOfWeek;
  const recommendedTimeOfDay = globalStats.bestTimeOfDay;

  // Confidence score
  let confidenceScore = 40;
  if (vehiclePerf.length >= 1) confidenceScore += 15;
  if (vehiclePerf.length >= 3) confidenceScore += 10;
  if (globalStats.sampleSize >= 10) confidenceScore += 15;
  if (globalStats.sampleSize >= 20) confidenceScore += 10;
  confidenceScore = Math.min(95, confidenceScore);

  // Explanation
  const dayLabel = DAY_NAMES[recommendedDayOfWeek] ?? "Saturday";
  const hour = recommendedTimeOfDay;
  const timeLabel = hour === 0 ? "12am" : hour < 12 ? `${hour}am` : hour === 12 ? "12pm" : `${hour - 12}pm`;
  const priceDesc =
    recommendedPriceStrategy === "full_price"
      ? `Full price ($${(price).toLocaleString()}) converts best for ${bodyStyle}s under $16k`
      : `Down payment strategy ($${recommendedDownPayment?.toLocaleString()} down) drives conversations for ${bodyStyle}s`;
  const photoDesc =
    hasCreative
      ? "AI creative assets outperform original photos by ~35%."
      : "Original photos are used — generate AI creatives for a performance boost.";
  const explanation =
    `${priceDesc}. Post on ${dayLabel}s at ${timeLabel} for peak engagement. ${photoDesc}`;

  // Expected lead quality
  let expectedLeadQuality = "warm";
  if (recommendedPriceStrategy === "down_payment" && truckSUV) {
    expectedLeadQuality = "hot";
  } else if (price < 12000) {
    expectedLeadQuality = "warm";
  } else if (luxury && price >= 40000) {
    expectedLeadQuality = "cold";
  }

  return {
    recommendedPriceStrategy,
    recommendedDownPayment,
    recommendedPhotoStrategy,
    recommendedTemplateKey,
    recommendedDayOfWeek,
    recommendedTimeOfDay,
    confidenceScore,
    explanation,
    expectedLeadQuality,
  };
}

export async function seedMarketplaceIntelligence(logger: Logger): Promise<void> {
  // Check if already seeded
  const [existing] = await db
    .select({ cnt: count() })
    .from(listingPerformanceTable)
    .where(eq(listingPerformanceTable.dealerId, DEALER_ID));
  if ((existing?.cnt ?? 0) > 0) {
    logger.info("Marketplace intelligence already seeded; skipping");
    return;
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

  // Generate listing_performance records for each vehicle (1–3 records)
  const now = new Date();
  for (const vehicle of vehicles) {
    const numRecords = 1 + Math.floor(Math.random() * 3);
    const hasCreative = creativeVehicleIds.has(vehicle.id);
    const truckSUV = isTruckOrSUV(vehicle.bodyStyle);
    const price = vehicle.price ?? 0;

    for (let i = 0; i < numRecords; i++) {
      const dayOfWeek = weightedRandom(DAY_WEIGHTS);
      const timeOfDay = weightedRandom(TIME_WEIGHTS);

      // Strategy based on rules; vary between records to create comparison data
      let displayedPriceStrategy: string;
      if (price < 16000) {
        displayedPriceStrategy = "full_price";
      } else if (truckSUV) {
        displayedPriceStrategy = i % 3 === 2 ? "full_price" : "down_payment";
      } else {
        displayedPriceStrategy = i % 2 === 0 ? "down_payment" : "full_price";
      }

      const publishedDownPayment =
        displayedPriceStrategy === "down_payment"
          ? (DOWN_TIERS[Math.floor(Math.random() * DOWN_TIERS.length)] ?? 1000)
          : null;

      const photoStrategy = hasCreative
        ? i === 0
          ? "ai_creative"
          : "original"
        : "original";

      // Outcome data — weekends + evenings get more conversations
      const timingBonus =
        (dayOfWeek === 6 || dayOfWeek === 5) && timeOfDay >= 17 && timeOfDay <= 20
          ? 1.6
          : dayOfWeek === 0 && timeOfDay >= 14
            ? 1.3
            : 1.0;
      const typeBonus = truckSUV ? 1.5 : 1.0;
      const photoBonus = photoStrategy === "ai_creative" ? 1.35 : 1.0;
      const downBonus = displayedPriceStrategy === "down_payment" ? 1.2 : 1.0;

      const baseConvos = 2 + Math.random() * 9;
      const conversationsCount = Math.max(1, Math.round(baseConvos * timingBonus * typeBonus));
      const hotLeadsCount = Math.round(
        Math.min(Math.random() * (conversationsCount / 2.5), conversationsCount) * photoBonus * downBonus,
      );
      const warmLeadsCount = Math.min(
        Math.round(Math.random() * (conversationsCount / 2)),
        conversationsCount - hotLeadsCount,
      );
      const coldLeadsCount = Math.max(0, conversationsCount - hotLeadsCount - warmLeadsCount);
      const appointmentReadyCount = Math.round(hotLeadsCount * (0.4 + Math.random() * 0.4));
      const soldCount = Math.round(appointmentReadyCount * (0.2 + Math.random() * 0.3));
      const outcomeScore = computeOutcomeScore(
        conversationsCount,
        hotLeadsCount,
        warmLeadsCount,
        appointmentReadyCount,
        soldCount,
      );

      const publishedAt = new Date(now);
      publishedAt.setDate(publishedAt.getDate() - Math.floor(Math.random() * 90));

      await db.insert(listingPerformanceTable).values({
        vehicleId: vehicle.id,
        dealerId: DEALER_ID,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        vehicleType: vehicle.bodyStyle ?? "Sedan",
        retailPrice: vehicle.price,
        displayedPriceStrategy,
        publishedDownPayment,
        photoStrategy,
        listingVersion: 1 + Math.floor(Math.random() * 3),
        creativeVersion: hasCreative ? 1 + Math.floor(Math.random() * 2) : null,
        dayOfWeek,
        timeOfDay,
        publishedAt,
        conversationsCount,
        hotLeadsCount,
        warmLeadsCount,
        coldLeadsCount,
        appointmentReadyCount,
        soldCount,
        outcomeScore,
      });
    }
  }

  // Now generate vehicle_intelligence for all vehicles
  const allPerf = await db
    .select()
    .from(listingPerformanceTable)
    .where(eq(listingPerformanceTable.dealerId, DEALER_ID));

  const globalStats = {
    bestDayOfWeek: computeBestDayOfWeek(allPerf),
    bestTimeOfDay: computeBestTimeOfDay(allPerf),
    bestDownByType: computeBestDownByType(allPerf),
    sampleSize: allPerf.length,
  };

  for (const vehicle of vehicles) {
    const vehiclePerf = allPerf.filter((p) => p.vehicleId === vehicle.id);
    const hasCreative = creativeVehicleIds.has(vehicle.id);
    const strategy = generateVehicleStrategy(vehicle, vehiclePerf, globalStats, hasCreative);

    await db
      .insert(vehicleIntelligenceTable)
      .values({ vehicleId: vehicle.id, dealerId: DEALER_ID, ...strategy })
      .onConflictDoUpdate({
        target: vehicleIntelligenceTable.vehicleId,
        set: { ...strategy, generatedAt: new Date() },
      });
  }

  logger.info(
    { vehicles: vehicles.length, records: allPerf.length },
    "Marketplace intelligence seeded",
  );
}
