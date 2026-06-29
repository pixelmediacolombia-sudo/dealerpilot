import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  db,
  dealersTable,
  feedRunsTable,
  vehiclesTable,
  type Dealer,
  type FeedRun,
} from "@workspace/db";
import { count, desc, eq } from "drizzle-orm";
import { fetchFeedXml } from "../inventory/feedSource";
import { importFeed } from "../inventory/importFeed";

const router: IRouter = Router();

function toFeedRun(run: FeedRun) {
  return {
    id: run.id,
    dealerId: run.dealerId,
    status: run.status,
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

router.post("/dealers/:id/sync", async (req, res) => {
  const id = Number(req.params.id);
  const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, id));
  if (!dealer) {
    res.status(404).json({ error: "Dealer not found" });
    return;
  }
  try {
    const xml = await fetchFeedXml(dealer.xmlFeedUrl);
    const summary = await importFeed(dealer.id, xml, req.log);
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
