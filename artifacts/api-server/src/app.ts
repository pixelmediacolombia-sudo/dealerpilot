import fs from "fs";
import path from "path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  generateMetaCatalogXml,
  generateMetaTestFeedXml,
  generateMetaCatalogCsv,
  generateMetaTestCsv,
} from "./channels/metaCatalog";

const DEALER_ID = 1;

// ── Feed access log (append-only NDJSON) ────────────────────────────────────
// process.cwd() = /home/runner/workspace (set by pnpm workspace runner).
// __dirname is not reliable in the ESM build output — use cwd instead.
const FEED_LOG_PATH = path.join(process.cwd(), "artifacts/api-server/logs/feed-access.log");

function writeFeedLog(record: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(FEED_LOG_PATH), { recursive: true });
    fs.appendFileSync(FEED_LOG_PATH, JSON.stringify(record) + "\n");
  } catch (e) {
    process.stderr.write(`[feed-log] write error: ${e}\n`);
  }
}

/**
 * Middleware that captures every request + response for the four feed endpoints.
 * Logs to pino AND appends a structured NDJSON line to feed-access.log.
 */
function feedAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestedAt = new Date().toISOString();

  const requestRecord: Record<string, unknown> = {
    type: "feed_request",
    timestamp: requestedAt,
    method: req.method,
    path: req.path,
    httpVersion: req.httpVersion,
    ip: req.ip ?? req.socket?.remoteAddress ?? "unknown",
    headers: {
      "user-agent": req.headers["user-agent"] ?? "",
      accept: req.headers["accept"] ?? "",
      "accept-encoding": req.headers["accept-encoding"] ?? "",
      "accept-language": req.headers["accept-language"] ?? "",
      "cache-control": req.headers["cache-control"] ?? "",
      host: req.headers["host"] ?? "",
      referer: req.headers["referer"] ?? "",
      "x-forwarded-for": req.headers["x-forwarded-for"] ?? "",
      "x-real-ip": req.headers["x-real-ip"] ?? "",
      "if-modified-since": req.headers["if-modified-since"] ?? "",
      "if-none-match": req.headers["if-none-match"] ?? "",
    },
  };

  logger.info(requestRecord, "feed_request");
  writeFeedLog(requestRecord);

  // Wrap res.send so we can capture response headers and body size
  const originalSend = res.send.bind(res) as typeof res.send;
  res.send = function patchedSend(body?: unknown): Response {
    const respondedAt = new Date().toISOString();
    const bodyBytes =
      typeof body === "string"
        ? Buffer.byteLength(body, "utf8")
        : Buffer.isBuffer(body)
          ? body.length
          : 0;

    const responseRecord: Record<string, unknown> = {
      type: "feed_response",
      timestamp: respondedAt,
      path: req.path,
      ip: requestRecord.ip,
      userAgent: (requestRecord.headers as Record<string, string>)["user-agent"],
      statusCode: res.statusCode,
      responseHeaders: {
        "content-type": res.getHeader("content-type"),
        "content-length": res.getHeader("content-length"),
        "content-encoding": res.getHeader("content-encoding"),
        "transfer-encoding": res.getHeader("transfer-encoding"),
        "cache-control": res.getHeader("cache-control"),
        etag: res.getHeader("etag"),
        vary: res.getHeader("vary"),
      },
      bodyBytes,
    };

    logger.info(responseRecord, "feed_response");
    writeFeedLog(responseRecord);

    return originalSend(body);
  };

  next();
}

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
app.use("/api/meta/webhooks/messenger", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Root-level public feed URLs (no /api prefix) ────────────────────────────
// These bypass the /api routing so Meta's crawler gets a clean direct URL.
// All paths are declared in artifact.toml so the proxy routes them here.
// feedAuditMiddleware logs every request + response to feed-access.log.

// CSV feeds — primary format for Meta Automotive Inventory Ads
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

// XML feeds — kept for reference / fallback
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

// ── Feed access log viewer (internal, no auth needed for now) ───────────────
app.get("/api/feed-audit-log", (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(FEED_LOG_PATH)) {
      res.json({ entries: [], message: "Log file not found yet" });
      return;
    }
    const raw = fs.readFileSync(FEED_LOG_PATH, "utf8");
    const entries = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); }
        catch { return { raw: line }; }
      });
    res.json({ total: entries.length, entries });
  } catch (err) {
    logger.error({ err }, "Failed to read feed audit log");
    res.status(500).json({ error: "Could not read log" });
  }
});

// Convenience: clear the log
app.delete("/api/feed-audit-log", (_req: Request, res: Response) => {
  try {
    fs.writeFileSync(FEED_LOG_PATH, "");
    res.json({ message: "Log cleared" });
  } catch (err) {
    logger.error({ err }, "Failed to clear feed audit log");
    res.status(500).json({ error: "Could not clear log" });
  }
});

// ── AI Photo Studio static files ─────────────────────────────────────────────
// Serves Sharp-composited vehicle photos written by the AI photo pipeline.
// Directory: artifacts/api-server/uploads/ai-photos/ (created on demand by pipeline).
const AI_PHOTOS_DIR = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos");
fs.mkdirSync(AI_PHOTOS_DIR, { recursive: true });
app.use("/api/static/ai-photos", express.static(AI_PHOTOS_DIR, { maxAge: "1d" }));

// ── API routes ───────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Dashboard SPA (production only) ─────────────────────────────────────────
// In production the compiled React dashboard is served by Express.
// /api/* and the four feed URLs are handled above; everything else goes to the
// SPA so client-side routing (wouter) can take over.
// In development the Vite dev server runs separately — do not register this.
if (process.env["NODE_ENV"] === "production") {
  const dashboardDist = path.join(process.cwd(), "artifacts/dashboard/dist/public");
  app.use(express.static(dashboardDist, { maxAge: "1h", etag: true }));
  // SPA fallback: serve index.html for any route not already handled
  app.get("/{*path}", (_req: Request, res: Response) => {
    res.sendFile(path.join(dashboardDist, "index.html"));
  });
}

export default app;
