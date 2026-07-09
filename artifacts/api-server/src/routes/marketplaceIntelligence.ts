import { Router } from "express";
import { db } from "@workspace/db";
import { eq, and, or, desc, ilike, isNull, isNotNull, sql, count, inArray } from "drizzle-orm";
import {
  vehiclesTable,
  vehicleImagesTable,
  listingPerformanceTable,
  vehicleIntelligenceTable,
  listingsTable,
  conversationsTable,
  leadsTable,
  feedRunsTable,
  type ListingPerformance,
} from "@workspace/db";
import { ensureVehicleIntelligenceSchema, seedMarketplaceIntelligence } from "../intelligence/seed";

const router = Router();

const DEALER_ID = 1;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function timeLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

function sum(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0);
}

function daysSince(date: Date | null): number {
  if (!date) return 0;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

function groupBy<T, K extends string | number>(arr: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of arr) {
    const k = key(item);
    const bucket = map.get(k) ?? [];
    bucket.push(item);
    map.set(k, bucket);
  }
  return map;
}

// --- Dashboard aggregations ---

function buildPostingTimePerformance(records: ListingPerformance[]) {
  const byDay = groupBy(records, (r) => r.dayOfWeek);
  return Array.from({ length: 7 }, (_, d) => {
    const recs = byDay.get(d) ?? [];
    return {
      dayOfWeek: d,
      dayLabel: DAY_NAMES[d] ?? "",
      avgOutcomeScore: avg(recs.map((r) => r.outcomeScore)),
      totalListings: recs.length,
      totalHotLeads: sum(recs.map((r) => r.hotLeadsCount)),
      totalConversations: sum(recs.map((r) => r.conversationsCount)),
    };
  }).sort((a, b) => b.avgOutcomeScore - a.avgOutcomeScore);
}

function buildDownPaymentPerformance(records: ListingPerformance[]) {
  const dpRecords = records.filter(
    (r) => r.displayedPriceStrategy === "down_payment" && r.publishedDownPayment != null && r.vehicleType,
  );
  const byType = groupBy(dpRecords, (r) => r.vehicleType!);
  return Array.from(byType.entries()).map(([vehicleType, typeRecs]) => {
    const byDown = groupBy(typeRecs, (r) => r.publishedDownPayment!);
    const variants = Array.from(byDown.entries())
      .map(([dp, recs]) => ({
        publishedDownPayment: dp,
        avgOutcomeScore: avg(recs.map((r) => r.outcomeScore)),
        totalListings: recs.length,
        hotLeads: sum(recs.map((r) => r.hotLeadsCount)),
      }))
      .sort((a, b) => b.avgOutcomeScore - a.avgOutcomeScore);
    const bestDownPayment = variants[0]?.publishedDownPayment ?? 1000;
    return { vehicleType, variants, bestDownPayment };
  });
}

function buildCreativePerformance(records: ListingPerformance[]) {
  const strategies = ["original", "ai_creative", "mixed"] as const;
  const result: Record<string, { avgOutcomeScore: number; totalListings: number; hotLeads: number; conversationsCount: number }> = {};
  for (const strat of strategies) {
    const recs = records.filter((r) => r.photoStrategy === strat);
    result[strat] = {
      avgOutcomeScore: avg(recs.map((r) => r.outcomeScore)),
      totalListings: recs.length,
      hotLeads: sum(recs.map((r) => r.hotLeadsCount)),
      conversationsCount: sum(recs.map((r) => r.conversationsCount)),
    };
  }
  return result;
}

function buildVehicleTypePerformance(records: ListingPerformance[]) {
  const byType = groupBy(records.filter((r) => r.vehicleType), (r) => r.vehicleType!);
  return Array.from(byType.entries())
    .map(([vehicleType, recs]) => ({
      vehicleType,
      avgOutcomeScore: avg(recs.map((r) => r.outcomeScore)),
      totalListings: recs.length,
      totalHotLeads: sum(recs.map((r) => r.hotLeadsCount)),
      totalConversations: sum(recs.map((r) => r.conversationsCount)),
    }))
    .sort((a, b) => b.avgOutcomeScore - a.avgOutcomeScore);
}

function buildWeakListings(records: ListingPerformance[], threshold = 25) {
  const byVehicle = groupBy(records, (r) => r.vehicleId);
  const result: Array<{
    vehicleId: number; year: number | null; make: string; model: string;
    outcomeScore: number; conversationsCount: number; daysSincePublished: number;
  }> = [];
  for (const [, recs] of byVehicle.entries()) {
    const latest = recs.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())[0];
    if (!latest || latest.outcomeScore >= threshold) continue;
    result.push({
      vehicleId: latest.vehicleId,
      year: latest.year,
      make: latest.make ?? "",
      model: latest.model ?? "",
      outcomeScore: latest.outcomeScore,
      conversationsCount: latest.conversationsCount,
      daysSincePublished: daysSince(latest.publishedAt),
    });
  }
  return result.sort((a, b) => a.outcomeScore - b.outcomeScore).slice(0, 10);
}

function buildHighViewsLowQuality(records: ListingPerformance[]) {
  return records
    .filter((r) => r.conversationsCount >= 5 && r.hotLeadsCount === 0)
    .sort((a, b) => b.conversationsCount - a.conversationsCount)
    .slice(0, 10)
    .map((r) => ({
      vehicleId: r.vehicleId,
      year: r.year,
      make: r.make ?? "",
      model: r.model ?? "",
      conversationsCount: r.conversationsCount,
      hotLeadsCount: r.hotLeadsCount,
      outcomeScore: r.outcomeScore,
    }));
}

function buildLowEngagement(records: ListingPerformance[]) {
  return records
    .filter((r) => r.conversationsCount === 0)
    .slice(0, 10)
    .map((r) => ({
      vehicleId: r.vehicleId,
      year: r.year,
      make: r.make ?? "",
      model: r.model ?? "",
      conversationsCount: r.conversationsCount,
      outcomeScore: r.outcomeScore,
    }));
}

// --- Real data aggregations ---

async function getRealSummary() {
  // 1. Total Marketplace listings — unique vehicles with a marketplace listing
  const marketplaceListings = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.channel, "marketplace"));

  const totalListings = marketplaceListings.length;

  // 2. Real conversations — imported from Marketplace / Messenger
  const conversations = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.dealerId, DEALER_ID));

  const totalConversations = conversations.length;
  const hasConversations = totalConversations > 0;

  // 3. Hot leads — qualified leads with temperature = Hot
  const hotLeads = await db
    .select()
    .from(leadsTable)
    .where(and(eq(leadsTable.dealerId, DEALER_ID), eq(leadsTable.temperature, "Hot")));

  const totalLeads = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.dealerId, DEALER_ID));

  const totalHotLeads = hotLeads.length;
  const hasLeads = totalLeads.length > 0;

  // 4. Outcome score — only from real publishing batches (publishingBatchId is not null)
  //    Seeded records have publishingBatchId = null
  const realPerformanceRecords = await db
    .select()
    .from(listingPerformanceTable)
    .where(
      and(
        eq(listingPerformanceTable.dealerId, DEALER_ID),
        isNotNull(listingPerformanceTable.publishingBatchId),
      ),
    );

  const hasRealPerformance = realPerformanceRecords.length > 0;
  const avgOutcomeScore = hasRealPerformance
    ? avg(realPerformanceRecords.map((r) => r.outcomeScore))
    : null;

  // 5. Mock data flag: seeded records = LP records without a publishingBatchId
  const [mockCountRow] = await db
    .select({ cnt: count() })
    .from(listingPerformanceTable)
    .where(
      and(
        eq(listingPerformanceTable.dealerId, DEALER_ID),
        isNull(listingPerformanceTable.publishingBatchId),
      ),
    );
  const hasMockPerformanceData = (mockCountRow?.cnt ?? 0) > 0;

  return {
    totalListings,
    totalListingsSource: "live_data" as const,
    totalListingsNote: "Count of unique Marketplace listings in the database. Each vehicle has at most one Marketplace listing.",

    avgOutcomeScore,
    avgOutcomeScoreSource: hasRealPerformance ? ("historical" as const) : ("no_data" as const),
    avgOutcomeScoreNote: hasRealPerformance
      ? `Average outcome score from ${realPerformanceRecords.length} published listing${realPerformanceRecords.length !== 1 ? "s" : ""} with real engagement data. Score = (Hot leads × 25 + Warm leads × 10 + Appointments × 30 + Sales × 50) / Conversations.`
      : "Insufficient data — score will appear once vehicles are published and receive buyer engagement. Requires at least one published listing with a real conversation.",

    totalConversations: hasConversations ? totalConversations : null,
    totalConversationsSource: hasConversations ? ("live_data" as const) : ("no_data" as const),
    totalConversationsNote: hasConversations
      ? `${totalConversations} buyer conversation${totalConversations !== 1 ? "s" : ""} imported from Marketplace / Messenger via the Chrome extension.`
      : "No conversations imported yet. Connect the Chrome extension on an active Marketplace inbox to sync buyer conversations.",

    totalHotLeads: hasLeads ? totalHotLeads : null,
    totalHotLeadsSource: hasLeads ? ("live_data" as const) : ("no_data" as const),
    totalHotLeadsNote: hasLeads
      ? `${totalHotLeads} hot lead${totalHotLeads !== 1 ? "s" : ""} out of ${totalLeads.length} total. A Hot lead is a buyer who confirmed budget, timeline, and documents.`
      : "No leads scored yet. Hot leads are buyers who confirmed budget, timeline, and proof of income via Messenger conversations.",

    hasMockPerformanceData,
  };
}

// GET /api/marketplace-intelligence/dashboard
router.get("/marketplace-intelligence/dashboard", async (req, res) => {
  await ensureVehicleIntelligenceSchema(req.log);

  const records = await db
    .select()
    .from(listingPerformanceTable)
    .where(eq(listingPerformanceTable.dealerId, DEALER_ID));

  const intelligence = await db
    .select()
    .from(vehicleIntelligenceTable)
    .where(eq(vehicleIntelligenceTable.dealerId, DEALER_ID))
    .orderBy(desc(vehicleIntelligenceTable.confidenceScore));

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, DEALER_ID));

  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

  // Best day/time from all records
  const bestByDay = buildPostingTimePerformance(records);
  const bestDay = bestByDay[0];
  const bestTimeMap = new Map<number, number[]>();
  for (const r of records) {
    const arr = bestTimeMap.get(r.timeOfDay) ?? [];
    arr.push(r.outcomeScore);
    bestTimeMap.set(r.timeOfDay, arr);
  }
  let bestTime = 18;
  let bestTimeScore = -1;
  for (const [t, scores] of bestTimeMap.entries()) {
    const a = avg(scores);
    if (a > bestTimeScore) { bestTimeScore = a; bestTime = t; }
  }

  const vehicleIdsWithPerf = new Set(records.map((r) => r.vehicleId));
  const nextBatchVehicles = intelligence
    .filter((vi) => vi.confidenceScore >= 50)
    .slice(0, 5)
    .map((vi) => {
      const v = vehicleMap.get(vi.vehicleId);
      return {
        vehicleId: vi.vehicleId,
        year: v?.year ?? null,
        make: v?.make ?? "",
        model: v?.model ?? "",
        price: v?.price ?? null,
        vehicleType: v?.bodyStyle ?? null,
        confidenceScore: vi.confidenceScore,
        recommendedPriceStrategy: vi.recommendedPriceStrategy,
        recommendedDownPayment: vi.recommendedDownPayment,
        expectedLeadQuality: vi.expectedLeadQuality,
      };
    });

  const estimatedHotLeads = Math.round(nextBatchVehicles.length * 1.8);

  // Real KPI summary from live tables
  const realSummary = await getRealSummary();

  res.json({
    summary: realSummary,
    postingTimePerformance: buildPostingTimePerformance(records),
    downPaymentPerformance: buildDownPaymentPerformance(records),
    creativePerformance: buildCreativePerformance(records),
    vehicleTypePerformance: buildVehicleTypePerformance(records),
    weakListings: buildWeakListings(records),
    highViewsLowQuality: buildHighViewsLowQuality(records),
    lowEngagement: buildLowEngagement(records),
    nextBatchRecommendation: {
      vehicles: nextBatchVehicles,
      recommendedDayOfWeek: bestDay?.dayOfWeek ?? 6,
      recommendedDayLabel: bestDay?.dayLabel ?? "Saturday",
      recommendedTimeOfDay: bestTime,
      recommendedTimeLabel: timeLabel(bestTime),
      estimatedHotLeads,
    },
  });
});

// GET /api/marketplace-intelligence/dashboard-health
router.get("/marketplace-intelligence/dashboard-health", async (req, res) => {
  // Inventory count
  const inventoryRows = await db
    .select({ cnt: count() })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, DEALER_ID));
  const inventoryCount = Number(inventoryRows[0]?.cnt ?? 0);

  // Marketplace listing count (all listings)
  const listingRows = await db
    .select({ cnt: count() })
    .from(listingsTable)
    .where(eq(listingsTable.channel, "marketplace"));
  const marketplaceListingCount = Number(listingRows[0]?.cnt ?? 0);

  // Published listings
  const publishedRows = await db
    .select({ cnt: count() })
    .from(listingsTable)
    .where(and(eq(listingsTable.channel, "marketplace"), eq(listingsTable.status, "Published")));
  const publishedListingCount = Number(publishedRows[0]?.cnt ?? 0);

  // Conversations
  const convRows = await db
    .select({ cnt: count() })
    .from(conversationsTable)
    .where(eq(conversationsTable.dealerId, DEALER_ID));
  const conversationsCount = Number(convRows[0]?.cnt ?? 0);

  // Leads
  const leadRows = await db
    .select({ cnt: count() })
    .from(leadsTable)
    .where(eq(leadsTable.dealerId, DEALER_ID));
  const realLeadsCount = Number(leadRows[0]?.cnt ?? 0);

  // Hot leads
  const hotLeadRows = await db
    .select({ cnt: count() })
    .from(leadsTable)
    .where(and(eq(leadsTable.dealerId, DEALER_ID), eq(leadsTable.temperature, "Hot")));
  const hotLeadsCount = Number(hotLeadRows[0]?.cnt ?? 0);

  // Mock data (seeded performance records = no publishingBatchId)
  const mockRows = await db
    .select({ cnt: count() })
    .from(listingPerformanceTable)
    .where(
      and(
        eq(listingPerformanceTable.dealerId, DEALER_ID),
        isNull(listingPerformanceTable.publishingBatchId),
      ),
    );
  const mockRecordCount = Number(mockRows[0]?.cnt ?? 0);
  const hasMockData = mockRecordCount > 0;

  // Last successful feed sync
  const lastSyncRows = await db
    .select()
    .from(feedRunsTable)
    .where(
      and(
        eq(feedRunsTable.dealerId, DEALER_ID),
        or(eq(feedRunsTable.status, "success"), eq(feedRunsTable.status, "completed"))!,
      ),
    )
    .orderBy(desc(feedRunsTable.finishedAt))
    .limit(1);
  const lastSyncAt = lastSyncRows[0]?.finishedAt?.toISOString() ?? null;

  // Detect duplicate performance records (same vehicleId appearing multiple times)
  const dupRows = await db
    .select({
      vehicleId: listingPerformanceTable.vehicleId,
      cnt: sql<number>`count(*)::int`,
    })
    .from(listingPerformanceTable)
    .where(eq(listingPerformanceTable.dealerId, DEALER_ID))
    .groupBy(listingPerformanceTable.vehicleId)
    .having(sql`count(*) > 1`);
  const duplicateRecordsDetected = dupRows.length;

  // Data sources connected
  const dataSourcesConnected: string[] = [];
  if (inventoryCount > 0) dataSourcesConnected.push("Inventory XML Feed");
  if (marketplaceListingCount > 0) dataSourcesConnected.push("Marketplace Listings");
  if (conversationsCount > 0) dataSourcesConnected.push("Messenger Conversations");
  if (realLeadsCount > 0) dataSourcesConnected.push("CRM Leads");

  res.json({
    inventoryCount,
    marketplaceListingCount,
    publishedListingCount,
    conversationsCount,
    realLeadsCount,
    hotLeadsCount,
    hasMockData,
    mockRecordCount,
    lastSyncAt,
    duplicateRecordsDetected,
    dataSourcesConnected,
  });
});

// Parse v2 JSON explanation
function parseV2Explanation(explanation: string | null): {
  v: 2;
  strategyName: string;
  reason: string;
  supportingSignals: string[];
  expectedImpact: string;
  actionCta: string;
} | null {
  if (!explanation) return null;
  try {
    const parsed = JSON.parse(explanation) as Record<string, unknown>;
    if (parsed["v"] === 2) {
      return parsed as {
        v: 2;
        strategyName: string;
        reason: string;
        supportingSignals: string[];
        expectedImpact: string;
        actionCta: string;
      };
    }
  } catch {
    // v1 plaintext — ignore
  }
  return null;
}

function computeEstimatedMessages(confidenceScore: number, bodyStyle: string | null): number {
  const bs = bodyStyle?.toLowerCase() ?? "";
  const base = bs.includes("truck") ? 8 : bs.includes("suv") ? 7 : bs.includes("van") ? 5 : 4;
  return Math.max(1, Math.round(base * (confidenceScore / 100)));
}

function computeEstimatedDaysToSell(price: number | null, confidenceScore: number): number {
  const base = !price ? 21 : price < 12000 ? 7 : price < 20000 ? 12 : price < 35000 ? 18 : price < 55000 ? 28 : 40;
  return Math.max(3, Math.round(base * (1 - (confidenceScore - 50) / 200)));
}

// GET /api/marketplace-intelligence/recommendations
router.get("/marketplace-intelligence/recommendations", async (req, res) => {
  await ensureVehicleIntelligenceSchema(req.log);

  const location = typeof req.query.location === "string" ? req.query.location : "";

  // Sort by demandScore DESC (Marketplace Demand Engine v1 — 12-signal composite).
  // Falls back to opportunityScore for any rows that haven't been demand-scored yet.
  const intelligence = await db
    .select()
    .from(vehicleIntelligenceTable)
    .where(and(
      eq(vehicleIntelligenceTable.dealerId, DEALER_ID),
      isNotNull(vehicleIntelligenceTable.opportunityScore),
    ))
    .orderBy(desc(sql`coalesce(${vehicleIntelligenceTable.demandScore}, ${vehicleIntelligenceTable.opportunityScore})`));

  // Include both Active and Price Changed vehicles (same filter as market intelligence)
  const vehicleConditions = [
    eq(vehiclesTable.dealerId, DEALER_ID),
    or(
      eq(vehiclesTable.status, "Active"),
      eq(vehiclesTable.status, "Price Changed"),
    )!,
  ];
  if (location) vehicleConditions.push(eq(vehiclesTable.lotLocation, location));
  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(and(...vehicleConditions));

  const vehicleIds = vehicles.map((v) => v.id);
  const vehicleSet = new Set(vehicleIds);
  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

  // Only recommend vehicles that belong to this dealer + are active/price-changed
  const filteredIntelligence = intelligence.filter((vi) => vehicleSet.has(vi.vehicleId));

  // Parallel: fetch thumbnails (position=0) and photo counts
  const [thumbnailRows, photoCountRows] = vehicleIds.length > 0
    ? await Promise.all([
        db.select({ vehicleId: vehicleImagesTable.vehicleId, url: vehicleImagesTable.url })
          .from(vehicleImagesTable)
          .where(and(inArray(vehicleImagesTable.vehicleId, vehicleIds), eq(vehicleImagesTable.position, 0))),
        db.select({ vehicleId: vehicleImagesTable.vehicleId, cnt: count() })
          .from(vehicleImagesTable)
          .where(inArray(vehicleImagesTable.vehicleId, vehicleIds))
          .groupBy(vehicleImagesTable.vehicleId),
      ])
    : [[], []];

  const thumbnailMap = new Map(thumbnailRows.map((r) => [r.vehicleId, r.url]));
  const photoCountMap = new Map(photoCountRows.map((r) => [r.vehicleId, Number(r.cnt)]));

  const recommendations = filteredIntelligence.map((vi) => {
    const v = vehicleMap.get(vi.vehicleId);
    const v2 = parseV2Explanation(vi.explanation);

    return {
      vehicleId: vi.vehicleId,
      year: v?.year ?? null,
      make: v?.make ?? "",
      model: v?.model ?? "",
      trim: v?.trim ?? null,
      price: v?.price ?? null,
      mileage: v?.mileage ?? null,
      vin: v?.vin ?? null,
      bodyStyle: v?.bodyStyle ?? null,
      thumbnailUrl: thumbnailMap.get(vi.vehicleId) ?? null,
      photoCount: photoCountMap.get(vi.vehicleId) ?? 0,
      estimatedMessages: computeEstimatedMessages(vi.confidenceScore, v?.bodyStyle ?? null),
      estimatedDaysToSell: computeEstimatedDaysToSell(v?.price ?? null, vi.confidenceScore),
      recommendedPriceStrategy: vi.recommendedPriceStrategy,
      recommendedDownPayment: vi.recommendedDownPayment,
      recommendedPhotoStrategy: vi.recommendedPhotoStrategy,
      recommendedTemplateKey: vi.recommendedTemplateKey,
      recommendedDayOfWeek: vi.recommendedDayOfWeek,
      recommendedDayLabel: vi.recommendedDayOfWeek != null ? (DAY_NAMES[vi.recommendedDayOfWeek] ?? "") : null,
      recommendedTimeOfDay: vi.recommendedTimeOfDay,
      recommendedTimeLabel: vi.recommendedTimeOfDay != null ? timeLabel(vi.recommendedTimeOfDay) : null,
      confidenceScore: vi.confidenceScore,
      explanation: vi.explanation,
      expectedLeadQuality: vi.expectedLeadQuality,
      generatedAt: vi.generatedAt,
      strategyName: v2?.strategyName ?? null,
      reason: v2?.reason ?? vi.explanation ?? null,
      supportingSignals: v2?.supportingSignals ?? [],
      expectedImpact: v2?.expectedImpact ?? null,
      actionCta: v2?.actionCta ?? null,
      // Opportunity Engine — quality baseline
      opportunityScore: vi.opportunityScore,
      opportunityLabel: vi.opportunityLabel ?? "Watch",
      primarySegment: vi.primarySegment ?? "General",
      secondarySegment: vi.secondarySegment ?? null,
      adAngle: vi.adAngle ?? "",
      suggestedLanguage: vi.suggestedLanguage ?? "English-first",
      whyThisAudience: vi.whyThisAudience ?? "",
      // Marketplace Demand Engine v1 — primary ranking score
      demandScore: vi.demandScore ?? vi.opportunityScore ?? 0,
      demandLabel: vi.demandLabel ?? "Moderate",
      demandFactors: (() => {
        try {
          return vi.demandFactors ? (JSON.parse(vi.demandFactors) as string[]) : [];
        } catch {
          return [];
        }
      })(),
      marketplacePopularityScore: vi.marketplacePopularityScore ?? null,
      latinoPreferenceScore: vi.latinoPreferenceScore ?? null,
      financingProbabilityScore: vi.financingProbabilityScore ?? null,
      historicalEngagementScore: vi.historicalEngagementScore ?? null,
      duplicateSaturationScore: vi.duplicateSaturationScore ?? null,
      demandWeightsVersion: vi.demandWeightsVersion ?? null,
      // Opportunity sub-scores (for breakdown)
      marketDemandScore: vi.marketDemandScore ?? null,
      priceScore: vi.priceScore ?? null,
      buyerSegmentScore: vi.buyerSegmentScore ?? null,
      inventoryHealthScore: vi.inventoryHealthScore ?? null,
      seasonalScore: vi.seasonalScore ?? null,
    };
  });

  res.json({
    strategyEngineVersion: "v2",
    demandEngineVersion: "v1",
    recommendations,
  });
});

// GET /api/marketplace-intelligence/vehicles/:vehicleId
router.get("/marketplace-intelligence/vehicles/:vehicleId", async (req, res) => {
  await ensureVehicleIntelligenceSchema(req.log);

  const vehicleId = parseInt(req.params["vehicleId"] ?? "0", 10);
  if (!vehicleId) { res.status(400).json({ error: "Invalid vehicleId" }); return; }

  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.dealerId, DEALER_ID)));

  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }

  const [intelligence] = await db
    .select()
    .from(vehicleIntelligenceTable)
    .where(eq(vehicleIntelligenceTable.vehicleId, vehicleId));

  const performanceHistory = await db
    .select()
    .from(listingPerformanceTable)
    .where(eq(listingPerformanceTable.vehicleId, vehicleId))
    .orderBy(desc(listingPerformanceTable.publishedAt));

  res.json({
    vehicle: {
      id: vehicle.id,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      price: vehicle.price,
      bodyStyle: vehicle.bodyStyle,
      mileage: vehicle.mileage,
      status: vehicle.status,
    },
    intelligence: intelligence
      ? {
          recommendedPriceStrategy: intelligence.recommendedPriceStrategy,
          recommendedDownPayment: intelligence.recommendedDownPayment,
          recommendedPhotoStrategy: intelligence.recommendedPhotoStrategy,
          recommendedTemplateKey: intelligence.recommendedTemplateKey,
          recommendedDayOfWeek: intelligence.recommendedDayOfWeek,
          recommendedDayLabel: intelligence.recommendedDayOfWeek != null ? (DAY_NAMES[intelligence.recommendedDayOfWeek] ?? "") : null,
          recommendedTimeOfDay: intelligence.recommendedTimeOfDay,
          recommendedTimeLabel: intelligence.recommendedTimeOfDay != null ? timeLabel(intelligence.recommendedTimeOfDay) : null,
          confidenceScore: intelligence.confidenceScore,
          explanation: intelligence.explanation,
          expectedLeadQuality: intelligence.expectedLeadQuality,
          generatedAt: intelligence.generatedAt,
          opportunityScore: intelligence.opportunityScore ?? null,
          opportunityLabel: intelligence.opportunityLabel ?? null,
          primarySegment: intelligence.primarySegment ?? null,
          secondarySegment: intelligence.secondarySegment ?? null,
          adAngle: intelligence.adAngle ?? null,
          suggestedLanguage: intelligence.suggestedLanguage ?? null,
          whyThisAudience: intelligence.whyThisAudience ?? null,
        }
      : null,
    performanceHistory: performanceHistory.map((p) => ({
      id: p.id,
      publishedAt: p.publishedAt,
      dayOfWeek: p.dayOfWeek,
      dayLabel: DAY_NAMES[p.dayOfWeek] ?? "",
      timeOfDay: p.timeOfDay,
      timeLabel: timeLabel(p.timeOfDay),
      displayedPriceStrategy: p.displayedPriceStrategy,
      publishedDownPayment: p.publishedDownPayment,
      photoStrategy: p.photoStrategy,
      conversationsCount: p.conversationsCount,
      hotLeadsCount: p.hotLeadsCount,
      warmLeadsCount: p.warmLeadsCount,
      coldLeadsCount: p.coldLeadsCount,
      appointmentReadyCount: p.appointmentReadyCount,
      soldCount: p.soldCount,
      outcomeScore: p.outcomeScore,
    })),
  });
});

// POST /api/marketplace-intelligence/seed — force re-seed
router.post("/marketplace-intelligence/seed", async (req, res) => {
  try {
    await db.delete(listingPerformanceTable).where(eq(listingPerformanceTable.dealerId, DEALER_ID));
    await db.delete(vehicleIntelligenceTable).where(eq(vehicleIntelligenceTable.dealerId, DEALER_ID));
    await seedMarketplaceIntelligence(req.log);
    res.json({ ok: true, message: "Marketplace intelligence re-seeded successfully" });
  } catch (err) {
    req.log.error({ err }, "Seed failed");
    res.status(500).json({ error: "Seed failed", detail: String(err) });
  }
});

// ── GET /api/marketplace-intelligence/opportunity ─────────────────────────────
// Returns all vehicles ranked by Opportunity Score with full sub-score breakdown.
// Sections: hot (≥80), cooling (aging ≥60 days), competitive (best priceScore),
//           byLot (regional breakdown), and market-level insights.
router.get("/marketplace-intelligence/opportunity", async (req, res) => {
  await ensureVehicleIntelligenceSchema(req.log);

  // Fetch available vehicles: Active + Price Changed (price updated but still in lot)
  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(and(
      eq(vehiclesTable.dealerId, DEALER_ID),
      inArray(vehiclesTable.status, ["Active", "Price Changed"]),
    ));

  if (vehicles.length === 0) {
    res.json({ vehicles: [], insights: null, sections: { hot: [], cooling: [], competitive: [], byLot: [] } });
    return;
  }

  const vehicleIds = vehicles.map((v) => v.id);
  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

  const [intelligenceRows, thumbnailRows, photoCountRows] = await Promise.all([
    db.select()
      .from(vehicleIntelligenceTable)
      .where(eq(vehicleIntelligenceTable.dealerId, DEALER_ID)),
    db.select({ vehicleId: vehicleImagesTable.vehicleId, url: vehicleImagesTable.url })
      .from(vehicleImagesTable)
      .where(and(inArray(vehicleImagesTable.vehicleId, vehicleIds), eq(vehicleImagesTable.position, 0))),
    db.select({ vehicleId: vehicleImagesTable.vehicleId, cnt: count() })
      .from(vehicleImagesTable)
      .where(inArray(vehicleImagesTable.vehicleId, vehicleIds))
      .groupBy(vehicleImagesTable.vehicleId),
  ]);

  const intelligenceMap = new Map(intelligenceRows.map((r) => [r.vehicleId, r]));
  const thumbnailMap = new Map(thumbnailRows.map((r) => [r.vehicleId, r.url]));
  const photoCountMap = new Map(photoCountRows.map((r) => [r.vehicleId, Number(r.cnt)]));

  // Parse v2 strategy name from explanation
  function parseStrategyName(explanation: string | null): string | null {
    if (!explanation) return null;
    try {
      const p = JSON.parse(explanation) as Record<string, unknown>;
      if (p["v"] === 2) return (p["strategyName"] as string) ?? null;
    } catch { /* ignore */ }
    return null;
  }

  // Build scored vehicle list (only for vehicles that have intelligence + opportunity score)
  const scored = vehicles
    .map((v) => {
      const intel = intelligenceMap.get(v.id);
      if (!intel || intel.opportunityScore == null) return null;
      const factors: string[] = (() => {
        try { return JSON.parse(intel.opportunityFactors ?? "[]") as string[]; } catch { return []; }
      })();
      return {
        vehicleId: v.id,
        year: v.year,
        make: v.make,
        model: v.model,
        trim: v.trim ?? null,
        price: v.price ?? null,
        mileage: v.mileage ?? null,
        bodyStyle: v.bodyStyle ?? null,
        status: v.status,
        lotLocation: v.lotLocation ?? null,
        vin: v.vin ?? null,
        thumbnailUrl: thumbnailMap.get(v.id) ?? null,
        photoCount: photoCountMap.get(v.id) ?? 0,
        missingPrice: !v.price || v.price <= 0,
        // Opportunity scores
        opportunityScore: intel.opportunityScore,
        opportunityLabel: intel.opportunityLabel ?? "Watch",
        recommendedAction: intel.recommendedAction ?? "Hold",
        marketDemandScore: intel.marketDemandScore ?? 0,
        priceScore: intel.priceScore ?? 0,
        vehicleQualityScore: intel.vehicleQualityScore ?? 0,
        buyerSegmentScore: intel.buyerSegmentScore ?? 0,
        seasonalScore: intel.seasonalScore ?? 0,
        dealerPerformanceScore: intel.dealerPerformanceScore ?? 0,
        buyerDemandScore: intel.buyerDemandScore ?? 0,
        inventoryHealthScore: intel.inventoryHealthScore ?? 0,
        creativePerformanceScore: intel.creativePerformanceScore ?? 0,
        pricingPosition: intel.pricingPosition ?? "Market Average",
        daysOnLot: intel.daysOnLot ?? 0,
        opportunityFactors: factors,
        // Buyer segment
        primarySegment: intel.primarySegment ?? "General",
        secondarySegment: intel.secondarySegment ?? null,
        adAngle: intel.adAngle ?? "",
        suggestedLanguage: intel.suggestedLanguage ?? "English-first",
        whyThisAudience: intel.whyThisAudience ?? "",
        // Strategy
        strategyName: parseStrategyName(intel.explanation),
        recommendedDayOfWeek: intel.recommendedDayOfWeek ?? null,
        recommendedDayLabel: intel.recommendedDayOfWeek != null ? (DAY_NAMES[intel.recommendedDayOfWeek] ?? null) : null,
        recommendedTimeOfDay: intel.recommendedTimeOfDay ?? null,
        recommendedTimeLabel: intel.recommendedTimeOfDay != null ? timeLabel(intel.recommendedTimeOfDay) : null,
        expectedLeadQuality: intel.expectedLeadQuality ?? "warm",
        confidenceScore: intel.confidenceScore,
        // Marketplace Demand Engine v1
        demandScore: intel.demandScore ?? intel.opportunityScore ?? 0,
        demandLabel: intel.demandLabel ?? "Moderate",
        demandFactors: (() => {
          try { return JSON.parse(intel.demandFactors ?? "[]") as string[]; } catch { return []; }
        })(),
        marketplacePopularityScore: intel.marketplacePopularityScore ?? null,
        latinoPreferenceScore: intel.latinoPreferenceScore ?? null,
        financingProbabilityScore: intel.financingProbabilityScore ?? null,
        historicalEngagementScore: intel.historicalEngagementScore ?? null,
        duplicateSaturationScore: intel.duplicateSaturationScore ?? null,
        demandWeightsVersion: intel.demandWeightsVersion ?? null,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => {
      // Primary: demandScore descending (Marketplace Demand Engine v1)
      const aDemand = a.demandScore ?? a.opportunityScore;
      const bDemand = b.demandScore ?? b.opportunityScore;
      if (bDemand !== aDemand) return bDemand - aDemand;
      // Secondary: price score descending (best value wins the tie)
      if (b.priceScore !== a.priceScore) return b.priceScore - a.priceScore;
      // Tertiary: vehicle id ascending (stable, deterministic)
      return a.vehicleId - b.vehicleId;
    });

  // Market-level insights
  const scores = scored.map((v) => v.opportunityScore);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0;
  const hotCount = scored.filter((v) => v.opportunityScore >= 75).length;
  const warmCount = scored.filter((v) => v.opportunityScore >= 60 && v.opportunityScore < 80).length;
  const coldCount = scored.filter((v) => v.opportunityScore < 60).length;
  const agingCount = scored.filter((v) => v.daysOnLot >= 60).length;
  const belowMarketCount = scored.filter((v) => v.pricingPosition === "Below Market").length;
  const atMarketCount = scored.filter((v) => v.pricingPosition === "Market Average").length;
  const aboveMarketCount = scored.filter((v) => v.pricingPosition === "Above Market").length;
  const avgDaysOnLot = scored.length > 0
    ? Math.round(scored.reduce((s, v) => s + v.daysOnLot, 0) / scored.length) : 0;

  // Seasonal context for July (current month)
  const month = new Date().getMonth() + 1;
  const seasonContext =
    month >= 6 && month <= 8 ? "Summer Peak — SUVs, Trucks & Convertibles lead demand" :
    month >= 2 && month <= 4 ? "Tax Season — Economy vehicles and EVs surge" :
    month >= 9 && month <= 11 ? "Fall Season — Trucks and AWD vehicles in demand" :
    "Winter Season — 4WD and all-weather vehicles preferred";

  // Top body type by avg opportunity score
  const byBodyType = new Map<string, number[]>();
  for (const v of scored) {
    const bt = v.bodyStyle ?? "Other";
    const arr = byBodyType.get(bt) ?? [];
    arr.push(v.opportunityScore);
    byBodyType.set(bt, arr);
  }
  let topBodyType = "Truck";
  let topBodyScore = 0;
  for (const [bt, btScores] of byBodyType.entries()) {
    const a = Math.round(btScores.reduce((s, n) => s + n, 0) / btScores.length);
    if (a > topBodyScore) { topBodyScore = a; topBodyType = bt; }
  }

  // Sections
  const hot = scored.filter((v) => v.opportunityScore >= 75).slice(0, 10);
  const cooling = [...scored]
    .sort((a, b) => b.daysOnLot - a.daysOnLot)
    .filter((v) => v.daysOnLot >= 30)
    .slice(0, 10);
  const competitive = [...scored]
    .sort((a, b) => b.priceScore - a.priceScore)
    .slice(0, 10);

  // Regional breakdown by lot
  const byLotMap = new Map<string, { count: number; scores: number[]; hot: number }>();
  for (const v of scored) {
    const loc = v.lotLocation ?? "Unknown";
    const entry = byLotMap.get(loc) ?? { count: 0, scores: [], hot: 0 };
    entry.count++;
    entry.scores.push(v.opportunityScore);
    if (v.opportunityScore >= 80) entry.hot++;
    byLotMap.set(loc, entry);
  }
  const byLot = Array.from(byLotMap.entries())
    .map(([location, data]) => ({
      location,
      count: data.count,
      avgOpportunityScore: Math.round(data.scores.reduce((s, n) => s + n, 0) / data.scores.length),
      hotCount: data.hot,
    }))
    .sort((a, b) => b.avgOpportunityScore - a.avgOpportunityScore);

  // Body type demand for market trends
  const bodyTypeTrend = Array.from(byBodyType.entries())
    .map(([bodyType, btScores]) => ({
      bodyType,
      count: btScores.length,
      avgScore: Math.round(btScores.reduce((s, n) => s + n, 0) / btScores.length),
    }))
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 6);

  res.json({
    vehicles: scored,
    insights: {
      avgOpportunityScore: avgScore,
      hotCount,
      warmCount,
      coldCount,
      agingCount,
      belowMarketCount,
      atMarketCount,
      aboveMarketCount,
      seasonContext,
      topBodyType,
      avgDaysOnLot,
      totalVehicles: scored.length,
    },
    sections: {
      hot,
      cooling,
      competitive,
      byLot,
      bodyTypeTrend,
    },
  });
});

export default router;
