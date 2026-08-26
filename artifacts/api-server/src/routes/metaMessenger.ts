import crypto from "node:crypto";
import { Router, type Request } from "express";
import { desc, eq } from "drizzle-orm";
import {
  conversationMessagesTable,
  conversationsTable,
  db,
  leadsTable,
  listingsTable,
  vehiclesTable,
  type Conversation,
} from "@workspace/db";
import {
  computeLeadScore,
  detectLanguage,
  generateAiReply,
} from "./conversations";
import { getDownPaymentPolicy, type DownPaymentPolicy } from "../downPayment/policy";

const router = Router();

const DEALER_ID = 1;
const DEFAULT_GRAPH_API_VERSION = "v23.0";

type MetaMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
  };
};

type MetaWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: MetaMessagingEvent[];
  }>;
};

function getEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function getRawBody(req: Request): Buffer | null {
  if (Buffer.isBuffer(req.body)) return req.body;
  return null;
}

function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const appSecret = getEnv("META_APP_SECRET");
  if (!appSecret || !signatureHeader) return false;

  const [algorithm, signature] = signatureHeader.split("=");
  if (algorithm !== "sha256" || !signature) return false;

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");

  try {
    const expectedBuffer = Buffer.from(expected, "hex");
    const signatureBuffer = Buffer.from(signature, "hex");
    return (
      expectedBuffer.length === signatureBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    );
  } catch {
    return false;
  }
}

function normalizePhone(text: string): string | null {
  const phoneMatch = text.match(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/);
  return phoneMatch ? phoneMatch[0].replace(/[^\d+]/g, "") : null;
}

function hasStrongBuyingIntent(text: string): boolean {
  return /\b(today|tonight|this week|ready to buy|come see|appointment|schedule|cash|down payment|financing|finance|trade in|call me|text me|hoy|esta semana|comprar|cita|financiamiento|enganche|inicial|llamame|llamarme|texto)\b/i.test(
    text,
  );
}

function getMessageDate(event: MetaMessagingEvent): Date {
  return event.timestamp ? new Date(event.timestamp) : new Date();
}

function vehicleLabel(vehicle: typeof vehiclesTable.$inferSelect): string {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter(Boolean)
    .join(" ");
}

async function matchVehicleFromMessage(message: string): Promise<{
  vehicleId?: number;
  listingId?: number;
  title?: string;
  vehicleType?: string;
  downPayment?: number;
  downPaymentPolicy?: DownPaymentPolicy;
}> {
  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.dealerId, DEALER_ID))
    .limit(100);

  const normalized = message.toLowerCase();
  const match = vehicles.find((vehicle) => {
    const title = vehicleLabel(vehicle).toLowerCase();
    const stock = vehicle.stockNumber?.toLowerCase();
    const vin = vehicle.vin?.toLowerCase();
    const make = vehicle.make.toLowerCase();
    const model = vehicle.model.toLowerCase();
    return (
      (title.length > 0 && normalized.includes(title)) ||
      (stock && normalized.includes(stock)) ||
      (vin && normalized.includes(vin)) ||
      (normalized.includes(make) && normalized.includes(model))
    );
  });

  if (!match) return {};

  const downPaymentPolicy = await getDownPaymentPolicy(DEALER_ID, match.id);

  const [listing] = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.vehicleId, match.id))
    .limit(1);

  return {
    vehicleId: match.id,
    listingId: listing?.id,
    title: vehicleLabel(match),
    vehicleType: match.bodyStyle ?? undefined,
    downPayment: downPaymentPolicy.minimumAmount ?? undefined,
    downPaymentPolicy,
  };
}

async function sendMessengerReply(psid: string, message: string): Promise<void> {
  const pageAccessToken = getEnv("META_PAGE_ACCESS_TOKEN");
  if (!pageAccessToken) {
    throw new Error("META_PAGE_ACCESS_TOKEN is not configured");
  }

  const graphVersion = getEnv("META_GRAPH_API_VERSION") ?? DEFAULT_GRAPH_API_VERSION;
  const url = new URL(`https://graph.facebook.com/${graphVersion}/me/messages`);
  url.searchParams.set("access_token", pageAccessToken);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: { text: message },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Messenger Send API failed: ${response.status} ${body}`);
  }
}

async function upsertConversation(params: {
  pageId: string;
  senderId: string;
  buyerMessage: string;
  eventDate: Date;
}): Promise<{
  conversation: Conversation;
  visibleMessages: string[];
  vehicleMatch: Awaited<ReturnType<typeof matchVehicleFromMessage>>;
}> {
  const externalThreadRef = `meta:${params.pageId}:${params.senderId}`;
  const language = detectLanguage(params.buyerMessage);
  const vehicleMatch = await matchVehicleFromMessage(params.buyerMessage);
  const globalAutoReply = getEnv("META_AUTO_REPLY_ENABLED") === "true";

  const [existingConversation] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.externalThreadRef, externalThreadRef))
    .limit(1);

  let conversation: Conversation;
  if (existingConversation) {
    const [updated] = await db
      .update(conversationsTable)
      .set({
        source: "meta_messenger_webhook",
        externalPageId: params.pageId,
        externalSenderId: params.senderId,
        language,
        vehicleId: vehicleMatch.vehicleId ?? existingConversation.vehicleId,
        listingId: vehicleMatch.listingId ?? existingConversation.listingId,
        detectedVehicleTitle:
          vehicleMatch.title ?? existingConversation.detectedVehicleTitle,
        vehicleType: vehicleMatch.vehicleType ?? existingConversation.vehicleType,
        marketplaceDownPayment:
          vehicleMatch.downPayment ?? existingConversation.marketplaceDownPayment,
        lastMessageAt: params.eventDate,
        updatedAt: new Date(),
      })
      .where(eq(conversationsTable.id, existingConversation.id))
      .returning();
    conversation = updated;
  } else {
    const [created] = await db
      .insert(conversationsTable)
      .values({
        dealerId: DEALER_ID,
        source: "meta_messenger_webhook",
        externalPageId: params.pageId,
        externalSenderId: params.senderId,
        externalThreadRef,
        language,
        vehicleId: vehicleMatch.vehicleId,
        listingId: vehicleMatch.listingId,
        detectedVehicleTitle: vehicleMatch.title,
        vehicleType: vehicleMatch.vehicleType,
        marketplaceDownPayment: vehicleMatch.downPayment,
        status: "active",
        autoReplyEnabled: globalAutoReply,
        lastMessageAt: params.eventDate,
      })
      .returning();
    conversation = created;
  }

  await db.insert(conversationMessagesTable).values({
    conversationId: conversation.id,
    role: "buyer",
    content: params.buyerMessage,
    createdAt: params.eventDate,
  });

  const history = await db
    .select()
    .from(conversationMessagesTable)
    .where(eq(conversationMessagesTable.conversationId, conversation.id))
    .orderBy(desc(conversationMessagesTable.createdAt))
    .limit(8);

  return {
    conversation,
    visibleMessages: history.reverse().map((message) => message.content),
    vehicleMatch,
  };
}

async function upsertLead(params: {
  conversation: Conversation;
  buyerMessage: string;
  suggestedReply: string;
  vehicleMatch: Awaited<ReturnType<typeof matchVehicleFromMessage>>;
}): Promise<number> {
  const phone = normalizePhone(params.buyerMessage);
  const strongIntent = hasStrongBuyingIntent(params.buyerMessage);

  const [existingLead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.conversationId, params.conversation.id))
    .limit(1);

  const scoreInput = {
    buyerTimeline: strongIntent ? "this_week" : existingLead?.buyerTimeline,
    buyerAvailableDownPayment: existingLead?.buyerAvailableDownPayment,
    publishedDownPayment:
      params.vehicleMatch.downPayment ?? existingLead?.publishedDownPayment,
    hasId: existingLead?.hasId,
    hasProofOfIncome: existingLead?.hasProofOfIncome,
    phone: phone ?? existingLead?.phone,
    appointmentIntent: strongIntent || existingLead?.appointmentIntent,
  };
  const { score, temperature } = computeLeadScore(scoreInput);
  const shouldAssignBdc = Boolean(phone || strongIntent);
  const finalTemperature = shouldAssignBdc ? "Hot" : temperature;
  const finalScore = shouldAssignBdc ? Math.max(score, 70) : score;

  if (existingLead) {
    await db
      .update(leadsTable)
      .set({
        language: params.conversation.language,
        vehicleId: params.vehicleMatch.vehicleId ?? existingLead.vehicleId,
        listingId: params.vehicleMatch.listingId ?? existingLead.listingId,
        publishedDownPayment:
          params.vehicleMatch.downPayment ?? existingLead.publishedDownPayment,
        messageText: params.buyerMessage,
        suggestedReply: params.suggestedReply,
        phone: phone ?? existingLead.phone,
        buyerTimeline: strongIntent ? "this_week" : existingLead.buyerTimeline,
        appointmentIntent: strongIntent || existingLead.appointmentIntent,
        leadScore: finalScore,
        temperature: finalTemperature,
        status: shouldAssignBdc ? "BDC Assigned" : existingLead.status,
        updatedAt: new Date(),
      })
      .where(eq(leadsTable.id, existingLead.id));
    return existingLead.id;
  }

  const [created] = await db
    .insert(leadsTable)
    .values({
      conversationId: params.conversation.id,
      dealerId: DEALER_ID,
      language: params.conversation.language,
      vehicleId: params.vehicleMatch.vehicleId,
      listingId: params.vehicleMatch.listingId,
      publishedDownPayment: params.vehicleMatch.downPayment,
      messageText: params.buyerMessage,
      suggestedReply: params.suggestedReply,
      phone,
      buyerTimeline: strongIntent ? "this_week" : null,
      appointmentIntent: strongIntent,
      leadScore: finalScore,
      temperature: finalTemperature,
      status: shouldAssignBdc ? "BDC Assigned" : "New",
    })
    .returning();

  return created.id;
}

async function processMessengerEvent(event: MetaMessagingEvent): Promise<{
  processed: boolean;
  replied: boolean;
  conversationId?: number;
  leadId?: number;
}> {
  const pageId = event.recipient?.id;
  const senderId = event.sender?.id;
  const buyerMessage = event.message?.text?.trim();

  if (!pageId || !senderId || !buyerMessage || event.message?.is_echo) {
    return { processed: false, replied: false };
  }

  const configuredPageId = getEnv("META_PAGE_ID");
  if (configuredPageId && configuredPageId !== pageId) {
    return { processed: false, replied: false };
  }

  const { conversation, visibleMessages, vehicleMatch } = await upsertConversation({
    pageId,
    senderId,
    buyerMessage,
    eventDate: getMessageDate(event),
  });

  const suggestedReply = await generateAiReply(
    visibleMessages,
    buyerMessage,
    conversation.language,
    vehicleMatch.title ?? conversation.detectedVehicleTitle ?? undefined,
    vehicleMatch.vehicleType ?? conversation.vehicleType ?? undefined,
    vehicleMatch.downPayment ?? conversation.marketplaceDownPayment ?? undefined,
    undefined,
    false,
    undefined,
    vehicleMatch.downPaymentPolicy,
  );

  await db.insert(conversationMessagesTable).values({
    conversationId: conversation.id,
    role: "assistant",
    content: suggestedReply,
    suggestedReply,
  });

  const leadId = await upsertLead({
    conversation,
    buyerMessage,
    suggestedReply,
    vehicleMatch,
  });

  const autoReplyEnabled =
    conversation.autoReplyEnabled || getEnv("META_AUTO_REPLY_ENABLED") === "true";

  if (autoReplyEnabled) {
    await sendMessengerReply(senderId, suggestedReply);
  }

  return {
    processed: true,
    replied: autoReplyEnabled,
    conversationId: conversation.id,
    leadId,
  };
}

router.get("/meta/webhooks/messenger", (req, res) => {
  const verifyToken = getEnv("META_VERIFY_TOKEN");
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (!verifyToken) {
    res.status(503).send("META_VERIFY_TOKEN is not configured");
    return;
  }

  if (mode === "subscribe" && token === verifyToken && typeof challenge === "string") {
    res.status(200).send(challenge);
    return;
  }

  res.sendStatus(403);
});

router.post("/meta/webhooks/messenger", async (req, res) => {
  const rawBody = getRawBody(req);
  if (!rawBody) {
    res.status(400).json({ error: "Raw JSON body is required" });
    return;
  }

  if (!verifyMetaSignature(rawBody, req.header("x-hub-signature-256"))) {
    req.log.warn("Rejected Meta Messenger webhook with invalid signature");
    res.sendStatus(401);
    return;
  }

  let body: MetaWebhookBody;
  try {
    body = JSON.parse(rawBody.toString("utf8")) as MetaWebhookBody;
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  if (body.object !== "page" || !Array.isArray(body.entry)) {
    res.json({ received: true, processed: 0 });
    return;
  }

  const events = body.entry.flatMap((entry) => entry.messaging ?? []);
  let processed = 0;
  let replied = 0;

  for (const event of events) {
    try {
      const result = await processMessengerEvent(event);
      if (result.processed) processed += 1;
      if (result.replied) replied += 1;
    } catch (err) {
      req.log.error({ err }, "Failed to process Messenger webhook event");
    }
  }

  res.json({ received: true, processed, replied });
});

export default router;
