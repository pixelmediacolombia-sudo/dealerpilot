// DealerPilot AI Orchestrator v1.0 — decides which of the 6 existing workers
// should RUN, SKIP, or PAUSE this cycle, and why. It never runs blindly on a
// fixed timer per worker; instead it checks real dependency/change/budget
// state before delegating actual execution to the existing runWorkerOnce()
// bookkeeping (worker_runs/worker_state/timeline events are unchanged).
//
// Hard rules (see PHASE 2 spec):
//  - Orchestrator does not create fake data.
//  - Orchestrator does not call OpenAI or FAL directly — it only reads the
//    same real budget counters the Photo Worker itself checks.
//  - Orchestrator only decides worker execution; it never fabricates state.
//  - This module must never throw out of runOrchestrationCycle() — any
//    failure is caught and recorded as a Failed cycle so the API can never
//    crash because of it.
import { db, workerStateTable, orchestratorStateTable, vehicleChangesTable, vehicleIntelligenceTable, vehiclesTable, aiPhotoSetsTable, aiStudioPacksTable, vehicleImagesTable, extensionConnectionsTable, publishingJobsTable, listingPerformanceTable, autoPublishSettingsTable } from "@workspace/db";
import { and, count, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { Logger } from "pino";
import { getAllWorkers } from "./registry";
import { runWorkerOnce } from "./scheduler";
import { checkFalBudget, checkOpenAiBudget, ESTIMATED_COST_PER_PHOTO_JOB_USD, getPhotoBudgetStatus } from "./costGuardrail";
import { logTimelineEvent } from "./timeline";
import { setNextSyncAt } from "../inventory/scheduler";
import type { WorkerDefinition } from "./types";

const DEALER_ID = 1;
const ELIGIBLE_PHOTO_STATUSES = ["New", "Active", "Price Changed", "Ready to Publish"];
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;
const QUEUED_JOB_STATUSES = ["Queued", "Retry"];

export type OrchestratorAction = "RUN" | "SKIP" | "PAUSE";

export interface WorkerDecision {
  workerId: string;
  action: OrchestratorAction;
  reason: string;
  budgetStatus?: string;
  dependencyStatus?: string;
}

async function workerState(workerId: string) {
  const [row] = await db.select().from(workerStateTable).where(eq(workerStateTable.workerId, workerId));
  return row ?? null;
}

function ageMs(lastRunAt: Date | null | undefined): number {
  return lastRunAt ? Date.now() - lastRunAt.getTime() : Infinity;
}

async function decideInventory(intervalMs: number): Promise<WorkerDecision> {
  const state = await workerState("inventory");
  const age = ageMs(state?.lastRunAt);
  if (age >= intervalMs) {
    return { workerId: "inventory", action: "RUN", reason: `last sync ${state?.lastRunAt ? "over 24h ago" : "never ran"}` };
  }
  const remainingH = ((intervalMs - age) / (60 * 60 * 1000)).toFixed(1);
  return { workerId: "inventory", action: "SKIP", reason: `synced recently — next sync in ~${remainingH}h`, dependencyStatus: "up to date" };
}

async function decideOpportunity(intervalMs: number): Promise<WorkerDecision> {
  const state = await workerState("opportunity");
  const since = state?.lastRunAt ?? new Date(0);
  const [changeRow] = await db
    .select({ n: count() })
    .from(vehicleChangesTable)
    .where(gt(vehicleChangesTable.createdAt, since));
  const inventoryChanged = changeRow?.n ?? 0;

  if (inventoryChanged > 0) {
    return { workerId: "opportunity", action: "RUN", reason: `inventory changed (${inventoryChanged} change${inventoryChanged === 1 ? "" : "s"} since last run)`, dependencyStatus: "inventory changed" };
  }

  const age = ageMs(state?.lastRunAt);
  const [intelRow] = await db.select({ n: count() }).from(vehicleIntelligenceTable);
  const intelligenceStale = (intelRow?.n ?? 0) === 0 || age >= intervalMs;
  if (intelligenceStale) {
    return { workerId: "opportunity", action: "RUN", reason: state?.lastRunAt ? "intelligence stale — refresh interval elapsed" : "no intelligence computed yet", dependencyStatus: "intelligence stale" };
  }

  return { workerId: "opportunity", action: "SKIP", reason: "no inventory changes, intelligence still fresh", dependencyStatus: "up to date" };
}

async function decideMarket(intervalMs: number): Promise<WorkerDecision> {
  const state = await workerState("market");
  const opportunityState = await workerState("opportunity");

  const opportunityChangedSince =
    opportunityState?.lastRunAt && (!state?.lastRunAt || opportunityState.lastRunAt > state.lastRunAt);

  if (opportunityChangedSince) {
    return { workerId: "market", action: "RUN", reason: "opportunity scores changed since last market scan", dependencyStatus: "opportunity updated" };
  }

  const age = ageMs(state?.lastRunAt);
  if (age >= intervalMs) {
    return { workerId: "market", action: "RUN", reason: state?.lastRunAt ? "market strategy stale — refresh interval elapsed" : "never scanned", dependencyStatus: "stale" };
  }

  return { workerId: "market", action: "SKIP", reason: "no opportunity changes, market strategy still fresh", dependencyStatus: "up to date" };
}

async function getPhotoCandidateCount(): Promise<number> {
  const [defaultPack] = await db
    .select()
    .from(aiStudioPacksTable)
    .where(and(eq(aiStudioPacksTable.dealerId, DEALER_ID), eq(aiStudioPacksTable.isDefault, true)))
    .limit(1);
  if (!defaultPack) return 0;
  const currentVersion = defaultPack.backgroundVersion ?? "v1";

  const vehicles = await db
    .select({ id: vehiclesTable.id, aiPhotoStatus: vehiclesTable.aiPhotoStatus })
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.dealerId, DEALER_ID), inArray(vehiclesTable.status, ELIGIBLE_PHOTO_STATUSES)));

  let candidates = 0;
  for (const v of vehicles) {
    if (v.aiPhotoStatus === "Pending" || v.aiPhotoStatus === "Processing") continue;
    if (v.aiPhotoStatus === "Ready") {
      const [latestSet] = await db
        .select({ studioVersion: aiPhotoSetsTable.studioVersion })
        .from(aiPhotoSetsTable)
        .where(and(eq(aiPhotoSetsTable.vehicleId, v.id), eq(aiPhotoSetsTable.isLatest, true)))
        .limit(1);
      if (latestSet?.studioVersion === currentVersion) continue;
    }
    const [imgRow] = await db.select({ n: count() }).from(vehicleImagesTable).where(eq(vehicleImagesTable.vehicleId, v.id));
    if ((imgRow?.n ?? 0) === 0) continue;
    candidates++;
  }
  return candidates;
}

async function decidePhoto(): Promise<WorkerDecision> {
  const openAi = await checkOpenAiBudget();
  if (openAi.budgetExhausted) {
    return {
      workerId: "photo",
      action: "PAUSE",
      reason: `daily OpenAI budget exhausted ($${openAi.estimatedSpentTodayUsd.toFixed(2)} / $${openAi.dailyBudgetUsd})`,
      budgetStatus: "exhausted",
    };
  }

  const fal = await checkFalBudget(ESTIMATED_COST_PER_PHOTO_JOB_USD);
  if (fal.budgetExhausted) {
    return {
      workerId: "photo",
      action: "PAUSE",
      reason: `daily FAL budget reached ($${fal.estimatedSpentTodayUsd.toFixed(2)} / $${fal.dailyBudgetUsd})`,
      budgetStatus: "exhausted",
    };
  }

  const candidates = await getPhotoCandidateCount();
  if (candidates === 0) {
    return { workerId: "photo", action: "SKIP", reason: "no vehicles need AI photos", budgetStatus: "available", dependencyStatus: "no vehicles" };
  }

  return {
    workerId: "photo",
    action: "RUN",
    reason: `${candidates} vehicle${candidates === 1 ? "" : "s"} need AI photos, budget available`,
    budgetStatus: "available",
    dependencyStatus: "vehicles pending",
  };
}

async function findOnlineExtension(): Promise<boolean> {
  const rows = await db.select().from(extensionConnectionsTable);
  const cutoff = Date.now() - ONLINE_THRESHOLD_MS;
  return rows.some((r) => r.lastHeartbeatAt && r.lastHeartbeatAt.getTime() >= cutoff && r.status === "online");
}

async function decidePublishing(): Promise<WorkerDecision> {
  const extensionOnline = await findOnlineExtension();
  if (!extensionOnline) {
    return { workerId: "publishing", action: "SKIP", reason: "extension offline", dependencyStatus: "extension offline" };
  }

  const [queueRow] = await db
    .select({ n: count() })
    .from(publishingJobsTable)
    .where(
      and(
        eq(publishingJobsTable.dealerId, DEALER_ID),
        or(...QUEUED_JOB_STATUSES.map((s) => eq(publishingJobsTable.status, s))),
        isNull(publishingJobsTable.assignedExtensionId),
        isNull(publishingJobsTable.claimedByExtension),
      ),
    );
  const queued = queueRow?.n ?? 0;

  if (queued === 0) {
    const [settings] = await db
      .select()
      .from(autoPublishSettingsTable)
      .where(eq(autoPublishSettingsTable.dealerId, DEALER_ID));
    if (settings?.enabled && !settings.requireApproval) {
      return {
        workerId: "publishing",
        action: "RUN",
        reason: "auto-publish plan active, extension online",
        dependencyStatus: "extension online, auto plan active",
      };
    }
    return { workerId: "publishing", action: "SKIP", reason: "no approved vehicles in queue", dependencyStatus: "extension online, queue empty" };
  }

  return { workerId: "publishing", action: "RUN", reason: `${queued} job${queued === 1 ? "" : "s"} queued, extension online`, dependencyStatus: "extension online" };
}

async function decideLearning(intervalMs: number): Promise<WorkerDecision> {
  const state = await workerState("learning");
  const [perfRow] = await db.select({ n: count() }).from(listingPerformanceTable);
  const performanceRows = perfRow?.n ?? 0;

  if (performanceRows === 0) {
    return { workerId: "learning", action: "SKIP", reason: "no published results to analyze yet", dependencyStatus: "no performance data" };
  }

  const age = ageMs(state?.lastRunAt);
  if (age < intervalMs) {
    return { workerId: "learning", action: "SKIP", reason: "already ran within the last cycle", dependencyStatus: "up to date" };
  }

  return { workerId: "learning", action: "RUN", reason: `nightly check due — ${performanceRows} performance row${performanceRows === 1 ? "" : "s"} available`, dependencyStatus: "due" };
}

async function decideAll(definitions: WorkerDefinition[]): Promise<WorkerDecision[]> {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const decisions: WorkerDecision[] = [];

  const inventoryDef = byId.get("inventory");
  if (inventoryDef) decisions.push(await decideInventory(inventoryDef.intervalMs));

  const opportunityDef = byId.get("opportunity");
  if (opportunityDef) decisions.push(await decideOpportunity(opportunityDef.intervalMs));

  const marketDef = byId.get("market");
  if (marketDef) decisions.push(await decideMarket(marketDef.intervalMs));

  if (byId.get("photo")) decisions.push(await decidePhoto());
  if (byId.get("publishing")) decisions.push(await decidePublishing());

  const learningDef = byId.get("learning");
  if (learningDef) decisions.push(await decideLearning(learningDef.intervalMs));

  return decisions;
}

async function upsertOrchestratorState(patch: Partial<typeof orchestratorStateTable.$inferInsert>): Promise<void> {
  const [existing] = await db.select({ id: orchestratorStateTable.id }).from(orchestratorStateTable).limit(1);
  if (existing) {
    await db.update(orchestratorStateTable).set(patch).where(eq(orchestratorStateTable.id, existing.id));
  } else {
    await db.insert(orchestratorStateTable).values(patch);
  }
}

export interface OrchestrationCycleResult {
  status: "Active" | "Failed";
  decisions: WorkerDecision[];
  ranWorkerIds: string[];
  skippedWorkerIds: string[];
  pausedWorkerIds: string[];
}

/**
 * Runs one orchestration cycle: decides RUN/SKIP/PAUSE for each of the 6
 * workers based on real dependency/change/budget state, then delegates
 * execution of RUN decisions to the existing runWorkerOnce() (unchanged
 * bookkeeping). SKIP/PAUSE decisions are logged to the System Timeline but
 * never touch worker_state — this is what makes the mechanism non-destructive
 * and fully reversible (a worker "paused" only by orchestrator decision
 * simply reconsiders next cycle, with no persisted flag to get stuck on).
 *
 * NEVER throws — any internal failure is caught, recorded as a Failed
 * orchestration cycle, and returned so callers (routes, the auto-scheduler)
 * can never crash because of it.
 */
export async function runOrchestrationCycle(log: Logger, trigger: "auto" | "manual"): Promise<OrchestrationCycleResult> {
  try {
    const definitions = getAllWorkers();
    const decisions = await decideAll(definitions);
    const byId = new Map(definitions.map((d) => [d.id, d]));

    const ranWorkerIds: string[] = [];
    const skippedWorkerIds: string[] = [];
    const pausedWorkerIds: string[] = [];

    for (const decision of decisions) {
      const def = byId.get(decision.workerId);
      if (!def) continue;

      if (decision.action === "RUN") {
        const nextRunAt = new Date(Date.now() + def.intervalMs);
        if (def.id === "inventory") setNextSyncAt(nextRunAt);
        await runWorkerOnce(def, log, trigger, nextRunAt);
        ranWorkerIds.push(def.id);
      } else {
        if (decision.action === "PAUSE") pausedWorkerIds.push(def.id);
        else skippedWorkerIds.push(def.id);
        await logTimelineEvent(
          "orchestrator",
          `${def.name} ${decision.action === "PAUSE" ? "paused" : "skipped"} — ${decision.reason}`,
          { action: decision.action, reason: decision.reason },
          log,
          def.id,
        );
      }
    }

    await upsertOrchestratorState({
      lastDecisionAt: new Date(),
      lastDecisionJson: JSON.stringify(decisions),
      status: "Active",
    });

    return { status: "Active", decisions, ranWorkerIds, skippedWorkerIds, pausedWorkerIds };
  } catch (err) {
    log.error({ err }, "orchestrator: cycle failed — swallowed, process continues");
    await upsertOrchestratorState({
      lastDecisionAt: new Date(),
      status: "Failed",
    }).catch(() => {
      // Defense in depth: even the failure-path DB write must never throw.
    });
    return { status: "Failed", decisions: [], ranWorkerIds: [], skippedWorkerIds: [], pausedWorkerIds: [] };
  }
}

export interface OrchestratorStatus {
  status: "Active" | "Failed" | "Sleeping";
  lastDecisionAt: string | null;
  decisions: WorkerDecision[];
  workersRunning: string[];
  workersSkipped: string[];
  workersPaused: string[];
  budgetStatus: Awaited<ReturnType<typeof getPhotoBudgetStatus>>;
  extensionOnline: boolean;
}

/** Read-only snapshot for GET /api/orchestrator/status — never throws. */
export async function getOrchestratorStatus(): Promise<OrchestratorStatus> {
  try {
    const [row] = await db.select().from(orchestratorStateTable).limit(1);
    const decisions: WorkerDecision[] = row?.lastDecisionJson ? JSON.parse(row.lastDecisionJson) : [];
    const budgetStatus = await getPhotoBudgetStatus();
    const extensionOnline = await findOnlineExtension();

    return {
      status: row ? (row.status as "Active" | "Failed") : "Sleeping",
      lastDecisionAt: row?.lastDecisionAt ? row.lastDecisionAt.toISOString() : null,
      decisions,
      workersRunning: decisions.filter((d) => d.action === "RUN").map((d) => d.workerId),
      workersSkipped: decisions.filter((d) => d.action === "SKIP").map((d) => d.workerId),
      workersPaused: decisions.filter((d) => d.action === "PAUSE").map((d) => d.workerId),
      budgetStatus,
      extensionOnline,
    };
  } catch (err) {
    return {
      status: "Failed",
      lastDecisionAt: null,
      decisions: [],
      workersRunning: [],
      workersSkipped: [],
      workersPaused: [],
      budgetStatus: {
        todayFALSpendEstimate: 0,
        falBudgetRemaining: 0,
        falDailyBudgetUsd: 0,
        todayOpenAISpendEstimate: 0,
        openAIBudgetRemaining: 0,
        openAIDailyBudgetUsd: 0,
      },
      extensionOnline: false,
    };
  }
}
