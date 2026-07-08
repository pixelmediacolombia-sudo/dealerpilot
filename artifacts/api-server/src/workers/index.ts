// DealerPilot AI Worker Framework v1.0 — in-process orchestration for the 6
// scheduled agents. Runs on its own timers regardless of dashboard activity;
// every run is logged to worker_runs/worker_state and the System Timeline.
import { db, workerStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import { registerWorker, getAllWorkers } from "./registry";
import { runWorkerOnce } from "./scheduler";
import { inventoryWorker } from "./inventory.worker";
import { opportunityWorker } from "./opportunity.worker";
import { marketWorker } from "./market.worker";
import { photoWorker } from "./photo.worker";
import { publishingWorker } from "./publishing.worker";
import { learningWorker } from "./learning.worker";
import { setNextSyncAt } from "../inventory/scheduler";
import type { WorkerDefinition } from "./types";

export { getAllWorkers, getWorker } from "./registry";
export { runWorkerOnce } from "./scheduler";
export type { WorkerDefinition, WorkerStatusSummary } from "./types";

registerWorker(inventoryWorker);
registerWorker(opportunityWorker);
registerWorker(marketWorker);
registerWorker(photoWorker);
registerWorker(publishingWorker);
registerWorker(learningWorker);

/**
 * Schedules a single worker with startup catch-up: if worker_state shows the
 * last run is missing or older than the interval, it runs immediately; then
 * it self-reschedules with setTimeout after every run (drift-free, survives
 * long-running ticks) rather than a fixed setInterval.
 */
async function scheduleWithCatchup(worker: WorkerDefinition, log: Logger): Promise<void> {
  const [state] = await db
    .select({ lastRunAt: workerStateTable.lastRunAt })
    .from(workerStateTable)
    .where(eq(workerStateTable.workerId, worker.id));

  const ageMs = state?.lastRunAt ? Date.now() - state.lastRunAt.getTime() : Infinity;
  const delayMs = ageMs >= worker.intervalMs ? 0 : worker.intervalMs - ageMs;

  const runAndReschedule = async () => {
    const nextRunAt = new Date(Date.now() + worker.intervalMs);
    if (worker.id === "inventory") setNextSyncAt(nextRunAt);
    await runWorkerOnce(worker, log, "auto", nextRunAt);
    setTimeout(() => void runAndReschedule(), worker.intervalMs);
  };

  if (worker.id === "inventory") {
    setNextSyncAt(new Date(Date.now() + delayMs));
  }

  setTimeout(() => void runAndReschedule(), delayMs);
  log.info(
    { worker: worker.id, delayMs, intervalMs: worker.intervalMs },
    "worker scheduled",
  );
}

/**
 * Starts every registered worker on its own catch-up-aware interval, unless
 * disabled via WORKERS_ENABLED=false (e.g. for a staging/preview deploy that
 * should not sync inventory, spend photo budget, or assign publishing jobs).
 * Manual triggers via POST /api/workers/:id/run still work when disabled —
 * this flag only gates the automatic timers.
 */
export function startWorkers(log: Logger): void {
  if (process.env["WORKERS_ENABLED"] === "false") {
    log.warn("Worker framework disabled via WORKERS_ENABLED=false — no automatic scheduling. Manual triggers via POST /api/workers/:id/run still work.");
    return;
  }

  const workers = getAllWorkers();
  log.info({ count: workers.length, ids: workers.map((w) => w.id) }, "Starting worker framework");
  for (const worker of workers) {
    if (!worker.enabled) continue;
    void scheduleWithCatchup(worker, log);
  }
}
