// Lightweight daily spend guardrail for the Photo Worker.
// There is no live provider-balance API for FAL, so spend is *estimated* from
// the number of ai_photo_jobs actually created today, multiplied by a
// documented flat per-job cost. This is a conservative estimate, not billing
// truth — it exists purely to stop the worker from enqueuing runaway jobs.
import { db, aiPhotoJobsTable } from "@workspace/db";
import { and, gte, sql } from "drizzle-orm";

// Estimated all-in cost (FAL background removal + enhancement) per vehicle photo set.
export const ESTIMATED_COST_PER_PHOTO_JOB_USD = 0.15;

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getTodayPhotoJobCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiPhotoJobsTable)
    .where(and(gte(aiPhotoJobsTable.createdAt, todayStart())));
  return row?.count ?? 0;
}

export interface PhotoBudgetCheck {
  allowedCount: number;
  estimatedSpentTodayUsd: number;
  dailyBudgetUsd: number;
  budgetExhausted: boolean;
}

/**
 * Given a requested number of new photo jobs, returns how many can actually
 * be enqueued this run without exceeding WORKER_DAILY_FAL_BUDGET_USD.
 */
export async function checkPhotoBudget(requestedCount: number): Promise<PhotoBudgetCheck> {
  const dailyBudgetUsd = Number(process.env["WORKER_DAILY_FAL_BUDGET_USD"] ?? "10");
  const jobsToday = await getTodayPhotoJobCount();
  const estimatedSpentTodayUsd = jobsToday * ESTIMATED_COST_PER_PHOTO_JOB_USD;
  const remainingBudgetUsd = Math.max(0, dailyBudgetUsd - estimatedSpentTodayUsd);
  const affordableCount = Math.floor(remainingBudgetUsd / ESTIMATED_COST_PER_PHOTO_JOB_USD);
  const allowedCount = Math.max(0, Math.min(requestedCount, affordableCount));

  return {
    allowedCount,
    estimatedSpentTodayUsd,
    dailyBudgetUsd,
    budgetExhausted: allowedCount === 0 && requestedCount > 0,
  };
}

export function getPhotoMaxVehiclesPerRun(): number {
  return Number(process.env["WORKER_PHOTO_MAX_VEHICLES_PER_RUN"] ?? "5");
}
