import { Router, type IRouter } from "express";
import { CURRENT_SAMPLE_FEED } from "../inventory/sampleFeed";

const router: IRouter = Router();

// Serves the built-in sample dealer inventory feed so the feed URL is a real,
// reachable endpoint that can be inspected and fetched like any vendor feed.
router.get("/sample-feed", (req, res) => {
  req.log.info("Serving sample inventory feed");
  res.type("application/xml").send(CURRENT_SAMPLE_FEED());
});

export default router;
