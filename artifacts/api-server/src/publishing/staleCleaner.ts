import { db, publishingJobsTable } from "@workspace/db";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { Logger } from "pino";

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const CHECK_INTERVAL_MS = 2 * 60 * 1000;   // every 2 minutes
const MAX_ATTEMPTS = 3;

const STALE_STATUSES = ["Publishing", "Assigned", "Filling Form", "Opening Facebook"] as const;

export function startStaleJobCleaner(logger: Logger): void {
  const check = async () => {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    const stale = await db
      .select({ id: publishingJobsTable.id, attempts: publishingJobsTable.attempts })
      .from(publishingJobsTable)
      .where(
        and(
          inArray(publishingJobsTable.status, [...STALE_STATUSES]),
          lt(publishingJobsTable.updatedAt, cutoff),
        ),
      );

    if (stale.length === 0) return;

    logger.warn({ count: stale.length, cutoff }, "Stale publishing jobs detected — transitioning");

    for (const job of stale) {
      const nextStatus = job.attempts >= MAX_ATTEMPTS ? "Failed" : "Retry";
      await db
        .update(publishingJobsTable)
        .set({
          status: nextStatus,
          failedReason: `Auto-expired: no activity for ${STALE_THRESHOLD_MS / 60000} minutes`,
          claimedByExtension: null,
        })
        .where(eq(publishingJobsTable.id, job.id));
    }

    logger.warn({ jobIds: stale.map((j) => j.id) }, "Stale jobs transitioned");
  };

  setInterval(() => {
    check().catch((err) => logger.error({ err }, "Stale job cleaner error"));
  }, CHECK_INTERVAL_MS);

  logger.info(
    { thresholdMin: STALE_THRESHOLD_MS / 60000, intervalMin: CHECK_INTERVAL_MS / 60000 },
    "Stale job cleaner started",
  );
}
