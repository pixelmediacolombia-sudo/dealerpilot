import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  db,
  dealersTable,
  dealerDownPaymentConfigsTable,
  feedRunsTable,
  vehiclesTable,
  type Dealer,
  type FeedRun,
} from "@workspace/db";
import { and, count, desc, eq, ilike, isNull, lt, or } from "drizzle-orm";
import { runInventorySync } from "../inventory/scheduler";


const router: IRouter = Router();

function toFeedRun(run: FeedRun) {
  return {
    id: run.id,
    dealerId: run.dealerId,
    status: run.status,
    triggerType: run.triggerType,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    vehiclesImported: run.vehiclesImported,
    vehiclesNew: run.vehiclesNew,
    vehiclesUpdated: run.vehiclesUpdated,
    vehiclesRemoved: run.vehiclesRemoved,
    vehiclesActive: run.vehiclesActive,
    errorCount: run.errorCount,
    errorMessage: run.errorMessage ?? null,
  };
}

async function toDealer(dealer: Dealer) {
  const [latest] = await db
    .select()
    .from(feedRunsTable)
    .where(eq(feedRunsTable.dealerId, dealer.id))
    .orderBy(desc(feedRunsTable.startedAt))
    .limit(1);
  const [{ value: total }] = await db
    .select({ value: count() })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, dealer.id));

  const lastSyncAt = latest
    ? (latest.finishedAt ?? latest.startedAt).toISOString()
    : null;

  return {
    id: dealer.id,
    name: dealer.name,
    websiteUrl: dealer.websiteUrl ?? null,
    xmlFeedUrl: dealer.xmlFeedUrl ?? null,
    plan: dealer.plan === "basic" ? "basic" : "complete",
    status: dealer.status,
    notes: dealer.notes ?? null,
    lastSyncAt,
    lastSyncStatus: latest?.status ?? null,
    totalVehiclesImported: total ?? 0,
    lastError: latest?.errorMessage ?? null,
    createdAt: dealer.createdAt.toISOString(),
  };
}

router.get("/dealers", async (req, res) => {
  const rows = await db.select().from(dealersTable).orderBy(dealersTable.id);
  const dealers = await Promise.all(rows.map(toDealer));
  res.json({ dealers });
});

router.get("/dealers/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, id));
  if (!dealer) {
    res.status(404).json({ error: "Dealer not found" });
    return;
  }
  res.json(await toDealer(dealer));
});

const DealerUpdateBody = z.object({
  name: z.string().min(1).optional(),
  websiteUrl: z.string().optional(),
  xmlFeedUrl: z.string().optional(),
  plan: z.enum(["basic", "complete"]).optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
});

router.patch("/dealers/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = DealerUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid dealer update" });
    return;
  }
  const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, id));
  if (!dealer) {
    res.status(404).json({ error: "Dealer not found" });
    return;
  }
  const [updated] = await db
    .update(dealersTable)
    .set(parsed.data)
    .where(eq(dealersTable.id, id))
    .returning();
  req.log.info({ dealerId: id }, "Updated dealer");
  res.json(await toDealer(updated!));
});

const DownPaymentConfigBody = z.object({
  planAmounts: z.array(z.number().int().positive()).min(1).max(12),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().nullable().optional(),
});

function parseConfigDate(value: string | undefined, fallback: Date | null): Date | null {
  if (value === undefined) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

router.get("/dealers/:id/down-payment-config", async (req, res) => {
  const id = Number(req.params.id);
  const [dealer] = await db.select({ id: dealersTable.id }).from(dealersTable).where(eq(dealersTable.id, id));
  if (!dealer) {
    res.status(404).json({ error: "Dealer not found" });
    return;
  }
  const configs = await db
    .select()
    .from(dealerDownPaymentConfigsTable)
    .where(eq(dealerDownPaymentConfigsTable.dealerId, id))
    .orderBy(desc(dealerDownPaymentConfigsTable.effectiveFrom));
  const now = new Date();
  const active = configs.find((config) =>
    config.effectiveFrom <= now && (config.effectiveTo == null || config.effectiveTo > now),
  ) ?? null;
  res.json({
    active: active ? {
      id: active.id,
      dealerId: active.dealerId,
      planAmounts: active.planAmounts,
      effectiveFrom: active.effectiveFrom.toISOString(),
      effectiveTo: active.effectiveTo?.toISOString() ?? null,
    } : null,
    history: configs.map((config) => ({
      id: config.id,
      dealerId: config.dealerId,
      planAmounts: config.planAmounts,
      effectiveFrom: config.effectiveFrom.toISOString(),
      effectiveTo: config.effectiveTo?.toISOString() ?? null,
    })),
  });
});

router.put("/dealers/:id/down-payment-config", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = DownPaymentConfigBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid down-payment configuration", issues: parsed.error.issues });
    return;
  }
  const [dealer] = await db.select({ id: dealersTable.id }).from(dealersTable).where(eq(dealersTable.id, id));
  if (!dealer) {
    res.status(404).json({ error: "Dealer not found" });
    return;
  }
  const effectiveFrom = parseConfigDate(parsed.data.effectiveFrom, new Date());
  const effectiveTo = parseConfigDate(parsed.data.effectiveTo ?? undefined, null);
  if (!effectiveFrom || (parsed.data.effectiveTo !== undefined && !effectiveTo) || (effectiveTo && effectiveTo <= effectiveFrom)) {
    res.status(400).json({ error: "Invalid effective date window" });
    return;
  }
  const planAmounts = [...new Set(parsed.data.planAmounts)].sort((a, b) => a - b);
  const [created] = await db.transaction(async (tx) => {
    await tx
      .update(dealerDownPaymentConfigsTable)
      .set({ effectiveTo: effectiveFrom, updatedAt: new Date() })
      .where(and(
        eq(dealerDownPaymentConfigsTable.dealerId, id),
        lt(dealerDownPaymentConfigsTable.effectiveFrom, effectiveFrom),
        isNull(dealerDownPaymentConfigsTable.effectiveTo),
      ));
    return tx
      .insert(dealerDownPaymentConfigsTable)
      .values({ dealerId: id, planAmounts, effectiveFrom, effectiveTo })
      .returning();
  });
  res.status(201).json({
    id: created!.id,
    dealerId: created!.dealerId,
    planAmounts: created!.planAmounts,
    effectiveFrom: created!.effectiveFrom.toISOString(),
    effectiveTo: created!.effectiveTo?.toISOString() ?? null,
  });
});

router.post("/dealers/:id/sync", async (req, res) => {
  const id = Number(req.params.id);
  const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, id));
  if (!dealer) {
    res.status(404).json({ error: "Dealer not found" });
    return;
  }
  try {
    const { summary } = await runInventorySync(req.log, {
      dealerId: dealer.id,
      trigger: "manual",
    });
    const [run] = await db
      .select()
      .from(feedRunsTable)
      .where(eq(feedRunsTable.id, summary.feedRunId));
    res.json(toFeedRun(run!));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";
    req.log.warn({ err, dealerId: id }, "Feed sync failed");
    const [run] = await db
      .insert(feedRunsTable)
      .values({
        dealerId: dealer.id,
        status: "error",
        finishedAt: new Date(),
        errorCount: 1,
        errorMessage: message,
      })
      .returning();
    res.status(400).json(toFeedRun(run!));
  }
});

router.get("/dealers/:id/feed-runs", async (req, res) => {
  const id = Number(req.params.id);
  const runs = await db
    .select()
    .from(feedRunsTable)
    .where(eq(feedRunsTable.dealerId, id))
    .orderBy(desc(feedRunsTable.startedAt))
    .limit(20);
  res.json({ feedRuns: runs.map(toFeedRun) });
});

export default router;
