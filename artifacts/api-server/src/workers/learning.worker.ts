// Learning Worker — nightly calibration.
//
// 1. Compares each vehicle's predicted expectedLeadQuality (Opportunity Engine)
//    against actual lead outcomes in listing_performance (existing check).
//
// 2. NEW: Calibrates Marketplace Demand Engine signal weights using EMA.
//    For each vehicle with real listing performance data, compares how well
//    each demand sub-score predicted the actual outcome. Slightly adjusts
//    signal weights toward what actually mattered on Marketplace.
//    Updated weights are stored in the learning worker's lastResultJson so that
//    the next seedOpportunityScores run picks them up automatically.
import {
  db,
  vehicleIntelligenceTable,
  listingPerformanceTable,
  workerStateTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  DEFAULT_DEMAND_WEIGHTS,
  DEMAND_WEIGHTS_VERSION,
  calibrateDemandWeights,
  type DemandWeights,
  type SignalFeedback,
} from "../intelligence/demandEngine";
import type { WorkerDefinition, WorkerRunOutcome } from "./types";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // nightly

// ── Existing quality-match calibration ───────────────────────────────────────

function actualQualityFromCounts(row: {
  hotLeadsCount: number;
  warmLeadsCount: number;
  coldLeadsCount: number;
}): "hot" | "warm" | "cold" | null {
  const total = row.hotLeadsCount + row.warmLeadsCount + row.coldLeadsCount;
  if (total === 0) return null;
  if (row.hotLeadsCount >= row.warmLeadsCount && row.hotLeadsCount >= row.coldLeadsCount) return "hot";
  if (row.warmLeadsCount >= row.coldLeadsCount) return "warm";
  return "cold";
}

// ── Demand weight calibration ─────────────────────────────────────────────────

async function loadCurrentDemandWeights(): Promise<{ weights: DemandWeights; version: string }> {
  const [learningState] = await db
    .select({ lastResultJson: workerStateTable.lastResultJson })
    .from(workerStateTable)
    .where(eq(workerStateTable.workerId, "learning"))
    .limit(1);

  if (learningState?.lastResultJson) {
    try {
      const stored = JSON.parse(learningState.lastResultJson) as {
        detail?: { demandWeights?: DemandWeights; demandWeightsVersion?: string };
      };
      const w = stored.detail?.demandWeights;
      const v = stored.detail?.demandWeightsVersion;
      if (w && typeof w === "object" && Object.keys(w).length >= 10) {
        return { weights: w, version: v ?? DEMAND_WEIGHTS_VERSION };
      }
    } catch {
      // corrupt JSON — fall back to defaults
    }
  }
  return { weights: DEFAULT_DEMAND_WEIGHTS, version: DEMAND_WEIGHTS_VERSION };
}

function buildSignalFeedback(
  intel: {
    demandScore: number | null;
    opportunityScore: number | null;
    buyerSegmentScore: number | null;
    priceScore: number | null;
    inventoryHealthScore: number | null;
    seasonalScore: number | null;
    marketplacePopularityScore: number | null;
    latinoPreferenceScore: number | null;
    financingProbabilityScore: number | null;
    historicalEngagementScore: number | null;
    duplicateSaturationScore: number | null;
  },
  perf: { outcomeScore: number; hotLeadsCount: number; appointmentReadyCount: number; soldCount: number },
  weights: DemandWeights,
): SignalFeedback[] {
  // Actual relevance proxy: map real outcome signals to 0–100 contributions
  // outcomeScore (0–100) = primary truth signal
  const actual = perf.outcomeScore;
  const apptBoost = Math.min(20, perf.appointmentReadyCount * 10);
  const salesBoost = Math.min(15, perf.soldCount * 10);
  const hotBoost = Math.min(15, perf.hotLeadsCount * 5);
  const actualEngagement = Math.min(100, actual + apptBoost + salesBoost + hotBoost);

  const sub = {
    opportunityScore:          intel.opportunityScore ?? 50,
    marketplaceDemand:         intel.marketplacePopularityScore ?? 50,
    vehicleSegmentDemand:      intel.buyerSegmentScore ?? 50,
    latinoBuyerPreference:     intel.latinoPreferenceScore ?? 50,
    financingProbability:      intel.financingProbabilityScore ?? 50,
    historicalConversations:   intel.historicalEngagementScore ?? 50,
    historicalAppointments:    Math.min(100, (intel.historicalEngagementScore ?? 50) * 0.6 + perf.appointmentReadyCount * 15),
    historicalSales:           Math.min(100, (intel.historicalEngagementScore ?? 50) * 0.5 + perf.soldCount * 20),
    daysInInventory:           intel.inventoryHealthScore ?? 50,
    priceCompetitiveness:      intel.priceScore ?? 50,
    duplicateSaturation:       intel.duplicateSaturationScore ?? 50,
    seasonalDemand:            intel.seasonalScore ?? 50,
  };

  return (Object.keys(weights) as Array<keyof DemandWeights>).map((signal) => ({
    signal,
    predictedContribution: (sub[signal] ?? 50) * weights[signal],
    actualRelevance: actualEngagement * weights[signal],
  }));
}

// ── Worker run ────────────────────────────────────────────────────────────────

async function run(): Promise<WorkerRunOutcome> {
  const performances = await db.select().from(listingPerformanceTable);

  // ── 1. Lead quality match check (existing) ───────────────────────────────────
  let compared = 0;
  let matches = 0;
  const mismatches: Array<{ vehicleId: number; predicted: string; actual: string }> = [];

  for (const perf of performances) {
    const actual = actualQualityFromCounts(perf);
    if (!actual) continue;

    const [intel] = await db
      .select({ expectedLeadQuality: vehicleIntelligenceTable.expectedLeadQuality })
      .from(vehicleIntelligenceTable)
      .where(eq(vehicleIntelligenceTable.vehicleId, perf.vehicleId));

    if (!intel?.expectedLeadQuality) continue;

    compared++;
    if (intel.expectedLeadQuality === actual) {
      matches++;
    } else {
      mismatches.push({ vehicleId: perf.vehicleId, predicted: intel.expectedLeadQuality, actual });
    }
  }

  const qualityAccuracyPct = compared > 0 ? Math.round((matches / compared) * 100) : null;

  // ── 2. Demand weight calibration (new) ────────────────────────────────────────
  const { weights: currentWeights, version: currentVersion } = await loadCurrentDemandWeights();

  // Only calibrate if we have real performance data (non-seeded records)
  const realPerfs = performances.filter(
    (p) => p.outcomeScore > 0 && (p.hotLeadsCount > 0 || p.conversationsCount > 0 || p.appointmentReadyCount > 0),
  );

  let newWeights = currentWeights;
  let newVersion = currentVersion;
  let demandCalibrated = false;
  let demandCompared = 0;

  if (realPerfs.length >= 3) {
    const allFeedback: SignalFeedback[] = [];

    for (const perf of realPerfs) {
      const [intel] = await db
        .select({
          demandScore: vehicleIntelligenceTable.demandScore,
          opportunityScore: vehicleIntelligenceTable.opportunityScore,
          buyerSegmentScore: vehicleIntelligenceTable.buyerSegmentScore,
          priceScore: vehicleIntelligenceTable.priceScore,
          inventoryHealthScore: vehicleIntelligenceTable.inventoryHealthScore,
          seasonalScore: vehicleIntelligenceTable.seasonalScore,
          marketplacePopularityScore: vehicleIntelligenceTable.marketplacePopularityScore,
          latinoPreferenceScore: vehicleIntelligenceTable.latinoPreferenceScore,
          financingProbabilityScore: vehicleIntelligenceTable.financingProbabilityScore,
          historicalEngagementScore: vehicleIntelligenceTable.historicalEngagementScore,
          duplicateSaturationScore: vehicleIntelligenceTable.duplicateSaturationScore,
        })
        .from(vehicleIntelligenceTable)
        .where(eq(vehicleIntelligenceTable.vehicleId, perf.vehicleId));

      if (!intel?.demandScore) continue;

      const feedback = buildSignalFeedback(intel, perf, currentWeights);
      allFeedback.push(...feedback);
      demandCompared++;
    }

    if (demandCompared >= 2 && allFeedback.length > 0) {
      // Aggregate feedback across all vehicles before calibrating
      const aggregated = new Map<keyof DemandWeights, { predicted: number; actual: number; n: number }>();
      for (const f of allFeedback) {
        const existing = aggregated.get(f.signal) ?? { predicted: 0, actual: 0, n: 0 };
        existing.predicted += f.predictedContribution;
        existing.actual += f.actualRelevance;
        existing.n += 1;
        aggregated.set(f.signal, existing);
      }

      const avgFeedback: SignalFeedback[] = Array.from(aggregated.entries()).map(
        ([signal, { predicted, actual, n }]) => ({
          signal,
          predictedContribution: predicted / n,
          actualRelevance: actual / n,
        }),
      );

      const calibrated = calibrateDemandWeights(currentWeights, avgFeedback);
      newWeights = calibrated.weights;
      newVersion = calibrated.version;
      demandCalibrated = true;
    }
  }

  if (compared === 0 && !demandCalibrated) {
    return { summary: "Learning check skipped — not enough performance data yet", skipped: true };
  }

  const accuracyPct = qualityAccuracyPct ?? 0;

  return {
    summary: `Learning — quality match ${matches}/${compared} (${accuracyPct}%)${demandCalibrated ? ` · demand weights calibrated from ${demandCompared} vehicles` : " · demand weights unchanged"}`,
    detail: {
      compared,
      matches,
      qualityAccuracyPct,
      mismatches: mismatches.slice(0, 20),
      demandCalibrated,
      demandCompared,
      // Stored weights — read by seedOpportunityScores on next run
      demandWeights: newWeights,
      demandWeightsVersion: newVersion,
    },
  };
}

export const learningWorker: WorkerDefinition = {
  id: "learning",
  name: "Learning Agent",
  description: "Nightly calibration: quality predictions vs actuals + demand signal weight tuning",
  intervalMs: INTERVAL_MS,
  enabled: true,
  run,
};
