import { Router, type IRouter } from "express";
import { CURRENT_SAMPLE_FEED } from "../inventory/sampleFeed";
import { computeFeedHealth } from "../channels/metaCatalog";
import { getNextSyncAt, runInventorySync } from "../inventory/scheduler";
import { ALPHA_DEALER_ID } from "../lib/dealer";

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
