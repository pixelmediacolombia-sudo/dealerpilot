import type { Express, Request, Response } from "express";
import {
  generateMetaCatalogCsv,
  generateMetaCatalogXml,
  generateMetaTestCsv,
  generateMetaTestFeedXml,
} from "../../channels/metaCatalog";
import { logger } from "../../lib/logger";
import { feedAuditMiddleware } from "./feedAudit";

const DEALER_ID = 1;

export function registerPublicFeeds(app: Express): void {
  app.get("/meta-catalog-feed.csv", feedAuditMiddleware, async (_req: Request, res: Response) => {
    try {
      const csv = await generateMetaCatalogCsv(DEALER_ID);
      res
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Cache-Control", "public, max-age=300")
        .header("X-Robots-Tag", "noindex")
        .send(csv);
    } catch (err) {
      logger.error({ err }, "Failed to generate meta catalog CSV");
      res.status(500).send("Internal Server Error");
    }
  });

  app.get("/meta-test-feed.csv", feedAuditMiddleware, async (_req: Request, res: Response) => {
    try {
      const csv = await generateMetaTestCsv(DEALER_ID);
      res
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Cache-Control", "public, max-age=300")
        .header("X-Robots-Tag", "noindex")
        .send(csv);
    } catch (err) {
      logger.error({ err }, "Failed to generate meta test CSV");
      res.status(500).send("Internal Server Error");
    }
  });

  app.get("/meta-test-feed.xml", feedAuditMiddleware, async (_req: Request, res: Response) => {
    try {
      const xml = await generateMetaTestFeedXml(DEALER_ID);
      res
        .header("Content-Type", "application/rss+xml; charset=utf-8")
        .header("Cache-Control", "public, max-age=300")
        .header("X-Robots-Tag", "noindex")
        .send(xml);
    } catch (err) {
      logger.error({ err }, "Failed to generate meta test feed");
      res.status(500).send("Internal Server Error");
    }
  });

  app.get("/meta-catalog-feed.xml", feedAuditMiddleware, async (_req: Request, res: Response) => {
    try {
      const xml = await generateMetaCatalogXml(DEALER_ID);
      res
        .header("Content-Type", "application/rss+xml; charset=utf-8")
        .header("Cache-Control", "public, max-age=300")
        .header("X-Robots-Tag", "noindex")
        .send(xml);
    } catch (err) {
      logger.error({ err }, "Failed to generate meta catalog feed");
      res.status(500).send("Internal Server Error");
    }
  });
}
