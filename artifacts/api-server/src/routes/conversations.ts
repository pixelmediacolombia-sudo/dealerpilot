import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  conversationsTable,
  conversationMessagesTable,
  leadsTable,
  downPaymentIntelligenceTable,
  vehiclesTable,
  listingsTable,
  marketplaceListingsTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";


const router = Router();

const DEALER_ID = 1;

const STORE_PHONES: Record<string, string> = {
  manassas: "+1 703-763-4675",
  fredericksburg: "+1 703-763-4675", // same until Fredericksburg number is confirmed
};

const DEFAULT_STORE_PHONE = "+1 703-763-4675";
const SALES_AI_REPLY_TIMEOUT_MS = 3500;

function resolveStorePhone(lotLocation?: string | null): string {
  if (!lotLocation) return DEFAULT_STORE_PHONE;
  const key = lotLocation.toLowerCase().trim();
  return STORE_PHONES[key] ?? DEFAULT_STORE_PHONE;
}

function parseMoney(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

type ParsedConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const UI_MESSAGE_TEXT = new Set([
  "aa",
  "active",
  "about",
  "anyone can find this group",
  "anyone can see who's in the group and what they post",
  "archive",
  "chat members",
  "close",
  "compose",
  "copy link",
  "customize chat",
  "delete chat",
  "edit nicknames",
  "emoji",
  "enter",
  "esc",
  "facebook",
  "feed",
  "group",
  "mark as pending",
  "media, files and links",
  "message",
  "message...",
  "messenger",
  "more",
  "more options",
  "mute",
  "notifications",
  "people",
  "privacy & support",
  "public",
  "recent media",
  "saved",
  "search",
  "search in conversation",
  "see all",
  "send",
  "send in messenger",
  "share now",
  "share to",
  "vehicle inquiry",
  "view profile",
  "write to saved",
]);

function cleanConversationText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^\s*(Enter|Return)\s*,?\s*/i, "")
    .replace(/\bMessage sent\s+\d{1,2}:\d{2}\s*(AM|PM)\s+by\s+You\s*:?\s*/gi, "You sent: ")
    .replace(/^\w+day\s+\d{1,2}:\d{2}\s*(AM|PM)\s+by\s+You\s*:?\s*/i, "You sent: ")
    .replace(/^You sent\s*,\s*/i, "You sent: ")
    .replace(/^\s*[:.,;]\s*/, "")
    .trim();
}

function isUiConversationText(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[.。:;,\-–—]+$/g, "").trim();
  if (!normalized) return true;
  if (UI_MESSAGE_TEXT.has(normalized)) return true;
  if (/^(enter|escape|tab|shift|control|option|command|alt)\b/i.test(normalized)) return true;
  if (/^(write to|saved|compose|mute|search|customize chat|chat members|mark as pending|more options|say something about this|anyone can|this group consist)\b/i.test(normalized)) return true;
  if (/^(older listings will be deleted|high net cars available|recent media|see all)\b/i.test(normalized)) return true;
  if (/^\d{1,2}:\d{2}\s*(am|pm)$/i.test(normalized)) return true;
  if (/^marketplace\s+\$?[\d,]+/i.test(normalized)) return true;
  if (/^[a-z][\w .'-]{1,60}\s+-\s+(19|20)\d{2}\s+/i.test(normalized)) return true;
  if (/^[A-Z][A-Za-zÀ-ÿ'’-]+(?:\s+[A-Z][A-Za-zÀ-ÿ'’-]+){1,2}$/.test(value.trim())) return true;
  return false;
}

function parseConversationMessage(value: unknown): ParsedConversationMessage | null {
  let text = cleanConversationText(value);
  if (!text || isUiConversationText(text)) return null;

  let role: ParsedConversationMessage["role"] = "user";
  const roleMatch = text.match(/^(Dealer|DealerPilot AI|Assistant|Buyer|Customer|User|You|You sent)\s*:\s*(.+)$/i);
  if (roleMatch) {
    const label = roleMatch[1]?.toLowerCase() ?? "";
    role = /dealer|assistant|dealerpilot|you/.test(label) ? "assistant" : "user";
    text = cleanConversationText(roleMatch[2] ?? "");
  } else if (/^(You sent|Sent by you|Enviaste|Enviado por ti)\b/i.test(text)) {
    role = "assistant";
    text = cleanConversationText(text.replace(/^(You sent|Sent by you|Enviaste|Enviado por ti)\s*:?\s*/i, ""));
  }

  if (!text || isUiConversationText(text)) return null;
  return { role, content: text.slice(0, 1000) };
}

function isDisplayMessage(message: { content?: string | null } | null | undefined): boolean {
  return !!message?.content && !isUiConversationText(message.content);
}

function isBuyerDisplayMessage(message: { role?: string | null; content?: string | null } | null | undefined): boolean {
  return message?.role === "user" && isDisplayMessage(message);
}

function isReliableBuyerName(name?: string | null): boolean {
  const cleaned = cleanConversationText(name);
  const normalized = cleaned.toLowerCase();
  if (!cleaned || cleaned.length < 2 || cleaned.length > 80) return false;
  if (normalized === "unknown buyer" || normalized === "buyer" || normalized === "facebook") return false;
  if (UI_MESSAGE_TEXT.has(normalized)) return false;
  if (/^(enter|escape|tab|shift|control|option|command|alt)\b/i.test(normalized)) return false;
  if (/^(write to|saved|compose|mute|search|customize chat|chat members|mark as pending|more options)\b/i.test(normalized)) return false;
  if (/\b(19|20)\d{2}\b/.test(cleaned)) return false;
  if (/\b(honda|acura|toyota|marketplace|listing|vehicle|group|page|facebook)\b/i.test(cleaned)) return false;
  if (/[/$•·]/.test(cleaned)) return false;
  return true;
}

function isBlockedFacebookSurface(sourceUrl?: string | null): boolean {
  if (!sourceUrl) return false;
  try {
    const url = new URL(sourceUrl);
    return (
      url.pathname === "/" ||
      /^\/(home\.php|feed)\b/i.test(url.pathname) ||
      /^\/(groups|pages|profile\.php|watch|reel|events)\b/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function normalizeVehicleTitle(value?: string | null): string {
  return cleanConversationText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractMarketplaceItemId(value?: string | null): string | null {
  return value?.match(/\/marketplace\/item\/(\d+)/i)?.[1] ?? null;
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildSafeFallbackReply(language: string, vehicleTitle?: string, storePhone: string = DEFAULT_STORE_PHONE): string {
  const vehicle = vehicleTitle ?? (language === "es" ? "el vehiculo" : "the vehicle");
  if (language === "es") {
    return `Gracias por escribirnos sobre el ${vehicle}. Para confirmar disponibilidad y opciones, llama ahora al ${storePhone}. ¿Puedes llamar en este momento?`;
  }
  return `Thanks for asking about the ${vehicle}. To confirm availability and options, call us now at ${storePhone}. Are you able to call now?`;
}

type AiReplyResult = {
  reply: string;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  aiStartedAt: Date;
  aiCompletedAt: Date;
  aiDurationMs: number;
};

const ALPHA_RULES = `
You are a professional car sales representative for Alpha Motorsport, a used car dealership.

PHONE-FIRST STRATEGY:
Your goal is to get the buyer to call the store. Every reply must:
1. Answer the buyer's question directly without inventing availability, price, approval, or financing details
2. Mention the specific vehicle by year, make, and model
3. Direct them to call the store phone number provided
4. Optionally ask if they want help scheduling a visit TODAY

Language rules:
- Match the buyer's language EXACTLY (English or Spanish — do not mix)
- Use "easy financing options" / "opciones de financiamiento fáciles"
- Use "approval based on qualification" / "aprobación basada en calificación"
- If asked about financing details: say they can confirm all options by calling
- NEVER say: guaranteed approval, everyone approved, bad credit, denied, rejected, disqualified
- NEVER promise a loan or specific rate
- NEVER invent price, down payment, availability, or financing terms; if missing, tell the buyer to call the store to confirm

Reply format:
- Keep it SHORT — 3–5 lines max including the phone number line
- Include the phone number with 📞 emoji on its own line
- End with one soft question (appointment or purchase timeline)
`;

export function detectLanguage(text: string): "en" | "es" {
  const spanishWords =
    /\b(hola|gracias|disponible|tengo|quiero|inicial|comprar|semana|número|itin|ingresos|esta|carro|auto)\b/i;
  return spanishWords.test(text) ? "es" : "en";
}

export function computeLeadScore(params: {
  buyerTimeline?: string | null;
  buyerAvailableDownPayment?: number | null;
  publishedDownPayment?: number | null;
  hasId?: boolean | null;
  hasProofOfIncome?: boolean | null;
  phone?: string | null;
  appointmentIntent?: boolean | null;
}): { score: number; temperature: "Hot" | "Warm" | "Cold" } {
  let score = 0;

  if (params.buyerTimeline === "this_week") score += 30;
  else if (params.buyerTimeline === "this_month") score += 15;

  if (
    params.buyerAvailableDownPayment != null &&
    params.publishedDownPayment != null &&
    params.buyerAvailableDownPayment >= params.publishedDownPayment
  )
    score += 25;
  else if (params.buyerAvailableDownPayment != null && params.buyerAvailableDownPayment > 0)
    score += 10;

  if (params.hasId) score += 15;
  if (params.hasProofOfIncome) score += 15;
  if (params.phone) score += 10;
  if (params.appointmentIntent) score += 5;

  const temperature: "Hot" | "Warm" | "Cold" =
    score >= 60 ? "Hot" : score >= 30 ? "Warm" : "Cold";
  return { score, temperature };
}

export async function generateAiReply(
  visibleMessages: string[],
  currentMessage: string,
  language: string,
  vehicleTitle?: string,
  vehicleType?: string,
  publishedDownPayment?: number,
  storePhone: string = DEFAULT_STORE_PHONE,
): Promise<string> {
  const langNote =
    language === "es"
      ? "Respond ONLY in Spanish."
      : "Respond ONLY in English.";

  const vehicleContext = vehicleTitle
    ? `Vehicle: ${vehicleTitle}${vehicleType ? ` (${vehicleType})` : ""}${publishedDownPayment ? ` — Listed down payment: $${publishedDownPayment.toLocaleString()}` : ""}`
    : "";

  const history = visibleMessages.slice(-8).join("\n");

  const phoneInstruction = `Store phone for this listing: ${storePhone} — ALWAYS include this number in your reply with a 📞 emoji.`;

  const prompt = `${ALPHA_RULES}

${vehicleContext}
${phoneInstruction}

Recent conversation:
${history}

Latest buyer message: "${currentMessage}"

${langNote}
Write a short phone-first reply. Must include 📞 ${storePhone} on its own line. Mention the vehicle. Keep it under 5 lines.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.choices[0]?.message?.content?.trim();

  // Verify phone number is present; if AI omitted it, inject fallback template
  if (raw && raw.length > 0 && raw.includes(storePhone)) {
    return raw;
  }

  // Fallback phone-first template
  const vehicle = vehicleTitle ?? "the vehicle";
  if (language === "es") {
    return `Sí, está disponible ✅\n\nPara info rápida y opciones de financiamiento, llama directo a nuestra tienda:\n\n📞 ${storePhone}\n\nDiles que preguntas por el ${vehicle} que viste en Marketplace. ¿Quieres apartar una cita para verlo hoy?`;
  }
  return `Yes, it's available ✅\n\nFor the fastest details and financing options, call our store directly:\n\n📞 ${storePhone}\n\nMention you're asking about the ${vehicle} from Marketplace. Would you like to set up a time to see it today?`;
}

async function generateAiReplyWithFallback(
  visibleMessages: string[],
  currentMessage: string,
  language: string,
  vehicleTitle?: string,
  vehicleType?: string,
  publishedDownPayment?: number,
  storePhone: string = DEFAULT_STORE_PHONE,
): Promise<AiReplyResult> {
  const aiStartedAt = new Date();
  let fallbackReason: string | null = null;

  try {
    const reply = await Promise.race([
      generateAiReply(
        visibleMessages,
        currentMessage,
        language,
        vehicleTitle,
        vehicleType,
        publishedDownPayment,
        storePhone,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("sales_ai_reply_timeout")), SALES_AI_REPLY_TIMEOUT_MS),
      ),
    ]);
    const aiCompletedAt = new Date();
    return {
      reply,
      fallbackUsed: false,
      fallbackReason: null,
      aiStartedAt,
      aiCompletedAt,
      aiDurationMs: aiCompletedAt.getTime() - aiStartedAt.getTime(),
    };
  } catch (err) {
    fallbackReason = err instanceof Error && err.message === "sales_ai_reply_timeout"
      ? "latency_timeout"
      : "ai_error";
  }

  const aiCompletedAt = new Date();
  return {
    reply: buildSafeFallbackReply(language, vehicleTitle, storePhone),
    fallbackUsed: true,
    fallbackReason,
    aiStartedAt,
    aiCompletedAt,
    aiDurationMs: aiCompletedAt.getTime() - aiStartedAt.getTime(),
  };
}

async function syncMarketplaceListingMetrics(params: {
  vehicleId?: number | null;
  leadQuality?: string | null;
}) {
  if (!params.vehicleId) return;

  const [messageCounts] = await db
    .select({
      messagesReceived: sql<number>`count(*) filter (where ${conversationMessagesTable.role} in ('user', 'buyer'))`,
      lastMessageAt: sql<Date | null>`max(${conversationMessagesTable.createdAt}) filter (where ${conversationMessagesTable.role} in ('user', 'buyer'))`,
    })
    .from(conversationMessagesTable)
    .innerJoin(conversationsTable, eq(conversationsTable.id, conversationMessagesTable.conversationId))
    .where(eq(conversationsTable.vehicleId, params.vehicleId));

  const messagesReceived = Number(messageCounts?.messagesReceived ?? 0);
  const updateFields: Partial<typeof marketplaceListingsTable.$inferInsert> = {
    messagesReceived,
    unreadMessages: messagesReceived,
    lastMessageAt: messageCounts?.lastMessageAt ?? null,
  };
  if (params.leadQuality) updateFields.leadQuality = params.leadQuality;

  await db
    .update(marketplaceListingsTable)
    .set(updateFields)
    .where(eq(marketplaceListingsTable.vehicleId, params.vehicleId));
}

router.post("/conversations/intake", async (req, res) => {
  const {
    extensionId,
    externalThreadRef,
    sourceUrl,
    buyerName,
    visibleMessages,
    currentMessage,
    detectedMarketplaceListingUrl,
    detectedVehicleTitle,
    marketplaceDownPayment,
    marketplaceAskingPrice,
    vehicleType,
    dealerId: _dealerId,
    messageDetectedAt: rawMessageDetectedAt,
    messageHash,
    idempotencyKey,
    routeAllowed,
    conversationThreadDetected,
    buyerMessageDetected,
    buyerNameDetected,
    sellerIsCurrentUser,
    marketplaceContextDetected,
    timestamp: _ts,
  } = req.body as {
    extensionId?: string;
    externalThreadRef: string;
    sourceUrl?: string;
    buyerName?: string;
    visibleMessages?: string[];
    currentMessage?: string;
    detectedMarketplaceListingUrl?: string;
    detectedVehicleTitle?: string;
    marketplaceDownPayment?: number | string;
    marketplaceAskingPrice?: number | string;
    vehicleType?: string;
    dealerId?: number | string;
    messageDetectedAt?: string;
    messageHash?: string;
    idempotencyKey?: string;
    routeAllowed?: boolean;
    conversationThreadDetected?: boolean;
    buyerMessageDetected?: boolean;
    buyerNameDetected?: boolean;
    sellerIsCurrentUser?: boolean;
    marketplaceContextDetected?: boolean;
    timestamp?: string;
  };
  const backendReceivedAt = new Date();
  const messageDetectedAt = parseTimestamp(rawMessageDetectedAt) ?? parseTimestamp(_ts) ?? backendReceivedAt;

  if (!externalThreadRef) {
    res.status(400).json({ error: "externalThreadRef required" });
    return;
  }

  const missingContext = [
    routeAllowed === true ? null : "route_not_allowed",
    conversationThreadDetected === true ? null : "conversation_thread_missing",
    buyerMessageDetected === true ? null : "buyer_message_missing",
    buyerNameDetected === true ? null : "buyer_name_missing",
    sellerIsCurrentUser === true ? null : "seller_current_user_missing",
    marketplaceContextDetected === true ? null : "marketplace_context_missing",
  ].filter((reason): reason is string => !!reason);
  if (missingContext.length > 0 || !isReliableBuyerName(buyerName) || isBlockedFacebookSurface(sourceUrl)) {
    const reason = isBlockedFacebookSurface(sourceUrl)
      ? "blocked_facebook_surface"
      : !isReliableBuyerName(buyerName)
        ? "buyer_name_missing"
        : missingContext[0];
    req.log.info(
      { externalThreadRef, sourceUrl, buyerName, reason, missingContext, extensionId: extensionId ?? null },
      "Conversation intake skipped - invalid Marketplace Sales AI context",
    );
    res.json({
      skipped: true,
      reason,
      missingContext,
      timings: {
        messageDetectedAt: messageDetectedAt.toISOString(),
        backendReceivedAt: backendReceivedAt.toISOString(),
        totalResponseMs: Date.now() - messageDetectedAt.getTime(),
      },
    });
    return;
  }

  const rawMsgs = Array.isArray(visibleMessages) ? visibleMessages : [];
  const parsedMsgs = rawMsgs.map(parseConversationMessage).filter((msg): msg is ParsedConversationMessage => !!msg);
  const currentParsed = parseConversationMessage(currentMessage);
  const latestParsed = currentParsed ?? parsedMsgs[parsedMsgs.length - 1] ?? null;
  const latestBuyerMessage =
    latestParsed?.role === "user"
      ? latestParsed.content
      : [...parsedMsgs].reverse().find((msg) => msg.role === "user")?.content ?? "";
  if (!latestBuyerMessage) {
    req.log.info(
      { externalThreadRef, extensionId: extensionId ?? null, messageHash: messageHash ?? idempotencyKey ?? null },
      "Conversation intake skipped - no buyer message",
    );
    res.json({
      skipped: true,
      reason: "no_buyer_message",
      timings: {
        messageDetectedAt: messageDetectedAt.toISOString(),
        backendReceivedAt: backendReceivedAt.toISOString(),
        totalResponseMs: Date.now() - messageDetectedAt.getTime(),
      },
    });
    return;
  }
  const inbound = latestBuyerMessage;
  const language = detectLanguage(inbound + " " + (buyerName ?? ""));
  const parsedDownPayment = parseMoney(marketplaceDownPayment);
  const parsedAskingPrice = parseMoney(marketplaceAskingPrice);

  let vehicleId: number | undefined;
  let listingId: number | undefined;
  let lotLocation: string | null = null;
  let vehicleTitleFromDb: string | undefined;

  if (detectedMarketplaceListingUrl) {
    const detectedMarketplaceItemId = extractMarketplaceItemId(detectedMarketplaceListingUrl);
    const marketplaceListings = await db
      .select({
        vehicleId: marketplaceListingsTable.vehicleId,
        listingUrl: marketplaceListingsTable.listingUrl,
        facebookListingId: marketplaceListingsTable.facebookListingId,
      })
      .from(marketplaceListingsTable)
      .where(eq(marketplaceListingsTable.dealerId, DEALER_ID));
    const marketplaceListing = marketplaceListings.find((listing) => {
      if (!detectedMarketplaceItemId) return listing.listingUrl === detectedMarketplaceListingUrl;
      return (
        listing.facebookListingId === detectedMarketplaceItemId ||
        extractMarketplaceItemId(listing.listingUrl) === detectedMarketplaceItemId
      );
    });
    if (marketplaceListing) {
      vehicleId = marketplaceListing.vehicleId;
    }
  }

  if (!vehicleId && detectedVehicleTitle) {
    const normalizedDetectedTitle = normalizeVehicleTitle(detectedVehicleTitle);
    const vRow = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.dealerId, DEALER_ID));

    const match = vRow.find((v) => {
      if (!detectedVehicleTitle) return false;
      const exactTitles = [
        [v.year, v.make, v.model].filter(Boolean).join(" "),
        [v.year, v.make, v.model, v.trim].filter(Boolean).join(" "),
      ].map(normalizeVehicleTitle);
      return exactTitles.includes(normalizedDetectedTitle);
    });
    if (match) {
      vehicleId = match.id;
      lotLocation = match.lotLocation ?? null;
    }
  }

  if (vehicleId && !lotLocation) {
    const [vehicle] = await db
      .select({
        lotLocation: vehiclesTable.lotLocation,
        year: vehiclesTable.year,
        make: vehiclesTable.make,
        model: vehiclesTable.model,
        trim: vehiclesTable.trim,
      })
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, vehicleId))
      .limit(1);
    lotLocation = vehicle?.lotLocation ?? null;
    vehicleTitleFromDb = vehicle
      ? [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ")
      : undefined;
  }

  const storePhone = resolveStorePhone(lotLocation);

  if (vehicleId) {
    const lRow = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.vehicleId, vehicleId))
      .limit(1);
    if (lRow[0]) listingId = lRow[0].id;
  }
  const resolvedVehicleTitle = vehicleId ? vehicleTitleFromDb ?? detectedVehicleTitle : undefined;

  const [existingConv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.externalThreadRef, externalThreadRef))
    .limit(1);

  let conversationId: number;
  let conversation: typeof existingConv;

  if (existingConv) {
    conversationId = existingConv.id;
    const [updated] = await db
      .update(conversationsTable)
      .set({
        buyerName: buyerName ?? existingConv.buyerName,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
        vehicleId: vehicleId ?? existingConv.vehicleId,
        listingId: listingId ?? existingConv.listingId,
        marketplaceDownPayment:
          parsedDownPayment ?? existingConv.marketplaceDownPayment,
        marketplaceAskingPrice:
          parsedAskingPrice ?? existingConv.marketplaceAskingPrice,
        vehicleType: vehicleType ?? existingConv.vehicleType,
        detectedListingUrl:
          detectedMarketplaceListingUrl ?? existingConv.detectedListingUrl,
        detectedVehicleTitle:
          resolvedVehicleTitle ?? existingConv.detectedVehicleTitle,
        language,
      })
      .where(eq(conversationsTable.id, existingConv.id))
      .returning();
    conversation = updated;
  } else {
    const [created] = await db
      .insert(conversationsTable)
      .values({
        dealerId: DEALER_ID,
        externalThreadRef,
        buyerName,
        language,
        sourceUrl,
        detectedListingUrl: detectedMarketplaceListingUrl,
        detectedVehicleTitle: resolvedVehicleTitle,
        vehicleId,
        listingId,
        marketplaceDownPayment: parsedDownPayment,
        marketplaceAskingPrice: parsedAskingPrice,
        vehicleType,
        lastMessageAt: new Date(),
        status: "active",
      })
      .returning();
    conversationId = created.id;
    conversation = created;
  }

  const existingMsgs = await db
    .select()
    .from(conversationMessagesTable)
    .where(eq(conversationMessagesTable.conversationId, conversationId))
    .orderBy(desc(conversationMessagesTable.createdAt));

  const existingContents = new Set(existingMsgs.map((m) => `${m.role}:${m.content.trim()}`));
  let hasNewBuyerMessage = false;

  for (const msg of parsedMsgs) {
    const key = `${msg.role}:${msg.content.trim()}`;
    if (!existingContents.has(key)) {
      await db.insert(conversationMessagesTable).values({
        conversationId,
        role: msg.role,
        content: msg.content,
      });
      existingContents.add(key);
      if (msg.role === "user") hasNewBuyerMessage = true;
    }
  }

  if (currentParsed) {
    const key = `${currentParsed.role}:${currentParsed.content.trim()}`;
    if (!existingContents.has(key)) {
      await db.insert(conversationMessagesTable).values({
        conversationId,
        role: currentParsed.role,
        content: currentParsed.content,
      });
      existingContents.add(key);
      if (currentParsed.role === "user") hasNewBuyerMessage = true;
    }
  }

  if (!hasNewBuyerMessage) {
    req.log.info(
      { conversationId, externalThreadRef, extensionId: extensionId ?? null, messageHash: messageHash ?? idempotencyKey ?? null },
      "Conversation intake skipped - duplicate buyer message",
    );
    res.json({
      skipped: true,
      reason: "duplicate_buyer_message",
      conversationId,
      timings: {
        messageDetectedAt: messageDetectedAt.toISOString(),
        backendReceivedAt: backendReceivedAt.toISOString(),
        totalResponseMs: Date.now() - messageDetectedAt.getTime(),
      },
    });
    return;
  }

  // Extract phone number if buyer included one in their message
  const phoneMatch = inbound.match(/\b(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\b/);
  const extractedPhone = phoneMatch ? phoneMatch[1].replace(/[-.\s]/g, "-") : null;

  let suggestedReply: string | null = null;
  let aiReplyResult: AiReplyResult | null = null;
  const latestExistingAssistant = existingMsgs.find((m) => m.role === "assistant");
  const shouldGenerateReply =
    !!inbound &&
    !!hasNewBuyerMessage &&
    latestParsed?.role === "user" &&
    latestExistingAssistant?.content.trim() !== inbound.trim();

  if (shouldGenerateReply) {
    aiReplyResult = await generateAiReplyWithFallback(
      parsedMsgs.map((msg) => `${msg.role === "assistant" ? "Dealer" : "Buyer"}: ${msg.content}`),
      inbound,
      language,
      resolvedVehicleTitle,
      vehicleType,
      parsedDownPayment,
      storePhone,
    );
    suggestedReply = aiReplyResult.reply;

    await db.insert(conversationMessagesTable).values({
      conversationId,
      role: "assistant",
      content: suggestedReply,
    });
  }

  const [existingLead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.conversationId, conversationId))
    .limit(1);

  let leadId: number;
  let resolvedLeadQuality: "Hot" | "Warm" | "Cold" | null = null;
  if (existingLead) {
    leadId = existingLead.id;
    const resolvedPhone = extractedPhone ?? existingLead.phone;
    const { score, temperature } = computeLeadScore({
      buyerTimeline: existingLead.buyerTimeline,
      buyerAvailableDownPayment: existingLead.buyerAvailableDownPayment,
      publishedDownPayment: parsedDownPayment ?? existingLead.publishedDownPayment,
      hasId: existingLead.hasId,
      hasProofOfIncome: existingLead.hasProofOfIncome,
      phone: resolvedPhone,
      appointmentIntent: existingLead.appointmentIntent,
    });
    // Buyer providing phone number → force HOT, assign to BDC
    const finalTemperature = extractedPhone ? "Hot" : temperature;
    resolvedLeadQuality = finalTemperature;
    await db
      .update(leadsTable)
      .set({
        buyerName: buyerName ?? existingLead.buyerName,
        language,
        vehicleId: vehicleId ?? existingLead.vehicleId,
        listingId: listingId ?? existingLead.listingId,
        sourceUrl: sourceUrl ?? existingLead.sourceUrl,
        publishedDownPayment:
          parsedDownPayment ?? existingLead.publishedDownPayment,
        suggestedReply: suggestedReply ?? existingLead.suggestedReply,
        phone: resolvedPhone,
        leadScore: extractedPhone ? Math.max(score, 70) : score,
        temperature: finalTemperature,
        status: extractedPhone ? "BDC Assigned" : existingLead.status,
        updatedAt: new Date(),
      })
      .where(eq(leadsTable.id, existingLead.id));
  } else {
    const { score, temperature } = computeLeadScore({
      publishedDownPayment: parsedDownPayment,
      phone: extractedPhone,
    });
    const finalTemperature = extractedPhone ? "Hot" : temperature;
    resolvedLeadQuality = finalTemperature;
    const [newLead] = await db
      .insert(leadsTable)
      .values({
        conversationId,
        dealerId: DEALER_ID,
        buyerName,
        language,
        vehicleId,
        listingId,
        sourceUrl,
        publishedDownPayment: parsedDownPayment,
        suggestedReply,
        phone: extractedPhone,
        leadScore: extractedPhone ? Math.max(score, 70) : score,
        temperature: finalTemperature,
        status: extractedPhone ? "BDC Assigned" : "New",
      })
      .returning();
    leadId = newLead.id;
  }

  await db
    .insert(downPaymentIntelligenceTable)
    .values({
      dealerId: DEALER_ID,
      conversationId,
      vehicleId,
      listingId,
      vehicleType,
      publishedDownPayment: parsedDownPayment,
      outcome: "pending",
    })
    .onConflictDoNothing();

  await syncMarketplaceListingMetrics({
    vehicleId: vehicleId ?? conversation.vehicleId,
    leadQuality: resolvedLeadQuality,
  });

  const backendRespondedAt = new Date();
  const timings = {
    messageDetectedAt: messageDetectedAt.toISOString(),
    backendReceivedAt: backendReceivedAt.toISOString(),
    aiStartedAt: aiReplyResult?.aiStartedAt.toISOString() ?? null,
    aiCompletedAt: aiReplyResult?.aiCompletedAt.toISOString() ?? null,
    backendRespondedAt: backendRespondedAt.toISOString(),
    replySentAt: null,
    aiDurationMs: aiReplyResult?.aiDurationMs ?? null,
    totalResponseMs: backendRespondedAt.getTime() - messageDetectedAt.getTime(),
  };

  req.log.info(
    {
      conversationId,
      leadId,
      language,
      extensionId: extensionId ?? null,
      messageHash: messageHash ?? idempotencyKey ?? null,
      fallbackUsed: aiReplyResult?.fallbackUsed ?? false,
      fallbackReason: aiReplyResult?.fallbackReason ?? null,
      timings,
    },
    "Conversation intake processed",
  );
  res.json({
    conversationId,
    leadId,
    suggestedReply,
    language,
    fallbackUsed: aiReplyResult?.fallbackUsed ?? false,
    fallbackReason: aiReplyResult?.fallbackReason ?? null,
    timings,
  });
});

router.get("/conversations", async (req, res) => {
  const dealerId = Number(req.query.dealerId) || DEALER_ID;
  const status = req.query.status as string | undefined;

  const conditions = [eq(conversationsTable.dealerId, dealerId)];
  if (status) conditions.push(eq(conversationsTable.status, status));

  const convs = await db
    .select()
    .from(conversationsTable)
    .where(and(...conditions))
    .orderBy(desc(conversationsTable.lastMessageAt));

  const withLeads = await Promise.all(
    convs.map(async (c) => {
      const [lead] = await db
        .select()
        .from(leadsTable)
        .where(eq(leadsTable.conversationId, c.id))
        .limit(1);
      if (!isReliableBuyerName(lead?.buyerName ?? c.buyerName) || isBlockedFacebookSurface(c.sourceUrl)) {
        return null;
      }
      const messages = await db
        .select()
        .from(conversationMessagesTable)
        .where(eq(conversationMessagesTable.conversationId, c.id))
        .orderBy(desc(conversationMessagesTable.createdAt))
        .limit(20);
      const displayMessages = messages.filter(isDisplayMessage);
      const hasBuyerMessage = displayMessages.some(isBuyerDisplayMessage);
      if (!hasBuyerMessage) return null;

      let vehicle = null;
      if (c.vehicleId) {
        const [v] = await db
          .select({
            id: vehiclesTable.id,
            year: vehiclesTable.year,
            make: vehiclesTable.make,
            model: vehiclesTable.model,
            trim: vehiclesTable.trim,
            price: vehiclesTable.price,
            mileage: vehiclesTable.mileage,
            stockNumber: vehiclesTable.stockNumber,
            status: vehiclesTable.status,
          })
          .from(vehiclesTable)
          .where(eq(vehiclesTable.id, c.vehicleId))
          .limit(1);
        vehicle = v ?? null;
      }

      let listingUrl: string | null = null;
      if (c.listingId) {
        const [listing] = await db
          .select({ externalUrl: listingsTable.externalUrl })
          .from(listingsTable)
          .where(eq(listingsTable.id, c.listingId))
          .limit(1);
        listingUrl = listing?.externalUrl ?? null;
      }

      return { ...c, lead: lead ?? null, lastMessage: displayMessages[0] ?? null, vehicle, listingUrl };
    }),
  );

  res.json({ conversations: withLeads.filter((c): c is NonNullable<typeof c> => !!c) });
});

router.get("/conversations/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id))
    .limit(1);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const messages = await db
    .select()
    .from(conversationMessagesTable)
    .where(eq(conversationMessagesTable.conversationId, id))
    .orderBy(conversationMessagesTable.createdAt);
  const displayMessages = messages.filter(isDisplayMessage);

  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.conversationId, id))
    .limit(1);

  let vehicle = null;
  if (conv.vehicleId) {
    const [v] = await db
      .select({
        id: vehiclesTable.id,
        year: vehiclesTable.year,
        make: vehiclesTable.make,
        model: vehiclesTable.model,
        trim: vehiclesTable.trim,
        price: vehiclesTable.price,
        mileage: vehiclesTable.mileage,
        stockNumber: vehiclesTable.stockNumber,
        status: vehiclesTable.status,
      })
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, conv.vehicleId))
      .limit(1);
    vehicle = v ?? null;
  }

  let listingUrl: string | null = null;
  if (conv.listingId) {
    const [listing] = await db
      .select({ externalUrl: listingsTable.externalUrl })
      .from(listingsTable)
      .where(eq(listingsTable.id, conv.listingId))
      .limit(1);
    listingUrl = listing?.externalUrl ?? null;
  }

  res.json({ conversation: conv, messages: displayMessages, lead: lead ?? null, vehicle, listingUrl });
});

router.patch("/conversations/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body as { status: string };
  await db
    .update(conversationsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(conversationsTable.id, id));
  res.json({ ok: true });
});

router.patch("/conversations/:id/auto-reply", async (req, res) => {
  const id = Number(req.params.id);
  const { enabled } = req.body as { enabled: boolean };
  await db
    .update(conversationsTable)
    .set({ autoReplyEnabled: enabled, updatedAt: new Date() })
    .where(eq(conversationsTable.id, id));
  res.json({ ok: true, autoReplyEnabled: enabled });
});

// ── Intent / escalation / qualification helpers ──────────────────────────────

function detectIntent(message: string): string {
  const m = message.toLowerCase();
  if (/disponible|still.*for sale|still.*available|is it available|está disponible/.test(m)) return "availability";
  if (/\bprecio\b|how much|what.*price|cuánto.*cuesta|cuanto.*cuesta/.test(m)) return "price_inquiry";
  if (/financiamiento|financing|finance|monthly|mensual|payment plan/.test(m)) return "financing";
  if (/dónde|donde|location|address|dirección|where.*are.*you|where.*located/.test(m)) return "location";
  if (/\binicial\b|down.?payment|enganche|cuánto.*inicial|cuanto.*inicial/.test(m)) return "down_payment";
  if (/\bitin\b|\bpasaporte\b|\bpassport\b|driver.*license|tax id|identificación/.test(m)) return "document_inquiry";
  if (/cita|appointment|come.*in|ver.*hoy|see.*today|schedule/.test(m)) return "appointment_request";
  if (/this week|esta semana|comprar.*semana|buy.*today|comprar.*hoy/.test(m)) return "purchase_timeline";
  if (/qué.*necesito|what.*documents|what.*need|what.*bring|documentos/.test(m)) return "document_list";
  if (/credit|crédito|bad.*credit|credit.*score/.test(m)) return "credit_inquiry";
  return "general_inquiry";
}

function shouldEscalate(
  message: string,
  intent: string,
): { escalate: boolean; reason?: string } {
  const m = message.toLowerCase();

  if (intent === "appointment_request" || /\b(appointment|come in|schedule a time|cita)\b/.test(m))
    return { escalate: true, reason: "Buyer requesting appointment" };

  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(message))
    return { escalate: true, reason: "Buyer provided phone number" };

  if (/guarant|everyone.*approv|no.*credit.*check|definitely.*approv/.test(m))
    return { escalate: true, reason: "Buyer asking for approval guarantee" };

  if (/\b(scam|fraud|lawsuit|bbb|complaint|terrible|angry|upset)\b/.test(m))
    return { escalate: true, reason: "Buyer showing frustration" };

  if (/\b(interest rate|apr|contract|cosigner|co-signer|repossess|legal|attorney)\b/.test(m))
    return { escalate: true, reason: "Legal or financing detail inquiry" };

  return { escalate: false };
}

function getMissingQualificationFields(lead?: {
  buyerName?: string | null;
  phone?: string | null;
  buyerAvailableDownPayment?: number | null;
  hasId?: boolean | null;
  hasProofOfIncome?: boolean | null;
  buyerTimeline?: string | null;
  appointmentIntent?: boolean | null;
}): string[] {
  const missing: string[] = [];
  if (!lead?.buyerName) missing.push("Buyer name");
  if (!lead?.phone) missing.push("Phone number");
  if (lead?.buyerAvailableDownPayment == null) missing.push("Down payment amount");
  if (lead?.hasId == null) missing.push("ID / Tax ID");
  if (lead?.hasProofOfIncome == null) missing.push("Proof of income");
  if (!lead?.buyerTimeline) missing.push("Purchase timeline");
  if (lead?.appointmentIntent == null) missing.push("Appointment availability");
  return missing;
}

// ── Hidden QA test route — stateless, no DB writes ───────────────────────────
router.post("/sales-ai/test-message", async (req, res) => {
  const {
    vehicleId,
    buyerMessage,
    language: inputLanguage,
  } = req.body as {
    vehicleId?: number;
    buyerMessage: string;
    language?: string;
  };

  if (!buyerMessage) {
    res.status(400).json({ error: "buyerMessage required" });
    return;
  }

  const detectedLanguage = (inputLanguage ?? detectLanguage(buyerMessage)) as "en" | "es";
  const intent = detectIntent(buyerMessage);
  const escalation = shouldEscalate(buyerMessage, intent);
  const missingFields = getMissingQualificationFields();

  let vehicleTitle: string | undefined;
  let vehicleType: string | undefined;
  let testStorePhone: string = DEFAULT_STORE_PHONE;

  if (vehicleId) {
    const [v] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, vehicleId))
      .limit(1);
    if (v) {
      vehicleTitle = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
      vehicleType = v.bodyStyle ?? undefined;
      testStorePhone = resolveStorePhone(v.lotLocation);
    }
  }

  const suggestedReply = await generateAiReply(
    [],
    buyerMessage,
    detectedLanguage,
    vehicleTitle,
    vehicleType,
    undefined,
    testStorePhone,
  );

  const { score: leadScore, temperature } = computeLeadScore({});

  req.log.info({ intent, escalation, detectedLanguage }, "sales-ai:test-message");

  res.json({
    detectedIntent: intent,
    detectedLanguage,
    leadScore,
    temperature,
    suggestedReply,
    escalationDecision: escalation,
    missingFields,
  });
});

export default router;
