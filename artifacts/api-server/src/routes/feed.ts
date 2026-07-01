import { Router, type IRouter } from "express";
import { CURRENT_SAMPLE_FEED } from "../inventory/sampleFeed";
import { computeFeedHealth } from "../channels/metaCatalog";
import { getNextSyncAt } from "../inventory/scheduler";

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

export default router;
