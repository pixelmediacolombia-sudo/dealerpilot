// DealerPilot AI Worker Framework v1.0 — in-process orchestration for the 6
// scheduled agents. Runs on its own timer regardless of dashboard activity;
// every run is logged to worker_runs/worker_state and the System Timeline.
//
// v1.1 (AI Orchestrator): rather than each worker firing blindly on its own
// fixed interval, a single orchestrator cycle polls frequently and decides
// RUN/SKIP/PAUSE per worker based on real dependency/change/budget state
// (see orchestrator.ts). This is what stops DealerPilot from acting like
// several independent timers and makes it act like one coordinated system.
import type { Logger } from "pino";
import { registerWorker, getAllWorkers } from "./registry";
import { runOrchestrationCycle } from "./orchestrator";
import { inventoryWorker } from "./inventory.worker";
import { opportunityWorker } from "./opportunity.worker";
import { marketWorker } from "./market.worker";
import { photoWorker } from "./photo.worker";
import { publishingWorker } from "./publishing.worker";
import { learningWorker } from "./learning.worker";

export { getAllWorkers, getWorker } from "./registry";
export { runWorkerOnce } from "./scheduler";
export { runOrchestrationCycle, getOrchestratorStatus } from "./orchestrator";
export type { WorkerDefinition, WorkerStatusSummary } from "./types";

registerWorker(inventoryWorker);
registerWorker(opportunityWorker);
registerWorker(marketWorker);
registerWorker(photoWorker);
registerWorker(publishingWorker);
registerWorker(learningWorker);

// How often the orchestrator re-evaluates RUN/SKIP/PAUSE for every worker.
// Matches the shortest individual worker interval (Publishing Agent, 5 min)
// so nothing is ever meaningfully delayed versus the old per-worker timers —
// but a worker only actually runs when the orchestrator's own rules say so.
const ORCHESTRATION_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Starts the AI Orchestrator loop, unless disabled via WORKERS_ENABLED=false
 * (e.g. for a staging/preview deploy that should not sync inventory, spend
 * photo budget, or assign publishing jobs). Manual triggers via
 * POST /api/workers/:id/run and POST /api/orchestrator/run still work when
 * disabled — this flag only gates the automatic timer.
 */
export function startWorkers(log: Logger): void {
  if (process.env["WORKERS_ENABLED"] === "false") {
    log.warn("Worker framework disabled via WORKERS_ENABLED=false — no automatic scheduling. Manual triggers via POST /api/workers/:id/run and POST /api/orchestrator/run still work.");
    return;
  }

  const workers = getAllWorkers();
  log.info({ count: workers.length, ids: workers.map((w) => w.id) }, "Starting AI Orchestrator");

  const tick = () => void runOrchestrationCycle(log, "auto");
  tick(); // startup catch-up: evaluate immediately rather than waiting a full interval
  setInterval(tick, ORCHESTRATION_INTERVAL_MS);
}
