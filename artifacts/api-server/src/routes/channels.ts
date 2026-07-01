import { Router, type IRouter } from "express";
import {
  generateMetaCatalogXml,
  generateMetaCatalogCsv,
  validateMetaCatalog,
} from "../channels/metaCatalog";

const router: IRouter = Router();

const DEALER_ID = 1;

router.get("/channels/meta-catalog/feed.xml", async (req, res) => {
  try {
    const xml = await generateMetaCatalogXml(DEALER_ID);
    res
      .header("Cache-Control", "no-cache")
      .type("application/xml")
      .send(xml);
  } catch (err) {
    req.log.error({ err }, "Failed to generate Meta catalog XML");
    res.status(500).json({ error: "Failed to generate XML feed" });
  }
});

router.get("/channels/meta-catalog/feed.csv", async (req, res) => {
  try {
    const csv = await generateMetaCatalogCsv(DEALER_ID);
    res
      .header("Cache-Control", "no-cache")
      .header("Content-Disposition", 'attachment; filename="meta-catalog.csv"')
      .type("text/csv")
      .send(csv);
  } catch (err) {
    req.log.error({ err }, "Failed to generate Meta catalog CSV");
    res.status(500).json({ error: "Failed to generate CSV feed" });
  }
});

router.get("/channels/meta-catalog/diagnostics", async (req, res) => {
  try {
    const result = await validateMetaCatalog(DEALER_ID);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to validate Meta catalog");
    res.status(500).json({ error: "Failed to validate feed" });
  }
});

export default router;
