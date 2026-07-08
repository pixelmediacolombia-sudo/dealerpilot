import { Router, type IRouter } from "express";
import { aiPhotoJobsTable, creativeJobsTable, db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

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
