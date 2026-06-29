import {
  db,
  creativeJobsTable,
  creativeScoresTable,
  creativeVersionsTable,
  creativeTemplatesTable,
  dealerBrandDnaTable,
  dealersTable,
  vehiclesTable,
  vehicleImagesTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import type { Logger } from "pino";
import { buildCreative } from "./pipeline";
import { scoreCreative } from "./scoring";
import { PIPELINE_STEPS } from "./templates";

const POLL_INTERVAL_MS = 1500;
const STEP_DELAY_MS = 350;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Atomically claim the oldest Queued job by flipping it to Generating. The
// guarded UPDATE (status still Queued) makes the claim safe even if a future
// second worker is added.
async function claimNextJob() {
  const [next] = await db
    .select()
    .from(creativeJobsTable)
    .where(eq(creativeJobsTable.status, "Queued"))
    .orderBy(asc(creativeJobsTable.createdAt))
    .limit(1);
  if (!next) return null;

  const [claimed] = await db
    .update(creativeJobsTable)
    .set({
      status: "Generating",
      step: PIPELINE_STEPS[0],
      progress: 5,
      startedAt: new Date(),
      attempts: next.attempts + 1,
      failedReason: null,
    })
    .where(and(eq(creativeJobsTable.id, next.id), eq(creativeJobsTable.status, "Queued")))
    .returning();
  return claimed ?? null;
}

async function processJob(job: typeof creativeJobsTable.$inferSelect, log: Logger) {
  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, job.vehicleId));
  if (!vehicle) throw new Error(`Vehicle ${job.vehicleId} not found`);

  const [template] = await db
    .select()
    .from(creativeTemplatesTable)
    .where(eq(creativeTemplatesTable.key, job.templateKey));
  if (!template) throw new Error(`Template ${job.templateKey} not found`);

  const [dna] = await db
    .select()
    .from(dealerBrandDnaTable)
    .where(eq(dealerBrandDnaTable.dealerId, job.dealerId));

  const [dealer] = await db
    .select()
    .from(dealersTable)
    .where(eq(dealersTable.id, job.dealerId));

  const images = await db
    .select()
    .from(vehicleImagesTable)
    .where(eq(vehicleImagesTable.vehicleId, job.vehicleId))
    .orderBy(asc(vehicleImagesTable.position));
  const primaryImageUrl = images[0]?.url ?? null;

  // Walk the placeholder pipeline, surfacing step + progress as we go so the UI
  // can show live generation status without blocking.
  for (let i = 0; i < PIPELINE_STEPS.length; i++) {
    await sleep(STEP_DELAY_MS);
    await db
      .update(creativeJobsTable)
      .set({
        step: PIPELINE_STEPS[i],
        progress: Math.round(((i + 1) / PIPELINE_STEPS.length) * 100),
      })
      .where(eq(creativeJobsTable.id, job.id));
  }

  const { renderSpec, outputs } = buildCreative({
    vehicle,
    primaryImageUrl,
    dna: dna ?? null,
    template,
    dealerName: dealer?.name ?? "Dealer",
  });

  const existing = await db
    .select({ version: creativeVersionsTable.version })
    .from(creativeVersionsTable)
    .where(eq(creativeVersionsTable.vehicleId, job.vehicleId));
  const nextVersion = existing.reduce((max, v) => Math.max(max, v.version), 0) + 1;
  const isFirst = existing.length === 0;

  const version = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(creativeVersionsTable)
      .values({
        vehicleId: job.vehicleId,
        dealerId: job.dealerId,
        version: nextVersion,
        templateKey: job.templateKey,
        brandStyle: renderSpec.brandStyle,
        backgroundStyle: renderSpec.backgroundStyle,
        status: "Generated",
        // First creative for a vehicle becomes the default automatically.
        isDefault: isFirst,
        renderSpec,
        outputs,
      })
      .returning();

    const breakdown = scoreCreative(vehicle, dna ?? null, template, images.length);
    await tx.insert(creativeScoresTable).values({
      creativeVersionId: row!.id,
      vehicleId: job.vehicleId,
      brandConsistency: breakdown.brandConsistency,
      vehicleVisibility: breakdown.vehicleVisibility,
      lighting: breakdown.lighting,
      composition: breakdown.composition,
      ctrPrediction: breakdown.ctrPrediction,
      overall: breakdown.overall,
      rating: breakdown.rating,
    });
    return row!;
  });

  await db
    .update(creativeJobsTable)
    .set({
      status: "Completed",
      step: "Export",
      progress: 100,
      creativeVersionId: version.id,
      completedAt: new Date(),
    })
    .where(eq(creativeJobsTable.id, job.id));

  log.info(
    { jobId: job.id, vehicleId: job.vehicleId, version: nextVersion },
    "Creative job completed",
  );
}

async function tick(log: Logger, state: { running: boolean }) {
  if (state.running) return;
  state.running = true;
  try {
    const job = await claimNextJob();
    if (!job) return;
    try {
      await processJob(job, log);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      const nextStatus = job.attempts >= MAX_ATTEMPTS ? "Failed" : "Queued";
      await db
        .update(creativeJobsTable)
        .set({ status: nextStatus, failedReason: reason, step: null, progress: 0 })
        .where(eq(creativeJobsTable.id, job.id));
      log.error({ err, jobId: job.id, nextStatus }, "Creative job failed");
    }
  } catch (err) {
    log.error({ err }, "Creative worker tick failed");
  } finally {
    state.running = false;
  }
}

/**
 * Start the in-process creative worker. It resets any jobs left mid-flight by a
 * previous process, then polls for Queued jobs and processes them one at a time.
 */
export async function startCreativeWorker(log: Logger): Promise<void> {
  await db
    .update(creativeJobsTable)
    .set({ status: "Queued", step: null, progress: 0 })
    .where(eq(creativeJobsTable.status, "Generating"));

  const state = { running: false };
  setInterval(() => void tick(log, state), POLL_INTERVAL_MS);
  log.info("Creative worker started");
}
