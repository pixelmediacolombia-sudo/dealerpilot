import { Router, type IRouter } from "express";
import {
  db,
  feedRunsTable,
  extensionConnectionsTable,
} from "@workspace/db";
import { desc, sql } from "drizzle-orm";

const router: IRouter = Router();

const HEARTBEAT_WINDOW_MS = 5 * 60 * 1000;

router.get("/connection-center", async (req, res) => {
  let database: { status: string; detail: string | null };
  try {
    await db.execute(sql`select 1`);
    database = { status: "connected", detail: "PostgreSQL reachable" };
  } catch {
    database = { status: "error", detail: "Database unreachable" };
  }

  const [latestRun] = await db
    .select()
    .from(feedRunsTable)
    .orderBy(desc(feedRunsTable.startedAt))
    .limit(1);

  let xmlFeed: {
    status: string;
    detail: string | null;
    lastHeartbeatAt?: string | null;
  };
  if (!latestRun) {
    xmlFeed = { status: "not_synced", detail: "No sync has run yet" };
  } else if (latestRun.status === "success") {
    xmlFeed = {
      status: "connected",
      detail: `Last sync imported ${latestRun.vehiclesImported} vehicles`,
      lastHeartbeatAt: (latestRun.finishedAt ?? latestRun.startedAt).toISOString(),
    };
  } else {
    xmlFeed = {
      status: "error",
      detail: latestRun.errorMessage ?? "Last sync failed",
    };
  }

  const [ext] = await db
    .select()
    .from(extensionConnectionsTable)
    .orderBy(desc(extensionConnectionsTable.lastHeartbeatAt))
    .limit(1);

  let chromeExtension: {
    status: string;
    detail: string | null;
    lastHeartbeatAt: string | null;
    backendUrl: string | null;
  };
  if (!ext || !ext.lastHeartbeatAt) {
    chromeExtension = {
      status: "offline",
      detail: "No heartbeat received yet",
      lastHeartbeatAt: null,
      backendUrl: ext?.backendUrl ?? null,
    };
  } else {
    const online = Date.now() - ext.lastHeartbeatAt.getTime() < HEARTBEAT_WINDOW_MS;
    chromeExtension = {
      status: online ? "online" : "offline",
      detail: online
        ? "Extension reporting in"
        : "No recent heartbeat from the extension",
      lastHeartbeatAt: ext.lastHeartbeatAt.toISOString(),
      backendUrl: ext.backendUrl ?? null,
    };
  }

  res.json({
    backend: { status: "connected", detail: "API server responding" },
    database,
    xmlFeed,
    chromeExtension,
    facebookSession: {
      status: "unknown",
      detail: "No Facebook session linked in this sprint",
    },
    marketplace: {
      status: "coming_soon",
      detail: "Marketplace publishing arrives in a future sprint",
    },
    messenger: {
      status: "coming_soon",
      detail: "Messenger AI arrives in a future sprint",
    },
    openai: {
      status: "coming_soon",
      detail: "AI Studio arrives in a future sprint",
    },
  });
});

export default router;
