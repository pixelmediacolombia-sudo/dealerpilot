import { Router, type IRouter } from "express";
import {
  db,
  feedRunsTable,
  extensionConnectionsTable,
  leadsTable,
  conversationsTable,
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

  const extOnline =
    !!ext?.lastHeartbeatAt &&
    Date.now() - ext.lastHeartbeatAt.getTime() < HEARTBEAT_WINDOW_MS;

  if (!ext || !ext.lastHeartbeatAt) {
    chromeExtension = {
      status: "offline",
      detail: "No heartbeat received yet",
      lastHeartbeatAt: null,
      backendUrl: ext?.backendUrl ?? null,
    };
  } else {
    chromeExtension = {
      status: extOnline ? "connected" : "offline",
      detail: extOnline
        ? "Extension reporting in"
        : "No recent heartbeat from the extension",
      lastHeartbeatAt: ext.lastHeartbeatAt.toISOString(),
      backendUrl: ext.backendUrl ?? null,
    };
  }

  // ── Facebook session & Marketplace (real state from extension) ───────────────
  const fbLoggedIn = ext?.fbLoggedIn ?? null;
  const marketplaceConnected = ext?.marketplaceConnected ?? null;

  let facebookSession: {
    status: string;
    detail: string;
    fbLoggedIn: boolean | null;
  };
  if (!extOnline) {
    facebookSession = {
      status: "unknown",
      detail: "Extension offline — can't verify Facebook session",
      fbLoggedIn: null,
    };
  } else if (fbLoggedIn === null) {
    facebookSession = {
      status: "unknown",
      detail: "Extension hasn't visited Facebook yet",
      fbLoggedIn: null,
    };
  } else if (fbLoggedIn) {
    facebookSession = {
      status: "connected",
      detail: "Facebook session active",
      fbLoggedIn: true,
    };
  } else {
    facebookSession = {
      status: "error",
      detail: "Not logged in to Facebook",
      fbLoggedIn: false,
    };
  }

  let marketplace: {
    status: string;
    detail: string;
    marketplaceConnected: boolean | null;
  };
  if (!extOnline) {
    marketplace = {
      status: "unknown",
      detail: "Extension offline — can't verify Marketplace access",
      marketplaceConnected: null,
    };
  } else if (marketplaceConnected === null) {
    marketplace = {
      status: "unknown",
      detail: "Marketplace access not yet verified",
      marketplaceConnected: null,
    };
  } else if (marketplaceConnected) {
    marketplace = {
      status: "connected",
      detail: "Marketplace create form is accessible",
      marketplaceConnected: true,
    };
  } else {
    marketplace = {
      status: "error",
      detail: "Marketplace not accessible — check Facebook login",
      marketplaceConnected: false,
    };
  }

  // ── Messaging: real lead + conversation counts ────────────────────────────────
  const [leadCountRow] = await db.select({ count: sql<number>`count(*)` }).from(leadsTable);
  const [convCountRow] = await db.select({ count: sql<number>`count(*)` }).from(conversationsTable);
  const leadCount = Number(leadCountRow?.count ?? 0);
  const convCount = Number(convCountRow?.count ?? 0);

  let messenger: { status: string; detail: string; leadCount: number; convCount: number };
  if (!fbLoggedIn) {
    messenger = {
      status: "warning",
      detail: "Waiting for Facebook connection",
      leadCount,
      convCount,
    };
  } else if (convCount > 0 || leadCount > 0) {
    messenger = {
      status: "connected",
      detail: `Monitoring buyer conversations — ${leadCount} lead${leadCount !== 1 ? "s" : ""} captured`,
      leadCount,
      convCount,
    };
  } else {
    messenger = {
      status: "connected",
      detail: "Sales AI active — no buyer conversations yet",
      leadCount,
      convCount,
    };
  }

  // ── AI Engine: report each sub-system ─────────────────────────────────────────
  const metaAppSecretConfigured = !!process.env["META_APP_SECRET"];
  const metaVerifyTokenConfigured = !!process.env["META_VERIFY_TOKEN"];
  const metaPageTokenConfigured = !!process.env["META_PAGE_ACCESS_TOKEN"];
  const metaPageIdConfigured = !!process.env["META_PAGE_ID"];
  const metaAutoReplyEnabled = process.env["META_AUTO_REPLY_ENABLED"] === "true";

  const messagingWebhook = {
    status:
      metaAppSecretConfigured && metaVerifyTokenConfigured
        ? "connected"
        : "warning",
    detail:
      metaAppSecretConfigured && metaVerifyTokenConfigured
        ? `Webhook ready at /api/meta/webhooks/messenger. Auto-reply ${metaAutoReplyEnabled ? "enabled" : "disabled"}. ${leadCount} lead${leadCount !== 1 ? "s" : ""} captured.`
        : "META_APP_SECRET and META_VERIFY_TOKEN are required before Meta can subscribe the webhook.",
    leadCount,
    convCount,
  };

  const facebookPage = {
    status:
      metaPageTokenConfigured && metaPageIdConfigured
        ? "connected"
        : "warning",
    detail:
      metaPageTokenConfigured && metaPageIdConfigured
        ? "Facebook Page ID and Page Access Token configured for Messenger Send API."
        : "META_PAGE_ID and META_PAGE_ACCESS_TOKEN are missing.",
  };

  const openaiConfigured = !!process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  const falConfigured = !!process.env["FAL_KEY"];

  const aiEngine = {
    status: "connected",
    detail: "AI systems operational",
    components: [
      {
        name: "Opportunity Engine",
        status: "connected",
        detail: "Market intelligence + opportunity scoring",
      },
      {
        name: "GM Coach",
        status: "connected",
        detail: "AI-powered publish review & what-if analysis",
      },
      {
        name: "AI Photo Studio",
        status: falConfigured ? "connected" : "warning",
        detail: falConfigured ? "FAL.ai scene rendering active" : "FAL_KEY not configured",
      },
      {
        name: "OpenAI Reasoning",
        status: openaiConfigured ? "connected" : "warning",
        detail: openaiConfigured ? "OpenAI API configured" : "AI_INTEGRATIONS_OPENAI_API_KEY not configured",
      },
      {
        name: "FAL.ai",
        status: falConfigured ? "connected" : "warning",
        detail: falConfigured ? "Image generation active" : "FAL_KEY not configured",
      },
    ],
  };

  // Overall marketplace connection status
  const connectRequestedAt = ext?.connectRequestedAt ?? null;
  const overallConnected = extOnline && fbLoggedIn === true && marketplaceConnected === true;

  res.json({
    backend: { status: "connected", detail: "API server responding" },
    database,
    xmlFeed,
    chromeExtension,
    facebookSession,
    marketplace,
    messenger: messagingWebhook,
    messagingWebhook,
    facebookPage,
    openai: aiEngine,
    aiEngine,
    // Summary fields for the connection panel
    overallConnected,
    extensionOnline: extOnline,
    connectRequestedAt: connectRequestedAt ? connectRequestedAt.toISOString() : null,
  });
});

export default router;
