import { Router, type IRouter } from "express";
import { CURRENT_SAMPLE_FEED } from "../inventory/sampleFeed";
import { computeFeedHealth } from "../channels/metaCatalog";
import { getNextSyncAt } from "../inventory/scheduler";
import { fetchFeedXml } from "../inventory/feedSource";
import { importFeed } from "../inventory/importFeed";
import { db, dealersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

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
// the Alpha Motorsport location scraper. Used when lot locations are stale
// (e.g. after a fresh production deployment before the 24h scheduler fires).
router.post("/inventory/sync", async (req, res) => {
  req.log.info("Manual inventory sync triggered");
  try {
    const [dealer] = await db.select().from(dealersTable).where(eq(dealersTable.id, 1));
    if (!dealer?.xmlFeedUrl) {
      res.status(422).json({ error: "No XML feed URL configured for dealer 1" });
      return;
    }
    const xml = await fetchFeedXml(dealer.xmlFeedUrl);
    const summary = await importFeed(dealer.id, xml, req.log);
    req.log.info(summary, "Manual inventory sync complete");
    res.json({ ok: true, ...summary });
  } catch (err) {
    req.log.error({ err }, "Manual inventory sync failed");
    res.status(500).json({ error: "Sync failed", detail: String(err) });
  }
});

export default router;
