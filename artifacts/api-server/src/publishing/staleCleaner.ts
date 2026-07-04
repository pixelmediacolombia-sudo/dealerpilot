import { db, publishingJobsTable } from "@workspace/db";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { Logger } from "pino";

// ── In-flight stale jobs (extension crashed mid-fill) ────────────────────────
// Jobs stuck in an active extension status for > 30 min → Retry or Failed.
const ACTIVE_STALE_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVE_STALE_STATUSES = ["Publishing", "Assigned", "Filling Form", "Opening Facebook"] as const;
const MAX_ATTEMPTS = 3;

// ── Queued/Scheduled stale jobs (extension offline, never claimed) ────────────
// Jobs sitting in Queued or Scheduled for > 4 hours without being claimed
// are cancelled automatically. The operator can re-queue when the extension
// is back online. Threshold is intentionally long to survive overnight gaps.
const QUEUED_STALE_MS = 4 * 60 * 60 * 1000; // 4 hours
const QUEUED_STALE_STATUSES = ["Queued", "Scheduled", "Retry"] as const;

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

export function startStaleJobCleaner(logger: Logger): void {
  const check = async () => {
    const now = Date.now();

    // ── 1. Active-status stale jobs (extension crashed) ──────────────────────
    const activeCutoff = new Date(now - ACTIVE_STALE_MS);
    const activeStale = await db
      .select({ id: publishingJobsTable.id, attempts: publishingJobsTable.attempts })
      .from(publishingJobsTable)
      .where(
        and(
          inArray(publishingJobsTable.status, [...ACTIVE_STALE_STATUSES]),
          lt(publishingJobsTable.updatedAt, activeCutoff),
        ),
      );

    if (activeStale.length > 0) {
      logger.warn({ count: activeStale.length, cutoff: activeCutoff }, "Stale in-flight jobs — transitioning");
      for (const job of activeStale) {
        const nextStatus = job.attempts >= MAX_ATTEMPTS ? "Failed" : "Retry";
        await db
          .update(publishingJobsTable)
          .set({
            status: nextStatus,
            failedReason: `Auto-expired: no activity for ${ACTIVE_STALE_MS / 60000} minutes`,
            claimedByExtension: null,
          })
          .where(eq(publishingJobsTable.id, job.id));
      }
      logger.warn({ jobIds: activeStale.map((j) => j.id) }, "In-flight stale jobs transitioned");
    }

    // ── 2. Queued/Scheduled stale jobs (extension offline) ───────────────────
    const queuedCutoff = new Date(now - QUEUED_STALE_MS);
    const queuedStale = await db
      .select({ id: publishingJobsTable.id, vehicleId: publishingJobsTable.vehicleId, source: publishingJobsTable.source })
      .from(publishingJobsTable)
      .where(
        and(
          inArray(publishingJobsTable.status, [...QUEUED_STALE_STATUSES]),
          lt(publishingJobsTable.createdAt, queuedCutoff),
        ),
      );

    if (queuedStale.length > 0) {
      logger.warn(
        { count: queuedStale.length, cutoff: queuedCutoff, thresholdH: QUEUED_STALE_MS / 3_600_000 },
        "Stale queued jobs — cancelling (extension offline too long)",
      );
      await db
        .update(publishingJobsTable)
        .set({
          status: "Cancelled",
          failedReason: `Auto-cancelled: job sat in queue for over ${QUEUED_STALE_MS / 3_600_000} hours without being claimed by an extension`,
        })
        .where(
          and(
            inArray(publishingJobsTable.status, [...QUEUED_STALE_STATUSES]),
            lt(publishingJobsTable.createdAt, queuedCutoff),
          ),
        );
      logger.warn({ jobIds: queuedStale.map((j) => j.id) }, "Stale queued jobs cancelled");
    }
  };

  setInterval(() => {
    check().catch((err) => logger.error({ err }, "Stale job cleaner error"));
  }, CHECK_INTERVAL_MS);

  // Run once immediately on startup to clear any jobs left from previous sessions
  check().catch((err) => logger.error({ err }, "Stale job cleaner startup check error"));

  logger.info(
    {
      activeThresholdMin: ACTIVE_STALE_MS / 60000,
      queuedThresholdH: QUEUED_STALE_MS / 3_600_000,
      intervalMin: CHECK_INTERVAL_MS / 60000,
    },
    "Stale job cleaner started (active + queued)",
  );
}
