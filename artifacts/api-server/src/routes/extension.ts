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

const HeartbeatBody = z.object({
  backendUrl: z.string().optional(),
  status: z.string().optional(),
});

router.post("/extension/heartbeat", async (req, res) => {
  const parsed = HeartbeatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid heartbeat" });
    return;
  }
  const now = new Date();
  const status = parsed.data.status ?? "online";

  const [existing] = await db
    .select()
    .from(extensionConnectionsTable)
    .where(eq(extensionConnectionsTable.name, EXTENSION_NAME));

  let row;
  if (existing) {
    [row] = await db
      .update(extensionConnectionsTable)
      .set({
        status,
        backendUrl: parsed.data.backendUrl ?? existing.backendUrl,
        lastHeartbeatAt: now,
      })
      .where(eq(extensionConnectionsTable.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(extensionConnectionsTable)
      .values({
        name: EXTENSION_NAME,
        status,
        backendUrl: parsed.data.backendUrl ?? null,
        lastHeartbeatAt: now,
      })
      .returning();
  }

  req.log.info("Recorded extension heartbeat");
  res.json({
    id: row!.id,
    name: row!.name,
    backendUrl: row!.backendUrl ?? null,
    status: row!.status,
    lastHeartbeatAt: row!.lastHeartbeatAt ? row!.lastHeartbeatAt.toISOString() : null,
  });
});

router.get("/extension/leads", async (req, res) => {
  const leads = await db
    .select()
    .from(leadsTable)
    .orderBy(desc(leadsTable.createdAt));
  req.log.info({ count: leads.length }, "Listing test leads");
  res.json({ leads });
});

export default router;
