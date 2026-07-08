// Daily spend guardrails for the AI Photo pipeline — two independent budgets:
//  - FAL (background removal/enhancement): estimated from ai_photo_jobs created
//    today (no per-image granularity needed — one FAL pass per photo set).
//  - OpenAI (classification): tracked from REAL ai_usage_events rows, one per
//    actual classify() call, because classification happens once per IMAGE —
//    a single vehicle can be 3 photos or 40, so a per-job estimate would be
//    wildly inaccurate. Call recordOpenAiClassification() after every real
//    OpenAI call so the counter reflects true spend.
import { db, aiPhotoJobsTable, aiUsageEventsTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

// Estimated FAL cost (background removal + enhancement) per vehicle photo set.
export const ESTIMATED_COST_PER_PHOTO_JOB_USD = 0.15;

// Estimated OpenAI cost (gpt-5-mini vision, low-detail image, small JSON reply)
// per single classification call. Conservative estimate, not billing truth —
// exists purely to stop runaway per-image spend.
export const ESTIMATED_COST_PER_OPENAI_CLASSIFICATION_USD = 0.002;

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

export async function getTodayOpenAiClassificationCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiUsageEventsTable)
    .where(
      and(
        eq(aiUsageEventsTable.provider, "openai"),
        eq(aiUsageEventsTable.purpose, "photo_classification"),
        gte(aiUsageEventsTable.createdAt, todayStart()),
      ),
    );
  return row?.count ?? 0;
}

/** Records one real OpenAI classification call against today's usage counter. */
export async function recordOpenAiClassification(): Promise<void> {
  await db.insert(aiUsageEventsTable).values({ provider: "openai", purpose: "photo_classification" });
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

export interface OpenAiBudgetCheck {
  dailyBudgetUsd: number;
  estimatedSpentTodayUsd: number;
  remainingBudgetUsd: number;
  remainingCallsAllowed: number;
  budgetExhausted: boolean;
}

function getOpenAiDailyBudgetUsd(): number {
  return Number(process.env["WORKER_DAILY_OPENAI_BUDGET_USD"] ?? "1");
}

/**
 * Real-time OpenAI classification budget check. Called before every single
 * classify() call (per image, not per vehicle/job) so spend stops exactly at
 * the image granularity where it actually accrues.
 */
export async function checkOpenAiBudget(): Promise<OpenAiBudgetCheck> {
  const dailyBudgetUsd = getOpenAiDailyBudgetUsd();
  const callsToday = await getTodayOpenAiClassificationCount();
  const estimatedSpentTodayUsd = callsToday * ESTIMATED_COST_PER_OPENAI_CLASSIFICATION_USD;
  const remainingBudgetUsd = Math.max(0, dailyBudgetUsd - estimatedSpentTodayUsd);
  const remainingCallsAllowed = Math.floor(remainingBudgetUsd / ESTIMATED_COST_PER_OPENAI_CLASSIFICATION_USD);

  return {
    dailyBudgetUsd,
    estimatedSpentTodayUsd,
    remainingBudgetUsd,
    remainingCallsAllowed,
    budgetExhausted: remainingCallsAllowed <= 0,
  };
}

export function getPhotoMaxVehiclesPerRun(): number {
  return Number(process.env["WORKER_PHOTO_MAX_VEHICLES_PER_RUN"] ?? "5");
}

export interface PhotoBudgetStatus {
  todayFALSpendEstimate: number;
  falBudgetRemaining: number;
  falDailyBudgetUsd: number;
  todayOpenAISpendEstimate: number;
  openAIBudgetRemaining: number;
  openAIDailyBudgetUsd: number;
}

/** Combined snapshot for the /api/workers status endpoint. */
export async function getPhotoBudgetStatus(): Promise<PhotoBudgetStatus> {
  const falDailyBudgetUsd = Number(process.env["WORKER_DAILY_FAL_BUDGET_USD"] ?? "10");
  const jobsToday = await getTodayPhotoJobCount();
  const todayFALSpendEstimate = jobsToday * ESTIMATED_COST_PER_PHOTO_JOB_USD;

  const openAi = await checkOpenAiBudget();

  return {
    todayFALSpendEstimate,
    falBudgetRemaining: Math.max(0, falDailyBudgetUsd - todayFALSpendEstimate),
    falDailyBudgetUsd,
    todayOpenAISpendEstimate: openAi.estimatedSpentTodayUsd,
    openAIBudgetRemaining: openAi.remainingBudgetUsd,
    openAIDailyBudgetUsd: openAi.dailyBudgetUsd,
  };
}
