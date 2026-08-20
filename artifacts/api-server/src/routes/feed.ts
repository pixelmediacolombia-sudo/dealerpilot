import { Router, type IRouter } from "express";
import { CURRENT_SAMPLE_FEED } from "../inventory/sampleFeed";
import { computeFeedHealth } from "../channels/metaCatalog";
import { getNextSyncAt, runInventorySync } from "../inventory/scheduler";
import { ALPHA_DEALER_ID } from "../lib/dealer";
import { db, feedIngestionsTable, vehiclesTable } from "@workspace/db";
import { and, desc, eq, gte, lt } from "drizzle-orm";

const router: IRouter = Router();

router.get("/inventory/sold", async (req, res) => {
  try {
    const dealerId = Number(req.query.dealer_id ?? req.query.dealerId ?? ALPHA_DEALER_ID);
    const date = typeof req.query.date === "string" ? req.query.date : "today";
    if (!Number.isInteger(dealerId) || dealerId <= 0) {
      res.status(400).json({ error: "Invalid dealer_id" });
      return;
    }
    const start = date === "today" ? new Date(new Date().setHours(0, 0, 0, 0)) : new Date(`${date}T00:00:00`);
    if (Number.isNaN(start.getTime())) {
      res.status(400).json({ error: "Invalid date" });
      return;
    }
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const vehicles = await db
      .select()
      .from(vehiclesTable)
      .where(and(eq(vehiclesTable.dealerId, dealerId), gte(vehiclesTable.soldAt, start), lt(vehiclesTable.soldAt, end)))
      .orderBy(desc(vehiclesTable.soldAt));
    res.json({ dealerId, date, count: vehicles.length, vehicles });
  } catch (err) {
    req.log.error({ err }, "GET /inventory/sold failed");
    res.status(500).json({ error: "Failed to load sold inventory" });
  }
});

router.get("/feed/ingestions", async (req, res) => {
  try {
    const dealerId = Number(req.query.dealer_id ?? req.query.dealerId ?? ALPHA_DEALER_ID);
    const requestedLimit = Number(req.query.limit ?? 20);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;
    if (!Number.isInteger(dealerId) || dealerId <= 0) {
      res.status(400).json({ error: "Invalid dealer_id" });
      return;
    }
    const ingestions = await db
      .select()
      .from(feedIngestionsTable)
      .where(eq(feedIngestionsTable.dealerId, dealerId))
      .orderBy(desc(feedIngestionsTable.ingestedAt))
      .limit(limit);
    res.json({ dealerId, ingestions });
  } catch (err) {
    req.log.error({ err }, "GET /feed/ingestions failed");
    res.status(500).json({ error: "Failed to load feed ingestion history" });
  }
});

router.get("/sample-feed", (req, res) => {
  req.log.info("Serving sample inventory feed");
  res.type("application/xml").send(CURRENT_SAMPLE_FEED());
});

router.get("/inventory/health", async (req, res) => {
  try {
    const report = await computeFeedHealth(1, getNextSyncAt());
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Failed to compute inventory health");
    res.status(500).json({ error: "Failed to compute feed health" });
  }
});

// POST /api/inventory/sync — manually trigger a full feed import including
// the Alpha Motorsport location scraper and Opportunity Engine refresh.
router.post("/inventory/sync", async (req, res) => {
  try {
    const result = await runInventorySync(req.log, {
      dealerId: ALPHA_DEALER_ID,
      trigger: "manual",
    });

    res.json({
      ok: true,
      dealerId: result.dealerId,
      trigger: result.trigger,
      nextSyncAt: getNextSyncAt()?.toISOString() ?? null,
      summary: result.summary,
    });
  } catch (err) {
    req.log.error({ err }, "Manual inventory sync failed");
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Inventory sync failed",
    });
  }
});

export default router;
