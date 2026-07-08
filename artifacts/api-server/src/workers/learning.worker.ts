// Learning Worker — nightly calibration check. Compares each vehicle's
// predicted expectedLeadQuality (from the Opportunity Engine) against the
// actual lead outcomes recorded in listing_performance, and logs a real
// accuracy summary to the System Timeline. This does NOT retrain any model —
// there is no ML training loop in this codebase — it only measures how well
// today's heuristics matched reality so a human can review calibration.
import { db, vehicleIntelligenceTable, listingPerformanceTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { WorkerDefinition, WorkerRunOutcome } from "./types";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // nightly

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

async function run(): Promise<WorkerRunOutcome> {
  const performances = await db.select().from(listingPerformanceTable);

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

  if (compared === 0) {
    return { summary: "Learning check skipped — not enough performance data yet", skipped: true };
  }

  const accuracyPct = Math.round((matches / compared) * 100);

  return {
    summary: `Learning check — ${matches}/${compared} predictions matched actual lead quality (${accuracyPct}%)`,
    detail: { compared, matches, accuracyPct, mismatches: mismatches.slice(0, 20) },
  };
}

export const learningWorker: WorkerDefinition = {
  id: "learning",
  name: "Learning Agent",
  description: "Nightly prediction-vs-actual calibration check against listing performance",
  intervalMs: INTERVAL_MS,
  enabled: true,
  run,
};
