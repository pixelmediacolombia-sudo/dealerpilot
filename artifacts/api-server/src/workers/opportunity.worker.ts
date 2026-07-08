// Opportunity Worker — refreshes Opportunity Engine scores and the Top 10
// recommendation list every 30 minutes.
import { db, vehiclesTable, vehicleIntelligenceTable, publishingJobsTable } from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { seedOpportunityScores } from "../intelligence/seed";
import type { WorkerDefinition, WorkerRunOutcome } from "./types";

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const DEALER_ID = 1;
const PUBLISHED_JOB_STATUSES = ["Published"];

async function run({ log }: { log: import("pino").Logger }): Promise<WorkerRunOutcome> {
  await seedOpportunityScores(log, { forceRefresh: true });

  // Vehicles already published shouldn't clutter the Top 10 recommendation list.
  const publishedVehicleIds = (
    await db
      .select({ vehicleId: publishingJobsTable.vehicleId })
      .from(publishingJobsTable)
      .where(inArray(publishingJobsTable.status, PUBLISHED_JOB_STATUSES))
  ).map((r) => r.vehicleId);

  const candidates = await db
    .select({
      vehicleId: vehicleIntelligenceTable.vehicleId,
      opportunityScore: vehicleIntelligenceTable.opportunityScore,
      opportunityLabel: vehicleIntelligenceTable.opportunityLabel,
    })
    .from(vehicleIntelligenceTable)
    .innerJoin(vehiclesTable, eq(vehiclesTable.id, vehicleIntelligenceTable.vehicleId))
    .where(
      and(
        eq(vehiclesTable.dealerId, DEALER_ID),
        isNotNull(vehicleIntelligenceTable.opportunityScore),
        publishedVehicleIds.length > 0
          ? notInArray(vehicleIntelligenceTable.vehicleId, publishedVehicleIds)
          : undefined,
      ),
    )
    .orderBy(desc(vehicleIntelligenceTable.opportunityScore))
    .limit(10);

  const hotCount = candidates.filter((c) => (c.opportunityScore ?? 0) >= 75).length;

  return {
    summary: `Opportunity scores refreshed — ${candidates.length} vehicles selected for today, ${hotCount} hot`,
    detail: {
      top10VehicleIds: candidates.map((c) => c.vehicleId),
      hotCount,
      excludedPublished: publishedVehicleIds.length,
    },
  };
}

export const opportunityWorker: WorkerDefinition = {
  id: "opportunity",
  name: "Opportunity Agent",
  description: "Refreshes Opportunity Scores, Top 10, and Command Center strategy",
  intervalMs: INTERVAL_MS,
  enabled: true,
  run,
};
