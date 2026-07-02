import { Router } from "express";
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import {
  db,
  conversationsTable,
  conversationMessagesTable,
  leadsTable,
  downPaymentIntelligenceTable,
  vehiclesTable,
  listingsTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";

// All UI queries are scoped to the Manassas store only.
// null lot_location = default Manassas lot (feed never sets this field).
const MANASSAS_FILTER = or(
  ilike(vehiclesTable.lotLocation, "%manassas%"),
  isNull(vehiclesTable.lotLocation),
)!;

const router = Router();

const DEALER_ID = 1;

const ALPHA_RULES = `
You are a professional car sales representative for Alpha Motorsport, a used car dealership.
Qualification flow (ask ONE question at a time, in order):
1. Confirm the vehicle is available
2. Ask if they are buying this week or just checking options
3. Ask what down payment they have available
4. Ask if they have an ID or Tax ID (ITIN)
5. Ask if they have proof of income
6. Ask for their phone number
7. Ask if they can come in today or tomorrow

Down payment minimums by vehicle type:
- Sedan: $1,000–$1,500
- SUV: $2,000+
- Truck: $2,500–$3,000
- Luxury: $3,000+
- $0 down only if fully qualified

Preferred language:
- Use "easy financing options"
- Use "approval based on qualification"
- Use "ID or Tax ID accepted"
- Use "proof of income required"
- Use "ready to buy this week" / "serious buyers"
- NEVER say: guaranteed approval, everyone approved, bad credit, denied, rejected, disqualified

Rules:
- Match the buyer's language (English or Spanish)
- Sound like a real salesperson, not a robot
- Keep replies short — 2–4 sentences max
- Never promise loan approval
- Move the conversation toward an appointment
`;

function detectLanguage(text: string): "en" | "es" {
  const spanishWords =
    /\b(hola|gracias|disponible|tengo|quiero|inicial|comprar|semana|número|itin|ingresos|esta|carro|auto)\b/i;
  return spanishWords.test(text) ? "es" : "en";
}

function computeLeadScore(params: {
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

async function generateAiReply(
  visibleMessages: string[],
  currentMessage: string,
  language: string,
  vehicleTitle?: string,
  vehicleType?: string,
  publishedDownPayment?: number,
): Promise<string> {
  const langNote =
    language === "es"
      ? "Respond ONLY in Spanish."
      : "Respond ONLY in English.";

  const vehicleContext = vehicleTitle
    ? `Vehicle: ${vehicleTitle}${vehicleType ? ` (${vehicleType})` : ""}${publishedDownPayment ? ` — Listed down payment: $${publishedDownPayment.toLocaleString()}` : ""}`
    : "";

  const history = visibleMessages.slice(-8).join("\n");

  const prompt = `${ALPHA_RULES}

${vehicleContext}

Recent conversation:
${history}

Latest buyer message: "${currentMessage}"

${langNote}
Write a short, natural reply (2–4 sentences). Ask ONE qualifying question if appropriate.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.choices[0]?.message?.content?.trim();
  return raw && raw.length > 0
    ? raw
    : language === "es"
      ? "¡Hola! Gracias por tu interés. ¿Estás buscando comprar esta semana o solo explorando opciones?"
      : "Hi! Thanks for reaching out. Are you looking to purchase this week or just exploring options?";
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
    marketplaceDownPayment?: number;
    marketplaceAskingPrice?: number;
    vehicleType?: string;
    timestamp?: string;
  };

  if (!externalThreadRef) {
    res.status(400).json({ error: "externalThreadRef required" });
    return;
  }

  const msgs = Array.isArray(visibleMessages) ? visibleMessages : [];
  const inbound = currentMessage || msgs[msgs.length - 1] || "";
  const language = detectLanguage(inbound + " " + (buyerName ?? ""));

  let vehicleId: number | undefined;
  let listingId: number | undefined;

  if (detectedVehicleTitle) {
    const vRow = await db
      .select()
      .from(vehiclesTable)
      .where(and(eq(vehiclesTable.dealerId, DEALER_ID), MANASSAS_FILTER))
      .limit(20);

    const match = vRow.find((v) => {
      if (!detectedVehicleTitle) return false;
      const vTitle = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
      return vTitle.toLowerCase().includes(detectedVehicleTitle.toLowerCase().slice(0, 10));
    });
    if (match) vehicleId = match.id;
  }

  if (vehicleId) {
    const lRow = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.vehicleId, vehicleId))
      .limit(1);
    if (lRow[0]) listingId = lRow[0].id;
  }

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
          marketplaceDownPayment ?? existingConv.marketplaceDownPayment,
        marketplaceAskingPrice:
          marketplaceAskingPrice ?? existingConv.marketplaceAskingPrice,
        vehicleType: vehicleType ?? existingConv.vehicleType,
        detectedListingUrl:
          detectedMarketplaceListingUrl ?? existingConv.detectedListingUrl,
        detectedVehicleTitle:
          detectedVehicleTitle ?? existingConv.detectedVehicleTitle,
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
        detectedVehicleTitle,
        vehicleId,
        listingId,
        marketplaceDownPayment,
        marketplaceAskingPrice,
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

  const existingContents = new Set(existingMsgs.map((m) => m.content.trim()));

  for (const msg of msgs) {
    if (msg && !existingContents.has(msg.trim())) {
      await db.insert(conversationMessagesTable).values({
        conversationId,
        role: "buyer",
        content: msg,
      });
      existingContents.add(msg.trim());
    }
  }

  let suggestedReply: string | null = null;
  if (inbound) {
    suggestedReply = await generateAiReply(
      msgs,
      inbound,
      language,
      detectedVehicleTitle,
      vehicleType,
      marketplaceDownPayment,
    );

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
  if (existingLead) {
    leadId = existingLead.id;
    const { score, temperature } = computeLeadScore({
      buyerTimeline: existingLead.buyerTimeline,
      buyerAvailableDownPayment: existingLead.buyerAvailableDownPayment,
      publishedDownPayment: marketplaceDownPayment ?? existingLead.publishedDownPayment,
      hasId: existingLead.hasId,
      hasProofOfIncome: existingLead.hasProofOfIncome,
      phone: existingLead.phone,
      appointmentIntent: existingLead.appointmentIntent,
    });
    await db
      .update(leadsTable)
      .set({
        buyerName: buyerName ?? existingLead.buyerName,
        language,
        vehicleId: vehicleId ?? existingLead.vehicleId,
        listingId: listingId ?? existingLead.listingId,
        sourceUrl: sourceUrl ?? existingLead.sourceUrl,
        publishedDownPayment:
          marketplaceDownPayment ?? existingLead.publishedDownPayment,
        suggestedReply: suggestedReply ?? existingLead.suggestedReply,
        leadScore: score,
        temperature,
        updatedAt: new Date(),
      })
      .where(eq(leadsTable.id, existingLead.id));
  } else {
    const { score, temperature } = computeLeadScore({
      publishedDownPayment: marketplaceDownPayment,
    });
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
        publishedDownPayment: marketplaceDownPayment,
        suggestedReply,
        leadScore: score,
        temperature,
        status: "New",
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
      publishedDownPayment: marketplaceDownPayment,
      outcome: "pending",
    })
    .onConflictDoNothing();

  req.log.info(
    { conversationId, leadId, language },
    "Conversation intake processed",
  );
  res.json({ conversationId, leadId, suggestedReply, language });
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
      const messages = await db
        .select()
        .from(conversationMessagesTable)
        .where(eq(conversationMessagesTable.conversationId, c.id))
        .orderBy(desc(conversationMessagesTable.createdAt))
        .limit(1);
      return { ...c, lead: lead ?? null, lastMessage: messages[0] ?? null };
    }),
  );

  res.json({ conversations: withLeads });
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

  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.conversationId, id))
    .limit(1);

  res.json({ conversation: conv, messages, lead: lead ?? null });
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

export default router;
