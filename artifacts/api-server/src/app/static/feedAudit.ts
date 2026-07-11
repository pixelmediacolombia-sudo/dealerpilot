import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../../lib/logger";

export const FEED_LOG_PATH = path.join(process.cwd(), "artifacts/api-server/logs/feed-access.log");

export function writeFeedLog(record: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(FEED_LOG_PATH), { recursive: true });
    fs.appendFileSync(FEED_LOG_PATH, JSON.stringify(record) + "\n");
  } catch (e) {
    process.stderr.write(`[feed-log] write error: ${e}\n`);
  }
}

export function feedAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
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
