import { db, publishingJobsTable } from "@workspace/db";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Logger } from "pino";
import {
  IN_FLIGHT_PUBLISHING_JOB_STATUSES,
  QUEUED_PUBLISHING_JOB_STATUSES,
} from "./controlledMode";
import { reconcileBatchProgress } from "../features/publishing/infrastructure/publishingRepository";

// ── In-flight stale jobs (extension crashed mid-fill) ────────────────────────
// Jobs stuck in an active extension status for > 30 min → Retry or Failed.
const ACTIVE_STALE_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ATTEMPTS = 3;
const REVIEW_STALE_STATUSES = new Set<string>(["Auto Publishing"]);

// ── Queued/Scheduled stale jobs (extension offline, never claimed) ────────────
// Jobs sitting past their effective scheduled time for > 4 hours without being claimed
// are cancelled automatically. The operator can re-queue when the extension
// is back online. Threshold is intentionally long to survive overnight gaps.
const QUEUED_STALE_MS = 4 * 60 * 60 * 1000; // 4 hours

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

export function startStaleJobCleaner(logger: Logger): void {
  const check = async () => {
    const now = Date.now();

    // ── 1. Active-status stale jobs (extension crashed) ──────────────────────
    const activeCutoff = new Date(now - ACTIVE_STALE_MS);
    const activeStale = await db
      .select({
        id: publishingJobsTable.id,
        attempts: publishingJobsTable.attempts,
        batchId: publishingJobsTable.batchId,
        status: publishingJobsTable.status,
      })
      .from(publishingJobsTable)
      .where(
        and(
          inArray(publishingJobsTable.status, [...IN_FLIGHT_PUBLISHING_JOB_STATUSES]),
          lt(publishingJobsTable.updatedAt, activeCutoff),
        ),
      );

    if (activeStale.length > 0) {
      logger.warn({ count: activeStale.length, cutoff: activeCutoff }, "Stale in-flight jobs — transitioning");
      for (const job of activeStale) {
        if (REVIEW_STALE_STATUSES.has(job.status)) {
          const [updated] = await db
            .update(publishingJobsTable)
            .set({
              status: "Needs Review",
              needsReview: true,
              reviewReason: "Auto-expired during auto-publish confirmation. Verify Facebook before marking live.",
              failedReason: "Auto-expired during Auto Publishing without Marketplace listing URL confirmation",
              claimedByExtension: null,
              assignedExtensionId: null,
              assignedAt: null,
            })
            .where(eq(publishingJobsTable.id, job.id))
            .returning({ batchId: publishingJobsTable.batchId });
          await reconcileBatchProgress(updated?.batchId ?? job.batchId);
          continue;
        }

        const nextStatus = job.attempts >= MAX_ATTEMPTS ? "Failed" : "Retry";
        const [updated] = await db
          .update(publishingJobsTable)
          .set({
            status: nextStatus,
            failedReason: `Auto-expired: no activity for ${ACTIVE_STALE_MS / 60000} minutes`,
            claimedByExtension: null,
            assignedExtensionId: null,
            assignedAt: null,
          })
          .where(eq(publishingJobsTable.id, job.id))
          .returning({ batchId: publishingJobsTable.batchId });
        if (nextStatus === "Failed") {
          await reconcileBatchProgress(updated?.batchId ?? job.batchId);
        }
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
          inArray(publishingJobsTable.status, [...QUEUED_PUBLISHING_JOB_STATUSES]),
          lt(
            sql`coalesce(${publishingJobsTable.scheduledAt}, ${publishingJobsTable.createdAt})`,
            queuedCutoff,
          ),
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
            inArray(publishingJobsTable.status, [...QUEUED_PUBLISHING_JOB_STATUSES]),
            lt(
              sql`coalesce(${publishingJobsTable.scheduledAt}, ${publishingJobsTable.createdAt})`,
              queuedCutoff,
            ),
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
