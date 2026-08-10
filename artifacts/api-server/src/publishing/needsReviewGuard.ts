import { db, publishingJobsTable } from "@workspace/db";
import { desc, inArray } from "drizzle-orm";

/**
 * Vehicles whose latest publishing job is Needs Review require an operator
 * decision before they can enter another automatic batch.
 *
 * We inspect the latest job per vehicle instead of excluding any vehicle that
 * ever had a review job, so a later Published/Cancelled/Retry decision can
 * intentionally make it eligible again.
 */
export async function findLatestNeedsReviewVehicleIds(vehicleIds: number[]): Promise<Set<number>> {
  if (vehicleIds.length === 0) return new Set();

  const jobs = await db
    .select({
      vehicleId: publishingJobsTable.vehicleId,
      status: publishingJobsTable.status,
      id: publishingJobsTable.id,
      createdAt: publishingJobsTable.createdAt,
    })
    .from(publishingJobsTable)
    .where(inArray(publishingJobsTable.vehicleId, vehicleIds))
    .orderBy(desc(publishingJobsTable.createdAt), desc(publishingJobsTable.id));

  const latestStatusByVehicle = new Map<number, string>();
  for (const job of jobs) {
    if (!latestStatusByVehicle.has(job.vehicleId)) {
      latestStatusByVehicle.set(job.vehicleId, job.status);
    }
  }

  return new Set(
    [...latestStatusByVehicle.entries()]
      .filter(([, status]) => status === "Needs Review")
      .map(([vehicleId]) => vehicleId),
  );
}
