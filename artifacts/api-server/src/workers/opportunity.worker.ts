// Opportunity Worker — refreshes Opportunity Engine scores, Demand Engine scores,
// and the Top 10 recommendation list every 30 minutes.
// Ranking is now driven by demandScore (Marketplace Demand Engine v1) with
// opportunityScore as one of 12 inputs rather than the sole ranking metric.
import { db, vehiclesTable, vehicleIntelligenceTable, publishingJobsTable } from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
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

  // Rank by demandScore (Marketplace Demand Engine v1).
  // Fall back to opportunityScore for rows that haven't been demand-scored yet
  // (e.g. first run before the demand engine has computed scores).
  const candidates = await db
    .select({
      vehicleId: vehicleIntelligenceTable.vehicleId,
      demandScore: vehicleIntelligenceTable.demandScore,
      demandLabel: vehicleIntelligenceTable.demandLabel,
      opportunityScore: vehicleIntelligenceTable.opportunityScore,
    })
    .from(vehicleIntelligenceTable)
    .innerJoin(vehiclesTable, eq(vehiclesTable.id, vehicleIntelligenceTable.vehicleId))
    .where(
      and(
        eq(vehiclesTable.dealerId, DEALER_ID),
        isNotNull(sql`coalesce(${vehicleIntelligenceTable.demandScore}, ${vehicleIntelligenceTable.opportunityScore})`),
        publishedVehicleIds.length > 0
          ? notInArray(vehicleIntelligenceTable.vehicleId, publishedVehicleIds)
          : undefined,
      ),
    )
    .orderBy(
      desc(
        sql`coalesce(${vehicleIntelligenceTable.demandScore}, ${vehicleIntelligenceTable.opportunityScore})`,
      ),
    )
    .limit(10);

  const hotCount = candidates.filter(
    (c) => (c.demandScore ?? c.opportunityScore ?? 0) >= 75,
  ).length;

  const hotDemandCount = candidates.filter((c) => c.demandLabel === "Hot Demand").length;

  return {
    summary: `Demand scores refreshed — ${candidates.length} vehicles ranked, ${hotCount} hot (${hotDemandCount} "Hot Demand")`,
    detail: {
      top10VehicleIds: candidates.map((c) => c.vehicleId),
      hotCount,
      hotDemandCount,
      excludedPublished: publishedVehicleIds.length,
      rankingMetric: "demandScore",
    },
  };
}

export const opportunityWorker: WorkerDefinition = {
  id: "opportunity",
  name: "Opportunity Agent",
  description: "Refreshes Demand + Opportunity Scores, Top 10, and Command Center strategy",
  intervalMs: INTERVAL_MS,
  enabled: true,
  run,
};
