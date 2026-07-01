import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, leadsTable, extensionConnectionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const EXTENSION_NAME = "Chrome Extension";

const router: IRouter = Router();

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

async function getExtRow() {
  const [ext] = await db
    .select()
    .from(extensionConnectionsTable)
    .where(eq(extensionConnectionsTable.name, EXTENSION_NAME));
  return ext ?? null;
}

async function upsertExtRow(
  values: Partial<typeof extensionConnectionsTable.$inferInsert>,
) {
  const existing = await getExtRow();
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
    .values({ name: EXTENSION_NAME, ...values })
    .returning();
  return row!;
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

const HeartbeatBody = z.object({
  backendUrl: z.string().optional(),
  status: z.string().optional(),
  fbLoggedIn: z.boolean().nullable().optional(),
  marketplaceConnected: z.boolean().nullable().optional(),
});

router.post("/extension/heartbeat", async (req, res) => {
  const parsed = HeartbeatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid heartbeat" });
    return;
  }
  const { status = "online", backendUrl, fbLoggedIn, marketplaceConnected } =
    parsed.data;

  const existing = await getExtRow();
  const updates: Partial<typeof extensionConnectionsTable.$inferInsert> = {
    status,
    lastHeartbeatAt: new Date(),
  };
  if (backendUrl !== undefined) updates.backendUrl = backendUrl;
  if (fbLoggedIn !== undefined) updates.fbLoggedIn = fbLoggedIn;
  if (marketplaceConnected !== undefined)
    updates.marketplaceConnected = marketplaceConnected;
  // Back-fill backendUrl from existing if not provided
  if (!backendUrl && existing?.backendUrl)
    updates.backendUrl = existing.backendUrl;

  const row = await upsertExtRow(updates);

  req.log.info({ fbLoggedIn, marketplaceConnected }, "Recorded extension heartbeat");
  res.json({
    id: row.id,
    name: row.name,
    backendUrl: row.backendUrl ?? null,
    status: row.status,
    lastHeartbeatAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : null,
    fbLoggedIn: row.fbLoggedIn ?? null,
    marketplaceConnected: row.marketplaceConnected ?? null,
  });
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
    fbLoggedIn: ext?.fbLoggedIn ?? null,
    marketplaceConnected: ext?.marketplaceConnected ?? null,
  });
});

// ── Session Report (from extension after visiting Facebook) ────────────────────

const SessionReportBody = z.object({
  extensionId: z.string().optional(),
  fbLoggedIn: z.boolean(),
  marketplaceConnected: z.boolean(),
});

router.post("/extension/session-report", async (req, res) => {
  const parsed = SessionReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid session report" });
    return;
  }
  const { fbLoggedIn, marketplaceConnected } = parsed.data;

  const row = await upsertExtRow({
    fbLoggedIn,
    marketplaceConnected,
    connectRequestedAt: null, // clear the request
    connectAction: null,
  });

  req.log.info({ fbLoggedIn, marketplaceConnected }, "Extension session report saved");
  res.json({
    ok: true,
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
