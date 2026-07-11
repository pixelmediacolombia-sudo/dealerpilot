import fs from "fs";
import type { Express, Request, Response } from "express";
import { logger } from "../../lib/logger";
import { FEED_LOG_PATH } from "./feedAudit";

export function registerFeedAuditRoutes(app: Express): void {
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
          try {
            return JSON.parse(line);
          } catch {
            return { raw: line };
          }
        });
      res.json({ total: entries.length, entries });
    } catch (err) {
      logger.error({ err }, "Failed to read feed audit log");
      res.status(500).json({ error: "Could not read log" });
    }
  });

  app.delete("/api/feed-audit-log", (_req: Request, res: Response) => {
    try {
      fs.writeFileSync(FEED_LOG_PATH, "");
      res.json({ message: "Log cleared" });
    } catch (err) {
      logger.error({ err }, "Failed to clear feed audit log");
      res.status(500).json({ error: "Could not clear log" });
    }
  });
}
