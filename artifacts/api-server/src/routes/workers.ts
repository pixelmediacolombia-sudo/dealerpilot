import { Router, type IRouter } from "express";
import {
  db,
  workerStateTable,
  systemTimelineEventsTable,
  aiPhotoJobsTable,
  creativeJobsTable,
} from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { getAllWorkers, getWorker, runWorkerOnce } from "../workers";
import { getPhotoBudgetStatus } from "../workers/costGuardrail";
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

export type PhotoWorkerStatus = "Running" | "Paused (Budget)" | "Paused (No Vehicles)" | "Sleeping";

function derivePhotoWorkerStatus(
  enabled: boolean,
  pauseReason: string | null,
  lastRunAt: Date | null,
  intervalMs: number,
): PhotoWorkerStatus {
  if (!enabled) return "Sleeping";
  if (pauseReason === "budget") return "Paused (Budget)";
  if (pauseReason === "no-vehicles") return "Paused (No Vehicles)";
  if (!lastRunAt) return "Sleeping";
  const ageMs = Date.now() - lastRunAt.getTime();
  return ageMs <= intervalMs * 1.5 ? "Running" : "Sleeping";
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

  const budget = await getPhotoBudgetStatus();
  const photoDef = definitions.find((d) => d.id === "photo");
  const photoState = stateByWorkerId.get("photo");
  const photoWorkerStatus: PhotoWorkerStatus = photoDef
    ? derivePhotoWorkerStatus(
        photoDef.enabled,
        photoState?.pauseReason ?? null,
        photoState?.lastRunAt ?? null,
        photoDef.intervalMs,
      )
    : "Sleeping";

  res.json({
    workers,
    todayOpenAISpendEstimate: budget.todayOpenAISpendEstimate,
    todayFALSpendEstimate: budget.todayFALSpendEstimate,
    openAIBudgetRemaining: budget.openAIBudgetRemaining,
    falBudgetRemaining: budget.falBudgetRemaining,
    photoWorkerStatus,
  });
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

function isEnabled(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

function numberConfig(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

async function creativeQueueStatus() {
  const [row] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${creativeJobsTable.status} = 'Queued')`,
      running: sql<number>`count(*) filter (where ${creativeJobsTable.status} = 'Generating')`,
      completed: sql<number>`count(*) filter (where ${creativeJobsTable.status} = 'Completed')`,
      failed: sql<number>`count(*) filter (where ${creativeJobsTable.status} = 'Failed')`,
    })
    .from(creativeJobsTable);

  return {
    queued: asNumber(row?.queued),
    running: asNumber(row?.running),
    completed: asNumber(row?.completed),
    failed: asNumber(row?.failed),
  };
}

async function photoQueueStatus() {
  const [row] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${aiPhotoJobsTable.status} = 'Queued')`,
      running: sql<number>`count(*) filter (where ${aiPhotoJobsTable.status} = 'Processing')`,
      completed: sql<number>`count(*) filter (where ${aiPhotoJobsTable.status} = 'Completed')`,
      failed: sql<number>`count(*) filter (where ${aiPhotoJobsTable.status} = 'Failed')`,
      cancelled: sql<number>`count(*) filter (where ${aiPhotoJobsTable.status} = 'Cancelled')`,
    })
    .from(aiPhotoJobsTable);

  return {
    queued: asNumber(row?.queued),
    running: asNumber(row?.running),
    completed: asNumber(row?.completed),
    failed: asNumber(row?.failed),
    cancelled: asNumber(row?.cancelled),
  };
}

router.get("/workers/status", async (_req, res) => {
  const enabled = isEnabled(process.env["WORKERS_ENABLED"]);

  try {
    const [creativeQueue, photoQueue] = await Promise.all([
      creativeQueueStatus(),
      photoQueueStatus(),
    ]);

    res.json({
      status: enabled ? "enabled" : "disabled",
      enabled,
      workers: [
        {
          name: "creative",
          type: "in-process",
          enabled,
          queue: creativeQueue,
        },
        {
          name: "photo",
          type: "in-process",
          enabled,
          queue: photoQueue,
          limits: {
            maxVehiclesPerRun: numberConfig(process.env["WORKER_PHOTO_MAX_VEHICLES_PER_RUN"]),
            dailyFalBudgetUsd: numberConfig(process.env["WORKER_DAILY_FAL_BUDGET_USD"]),
            dailyOpenaiBudgetUsd: numberConfig(process.env["WORKER_DAILY_OPENAI_BUDGET_USD"]),
          },
        },
      ],
    });
  } catch (err) {
    _req.log.error({ err }, "Failed to read worker status");
    res.status(500).json({
      status: "error",
      enabled,
      error: "Failed to read worker status",
    });
  }
});

export default router;
