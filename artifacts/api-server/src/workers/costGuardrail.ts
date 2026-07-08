// Daily spend guardrails for the AI Photo pipeline — two independent, hard-stop
// budgets, both backed by REAL per-call usage events (never estimates derived
// from job/vehicle counts):
//  - FAL (background removal + AI Studio composite): one ai_usage_events row
//    per actual fal.ai call, tagged fal_bg_removal / fal_composite.
//  - OpenAI (classification): one ai_usage_events row per actual classify()
//    call — classification happens once per IMAGE, so a per-job estimate
//    would be wildly inaccurate for vehicles with different photo counts.
//
// Every call site MUST check the relevant checkXBudget() BEFORE making the
// real API call (not after), so spend can never exceed the configured daily
// budget. Both budgets reset automatically at midnight because every query
// is bounded to "today" — there is no persisted "exhausted" flag to clear.
import { db, aiUsageEventsTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

// Estimated OpenAI cost (gpt-5-mini vision, low-detail image, small JSON reply)
// per single classification call. Conservative estimate, not billing truth —
// exists purely to stop runaway per-image spend.
export const ESTIMATED_COST_PER_OPENAI_CLASSIFICATION_USD = 0.002;

// Estimated FAL cost per real API call, split by operation since AI Studio
// compositing (queued, ~20-60s/image) is far more expensive than background
// removal (direct endpoint, ~750ms/image).
export const ESTIMATED_COST_PER_FAL_BG_REMOVAL_USD = 0.02;
export const ESTIMATED_COST_PER_FAL_COMPOSITE_USD = 0.13;
// Rough per-vehicle-job estimate used only to gate whether it's worth
// enqueuing a NEW job at all (a job may contain several images of each type).
export const ESTIMATED_COST_PER_PHOTO_JOB_USD =
  ESTIMATED_COST_PER_FAL_BG_REMOVAL_USD + ESTIMATED_COST_PER_FAL_COMPOSITE_USD;

export type FalUsagePurpose = "fal_bg_removal" | "fal_composite";

const FAL_COST_BY_PURPOSE: Record<FalUsagePurpose, number> = {
  fal_bg_removal: ESTIMATED_COST_PER_FAL_BG_REMOVAL_USD,
  fal_composite: ESTIMATED_COST_PER_FAL_COMPOSITE_USD,
};

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
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

function getFalDailyBudgetUsd(): number {
  return Number(process.env["WORKER_DAILY_FAL_BUDGET_USD"] ?? "10");
}

/** Real spend today across BOTH fal.ai operations, from actual usage events. */
export async function getTodayFalSpend(): Promise<number> {
  const rows = await db
    .select({ purpose: aiUsageEventsTable.purpose, count: sql<number>`count(*)::int` })
    .from(aiUsageEventsTable)
    .where(and(eq(aiUsageEventsTable.provider, "fal"), gte(aiUsageEventsTable.createdAt, todayStart())))
    .groupBy(aiUsageEventsTable.purpose);

  return rows.reduce((sum, r) => {
    const cost = FAL_COST_BY_PURPOSE[r.purpose as FalUsagePurpose] ?? 0;
    return sum + r.count * cost;
  }, 0);
}

/** Records one real FAL API call against today's usage counter. */
export async function recordFalUsage(purpose: FalUsagePurpose): Promise<void> {
  await db.insert(aiUsageEventsTable).values({ provider: "fal", purpose });
}

export interface FalBudgetCheck {
  dailyBudgetUsd: number;
  estimatedSpentTodayUsd: number;
  remainingBudgetUsd: number;
  estimatedCallCostUsd: number;
  budgetExhausted: boolean;
}

/**
 * Real-time, hard-stop FAL budget check. MUST be called before submitting ANY
 * FAL job (both the scheduled enqueue step and each individual fal.ai call
 * inside the pipeline stages) — if the estimated cost of the call exceeds the
 * remaining daily budget, the caller must skip it, log "FAL daily budget
 * reached", and never place the call.
 */
export async function checkFalBudget(estimatedCallCostUsd: number): Promise<FalBudgetCheck> {
  const dailyBudgetUsd = getFalDailyBudgetUsd();
  const estimatedSpentTodayUsd = await getTodayFalSpend();
  const remainingBudgetUsd = Math.max(0, dailyBudgetUsd - estimatedSpentTodayUsd);

  return {
    dailyBudgetUsd,
    estimatedSpentTodayUsd,
    remainingBudgetUsd,
    estimatedCallCostUsd,
    budgetExhausted: estimatedCallCostUsd > remainingBudgetUsd,
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
  const falDailyBudgetUsd = getFalDailyBudgetUsd();
  const todayFALSpendEstimate = await getTodayFalSpend();
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
