import { Router, type IRouter } from "express";
import { db, workerStateTable, systemTimelineEventsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { getAllWorkers, getWorker, runWorkerOnce } from "../workers";
import type { WorkerStatusLabel } from "../workers/types";

const router: IRouter = Router();

function deriveStatus(
  enabled: boolean,
  lastStatus: string | null,
  lastRunAt: Date | null,
  intervalMs: number,
): WorkerStatusLabel {
  if (!enabled) return "Sleeping";
  if (lastStatus === "Failed") return "Failed";
  if (!lastRunAt) return "Sleeping";
  const ageMs = Date.now() - lastRunAt.getTime();
  // "Online" while within ~1.5x its own interval (i.e. actively cycling); otherwise Sleeping.
  return ageMs <= intervalMs * 1.5 ? "Online" : "Sleeping";
}

// GET /workers — status of all 6 scheduled AI workers, for the dashboard panel.
router.get("/workers", async (req, res) => {
  const definitions = getAllWorkers();
  const states = await db.select().from(workerStateTable);
  const stateByWorkerId = new Map(states.map((s) => [s.workerId, s]));

  const workers = definitions.map((def) => {
    const state = stateByWorkerId.get(def.id);
    const lastRunAt = state?.lastRunAt ?? null;
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      intervalMs: def.intervalMs,
      enabled: def.enabled,
      status: deriveStatus(def.enabled, state?.lastStatus ?? null, lastRunAt, def.intervalMs),
      lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
      nextRunAt: state?.nextRunAt ? state.nextRunAt.toISOString() : null,
      lastResult: state?.lastResultJson ?? null,
      lastError: state?.lastErrorMessage ?? null,
    };
  });

  res.json({ workers });
});

// POST /workers/:id/run — manually trigger a worker to run immediately.
router.post("/workers/:id/run", async (req, res) => {
  const worker = getWorker(req.params.id);
  if (!worker) {
    res.status(404).json({ error: `Unknown worker id: ${req.params.id}` });
    return;
  }

  req.log.info({ workerId: worker.id }, "Manual worker trigger via API");
  const outcome = await runWorkerOnce(worker, req.log, "manual", null);

  res.json({ workerId: worker.id, summary: outcome.summary, skipped: !!outcome.skipped, detail: outcome.detail ?? null });
});

// GET /workers/timeline — recent System Timeline events emitted by workers.
router.get("/workers/timeline", async (req, res) => {
  const limitRaw = Number(req.query["limit"]);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 30;

  const rows = await db
    .select()
    .from(systemTimelineEventsTable)
    .orderBy(desc(systemTimelineEventsTable.createdAt))
    .limit(limit);

  const events = rows.map((r) => ({
    id: r.id,
    category: r.category,
    workerId: r.workerId,
    message: r.message,
    detail: r.detailJson ? JSON.parse(r.detailJson) : null,
    createdAt: r.createdAt.toISOString(),
  }));

  res.json({ events });
});

export default router;
