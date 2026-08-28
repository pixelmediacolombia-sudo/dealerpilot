import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, pool, leadsTable, extensionConnectionsTable, marketplaceListingsTable, vehiclesTable } from "@workspace/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { recordMarketplaceSoldAction } from "../marketplace/soldAction";
import { vehicleOperationalColumns } from "../lib/vehicleColumns";

const EXTENSION_NAME = "Chrome Extension";

const router: IRouter = Router();

let extensionColumnsReady: Promise<void> | null = null;

function ensureExtensionColumns(): Promise<void> {
  extensionColumnsReady ??= Promise.all([
    pool.query("alter table extension_connections add column if not exists chrome_extension_id text"),
    pool.query("alter table extension_connections add column if not exists dealer_id integer"),
    pool.query("alter table extension_connections add column if not exists session_id text"),
    pool.query("create index if not exists extension_connections_dealer_session_idx on extension_connections (dealer_id, session_id)"),
  ])
    .then(() => undefined)
    .catch((err) => {
      extensionColumnsReady = null;
      throw err;
    });
  return extensionColumnsReady;
}

async function saveChromeExtensionId(rowId: number, chromeExtensionId: string | undefined): Promise<void> {
  if (!chromeExtensionId) return;
  await ensureExtensionColumns();
  await pool.query("update extension_connections set chrome_extension_id = $1 where id = $2", [
    chromeExtensionId,
    rowId,
  ]);
}

async function getChromeExtensionId(rowId: number | undefined): Promise<string | null> {
  if (!rowId) return null;
  await ensureExtensionColumns();
  const result = await pool.query<{ chrome_extension_id: string | null }>(
    "select chrome_extension_id from extension_connections where id = $1 limit 1",
    [rowId],
  );
  return result.rows[0]?.chrome_extension_id ?? null;
}

const TEST_LISTING = {
  title: "2021 Toyota Tacoma",
  year: 2021,
  make: "Toyota",
  model: "Tacoma",
  price: 28995,
  downPayment: 2500,
  mileage: 45000,
  description: "Test Marketplace listing.",
} as const;

router.get("/extension/test-listing", (req, res) => {
  req.log.info("Serving test listing to extension");
  res.json(TEST_LISTING);
});

const MessageContextBody = z.object({
  chatText: z.string().min(1, "chatText is required"),
  buyerName: z.string().optional(),
  sourceUrl: z.string().optional(),
});

function buildSuggestedReply(chatText: string): string {
  const text = chatText.toLowerCase();
  const v = TEST_LISTING;
  const lines: string[] = [];

  if (/(available|still there|sold|in stock)/.test(text)) {
    lines.push(`Yes! The ${v.title} is still available.`);
  } else {
    lines.push(`Thanks for reaching out about the ${v.title}!`);
  }

  if (/(price|cost|how much|asking|\$)/.test(text)) {
    lines.push(`The asking price is $${v.price.toLocaleString()}.`);
  }

  if (/(finance|financing|down|payment|monthly|credit)/.test(text)) {
    lines.push(
      `We offer financing with a down payment as low as $${v.downPayment.toLocaleString()}.`,
    );
  }

  if (/(mile|mileage|km|odometer)/.test(text)) {
    lines.push(`It has ${v.mileage.toLocaleString()} miles on it.`);
  }

  if (/(test drive|see it|view|come in|visit|appointment)/.test(text)) {
    lines.push(
      `Would you like to schedule a time to come see it and take it for a test drive?`,
    );
  } else {
    lines.push(
      `Would you like to set up a time to come take a look? Happy to answer any questions.`,
    );
  }

  return lines.join(" ");
}

router.post("/extension/message-context", async (req, res) => {
  const parsed = MessageContextBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const { chatText, buyerName, sourceUrl } = parsed.data;
  const suggestedReply = buildSuggestedReply(chatText);

  const [lead] = await db
    .insert(leadsTable)
    .values({
      buyerName: buyerName ?? null,
      messageText: chatText,
      suggestedReply,
      sourceUrl: sourceUrl ?? null,
      status: "Test Lead",
    })
    .returning();

  req.log.info({ leadId: lead?.id }, "Saved test lead from message context");

  res.json({ suggestedReply, lead });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

type ExtensionIdentity = {
  dealerId?: number | null;
  sessionId?: string | null;
};

function normalizedIdentity(identity: ExtensionIdentity = {}): Required<ExtensionIdentity> {
  const dealerId = Number(identity.dealerId);
  const sessionId = typeof identity.sessionId === "string" ? identity.sessionId.trim() : "";
  return {
    dealerId: Number.isInteger(dealerId) && dealerId > 0 ? dealerId : null,
    sessionId: sessionId || null,
  };
}

function sessionName(identity: ExtensionIdentity = {}): string {
  const normalized = normalizedIdentity(identity);
  if (!normalized.dealerId || !normalized.sessionId) return EXTENSION_NAME;
  return `${EXTENSION_NAME} [dealer=${normalized.dealerId};session=${normalized.sessionId}]`;
}

async function getExtRow(identity: ExtensionIdentity = {}) {
  await ensureExtensionColumns();
  const normalized = normalizedIdentity(identity);
  const conditions = normalized.dealerId && normalized.sessionId
    ? and(
        eq(extensionConnectionsTable.dealerId, normalized.dealerId),
        eq(extensionConnectionsTable.sessionId, normalized.sessionId),
      )
    : eq(extensionConnectionsTable.name, EXTENSION_NAME);
  const [ext] = await db
    .select()
    .from(extensionConnectionsTable)
    .where(conditions);
  return ext ?? null;
}

async function upsertExtRow(
  values: Partial<typeof extensionConnectionsTable.$inferInsert>,
) {
  const normalized = normalizedIdentity(values);
  const existing = await getExtRow(normalized);
  if (existing) {
    const [row] = await db
      .update(extensionConnectionsTable)
      .set(values)
      .where(eq(extensionConnectionsTable.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await db
    .insert(extensionConnectionsTable)
    .values({
      name: sessionName(normalized),
      ...(normalized.dealerId ? { dealerId: normalized.dealerId } : {}),
      ...(normalized.sessionId ? { sessionId: normalized.sessionId } : {}),
      ...values,
    })
    .returning();
  return row!;
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

const HeartbeatBody = z.object({
  backendUrl: z.string().optional(),
  status: z.string().optional(),
  chromeExtensionId: z.string().optional(),
  dealerId: z.number().int().positive().optional(),
  sessionId: z.string().trim().min(1).max(160).optional(),
  fbLoggedIn: z.boolean().nullable().optional(),
  marketplaceConnected: z.boolean().nullable().optional(),
});

router.post("/extension/heartbeat", async (req, res) => {
  const parsed = HeartbeatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid heartbeat" });
    return;
  }
  const { status = "online", backendUrl, chromeExtensionId, dealerId, sessionId, fbLoggedIn, marketplaceConnected } =
    parsed.data;

  const existing = await getExtRow({ dealerId, sessionId });
  const updates: Partial<typeof extensionConnectionsTable.$inferInsert> = {
    status,
    lastHeartbeatAt: new Date(),
  };
  if (dealerId !== undefined) updates.dealerId = dealerId;
  if (sessionId !== undefined) updates.sessionId = sessionId;
  if (backendUrl !== undefined) updates.backendUrl = backendUrl;
  if (fbLoggedIn !== undefined) updates.fbLoggedIn = fbLoggedIn;
  if (marketplaceConnected !== undefined)
    updates.marketplaceConnected = marketplaceConnected;
  // Back-fill backendUrl from existing if not provided
  if (!backendUrl && existing?.backendUrl)
    updates.backendUrl = existing.backendUrl;

  const row = await upsertExtRow(updates);
  await saveChromeExtensionId(row.id, chromeExtensionId);

  req.log.info({ fbLoggedIn, marketplaceConnected }, "Recorded extension heartbeat");
  res.json({
    id: row.id,
    name: row.name,
    extensionId: chromeExtensionId ?? (await getChromeExtensionId(row.id)),
    backendUrl: row.backendUrl ?? null,
    status: row.status,
    dealerId: row.dealerId ?? null,
    sessionId: row.sessionId ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : null,
    fbLoggedIn: row.fbLoggedIn ?? null,
    marketplaceConnected: row.marketplaceConnected ?? null,
  });
});

// ── Connect Acknowledge (clears connectRequested immediately after extension opens the tab) ──

router.post("/extension/connect-acknowledge", async (req, res) => {
  await upsertExtRow({ connectRequestedAt: null, connectAction: null });
  req.log.info("Connect-acknowledge: connectRequested cleared by extension");
  res.json({ ok: true });
});

// ── Connect Marketplace ────────────────────────────────────────────────────────

const ConnectMarketplaceBody = z.object({
  action: z.enum(["marketplace", "login"]).optional().default("marketplace"),
});

router.post("/extension/connect-marketplace", async (req, res) => {
  const parsed = ConnectMarketplaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const row = await upsertExtRow({
    connectRequestedAt: new Date(),
    connectAction: parsed.data.action,
  });
  req.log.info({ action: parsed.data.action }, "Connect-marketplace requested");
  res.json({ ok: true, connectRequestedAt: row.connectRequestedAt?.toISOString() ?? null });
});

// ── Connect Status (polled by extension alarm) ─────────────────────────────────

router.get("/extension/connect-status", async (req, res) => {
  const ext = await getExtRow();
  const CONNECT_WINDOW_MS = 5 * 60 * 1000; // ignore stale requests > 5 min
  const connectRequested =
    !!ext?.connectRequestedAt &&
    Date.now() - ext.connectRequestedAt.getTime() < CONNECT_WINDOW_MS;

  res.json({
    connectRequested,
    connectAction: connectRequested ? (ext?.connectAction ?? "marketplace") : null,
    extensionId: await getChromeExtensionId(ext?.id),
    fbLoggedIn: ext?.fbLoggedIn ?? null,
    marketplaceConnected: ext?.marketplaceConnected ?? null,
  });
});

// ── Marketplace Sold Actions ───────────────────────────────────────────────
// Dashboard feedback channel for the extension/operator: when DealerPilot marks
// inventory Sold/Removed, the extension can surface the live Marketplace URL so
// the Facebook listing is also marked Sold and the vehicle cannot be republished.
router.get("/extension/marketplace-sold-actions", async (_req, res) => {
  const rows = await db
    .select({
      listingId: marketplaceListingsTable.id,
      vehicleId: marketplaceListingsTable.vehicleId,
      listingUrl: marketplaceListingsTable.listingUrl,
      status: marketplaceListingsTable.status,
      updatedAt: marketplaceListingsTable.updatedAt,
      year: vehiclesTable.year,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      trim: vehiclesTable.trim,
      vehicleStatus: vehiclesTable.status,
    })
    .from(marketplaceListingsTable)
    .innerJoin(vehiclesTable, eq(vehiclesTable.id, marketplaceListingsTable.vehicleId))
    .where(
      and(
        eq(marketplaceListingsTable.status, "Sold"),
        eq(vehiclesTable.status, "Sold/Removed"),
        isNotNull(marketplaceListingsTable.listingUrl),
      ),
    )
    .orderBy(desc(marketplaceListingsTable.updatedAt))
    .limit(20);

  res.json({
    actions: rows.map((row) => ({
      ...row,
      label: `${row.year ?? ""} ${row.make} ${row.model}${row.trim ? ` ${row.trim}` : ""}`.trim(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
});

const MarketplaceSoldActionReportBody = z.object({
  extensionId: z.string().min(1).optional(),
  status: z.enum(["completed", "failed"]),
  error: z.string().trim().max(500).optional(),
});

router.post("/extension/marketplace-sold-actions/:listingId/report", async (req, res) => {
  const listingId = Number(req.params.listingId);
  const parsed = MarketplaceSoldActionReportBody.safeParse(req.body ?? {});
  if (!Number.isInteger(listingId) || listingId <= 0 || !parsed.success) {
    res.status(400).json({ error: "Invalid Marketplace sold action report" });
    return;
  }

  const [row] = await db
    .select({ vehicle: vehicleOperationalColumns })
    .from(marketplaceListingsTable)
    .innerJoin(vehiclesTable, eq(vehiclesTable.id, marketplaceListingsTable.vehicleId))
    .where(eq(marketplaceListingsTable.id, listingId))
    .limit(1);
  if (!row || row.vehicle.status !== "Sold/Removed") {
    res.status(404).json({ error: "Sold Marketplace listing not found" });
    return;
  }

  const now = new Date();
  const result = await recordMarketplaceSoldAction({
    listingId,
    status: parsed.data.status === "completed" ? "success" : "failed",
    error: parsed.data.error,
    extensionId: parsed.data.extensionId,
  });

  req.log.info({ listingId, vehicleId: row.vehicle.id, status: parsed.data.status }, "Marketplace sold action reported");
  res.json({ ok: true, listingId, status: parsed.data.status, reportedAt: now.toISOString(), result });
});

// ── Session Report (from extension after visiting Facebook) ────────────────────

const SessionReportBody = z.object({
  extensionId: z.string().optional(),
  dealerId: z.number().int().positive().optional(),
  sessionId: z.string().trim().min(1).max(160).optional(),
  fbLoggedIn: z.boolean(),
  marketplaceConnected: z.boolean(),
});

router.post("/extension/session-report", async (req, res) => {
  const parsed = SessionReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid session report" });
    return;
  }
  const { extensionId, dealerId, sessionId, fbLoggedIn, marketplaceConnected } = parsed.data;

  const row = await upsertExtRow({
    ...(dealerId !== undefined ? { dealerId } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    status: "online",
    lastHeartbeatAt: new Date(),
    fbLoggedIn,
    marketplaceConnected,
    connectRequestedAt: null, // clear the request
    connectAction: null,
  });
  await saveChromeExtensionId(row.id, extensionId);

  req.log.info({ fbLoggedIn, marketplaceConnected }, "Extension session report saved");
  res.json({
    ok: true,
    extensionId: extensionId ?? (await getChromeExtensionId(row.id)),
    status: row.status,
    dealerId: row.dealerId ?? null,
    sessionId: row.sessionId ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : null,
    fbLoggedIn: row.fbLoggedIn ?? null,
    marketplaceConnected: row.marketplaceConnected ?? null,
  });
});

// ── Leads ─────────────────────────────────────────────────────────────────────

router.get("/extension/leads", async (req, res) => {
  const leads = await db
    .select()
    .from(leadsTable)
    .orderBy(desc(leadsTable.createdAt));
  req.log.info({ count: leads.length }, "Listing test leads");
  res.json({ leads });
});

export default router;
