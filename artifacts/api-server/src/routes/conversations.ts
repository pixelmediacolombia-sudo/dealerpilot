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
const SALES_AI_REPLY_TIMEOUT_MS = 12000;
// Retry a prepared reply quickly when Facebook did not confirm the first
// composer/send attempt. The extension still deduplicates by message hash, so
// this does not create duplicate AI replies; it only removes the old 2-minute
// dead time between delivery attempts.
const MESSENGER_DELIVERY_RETRY_DELAY_MS = 15000;

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
  "message sent",
  "mensaje enviado",
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
    .replace(/^(?:message sent|mensaje enviado)[\s.]*$/i, "")
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

function sameParsedConversationMessage(
  left: ParsedConversationMessage | null | undefined,
  right: ParsedConversationMessage | null | undefined,
): boolean {
  return !!left && !!right && left.role === right.role && left.content.trim() === right.content.trim();
}

function mergeCurrentConversationMessage(
  messages: ParsedConversationMessage[],
  current: ParsedConversationMessage | null,
): ParsedConversationMessage[] {
  if (!current || sameParsedConversationMessage(messages[messages.length - 1], current)) return messages;
  return [...messages, current];
}

function findNewConversationMessages(
  existingChronological: ParsedConversationMessage[],
  incomingChronological: ParsedConversationMessage[],
): ParsedConversationMessage[] {
  const maxOverlap = Math.min(existingChronological.length, incomingChronological.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const existingSuffix = existingChronological.slice(-overlap);
    const incomingPrefix = incomingChronological.slice(0, overlap);
    if (existingSuffix.every((message, index) => sameParsedConversationMessage(message, incomingPrefix[index]))) {
      return incomingChronological.slice(overlap);
    }
  }

  // Facebook can briefly omit the dealer's latest outgoing row while the DOM
  // rerenders. In that case the incoming prefix still matches an older DB
  // segment even though it is not the DB suffix. Continue after that segment
  // instead of charging for the same buyer text again.
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const incomingPrefix = incomingChronological.slice(0, overlap);
    const lastStart = existingChronological.length - overlap;
    for (let start = lastStart; start >= 0; start -= 1) {
      const existingSegment = existingChronological.slice(start, start + overlap);
      if (existingSegment.every((message, index) => sameParsedConversationMessage(message, incomingPrefix[index]))) {
        return incomingChronological.slice(overlap);
      }
    }
  }
  return incomingChronological;
}

function formatConversationHistoryForAi(messages: ParsedConversationMessage[]): string[] {
  return messages.map((message) => `${message.role === "assistant" ? "Dealer" : "Buyer"}: ${message.content}`);
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

function resolveMarketplaceIntakeSourceUrl(params: {
  sourceUrl?: string | null;
  detectedMarketplaceListingUrl?: string | null;
  detectedVehicleTitle?: string | null;
  marketplaceContextDetected?: boolean;
}): string | undefined {
  const sourceUrl = params.sourceUrl ?? undefined;
  if (!isBlockedFacebookSurface(sourceUrl)) return sourceUrl;

  const detectedTitle = cleanConversationText(params.detectedVehicleTitle);
  const hasExplicitMarketplaceEvidence =
    params.marketplaceContextDetected === true &&
    (
      !!extractMarketplaceItemId(params.detectedMarketplaceListingUrl) ||
      /\b(?:19|20)\d{2}\s+\S+/.test(detectedTitle)
    );
  if (!hasExplicitMarketplaceEvidence) return sourceUrl;

  return params.detectedMarketplaceListingUrl || "https://www.facebook.com/marketplace/inbox";
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

type SalesReplyStage =
  | "availability"
  | "request_phone"
  | "phone_received"
  | "address_request"
  | "document_requirements"
  | "warranty_info"
  | "advisor_question"
  | "general";

function extractPhoneNumber(text: string): string | null {
  const match = text.match(/(?:^|\D)((?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})(?=$|\D)/);
  const digits = match?.[1]?.replace(/\D/g, "") ?? "";
  const localDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (localDigits.length !== 10) return null;
  return `${localDigits.slice(0, 3)}-${localDigits.slice(3, 6)}-${localDigits.slice(6)}`;
}

function hasPhoneNumber(text: string): boolean {
  return extractPhoneNumber(text) !== null;
}

function historyAskedAboutFinancing(history: string): boolean {
  return /\b(?:dealer|dealerpilot ai|assistant):[\s\S]{0,240}\b(?:financing|finance|financiamiento|financiar|opciones de financiamiento)\b/i.test(history);
}

function historyRequestedPhone(history: string): boolean {
  return /\b(?:dealer|dealerpilot ai|assistant):[\s\S]{0,280}\b(?:best phone number|phone number|n[uú]mero de tel[eé]fono|tel[eé]fono)\b/i.test(history);
}

function buyerAcceptedFinancingStep(latest: string): boolean {
  return /\b(?:yes|yeah|yep|sure|ok|okay|interested|i am|i'm|trade|trade-in|trade in|make this work|how can we make this work|next step|what next|si|s[ií]|claro|me interesa|hagamos|como hacemos|c[oó]mo hacemos)\b/i.test(latest);
}

function buyerAskedDocumentRequirements(latest: string): boolean {
  return /\b(?:q|que|qu[eé]|what).{0,50}(?:necesit|need|required|requisit|document).{0,140}(?:aplicar|apply|application|financ|finance|financing)?\b/i.test(latest) ||
    /\b(?:requisitos?|requirements?|documentos?|documents?).{0,140}(?:aplicar|apply|application|financ|finance|financing)\b/i.test(latest) ||
    /\b(?:pasaporte|passport|tax\s*id|itin|identificaci[oó]n|id|cuenta bancaria|bank account).{0,140}(?:aplicar|apply|application|financ|finance|financing|necesit|need|required)\b/i.test(latest);
}

function buyerAskedWarrantyInfo(latest: string): boolean {
  return /\b(?:warranty|garant[ií]a|deductible|deducible|engine|motor|transmission|transmisi[oó]n|mechanic|mec[aá]nico|repair|reparaci[oó]n|third-party|dealership|included|cover|days|miles|mill?as)\b/i.test(latest);
}

function buyerAskedAdvisorQuestion(latest: string): boolean {
  return /[?¿]/.test(latest) ||
    /^(?:what|how|when|where|why|can|could|do|does|did|is|are|will|would|cu[aá]l|c[oó]mo|cu[aá]ndo|d[oó]nde|por qu[eé]|puede|pueden|tiene|tienen|hay|es|est[aá])\b/i.test(latest);
}

function resolveSalesReplyStage(visibleMessages: string[], currentMessage: string): SalesReplyStage {
  const latest = cleanConversationText(currentMessage).toLowerCase();
  const history = visibleMessages.map(cleanConversationText).join(" ").toLowerCase();
  if (hasPhoneNumber(latest)) return "phone_received";
  if (buyerAskedDocumentRequirements(latest)) return "document_requirements";
  if (historyAskedAboutFinancing(history) && buyerAcceptedFinancingStep(latest)) {
    return "request_phone";
  }
  if (/\b(link|application|apply|financ(?:e|ing)|loan|monthly payment|payment plan|solicitud|aplicar|financiamiento|financiar|credito|crédito|cuota mensual)\b/i.test(latest)) {
    return "request_phone";
  }
  if (/\b(is (?:it|this|the .+?) (?:still )?available|still available|sigue disponible|esta disponible|está disponible|lo tiene disponible)\b/i.test(latest)) {
    return "availability";
  }
  if (
    /\b(direcci[oó]n|address|ubicaci[oó]n|location|d[oó]nde est[áa]n|where are you|c[oó]mo llegar|how (?:do )?i get|est[áa] en|store address|concesionario|lot location|physical address|visitar|visit the lot|come see|stop by|come by|directions|mapa|maps|google maps)\b/i.test(latest)
  ) {
    return "address_request";
  }
  if (buyerAskedWarrantyInfo(latest)) return "warranty_info";
  if (buyerAskedAdvisorQuestion(latest)) return "advisor_question";
  if (historyRequestedPhone(history)) return "request_phone";
  if (!/\b(?:Dealer|DealerPilot AI|Assistant):/i.test(history)) return "availability";
  return "general";
}

function resolveStoreAddress(lotLocation?: string | null): string {
  const locations: Record<string, string> = {
    manassas: "9120 Euclid Ave, Manassas, VA 20110",
    fredericksburg: "410 Hudgins Rd, Fredericksburg, VA 22408",
  };
  if (!lotLocation) return locations.manassas;
  const key = lotLocation.toLowerCase().trim();
  return locations[key] ?? locations.manassas;
}

function buildSafeFallbackReply(
  language: string,
  vehicleTitle?: string,
  storePhone: string = DEFAULT_STORE_PHONE,
  visibleMessages: string[] = [],
  currentMessage: string = "",
  availabilityQuickReplyAccepted: boolean = false,
  lotLocation?: string | null,
): string {
  const vehicle = vehicleTitle ?? (language === "es" ? "el vehículo" : "the vehicle");
  const stage = resolveSalesReplyStage(visibleMessages, currentMessage);
  const storeAddress = resolveStoreAddress(lotLocation);
  if (language === "es") {
    if (stage === "phone_received") {
      return `Gracias. Nuestro equipo se comunicará contigo pronto sobre el ${vehicle}. Si prefieres llamar ahora: ${storePhone}.`;
    }
    if (stage === "request_phone") {
      return `Perfecto. ¿Cuál es el mejor número de teléfono para ayudarte con el financiamiento del ${vehicle}?`;
    }
    if (stage === "availability") {
      return `${availabilityQuickReplyAccepted ? "" : "Sí, sigue disponible. "}¿Te interesa financiar el ${vehicle}?`;
    }
    if (stage === "address_request") {
      return `Nuestra dirección es: ${storeAddress}. ¿Te gustaría venir a ver el ${vehicle}?`;
    }
    if (stage === "document_requirements") {
      return "Solo necesitas tu ID y una cuenta bancaria activa; puede ser pasaporte o Tax ID. ¿Cuál es el mejor número de teléfono para ayudarte con la aplicación?";
    }
    if (stage === "warranty_info") {
      return `Buena pregunta. Eso lo puedes discutir con un asesor para confirmar los detalles exactos de garantía y cobertura. ¿Cuál es el mejor número de teléfono para ayudarte con el ${vehicle}?`;
    }
    if (stage === "advisor_question") {
      return `Buena pregunta. Eso lo puedes discutir con un asesor para confirmar los detalles exactos. ¿Cuál es el mejor número de teléfono para ayudarte con el ${vehicle}?`;
    }
    return `Con gusto te ayudo con el ${vehicle}. ¿Te interesa financiarlo?`;
  }
  if (stage === "phone_received") {
    return `Thank you. Our team will contact you shortly about the ${vehicle}. If you prefer to call now: ${storePhone}.`;
  }
  if (stage === "request_phone") {
    return `Great. What's the best phone number to help you with financing for the ${vehicle}?`;
  }
  if (stage === "availability") {
    return `${availabilityQuickReplyAccepted ? "" : "Yes, it is still available. "}Are you interested in financing the ${vehicle}?`;
  }
  if (stage === "address_request") {
    return `Our address is: ${storeAddress}. Would you like to come see the ${vehicle}?`;
  }
  if (stage === "document_requirements") {
    return "You only need your ID and an active bank account; a passport or Tax ID works. What's the best phone number to help with the application?";
  }
  if (stage === "warranty_info") {
    return `Great questions. You can discuss that with an advisor so they can confirm the exact warranty and coverage details. What's the best phone number so we can help you with the ${vehicle}?`;
  }
  if (stage === "advisor_question") {
    return `Great question. You can discuss that with an advisor so they can confirm the exact details. What's the best phone number so we can help you with the ${vehicle}?`;
  }
  return `I'd be happy to help with the ${vehicle}. Are you interested in financing it?`;
}

function isAiReplyAligned(reply: string, stage: SalesReplyStage, storePhone: string): boolean {
  const normalized = cleanConversationText(reply).toLowerCase();
  if (!normalized) return false;
  if (stage === "availability") {
    return /financ|financiar|financiamiento/.test(normalized) && !normalized.includes(storePhone.toLowerCase());
  }
  if (stage === "request_phone") {
    return /phone|number|tel[eé]fono|n[uú]mero/.test(normalized) && !normalized.includes(storePhone.toLowerCase());
  }
  if (stage === "phone_received") {
    return /call|contact|llam|comunicar/.test(normalized);
  }
  if (stage === "document_requirements") {
    return /\b(id|tax\s*id|passport|pasaporte)\b/.test(normalized) &&
      /bank account|cuenta bancaria|cuenta de banco/.test(normalized) &&
      /phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  if (stage === "warranty_info") {
    return /advisor|asesor/.test(normalized) &&
      /confirm|confirmar|discuss|discutir/.test(normalized) &&
      /phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  if (stage === "advisor_question") {
    return /advisor|asesor/.test(normalized) &&
      /confirm|confirmar|discuss|discutir/.test(normalized) &&
      /phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  return true;
}

function isReplyLanguageMirrored(reply: string, language: string): boolean {
  const text = cleanConversationText(reply);
  if (!text) return false;
  return detectLanguage(text) === language;
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

CONVERSATION FUNNEL:
1. For the initial Marketplace availability inquiry, the affirmative Marketplace quick reply is handled by the extension. Ask whether the buyer is interested in financing.
2. When the buyer is interested in financing or asks for an application/link, ask for the best phone number.
3. If the buyer asks what requirements/documents are needed to apply, answer the requirements first: ID and active bank account; passport or Tax ID works. Then continue the flow by asking for the best phone number to help with the application.
4. If the buyer asks any vehicle, payment, warranty, coverage, deductible, inspection, third-party/dealership, or other detailed question that is not answered by the supplied context, do not invent details. Say they can discuss it with an advisor and continue by asking for the best phone number.
5. If the conversation already asked for the buyer's phone number and the buyer replies without a number, do not restart the financing question. Continue by asking for the best phone number.
6. Once the buyer provides a phone number, acknowledge it and say the team will call shortly. Only at this stage may you also offer the store phone as an immediate option.
7. Send exactly one short reply for the latest buyer turn. Never repeat a previous reply.
8. Answer safe vehicle questions directly only when the supplied context contains the answer; otherwise route the buyer to an advisor and ask for the best phone number. Never invent availability, price, approval, history, warranty, or financing details.

ADDRESS / DIRECTIONS HANDLING:
- If the buyer asks for the address, directions, or location, provide the store address directly and invite them to visit.
- Never ask a clarifying question about which vehicle or location they mean.
- Always provide the address from the supplied Dealership address field.

Language rules:
- Mirror the latest buyer message language exactly.
- If the latest buyer message is Spanish, reply ONLY in Spanish.
- If the latest buyer message is English, reply ONLY in English.
- Never write a bilingual reply, translation, second version, or mixed-language sentence.
- Use "easy financing options" / "opciones de financiamiento fáciles"
- Use "approval based on qualification" / "aprobación basada en calificación"
- Do not push a call or include the store phone in the first reply
- If asked about financing or an application link, ask for the buyer's phone number first
- NEVER say: guaranteed approval, everyone approved, bad credit, denied, rejected, disqualified
- NEVER promise a loan or specific rate
- NEVER invent price, down payment, vehicle history, or financing terms

Reply format:
- Keep it SHORT — one or two sentences
- Ask only one question at a time
- Follow the current funnel stage exactly and do not add extra steps
- Never refer to the vehicle as "your vehicle", "your car", "tu vehículo", or "tu carro". Always say "the vehicle" / "el vehículo" or use the specific make/model.
`;

export function detectLanguage(text: string): "en" | "es" {
  const spanishWords =
    /[¿¡ñáéíóúü]|\b(hola|gracias|disponible|tengo|quiero|estoy|interesad[oa]s?|claro|podemos|ayuda(?:r|rte)?|inicial|comprar|semana|número|telefono|teléfono|itin|ingresos|esta|está|carro|auto|sí|como|cómo|necesit[ao]|aplicar|requisitos?|documentos?|pasaporte|cuenta|bancaria)\b/i;
  return spanishWords.test(cleanConversationText(text)) ? "es" : "en";
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
  availabilityQuickReplyAccepted: boolean = false,
  lotLocation?: string | null,
): Promise<string> {
  const langNote =
    language === "es"
      ? "The latest buyer message is Spanish. Respond ONLY in Spanish. Do not include English."
      : "The latest buyer message is English. Respond ONLY in English. Do not include Spanish.";

  const storeAddress = resolveStoreAddress(lotLocation);
  const vehicleContext = vehicleTitle
    ? `Vehicle: ${vehicleTitle}${vehicleType ? ` (${vehicleType})` : ""}${publishedDownPayment ? ` — Listed down payment: $${publishedDownPayment.toLocaleString()}` : ""}`
    : "";
  const locationContext = `Dealership address: ${storeAddress}`;

  const history = visibleMessages.slice(-8).join("\n");

  const stage = resolveSalesReplyStage(visibleMessages, currentMessage);
  const stageInstruction = {
    availability: availabilityQuickReplyAccepted
      ? "The affirmative Marketplace availability quick reply was already sent. Ask only whether the buyer is interested in financing."
      : "Confirm availability briefly, then ask whether the buyer is interested in financing.",
    request_phone: "Ask for the buyer's best phone number so the finance team can help. Do not provide the store phone yet.",
    phone_received: `A phone number was provided. Thank the buyer, say the team will call shortly, and optionally offer ${storePhone} as an immediate call option.`,
    address_request: `The buyer is asking for the address or directions. Provide the dealership address and invite them to visit. Do NOT ask clarifying questions.`,
    document_requirements: "The buyer is asking what is needed to apply. Reply with the requirements: ID and an active bank account; passport or Tax ID works. Then continue the flow by asking for the best phone number to help with the application.",
    warranty_info: "The buyer is asking detailed warranty questions. Do not invent warranty terms. Say they can discuss it with an advisor who can confirm the exact warranty and coverage details; then ask for the best phone number.",
    advisor_question: "The buyer is asking a detailed question. Do not invent details. Say they can discuss it with an advisor who can confirm the exact details; then ask for the best phone number.",
    general: "Answer safely using only supplied facts, then move the conversation forward with one short question.",
  }[stage];

  const prompt = `${ALPHA_RULES}

${vehicleContext}
${locationContext}
Current funnel stage: ${stage}
Stage instruction: ${stageInstruction}

Recent conversation:
${history}

Latest buyer message: "${currentMessage}"

${langNote}
Write one short reply that follows the stage instruction exactly. Mention the vehicle naturally.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.choices[0]?.message?.content?.trim();

  if (raw && isAiReplyAligned(raw, stage, storePhone) && isReplyLanguageMirrored(raw, language)) {
    return raw;
  }

  return buildSafeFallbackReply(
    language,
    vehicleTitle,
    storePhone,
    visibleMessages,
    currentMessage,
    availabilityQuickReplyAccepted,
  );
}

async function generateAiReplyWithFallback(
  visibleMessages: string[],
  currentMessage: string,
  language: string,
  vehicleTitle?: string,
  vehicleType?: string,
  publishedDownPayment?: number,
  storePhone: string = DEFAULT_STORE_PHONE,
  availabilityQuickReplyAccepted: boolean = false,
  lotLocation?: string | null,
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
        availabilityQuickReplyAccepted,
        lotLocation,
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
    reply: buildSafeFallbackReply(
      language,
      vehicleTitle,
      storePhone,
      visibleMessages,
      currentMessage,
      availabilityQuickReplyAccepted,
      lotLocation,
    ),
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
    availabilityQuickReplyAccepted,
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
    availabilityQuickReplyAccepted?: boolean;
    timestamp?: string;
  };
  const backendReceivedAt = new Date();
  const messageDetectedAt = parseTimestamp(rawMessageDetectedAt) ?? parseTimestamp(_ts) ?? backendReceivedAt;
  const resolvedSourceUrl = resolveMarketplaceIntakeSourceUrl({
    sourceUrl,
    detectedMarketplaceListingUrl,
    detectedVehicleTitle,
    marketplaceContextDetected,
  });

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
  if (missingContext.length > 0 || !isReliableBuyerName(buyerName) || isBlockedFacebookSurface(resolvedSourceUrl)) {
    const reason = isBlockedFacebookSurface(resolvedSourceUrl)
      ? "blocked_facebook_surface"
      : !isReliableBuyerName(buyerName)
        ? "buyer_name_missing"
        : missingContext[0];
    req.log.info(
      {
        externalThreadRef,
        sourceUrl,
        resolvedSourceUrl,
        buyerName,
        reason,
        missingContext,
        extensionId: extensionId ?? null,
      },
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
  const incomingMsgs = mergeCurrentConversationMessage(parsedMsgs, currentParsed);
  const latestParsed = incomingMsgs[incomingMsgs.length - 1] ?? null;
  const latestBuyerMessage =
    latestParsed?.role === "user"
      ? latestParsed.content
      : [...incomingMsgs].reverse().find((msg) => msg.role === "user")?.content ?? "";
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
  const language = detectLanguage(inbound);
  const parsedDownPayment = parseMoney(marketplaceDownPayment);
  const parsedAskingPrice = parseMoney(marketplaceAskingPrice);

  let vehicleId: number | undefined;
  let listingId: number | undefined;
  let lotLocation: string | null = null;
  let vehicleTitleFromDb: string | undefined;
  let vehicleMatchSource: "marketplace_listing_url" | "detected_vehicle_title" | null = null;

  const [existingConv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.externalThreadRef, externalThreadRef))
    .limit(1);

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
      vehicleMatchSource = "marketplace_listing_url";
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
      vehicleMatchSource = "detected_vehicle_title";
    }
  }

  if (
    existingConv?.vehicleId &&
    vehicleId &&
    vehicleId !== existingConv.vehicleId &&
    vehicleMatchSource !== "marketplace_listing_url"
  ) {
    req.log.warn(
      {
        conversationId: existingConv.id,
        externalThreadRef,
        existingVehicleId: existingConv.vehicleId,
        detectedVehicleId: vehicleId,
        detectedVehicleTitle,
        vehicleMatchSource,
      },
      "Conversation intake preserved existing vehicle binding over unverified DOM title match",
    );
    vehicleId = existingConv.vehicleId;
    listingId = existingConv.listingId ?? undefined;
    lotLocation = null;
    vehicleTitleFromDb = undefined;
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
        sourceUrl: resolvedSourceUrl ?? existingConv.sourceUrl,
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
        sourceUrl: resolvedSourceUrl,
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

  const existingChronological = [...existingMsgs]
    .reverse()
    .filter(isDisplayMessage)
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" as const : "user" as const,
      content: message.content.trim(),
    }));
  const newMessages = findNewConversationMessages(existingChronological, incomingMsgs);
  const conversationHistoryForAi = [...existingChronological, ...newMessages];
  let hasNewBuyerMessage = false;

  for (const msg of newMessages) {
    await db.insert(conversationMessagesTable).values({
      conversationId,
      role: msg.role,
      content: msg.content,
    });
    if (msg.role === "user") hasNewBuyerMessage = true;
  }

  if (!hasNewBuyerMessage) {
    const latestAssistantMessage =
      latestParsed?.role === "user"
        ? existingMsgs.find((message) => message.role === "assistant" && isDisplayMessage(message)) ?? null
        : null;
    const assistantAgeMs = latestAssistantMessage?.createdAt
      ? Date.now() - new Date(latestAssistantMessage.createdAt).getTime()
      : Number.POSITIVE_INFINITY;
    let retryableReply = assistantAgeMs >= MESSENGER_DELIVERY_RETRY_DELAY_MS
      ? latestAssistantMessage?.content ?? null
      : null;
    let retryFallbackUsed = false;
    let retryFallbackReason: string | null = null;
    if (retryableReply && !isReplyLanguageMirrored(retryableReply, language)) {
      const repairedReply = await generateAiReplyWithFallback(
        formatConversationHistoryForAi(conversationHistoryForAi.length ? conversationHistoryForAi : incomingMsgs),
        inbound,
        language,
        resolvedVehicleTitle,
        vehicleType,
        parsedDownPayment,
        storePhone,
        availabilityQuickReplyAccepted === true,
        lotLocation,
      );
      retryableReply = repairedReply.reply;
      retryFallbackUsed = repairedReply.fallbackUsed;
      retryFallbackReason = repairedReply.fallbackReason ?? "stored_reply_language_mismatch";
      if (latestAssistantMessage) {
        await db
          .update(conversationMessagesTable)
          .set({ content: retryableReply })
          .where(eq(conversationMessagesTable.id, latestAssistantMessage.id));
      }
      req.log.info(
        { conversationId, externalThreadRef, language },
        "Conversation intake repaired stored reply language before Messenger delivery retry",
      );
    }
    if (retryableReply) {
      req.log.info(
        { conversationId, externalThreadRef, extensionId: extensionId ?? null, messageHash: messageHash ?? idempotencyKey ?? null },
        "Conversation intake returning existing reply for Messenger delivery retry",
      );
      res.json({
        conversationId,
        suggestedReply: retryableReply,
        deliveryRetry: true,
        language,
        fallbackUsed: retryFallbackUsed,
        fallbackReason: retryFallbackReason,
        timings: {
          messageDetectedAt: messageDetectedAt.toISOString(),
          backendReceivedAt: backendReceivedAt.toISOString(),
          totalResponseMs: Date.now() - messageDetectedAt.getTime(),
        },
      });
      return;
    }
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
  const extractedPhone = extractPhoneNumber(inbound);

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
      formatConversationHistoryForAi(conversationHistoryForAi.length ? conversationHistoryForAi : incomingMsgs),
      inbound,
      language,
      resolvedVehicleTitle,
      vehicleType,
      parsedDownPayment,
      storePhone,
      availabilityQuickReplyAccepted === true,
      lotLocation,
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
        sourceUrl: resolvedSourceUrl ?? existingLead.sourceUrl,
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
        sourceUrl: resolvedSourceUrl,
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

  const secondarySyncs = await Promise.allSettled([
    db
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
      .onConflictDoNothing(),
    syncMarketplaceListingMetrics({
      vehicleId: vehicleId ?? conversation.vehicleId,
      leadQuality: resolvedLeadQuality,
    }),
  ]);
  for (const [index, result] of secondarySyncs.entries()) {
    if (result.status !== "rejected") continue;
    req.log.warn(
      {
        conversationId,
        secondaryTask: index === 0 ? "down_payment_intelligence" : "marketplace_listing_metrics",
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      },
      "Conversation intake secondary sync failed - response preserved",
    );
  }

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
