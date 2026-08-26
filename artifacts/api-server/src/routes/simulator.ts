import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  db,
  conversationsTable,
  conversationMessagesTable,
  leadsTable,
  downPaymentIntelligenceTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const DEALER_ID = 1;

const SCENARIOS = {
  en_available: {
    label: "Is this available? (EN)",
    language: "en",
    messages: ["Is this vehicle still available?"],
    vehicleType: "sedan",
    downPayment: 1000,
  },
  en_how_much_down: {
    label: "How much down? (EN)",
    language: "en",
    messages: ["Is this available?", "How much is the down payment?"],
    vehicleType: "suv",
    downPayment: 2000,
  },
  en_have_down: {
    label: "I have $2500 down (EN)",
    language: "en",
    messages: [
      "Is this still available?",
      "How much down?",
      "I have $2500 for the down payment",
    ],
    vehicleType: "truck",
    downPayment: 2500,
    buyerAvailableDownPayment: 2500,
    buyerTimeline: "this_week" as const,
  },
  en_come_tomorrow: {
    label: "I can come tomorrow (EN)",
    language: "en",
    messages: [
      "Is this available?",
      "I have $2500 down",
      "I can come in tomorrow",
    ],
    vehicleType: "truck",
    downPayment: 2500,
    buyerAvailableDownPayment: 2500,
    buyerTimeline: "this_week" as const,
    appointmentIntent: true,
  },
  en_phone: {
    label: "Phone number provided (EN)",
    language: "en",
    messages: [
      "Is this available?",
      "I have $2500 down",
      "I can come tomorrow",
      "My number is 555-1234",
    ],
    vehicleType: "truck",
    downPayment: 2500,
    buyerAvailableDownPayment: 2500,
    buyerTimeline: "this_week" as const,
    appointmentIntent: true,
    phone: "555-1234",
    hasId: true,
    hasProofOfIncome: true,
  },
  es_available: {
    label: "¿Está disponible? (ES)",
    language: "es",
    messages: ["¿Está disponible este carro?"],
    vehicleType: "sedan",
    downPayment: 1000,
  },
  es_have_down: {
    label: "Tengo $2500 de inicial (ES)",
    language: "es",
    messages: [
      "¿Está disponible?",
      "Tengo $2500 de inicial para el enganche",
    ],
    vehicleType: "suv",
    downPayment: 2000,
    buyerAvailableDownPayment: 2500,
    buyerTimeline: "this_week" as const,
  },
  es_itin: {
    label: "Tengo ITIN y prueba de ingresos (ES)",
    language: "es",
    messages: [
      "¿Está disponible?",
      "Tengo $2500 de inicial",
      "Tengo ITIN y prueba de ingresos",
    ],
    vehicleType: "suv",
    downPayment: 2000,
    buyerAvailableDownPayment: 2500,
    buyerTimeline: "this_week" as const,
    hasId: true,
    hasProofOfIncome: true,
  },
  es_buy_week: {
    label: "Quiero comprar esta semana (ES)",
    language: "es",
    messages: [
      "¿Está disponible?",
      "Tengo $2500 de inicial",
      "Quiero comprar esta semana",
    ],
    vehicleType: "suv",
    downPayment: 2000,
    buyerAvailableDownPayment: 2500,
    buyerTimeline: "this_week" as const,
    appointmentIntent: true,
  },
  es_phone: {
    label: "Este es mi número (ES)",
    language: "es",
    messages: [
      "¿Está disponible?",
      "Tengo $2500 de inicial",
      "Quiero comprar esta semana",
      "Este es mi número: 555-9876",
    ],
    vehicleType: "suv",
    downPayment: 2000,
    buyerAvailableDownPayment: 2500,
    buyerTimeline: "this_week" as const,
    appointmentIntent: true,
    phone: "555-9876",
    hasId: true,
    hasProofOfIncome: true,
  },
} as const;

type ScenarioKey = keyof typeof SCENARIOS;

const ALPHA_RULES = `
You are a professional car sales representative for Alpha Motorsport.
Qualification rules:
- Use only the dealer's effective-dated approved down-payment configuration; if it is absent, do not mention a down-payment number.
Preferred phrases: easy financing options, approval based on qualification, ID or Tax ID accepted, proof of income required
NEVER say: guaranteed approval, everyone approved, bad credit, denied, rejected, disqualified
Match buyer language (English/Spanish). Keep reply to 2–4 sentences. Ask ONE question at a time.
`;

type ScoreInput = {
  downPayment: number;
  phone?: string;
  buyerTimeline?: string;
  buyerAvailableDownPayment?: number;
  hasId?: boolean;
  hasProofOfIncome?: boolean;
  appointmentIntent?: boolean;
};

function computeLeadScore(s: ScoreInput): {
  score: number;
  temperature: "Hot" | "Warm" | "Cold";
} {
  let score = 0;
  if ("buyerTimeline" in s && s.buyerTimeline === "this_week") score += 30;
  if ("buyerAvailableDownPayment" in s && s.buyerAvailableDownPayment != null) {
    if (s.buyerAvailableDownPayment >= s.downPayment) score += 25;
    else score += 10;
  }
  if ("hasId" in s && s.hasId) score += 15;
  if ("hasProofOfIncome" in s && s.hasProofOfIncome) score += 15;
  if (s.phone) score += 10;
  if ("appointmentIntent" in s && s.appointmentIntent) score += 5;
  const temperature: "Hot" | "Warm" | "Cold" =
    score >= 60 ? "Hot" : score >= 30 ? "Warm" : "Cold";
  return { score, temperature };
}

router.get("/simulator/scenarios", (_req, res) => {
  const list = Object.entries(SCENARIOS).map(([key, s]) => ({
    key,
    label: s.label,
    language: s.language,
    vehicleType: s.vehicleType,
    downPayment: s.downPayment,
    messageCount: s.messages.length,
  }));
  res.json({ scenarios: list });
});

router.post("/simulator/run", async (req, res) => {
  const { scenarioKey, customMessages, buyerName } = req.body as {
    scenarioKey?: ScenarioKey;
    customMessages?: string[];
    buyerName?: string;
  };

  const scenario = scenarioKey ? SCENARIOS[scenarioKey] : null;
  const messages =
    customMessages ??
    (scenario ? [...scenario.messages] : ["Is this vehicle available?"]);
  const lang =
    scenario?.language ??
    (/\b(hola|tengo|está)\b/i.test(messages.join(" ")) ? "es" : "en");
  const vehicleType = scenario?.vehicleType ?? "sedan";
  const downPayment = scenario?.downPayment ?? 1000;

  const currentMessage = messages[messages.length - 1] ?? "";
  const externalThreadRef = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const name = buyerName ?? (lang === "es" ? "Comprador Simulado" : "Simulated Buyer");

  const prompt = `${ALPHA_RULES}

Vehicle type: ${vehicleType} — Listed down payment: $${downPayment.toLocaleString()}
${lang === "es" ? "Respond ONLY in Spanish." : "Respond ONLY in English."}

Conversation so far:
${messages.join("\n")}

Write a short reply (2–4 sentences) asking ONE qualifying question.`;

  const aiResponse = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  const rawReply = aiResponse.choices[0]?.message?.content?.trim();
  const suggestedReply =
    rawReply && rawReply.length > 0
      ? rawReply
      : "Thanks for your interest! Are you looking to purchase this week?";

  const [conv] = await db
    .insert(conversationsTable)
    .values({
      dealerId: DEALER_ID,
      externalThreadRef,
      buyerName: name,
      language: lang,
      vehicleType,
      marketplaceDownPayment: downPayment,
      lastMessageAt: new Date(),
      status: "active",
    })
    .returning();

  for (const msg of messages) {
    await db.insert(conversationMessagesTable).values({
      conversationId: conv.id,
      role: "buyer",
      content: msg,
    });
  }
  await db.insert(conversationMessagesTable).values({
    conversationId: conv.id,
    role: "assistant",
    content: suggestedReply,
  });

  const { score, temperature } = computeLeadScore(
    scenario ?? { downPayment },
  );

  const [lead] = await db
    .insert(leadsTable)
    .values({
      conversationId: conv.id,
      dealerId: DEALER_ID,
      buyerName: name,
      language: lang,
      publishedDownPayment: downPayment,
      buyerAvailableDownPayment:
        scenario && "buyerAvailableDownPayment" in scenario
          ? scenario.buyerAvailableDownPayment
          : undefined,
      buyerTimeline:
        scenario && "buyerTimeline" in scenario ? scenario.buyerTimeline : undefined,
      hasId: scenario && "hasId" in scenario ? scenario.hasId : undefined,
      hasProofOfIncome:
        scenario && "hasProofOfIncome" in scenario ? scenario.hasProofOfIncome : undefined,
      phone: scenario && "phone" in scenario ? scenario.phone : undefined,
      appointmentIntent:
        scenario && "appointmentIntent" in scenario ? scenario.appointmentIntent : undefined,
      suggestedReply,
      leadScore: score,
      temperature,
      status: "New",
    })
    .returning();

  await db.insert(downPaymentIntelligenceTable).values({
    dealerId: DEALER_ID,
    conversationId: conv.id,
    vehicleType,
    publishedDownPayment: downPayment,
    buyerAvailableDownPayment:
      scenario && "buyerAvailableDownPayment" in scenario
        ? scenario.buyerAvailableDownPayment
        : undefined,
    buyerTimeline:
      scenario && "buyerTimeline" in scenario ? scenario.buyerTimeline : undefined,
    leadTemperature: temperature,
    leadScore: score,
    appointmentIntent:
      scenario && "appointmentIntent" in scenario ? scenario.appointmentIntent : undefined,
    outcome: score >= 60 ? "hot" : score >= 30 ? "warm" : "cold",
  });

  req.log.info({ conversationId: conv.id, leadId: lead.id, score }, "Simulator run complete");
  res.json({
    conversationId: conv.id,
    leadId: lead.id,
    suggestedReply,
    language: lang,
    leadScore: score,
    temperature,
    messages,
  });
});

export default router;
