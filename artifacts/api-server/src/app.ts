import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { generateMetaCatalogXml, generateMetaTestFeedXml } from "./channels/metaCatalog";

const DEALER_ID = 1;

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Root-level public feed URLs (no /api prefix) ────────────────────────────
// These bypass the /api routing so Meta's crawler gets a clean direct URL.
// Both paths are declared in artifact.toml so the proxy routes them here
// instead of to the static dashboard.

app.get("/meta-test-feed.xml", async (_req: Request, res: Response) => {
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

app.get("/meta-catalog-feed.xml", async (_req: Request, res: Response) => {
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

// ── API routes ───────────────────────────────────────────────────────────────
app.use("/api", router);

export default app;
