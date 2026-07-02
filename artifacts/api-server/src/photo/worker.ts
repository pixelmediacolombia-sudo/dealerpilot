// AI Photo Worker — poll-based, in-process background worker.
// Same pattern as creative/worker.ts: atomic claim, retry, setInterval poll.
// Resets any jobs left mid-flight on startup (server crash recovery).
import {
  db,
  aiPhotoJobsTable,
  vehiclesTable,
  vehicleImagesTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import { runPhotoPipeline } from "./pipeline";

const POLL_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 3;

// Atomically claim the oldest Queued job — safe even if a future second worker is added.
async function claimNextJob() {
  const [next] = await db
    .select()
    .from(aiPhotoJobsTable)
    .where(eq(aiPhotoJobsTable.status, "Queued"))
    .orderBy(asc(aiPhotoJobsTable.priority), asc(aiPhotoJobsTable.createdAt))
    .limit(1);
  if (!next) return null;

  const [claimed] = await db
    .update(aiPhotoJobsTable)
    .set({
      status: "Processing",
      currentStage: "Classify",
      progressPercent: 1,
      startedAt: new Date(),
      attempts: next.attempts + 1,
      failedReason: null,
    })
    .where(and(eq(aiPhotoJobsTable.id, next.id), eq(aiPhotoJobsTable.status, "Queued")))
    .returning();
  return claimed ?? null;
}

async function processJob(
  job: typeof aiPhotoJobsTable.$inferSelect,
  log: Logger,
): Promise<void> {
  // Validate vehicle still exists and has images
  const [vehicle] = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, job.vehicleId));
  if (!vehicle) throw new Error(`Vehicle ${job.vehicleId} not found — job ${job.id} skipped`);

  await db
    .update(vehiclesTable)
    .set({ aiPhotoStatus: "Processing" })
    .where(eq(vehiclesTable.id, job.vehicleId));

  await runPhotoPipeline(job, log);
}

async function tick(log: Logger, state: { running: boolean }) {
  if (state.running) return;
  state.running = true;
  try {
    const job = await claimNextJob();
    if (!job) return;

    try {
      await processJob(job, log);
      log.info({ jobId: job.id, vehicleId: job.vehicleId }, "photo:worker job completed");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const exhausted = job.attempts >= MAX_ATTEMPTS;
      const nextStatus = exhausted ? "Failed" : "Queued";

      await db
        .update(aiPhotoJobsTable)
        .set({
          status: nextStatus,
          failedReason: reason,
          currentStage: null,
          progressPercent: 0,
        })
        .where(eq(aiPhotoJobsTable.id, job.id));

      if (exhausted) {
        await db
          .update(vehiclesTable)
          .set({ aiPhotoStatus: "Failed" })
          .where(eq(vehiclesTable.id, job.vehicleId));
      }

      log.error({ err, jobId: job.id, nextStatus }, "photo:worker job failed");
    }
  } catch (err) {
    log.error({ err }, "photo:worker tick threw");
  } finally {
    state.running = false;
  }
}

/**
 * Start the in-process AI photo worker.
 * Resets any jobs left mid-flight by a previous process (crash recovery),
 * then polls for Queued jobs on an interval.
 */
export async function startPhotoWorker(log: Logger): Promise<void> {
  // Reset mid-flight jobs — these were interrupted by server restart
  const reset = await db
    .update(aiPhotoJobsTable)
    .set({ status: "Queued", currentStage: null, progressPercent: 0 })
    .where(eq(aiPhotoJobsTable.status, "Processing"))
    .returning({ id: aiPhotoJobsTable.id, vehicleId: aiPhotoJobsTable.vehicleId });

  if (reset.length > 0) {
    // Also reset vehicle status for re-queued jobs
    const vehicleIds = [...new Set(reset.map((r) => r.vehicleId))];
    if (vehicleIds.length > 0) {
      await db
        .update(vehiclesTable)
        .set({ aiPhotoStatus: "Pending" })
        .where(inArray(vehiclesTable.id, vehicleIds));
    }
    log.info({ count: reset.length }, "photo:worker reset mid-flight jobs");
  }

  const state = { running: false };
  setInterval(() => void tick(log, state), POLL_INTERVAL_MS);
  log.info("photo:worker started");
}
