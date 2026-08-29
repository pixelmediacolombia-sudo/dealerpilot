import { Router } from "express";
import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  db,
  conversationsTable,
  conversationMessagesTable,
  leadsTable,
  downPaymentIntelligenceTable,
  vehiclesTable,
  vehicleImagesTable,
  listingsTable,
  marketplaceListingsTable,
  dealersTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { understandConversationMedia, type ConversationAudio, type ConversationImage } from "../conversations/mediaUnderstanding";
import {
  confirmOutboundDelivery,
  ensureMessengerOutboundSchema,
  findOutboundJobForAssistantMessage,
  queueNormalReply,
} from "../conversations/messengerOutboundQueue";
import {
  buildDownPaymentInstruction,
  formatDownPaymentAmounts,
  getDownPaymentPolicy,
  type DownPaymentPolicy,
} from "../downPayment/policy";
import {
  detectVehicleRequestKind,
  extractCarfaxUrlFromSourceRaw,
  hasConcreteCashOffer,
  hasDownPaymentAmount,
  hasVisitDaySignal,
  hasVehicleValueFact,
  isConciseMarketplaceReply,
  vehicleValueFact,
  type MarketplaceVehicleFacts,
} from "../sofia/marketplaceTone";
import { ALPHA_LOT_MANASSAS, isAlphaManassasVehicle } from "../lib/dealer";
import { vehicleOperationalColumns } from "../lib/vehicleColumns";


const router = Router();

const DEALER_ID = 1;

const DEFAULT_STORE_PHONE = "+1 703-763-4675";
const SALES_AI_REPLY_TIMEOUT_MS = 12000;
// Retry a prepared reply quickly when Facebook did not confirm the first
// composer/send attempt. The extension still deduplicates by message hash, so
// this does not create duplicate AI replies; it only removes the old 2-minute
// dead time between delivery attempts.
const MESSENGER_DELIVERY_RETRY_DELAY_MS = 15000;
const NO_DOWN_PAYMENT_POLICY: DownPaymentPolicy = {
  configId: null,
  planAmounts: [],
  minimumAmount: null,
  vehicleOverride: null,
  source: "none",
};

function resolveStorePhone(lotLocation?: string | null): string {
  void lotLocation;
  return DEFAULT_STORE_PHONE;
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

function normalizeIntentText(value: unknown): string {
  return cleanConversationText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isGroupSystemEventMessage(value: unknown): boolean {
  const text = cleanConversationText(value);
  if (!text || text.length > 160) return false;
  const normalized = normalizeIntentText(text);
  if (!/\b(?:group|chat|grupo|conversaci[oó]n)\b/.test(normalized)) return false;
  const hasAction =
    /(?:added|anadi[oó]|agreg[oó]|removed|elimin[oó]|left|sali[oó]|joined|se\s+uni[oó]|created|cre[oó]|started(?: a)?\s+(?:group|video|audio)|ended\s+(?:group|video|audio)|renamed|cambi[oó]\s+el\s+nombre|invited)\b/.test(normalized);
  if (!hasAction) return false;
  if (/\b(?:message|mensaje|photo|foto|photo\s+chat)\b/.test(normalized)) return false;
  return /to\s+the\s+group\b|from\s+the\s+group\b|the\s+group\b|(?:group|video|audio)\s+call\b|\bal\s+grupo\b|\bdel\s+grupo\b|\bel\s+grupo\b/.test(normalized);
}

function isUiConversationText(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[.。:;,\-–—]+$/g, "").trim();
  if (!normalized) return true;
  if (isGroupSystemEventMessage(value)) return true;
  if (UI_MESSAGE_TEXT.has(normalized)) return true;
  if (isParticipantLabelText(value)) return true;
  if (/^(enter|escape|tab|shift|control|option|command|alt)\b/i.test(normalized)) return true;
  if (/^(write to|saved|compose|mute|search|customize chat|chat members|mark as pending|more options|say something about this|anyone can|this group consist)\b/i.test(normalized)) return true;
  if (/^(older listings will be deleted|high net cars available|recent media|see all)\b/i.test(normalized)) return true;
  if (/^\d{1,2}:\d{2}\s*(am|pm)$/i.test(normalized)) return true;
  if (/^marketplace\s+\$?[\d,]+/i.test(normalized)) return true;
  if (/^[a-z][\w .'-]{1,60}\s+-\s+(19|20)\d{2}\s+/i.test(normalized)) return true;
  if (/^[A-Z][A-Za-zÀ-ÿ'’-]+(?:\s+[A-Z][A-Za-zÀ-ÿ'’-]+){1,2}$/.test(value.trim())) return true;
  return false;
}

function isParticipantLabelText(value: string): boolean {
  const normalized = normalizeIntentText(value);
  return /^[\p{L}\p{N}][\p{L}\p{N}\s.'’_-]{1,100}\s*(?:\u00b7|\u2022|\|)\s*(?:buyer|seller|participant|miembro|comprador|vendedor)$/u.test(normalized);
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
  | "open_question"
  | "availability"
  | "interest_confirmation"
  | "interest_declined"
  | "store_phone_requested"
  | "vehicle_link_request"
  | "carfax_request"
  | "price_inquiry"
  | "down_payment_request"
  | "down_payment_low"
  | "down_payment_declined"
  | "timeline_request"
  | "timeline_received"
  | "timeline_declined"
  | "documents_request"
  | "documents_declined"
  | "qualified_exit"
  | "financing_intro"
  | "financing_declined"
  | "cash_visit_request_phone"
  | "urgent_vehicle_request_phone"
  | "stalled_conversation_request_phone"
  | "salesperson_request_phone"
  | "request_phone"
  | "phone_received"
  | "address_request"
  | "inventory_options"
  | "document_requirements"
  | "clean_title"
  | "clean_title_and_warranty"
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

function extractDownPaymentAmount(text: string): number | null {
  const normalized = normalizeIntentText(text);
  // Buyers commonly answer the down-payment question with only "$3k", "2K", etc.
  // The preceding dealer turn supplies the context, so do not require a keyword
  // in the buyer's short amount-only reply.
  const standaloneKAmount = /^\s*\$?\d{1,2}(?:\.\d+)?\s*k\s*$/i.test(normalized);
  const hasDownContext = standaloneKAmount || /down|enganche|inicial|cash|contado|efectivo|available|disponible|have|tengo|cuento|can put|puedo dar|puedo poner/.test(normalized);
  if (!hasDownContext) return null;
  const withoutPhoneNumber = normalized.replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, " ");
  const numericMatch = withoutPhoneNumber.match(/(?:\$|usd\s*)?\s*(\d{1,2}(?:[,.]\d{3})?|\d{3,5})(?:\s*(?:k|mil|thousand))?/i);
  if (numericMatch?.[1]) {
    const raw = numericMatch[1].replace(/,/g, "");
    const amount = Number(raw);
    if (Number.isFinite(amount)) {
      const suffix = numericMatch[0].toLowerCase();
      return Math.round(suffix.includes("k") || suffix.includes("thousand") ? amount * 1000 : amount);
    }
  }
  const wordAmounts: Array<[RegExp, number]> = [
    [/one thousand|mil/, 1000],
    [/two thousand|dos mil/, 2000],
    [/three thousand|tres mil/, 3000],
  ];
  return wordAmounts.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

function historyHasBuyerPhone(visibleMessages: string[]): boolean {
  return visibleMessages
    .map(parseConversationMessage)
    .some((message) => message?.role === "user" && hasPhoneNumber(message.content));
}

function historyContainsDealerPrompt(visibleMessages: string[], pattern: RegExp): boolean {
  return visibleMessages
    .map(parseConversationMessage)
    .some((message) => message?.role === "assistant" && pattern.test(normalizeIntentText(message.content)));
}

function buyerAcceptedInterest(value: string): boolean {
  return /\b(?:yes|yeah|yep|sure|okay|ok|interested|i am interested|me interesa|estoy interesado|estoy interesada|si|s[ií]|claro|por supuesto)\b/i.test(normalizeIntentText(value));
}

function buyerAcceptedMinimumDown(value: string): boolean {
  return buyerAcceptedInterest(value) || /\b(?:puedo|tengo|cuento|conseguir[eé]|reach|can do|i have)\b/i.test(normalizeIntentText(value));
}

function buyerAcceptedCashPurchase(value: string): boolean {
  const normalized = normalizeIntentText(value);
  if (/\b(?:no cash|not cash|don't have cash|do not have cash|no tengo efectivo|no cuento con efectivo|no puedo pagar en efectivo|no puedo pagar de contado)\b/i.test(normalized)) {
    return false;
  }
  return /\b(?:cash|cash buyer|pay cash|paying cash|buy cash|pay in cash|contado|de contado|pagar(?:[eé])? en efectivo|pago en efectivo|efectivo)\b/i.test(normalized);
}

function buyerDeclinedCurrentStep(value: string): boolean {
  return /\b(?:no|nope|nah|not interested|don't|do not|no tengo|no cuento|me falta|todavia no|aun no|no puedo|no puedo contar|not yet|cannot|can't)\b/i.test(normalizeIntentText(value));
}

function buyerAcceptedTimeline(value: string): "this_week" | "this_month" | null {
  const normalized = normalizeIntentText(value);
  if (/\b(?:this week|esta semana|ahora|ahorita|immediately|right away|today|tomorrow|hoy|manana|next few days|within a week|in a week|in 1 week|en una semana|en 1 semana|dentro de una semana|esta quincena)\b/.test(normalized)) return "this_week";
  if (/\b(?:this month|este mes|within the month|en el mes|later this month|by month end|in 10 days|in 14 days|in 15 days|in 20 days|in 21 days|in 30 days|in two weeks|in 2 weeks|in three weeks|in 3 weeks|in a couple of weeks|in a few weeks|in a month|in one month|next month|following month|the other month|another month|el otro mes|otro mes|el mes que viene|el mes siguiente|el proximo mes|el próximo mes|dentro de un mes|en un mes|en un par de semanas|en unas semanas|en 15 dias|en 15 días|en dos semanas|en 2 semanas|en tres semanas|en 3 semanas|dentro de 15 dias|dentro de 15 días|soon|as soon as possible|asap|later|when i get paid|after payday|pronto|lo antes posible|cuando cobre|cuando me paguen)\b/.test(normalized)) return "this_month";
  if (/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/.test(normalized)) return "this_month";
  if (/\b(?:in|en|within|dentro de|para|by|next|coming|following|otro|proximo|pr[oó]ximo|que viene)\b[\s\w,.-]{0,32}\b(?:day|days|dia|dias|d[ií]a|d[ií]as|week|weeks|semana|semanas|month|months|mes|meses)\b/.test(normalized)) return "this_month";
  return null;
}

function buyerDocumentStatus(value: string): { hasId: boolean; hasProofOfIncome: boolean } | null {
  const normalized = normalizeIntentText(value);
  const negative = /\b(?:no|no tengo|no cuento|me falta|todavia no|aun no|don't have|do not have|not yet)\b/.test(normalized);
  const mentionsId = /\b(?:id|identificacion|identification|tax id|itin|passport|pasaporte)\b/.test(normalized);
  const mentionsIncome = /\b(?:proof of income|income proof|comprobante de ingresos|prueba de ingresos|talones|pay stubs|paystubs|ingresos)\b/.test(normalized);
  if (!mentionsId && !mentionsIncome && !/\b(?:yes|si|sí|tengo|cuento|i have|i do)\b/.test(normalized)) return null;
  if (negative) return { hasId: false, hasProofOfIncome: false };
  return { hasId: mentionsId || /\b(?:yes|si|sí|tengo|cuento|i have|i do)\b/.test(normalized), hasProofOfIncome: mentionsIncome || /\b(?:yes|si|sí|tengo|cuento|i have|i do)\b/.test(normalized) };
}

function extractBuyerQualification(messages: ParsedConversationMessage[]): {
  downPayment: number | null;
  timeline: "this_week" | "this_month" | null;
  documents: { hasId: boolean; hasProofOfIncome: boolean } | null;
} {
  let downPayment: number | null = null;
  let timeline: "this_week" | "this_month" | null = null;
  let documents: { hasId: boolean; hasProofOfIncome: boolean } | null = null;
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    if (downPayment === null) downPayment = extractDownPaymentAmount(message.content);
    if (timeline === null) timeline = buyerAcceptedTimeline(message.content);
    if (documents === null) documents = buyerDocumentStatus(message.content);
  }
  return { downPayment, timeline, documents };
}

function buyerRequestedStorePhone(text: string): boolean {
  const normalized = normalizeIntentText(text);
  return /\b(?:send|give|share|text|whats|what is|can i have|may i have|call)\b[\s\S]{0,32}\b(?:your|the|dealer(?:ship)?s?|store|alpha(?: motorsports)?)?[\s\S]{0,16}\b(?:phone|number|telephone)\b/.test(normalized) ||
    /\b(?:mandame|mandeme|envia(?:me)?|dame|compart(?:e|eme)|cual es|cual|me das|pasame|paseme)\b[\s\S]{0,32}\b(?:su|el|del|de la|de alpha)?[\s\S]{0,16}\b(?:telefono|numero)\b/.test(normalized) ||
    /\b(?:quiero|necesito|puedo tener)\b[\s\S]{0,32}\b(?:el|su|tu)\s+(?:telefono|numero)\b/.test(normalized);
}

function historyAskedAboutFinancing(history: string): boolean {
  return /\b(?:dealer|dealerpilot ai|assistant):[\s\S]{0,240}\b(?:financing|finance|financiamiento|financiar|opciones de financiamiento)\b/i.test(history);
}

function historyGaveFinancingRequirements(history: string): boolean {
  return /\b(?:dealer|dealerpilot ai|assistant):[\s\S]{0,360}\b(?:id|tax\s*id|passport|pasaporte)[\s\S]{0,180}\b(?:bank account|cuenta bancaria|cuenta de banco)\b/i.test(history);
}

function historyRequestedPhone(history: string): boolean {
  return /\b(?:dealer|dealerpilot ai|assistant):[\s\S]{0,280}\b(?:best phone number|phone number|n[uú]mero de tel[eé]fono|tel[eé]fono)\b/i.test(history);
}

function historyAskedCashOrVisit(history: string): boolean {
  return /\b(?:dealer|dealerpilot ai|assistant):[\s\S]{0,320}\b(?:purchase cash|pay cash|cash purchase|come see|visit|venir a ver|comprar de contado|pagar en efectivo)\b/i.test(history);
}

function historyShowsFinancingDeclined(history: string): boolean {
  return /\b(?:buyer|comprador):[\s\S]{0,180}\b(?:no financing|no finance|cash buyer|pay(?:ing)? cash|no necesito financiamiento|no quiero financiamiento|no me interesa financiar|contado|efectivo)\b/i.test(history);
}

function buyerRequestedVisitOrTestDrive(latest: string): boolean {
  return /\b(?:test drive|take (?:it|the vehicle) for a drive|drive it|come see|come by|stop by|visit|appointment|cita|prueba de manejo|probarlo|manejarlo|venir a verlo|visitar)\b/i.test(normalizeIntentText(latest)) || hasVisitDaySignal(latest);
}

function buyerDeclinedFinancing(latest: string, history: string): boolean {
  const normalized = normalizeIntentText(latest);
  if (historyAskedCashOrVisit(history)) return false;
  const financingContext = historyAskedAboutFinancing(history) ||
    /\b(?:financ(?:e|ing)?|loan|payment plan|financiar|financiamiento|credito)\b/i.test(normalized);
  if (!financingContext) return false;
  return /\b(?:no|nope|nah|not interested|not looking|not needed|don'?t need|do not need|don'?t want|do not want|no financing|cash buyer|pay(?:ing)? cash|cash|efectivo|contado|no necesito|no quiero|no me interesa|no estoy interesad[oa])\b/i.test(normalized);
}

function buyerAcceptedCashOrVisitStep(latest: string): boolean {
  const normalized = normalizeIntentText(latest);
  return /\b(?:cash|pay(?:ing)? cash|cash buyer|come see|visit|stop by|appointment|cita|efectivo|contado|venir (?:a |al |a ver|al lot|a la )(?:ver|comprar|contado)|visitar|verlo|ver el|dar una vuelta|pasar por|passe? por|show up)\b/i.test(normalized) ||
    /\b(?:si|s[ií]|yes|yeah|yep|sure|ok|okay|claro|vamos|hagamos|adelante|dale)\b/i.test(normalized) && /\b(?:visita|visitar|venir|venir|comprar|contado|cash|efectivo|lot|dealer|cita)\b/i.test(normalized);
}

function buyerAcceptedFinancingStep(latest: string): boolean {
  return /\b(?:yes|yeah|yep|sure|ok|okay|interested|i am|i'm|trade|trade-in|trade in|make this work|how can we make this work|next step|what next|si|s[ií]|claro|me interesa|hagamos|como hacemos|c[oó]mo hacemos)\b/i.test(latest);
}

function buyerConfirmedRequirements(latest: string): boolean {
  return /\b(?:yes|yeah|yep|sure|ok|okay|i have|i do|got it|ready|next step|what next|si|s[ií]|claro|tengo|cuento|listo|perfecto|lo tengo|los tengo|siguiente|aplicar)\b/i.test(latest);
}

function buyerLacksRequirements(latest: string): boolean {
  return /\b(?:no tengo|no cuento|no poseo|me falta|me faltan|no tengo id|no tengo pasaporte|no tengo tax id|no tengo cuenta|i don'?t have|i do not have|don'?t have|dont have|not yet|todav[ií]a no|todavia no|no tengo los|aun no los tengo|a[uú]n no los tengo)\b/i.test(normalizeIntentText(latest));
}

function buyerAskedDocumentRequirements(latest: string): boolean {
  return /\b(?:q|que|qu[eé]|what).{0,50}(?:necesit|need|required|requisit|document).{0,140}(?:aplicar|apply|application|financ|finance|financing)?\b/i.test(latest) ||
    /\b(?:requisitos?|requirements?|documentos?|documents?).{0,140}(?:aplicar|apply|application|financ|finance|financing)\b/i.test(latest) ||
    /\b(?:pasaporte|passport|tax\s*id|itin|identificaci[oó]n|id|cuenta bancaria|bank account).{0,140}(?:aplicar|apply|application|financ|finance|financing|necesit|need|required)\b/i.test(latest);
}

function buyerAskedPriceInquiry(latest: string): boolean {
  return /\b(?:price|precio|cash price|precio cash|cu[aá]nto cuesta|cuanto cuesta|how much|what(?:'s| is).{0,40}price|valor)\b/i.test(latest);
}

function buyerAskedInventoryOptions(latest: string): boolean {
  return /\b(?:tiene(?:n)?|hay|tendrian|manejan|ofrecen).{0,60}(?:mas|otros?|otras?|opciones?|disponibles?)\b/i.test(latest) ||
    /\b(?:mas|otros?|otras?|opciones?|disponibles?).{0,60}(?:tiene(?:n)?|hay|manejan|ofrecen)\b/i.test(latest) ||
    /\b(?:solo eso|solamente eso|nada mas|alguno mas|alguna mas|otro similar|otra opcion|otras opciones|more available|more options|other options|anything else|only that|only this|similar options)\b/i.test(latest);
}

function buyerAskedDetailedVehicleInfo(latest: string): boolean {
  return /\b(?:price|precio|cash|efectivo|miles|millas|odometer|payment|pago|cuota|down payment|inicial|historial|history|accident|accidente|condition|condici[oó]n|warranty|garant[ií]a|deductible|deducible|coverage|cobertura)\b/i.test(latest);
}

function buyerAskedCleanTitle(latest: string): boolean {
  return /\b(?:clean\s+title|clear\s+title|titulo\s+limpio|t[ií]tulo\s+limpio)\b/i.test(latest);
}

function buyerAskedCleanTitleAndWarranty(latest: string): boolean {
  return buyerAskedCleanTitle(latest) && buyerAskedWarrantyInfo(latest);
}

function buyerAskedWarrantyInfo(latest: string): boolean {
  return /\b(?:warranty|garant[ií]a|deductible|deducible|certif(?:ied|ication)|certificad[oa]|engine|motor|transmission|transmisi[oó]n|mechanic|mec[aá]nico|repair|reparaci[oó]n|third-party|dealership|included|cover|days|miles|mill?as)\b/i.test(latest);
}

function buyerAskedAdvisorQuestion(latest: string): boolean {
  return /[?¿]/.test(latest) ||
    /^(?:what|how|when|where|why|can|could|do|does|did|is|are|will|would|cu[aá]l|c[oó]mo|cu[aá]ndo|d[oó]nde|por qu[eé]|puede|pueden|tiene|tienen|hay|es|est[aá])\b/i.test(latest);
}

function hasPersistentUnansweredBuyerTurns(
  visibleMessages: string[],
  currentMessage: string,
): boolean {
  const parsed = visibleMessages
    .slice(-12)
    .map(parseConversationMessage)
    .filter((message): message is ParsedConversationMessage => message !== null);
  const current = parseConversationMessage(`Buyer: ${currentMessage}`);
  const chronological = mergeCurrentConversationMessage(parsed, current);
  const consecutiveBuyerMessages: ParsedConversationMessage[] = [];
  for (let index = chronological.length - 1; index >= 0; index -= 1) {
    const message = chronological[index];
    if (message.role === "assistant") break;
    consecutiveBuyerMessages.unshift(message);
  }
  return consecutiveBuyerMessages.length >= 3;
}

function buyerHasOpenQuestion(latest: string): boolean {
  if (!buyerAskedAdvisorQuestion(latest)) return false;
  if (buyerRequestedStorePhone(latest)) return false;
  if (detectVehicleRequestKind(latest)) return false;
  if (/\b(?:is (?:it|this|the .+?) (?:still )?available|still available|sigue disponible|esta disponible|est[aá] (?:a la venta|en venta)|lo tiene disponible|lo tienen disponible|tienen este|hay alguno disponible|lo venden aun|lo siguen vendiendo|a[uú]n lo tienen)\b/i.test(latest)) return false;
  if (buyerAskedDocumentRequirements(latest)) return false;
  if (/\b(?:address|location|directions|direccion|ubicacion|donde queda|como llegar|visitar|visit the lot|come see|stop by|come by|maps?)\b/i.test(latest)) return false;
  return true;
}

function buyerMovesConversationForward(value: string): boolean {
  const normalized = cleanConversationText(value);
  return hasPhoneNumber(normalized) ||
    buyerRequestedStorePhone(normalized) ||
    buyerRequestedVisitOrTestDrive(normalized) ||
    buyerAcceptedCashOrVisitStep(normalized) ||
    buyerClearlyAdvancesFinancing(normalized);
}

function buyerClearlyAdvancesFinancing(value: string): boolean {
  const normalized = normalizeIntentText(value);
  if (!normalized || /[?¿]/.test(value)) return false;
  return /^(?:yes|yeah|yep|sure|okay|ok|si|claro|perfecto|listo)\b/.test(normalized) ||
    /\b(?:i am|im|i'm|estoy|me encuentro)\s+(?:interested|ready|listo|interesad[oa])\b/.test(normalized) ||
    /\b(?:want|quiero|deseo)\s+(?:to )?(?:finance|apply|financiar|aplicar)\b/.test(normalized) ||
    /\b(?:ready to apply|listo para aplicar|next step|siguiente paso|how can we make this work|como hacemos para hacerlo)\b/.test(normalized) ||
    /\b(?:i have|tengo|cuento con)\b[\s\S]{0,80}\b(?:id|passport|tax id|bank account|cuenta bancaria)\b/.test(normalized);
}

function buyerExplicitlyDisengages(value: string): boolean {
  return /\b(?:not interested|no thanks|don't contact|do not contact|stop messaging|goodbye|bye)\b/i.test(value) ||
    /\b(?:no me interesa|no gracias|no me contacten|deja de escribir|adi[oó]s|chao)\b/i.test(value);
}

function hasStalledConversation(
  visibleMessages: string[],
  currentMessage: string,
): boolean {
  const parsed = visibleMessages
    .slice(-12)
    .map(parseConversationMessage)
    .filter((message): message is ParsedConversationMessage => message !== null);
  const current = parseConversationMessage(`Buyer: ${currentMessage}`);
  const chronological = mergeCurrentConversationMessage(parsed, current);

  let hasDealerReply = false;
  let stalledBuyerTurns = 0;
  for (const message of chronological) {
    if (message.role === "assistant") {
      hasDealerReply = true;
      continue;
    }
    if (!hasDealerReply) continue;
    if (buyerMovesConversationForward(message.content)) {
      stalledBuyerTurns = 0;
      continue;
    }
    stalledBuyerTurns += 1;
  }

  return hasDealerReply &&
    stalledBuyerTurns >= 2 &&
    !buyerExplicitlyDisengages(currentMessage);
}

function isTerminalBuyerAcknowledgement(value: string): boolean {
  const normalized = cleanConversationText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:(?:ok|okay|perfecto|listo|esta bien|todo bien)\s+)?(?:gracias|muchas gracias)$/.test(normalized) ||
    /^(?:(?:ok|okay|perfect|got it|all right)\s+)?(?:thanks|thank you)$/.test(normalized);
}

function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function replyIncludesStorePhone(reply: string, storePhone: string): boolean {
  const replyDigits = normalizePhoneDigits(reply);
  const storeDigits = normalizePhoneDigits(storePhone);
  return storeDigits.length > 0 && replyDigits.includes(storeDigits);
}

function stageRequiresStorePhone(stage: SalesReplyStage): boolean {
  return stage === "store_phone_requested" ||
    stage === "cash_visit_request_phone" ||
    stage === "urgent_vehicle_request_phone" ||
    stage === "stalled_conversation_request_phone" ||
    stage === "salesperson_request_phone";
}

function isConversationClosingBuyerAcknowledgement(value: string): boolean {
  const normalized = cleanConversationText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /\b(?:not interested|no thanks|do not contact|stop messaging|goodbye|bye)\b/.test(normalized) ||
    /\b(?:no me interesa|ya no estoy interesado|no gracias|no me contacten|deja de escribir|adios|chao)\b/.test(normalized);
}

function isTerminalConversationStatus(status: string | null | undefined): boolean {
  const normalized = cleanConversationText(status || "").toLowerCase();
  // BDC Assigned is a lead handoff state, not a completed conversation. The
  // buyer must still be able to answer the remaining qualification questions.
  return new Set(["closed", "sold", "lost"]).has(normalized);
}

function historyHasDealerReply(visibleMessages: string[]): boolean {
  return visibleMessages.some((message) =>
    /^(?:Dealer|DealerPilot AI|Assistant):/i.test(cleanConversationText(message)),
  );
}

function isFirstDealerReply(visibleMessages: string[]): boolean {
  return !historyHasDealerReply(visibleMessages);
}

function replyHasFirstGreeting(reply: string): boolean {
  const normalized = normalizeIntentText(reply);
  return /\b(?:hello|hola)\b/.test(normalized) && /\balpha\b/.test(normalized);
}

function withFirstReplyGreeting(reply: string, language: string, firstDealerReply: boolean): string {
  const cleaned = reply.trim();
  const isStorePhoneClosingReply = /^(?:con gusto|of course),?\s+(?:nuestro|our)\s+(?:n[uú]mero|number)\b/i.test(cleaned);
  if (!firstDealerReply || replyHasFirstGreeting(cleaned) || isStorePhoneClosingReply) return cleaned;
  return language === "es"
    ? `Hola, somos Alpha Motorsports. ${cleaned}`
    : `Hello, this is Alpha Motorsports. ${cleaned}`;
}

function configuredDownPaymentLabel(policy: DownPaymentPolicy, language: "en" | "es"): string {
  if (policy.vehicleOverride != null) return `$${policy.vehicleOverride.toLocaleString("en-US")}`;
  return formatDownPaymentAmounts(policy.planAmounts, language);
}

function downPaymentRequestReply(language: "en" | "es", policy: DownPaymentPolicy): string {
  const label = configuredDownPaymentLabel(policy, language);
  if (!label) {
    return language === "es"
      ? "¿Con cuánto cuentas para el enganche?"
      : "How much do you have available for the down payment?";
  }
  return language === "es"
    ? `Tenemos planes desde ${label} de down payment. ¿Con cuánto cuentas para el enganche?`
    : `We have plans starting at ${label} down. How much do you have available for the down payment?`;
}

function downPaymentLowReply(language: "en" | "es", policy: DownPaymentPolicy): string {
  if (policy.minimumAmount == null) return downPaymentRequestReply(language, policy);
  const minimum = `$${policy.minimumAmount.toLocaleString("en-US")}`;
  return language === "es"
    ? `Gracias por decírmelo. Actualmente necesitamos al menos ${minimum} de down payment. ¿Podrías contar con ${minimum} o más?`
    : `Thanks for letting me know. We currently require at least ${minimum} down. Would you be able to have ${minimum} or more?`;
}

function downPaymentDeclinedReply(language: "en" | "es", policy: DownPaymentPolicy): string {
  if (policy.minimumAmount == null) return language === "es"
    ? "Entiendo, gracias por tu interés. Cuando estés listo para continuar, aquí estaremos para ayudarte. ¡Que tengas un buen día!"
    : "I understand, and I appreciate your interest. When you are ready to continue, we will be here to help. Have a great day!";
  const minimum = `$${policy.minimumAmount.toLocaleString("en-US")}`;
  return language === "es"
    ? `Entiendo, gracias por tu interés. Actualmente necesitamos al menos ${minimum} de down payment para avanzar. Cuando cuentes con esa cantidad, estaremos aquí para ayudarte. ¡Que tengas un buen día!`
    : `I understand, and I appreciate your interest. We currently need at least ${minimum} down to move forward. Please reach out when you have that amount. Have a great day!`;
}

function replyGivesRestrictedVehicleDetails(reply: string): boolean {
  const normalized = cleanConversationText(reply).toLowerCase();
  return /\$\s*\d/.test(normalized) ||
    /\b(?:price|precio|mileage|millaje|millas|miles|down payment|inicial)\b.{0,24}\b\d[\d,]*(?:\s*(?:mi|miles|millas))?\b/i.test(normalized) ||
    /\b\d[\d,]*\s*(?:mi|miles|millas)\b/i.test(normalized);
}

function downPaymentAmountsMentioned(reply: string): number[] {
  const withoutPhones = reply.replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, " ");
  const values: number[] = [];
  for (const match of withoutPhones.matchAll(/\$?\s*(\d{1,3}(?:,\d{3})?|\d{1,5}(?:\.\d+)?)\s*(k|thousand|mil)?/gi)) {
    const amount = Number(match[1]?.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const suffix = (match[2] ?? "").toLowerCase();
    values.push(Math.round(amount * (suffix === "k" || suffix === "thousand" || suffix === "mil" ? 1000 : 1)));
  }
  return values;
}

function replyUsesOnlyConfiguredDownPayments(reply: string, policy: DownPaymentPolicy): boolean {
  const normalized = cleanConversationText(reply).toLowerCase();
  const allowed = new Set(
    (policy.vehicleOverride != null ? [policy.vehicleOverride] : policy.planAmounts)
      .filter((amount) => Number.isInteger(amount) && amount > 0),
  );
  const downPaymentMatch = /\b(?:down|down payment|plans?|planes?|enganche|inicial|minimum|at least|more than|al menos|m[aá]s de)\b/i;
  if (!downPaymentMatch.test(normalized)) return true;
  const values = downPaymentAmountsMentioned(normalized);
  return values.every((amount) => allowed.has(amount));
}

function resolveSalesReplyStage(
  visibleMessages: string[],
  currentMessage: string,
  downPaymentPolicy: DownPaymentPolicy = NO_DOWN_PAYMENT_POLICY,
): SalesReplyStage {
  const latest = cleanConversationText(currentMessage).toLowerCase();
  const latestIntent = normalizeIntentText(currentMessage);
  const history = visibleMessages.slice(-8).map(cleanConversationText).join(" ").toLowerCase();
  const buyerPhoneAlreadyKnown = historyHasBuyerPhone(visibleMessages);
  const askedForBuyerPhone = historyContainsDealerPrompt(visibleMessages, /best phone number|phone number|numero de telefono|n[uú]mero de tel[eé]fono/);
  const askedForDownPayment = historyContainsDealerPrompt(visibleMessages, /down payment|down|enganche|inicial/);
  const askedForTimeline = historyContainsDealerPrompt(visibleMessages, /this week|this month|esta semana|este mes|when.*buy|cuando.*compr/);
  const askedForDocuments = historyContainsDealerPrompt(visibleMessages, /proof of income|income proof|prueba de ingresos|comprobante de ingresos|identification|identificacion|tax id|pasaporte|bank account|cuenta bancaria/);
  const vehicleRequest = detectVehicleRequestKind(latest);
  if (vehicleRequest === "photos") return "vehicle_link_request";
  if (vehicleRequest === "carfax") return "carfax_request";
  if (buyerAskedCleanTitleAndWarranty(latest)) return "clean_title_and_warranty";
  if (buyerHasOpenQuestion(latest)) return "open_question";
  if (buyerRequestedStorePhone(latest)) return "store_phone_requested";
  if (hasPhoneNumber(latest) && !buyerPhoneAlreadyKnown) return "phone_received";
  if (askedForDocuments) {
    const documentStatus = buyerDocumentStatus(latest);
    if (documentStatus && (!documentStatus.hasId || !documentStatus.hasProofOfIncome)) return "documents_declined";
    if (buyerDeclinedCurrentStep(latest)) return "documents_declined";
    if (documentStatus) return "qualified_exit";
    return "documents_request";
  }
  if (askedForTimeline) {
    if (buyerAcceptedTimeline(latest)) return "timeline_received";
    if (buyerDeclinedCurrentStep(latest)) return "timeline_declined";
    return "timeline_request";
  }
  if (hasVisitDaySignal(latest)) return "cash_visit_request_phone";
  if (askedForDownPayment) {
    if (buyerAcceptedCashPurchase(latest)) return "timeline_request";
    const amount = extractDownPaymentAmount(latest);
    if (amount !== null && downPaymentPolicy.minimumAmount != null) {
      return amount < downPaymentPolicy.minimumAmount ? "down_payment_low" : "timeline_request";
    }
    if (buyerDeclinedCurrentStep(latest)) return "down_payment_declined";
    return "down_payment_request";
  }
  if (buyerPhoneAlreadyKnown && (askedForBuyerPhone || historyContainsDealerPrompt(visibleMessages, /interested|interesado|interesada/))) return "down_payment_request";
  if (
    historyRequestedPhone(history) &&
    (buyerAskedPriceInquiry(latest) || buyerAskedDetailedVehicleInfo(latest) || buyerAskedWarrantyInfo(latest) || buyerAskedAdvisorQuestion(latest))
  ) {
    return "salesperson_request_phone";
  }
  if (hasStalledConversation(visibleMessages, currentMessage)) return "stalled_conversation_request_phone";
  if (buyerRequestedVisitOrTestDrive(latest) && (historyAskedCashOrVisit(history) || historyShowsFinancingDeclined(history))) {
    return "cash_visit_request_phone";
  }
  if (historyAskedCashOrVisit(history) && buyerAcceptedCashOrVisitStep(latest)) {
    return "cash_visit_request_phone";
  }
  if (buyerAskedDocumentRequirements(latest)) return "document_requirements";
  if (buyerAskedPriceInquiry(latest)) return "price_inquiry";
  if (buyerAskedInventoryOptions(latestIntent)) return "inventory_options";
  if (historyContainsDealerPrompt(visibleMessages, /interested|interesado|interesada/) && buyerAcceptedInterest(latest)) return "timeline_request";
  if (historyContainsDealerPrompt(visibleMessages, /interested|interesado|interesada/) && buyerDeclinedCurrentStep(latest)) return "interest_declined";
  if (/\b(is (?:it|this|the .+?) (?:still )?available|still available|sigue disponible|esta disponible|está disponible|esta(?:n)? (?:a la venta|en venta)|lo tiene disponible|lo tienen disponible|lo tienes disponible|tienen este|tienen esa|tienen ese (?:vehiculo|carro|auto|car|suv|camioneta)|tienen este (?:vehiculo|carro|auto|car|suv|camioneta)|hay alguno disponible|lo venden aun|lo siguen vendiendo|aun lo tienen|a[uú]n lo tienen)\b/i.test(latest)) {
    return "availability";
  }
  if (buyerAskedCleanTitle(latest)) return "clean_title";
  if (
    /\b(direccion|address|ubicacion|location|donde esta(?:n|s)?|donde queda|donde se encuentra|ubicad[oa]s?|where are you|where (?:is|are).{0,40}located|where is (?:the )?(?:dealer|dealership|lot)|como llegar|how (?:do )?i get|esta en|store address|concesionario|lot location|physical address|visitar|visit the lot|come see|stop by|come by|directions|mapa|maps|google maps)\b/i.test(latestIntent)
  ) {
    return "address_request";
  }
  if (buyerAskedWarrantyInfo(latest)) return "warranty_info";
  if (buyerAskedAdvisorQuestion(latest)) return "advisor_question";
  if (historyAskedCashOrVisit(history)) return "cash_visit_request_phone";
  if (historyRequestedPhone(history)) return "request_phone";
  if (!/\b(?:Dealer|DealerPilot AI|Assistant):/i.test(history)) return "availability";
  return "general";
}

function resolveStoreAddress(lotLocation?: string | null): string {
  void lotLocation;
  return "9120 Euclid Ave, Manassas, VA 20110";
}

function buildBaseSafeFallbackReply(
  language: string,
  vehicleTitle?: string,
  storePhone: string = DEFAULT_STORE_PHONE,
  visibleMessages: string[] = [],
  currentMessage: string = "",
  availabilityQuickReplyAccepted: boolean = false,
  lotLocation?: string | null,
  downPaymentPolicy: DownPaymentPolicy = NO_DOWN_PAYMENT_POLICY,
): string {
  const vehicle = vehicleTitle ?? (language === "es" ? "el vehículo" : "the vehicle");
  const stage = resolveSalesReplyStage(visibleMessages, currentMessage, downPaymentPolicy);
  const storeAddress = resolveStoreAddress(lotLocation);
  if (language === "es") {
    if (stage === "open_question") {
      return `Buena pregunta. No tengo ese detalle confirmado sobre el ${vehicle}; puedo verificarlo. ¿Qué te gustaría saber?`;
    }
    if (stage === "vehicle_link_request") {
      return "La ficha del vehículo no está disponible en el feed todavía; puedo verificarla.";
    }
    if (stage === "carfax_request") {
      return "No tengo aquí un reporte Carfax identificado para este VIN; el vendedor te lo puede enviar.";
    }
    if (stage === "store_phone_requested") {
      return `Con gusto, nuestro número es ${storePhone}. Quedamos atentos.`;
    }
    if (stage === "phone_received") {
      return `¡Gracias! Ya tengo tu número. ${downPaymentRequestReply("es", downPaymentPolicy)}`;
    }
    if (stage === "interest_confirmation") {
      return `Sí, el ${vehicle} está disponible. ¿Te queda mejor un día entre semana o el fin de semana?`;
    }
    if (stage === "interest_declined") {
      return "Entiendo, gracias por tu tiempo. Si cambias de opinión, aquí estaremos para ayudarte. ¡Que tengas un buen día!";
    }
    if (stage === "down_payment_request") {
      return downPaymentRequestReply("es", downPaymentPolicy);
    }
    if (stage === "down_payment_low") {
      return downPaymentLowReply("es", downPaymentPolicy);
    }
    if (stage === "down_payment_declined") {
      return downPaymentDeclinedReply("es", downPaymentPolicy);
    }
    if (stage === "timeline_request") {
      return "Perfecto. ¿Qué te queda mejor: un día entre semana o el fin de semana?";
    }
    if (stage === "timeline_received") {
      return "Perfecto. ¿A qué número te llama el vendedor para confirmarte la hora?";
    }
    if (stage === "timeline_declined") {
      return "Entiendo. En este momento estamos atendiendo a quienes planean comprar esta semana o este mes. Cuando estés listo, con gusto te ayudamos. ¡Que tengas un buen día!";
    }
    if (stage === "documents_request") {
      return "Para avanzar necesitamos una identificación vigente y comprobante de ingresos. ¿Cuentas con ambos?";
    }
    if (stage === "documents_declined") {
      return "Entiendo. Actualmente estamos pidiendo identificación y comprobante de ingresos para avanzar. Cuando los tengas, con gusto te ayudamos. ¡Que tengas un buen día!";
    }
    if (stage === "qualified_exit") {
      return `Perfecto ✅ Ya tengo toda tu información y cumples con los requisitos. Puedes llamarnos al ${storePhone} y nuestro equipo continuará contigo. ¡Gracias por tu interés!`;
    }
    if (stage === "request_phone") {
      return `Perfecto. ¿Cuál es el mejor número de teléfono para comunicarnos contigo sobre el ${vehicle}?`;
    }
    if (stage === "cash_visit_request_phone") {
      return `Perfecto. Cual es el mejor numero de telefono para coordinar la visita o la compra del ${vehicle}? Tambien puedes llamarnos al ${storePhone}.`;
    }
    if (stage === "urgent_vehicle_request_phone") {
      return `Con gusto te ayudamos de inmediato con el ${vehicle}. Cual es el mejor numero de telefono para comunicarnos contigo? Tambien puedes llamarnos al ${storePhone}.`;
    }
    if (stage === "stalled_conversation_request_phone") {
      return `Para ayudarte mejor con el ${vehicle}, cual es el mejor numero de telefono para comunicarnos contigo? Tambien puedes llamarnos al ${storePhone}.`;
    }
    if (stage === "salesperson_request_phone") {
      return `Nuestro vendedor puede darte mas informacion sobre el ${vehicle}. Cual es el mejor numero de telefono para comunicarnos contigo? Tambien puedes llamarnos al ${storePhone}.`;
    }
    if (stage === "availability") {
      return availabilityQuickReplyAccepted
        ? `Hola, somos Alpha Motorsports. Tenemos el ${vehicle} disponible. ¿Qué te gustaría saber?`
        : `Hola, somos Alpha Motorsports. Sí, el ${vehicle} está disponible. ¿Qué te gustaría saber?`;
    }
    if (stage === "price_inquiry") {
      return `Con gusto podemos confirmar ese detalle del ${vehicle}. ¿Qué te gustaría saber?`;
    }
    if (stage === "financing_intro") {
      return "Perfecto. Para avanzar necesitamos una identificación vigente y comprobante de ingresos. ¿Cuentas con ambos?";
    }
    if (stage === "financing_declined") {
      return `No hay problema, gracias por avisarnos. Planeas comprar de contado o te gustaria venir a ver el ${vehicle}?`;
    }
    if (stage === "address_request") {
      return `Estamos en ${storeAddress}. ¿Te queda mejor hoy o mañana?`;
    }
    if (stage === "inventory_options") {
      return `Sí, tenemos más vehículos disponibles además del ${vehicle}. ¿Qué opción te gustaría conocer?`;
    }
    if (stage === "document_requirements") {
      const detailBridge = buyerAskedDetailedVehicleInfo(currentMessage)
        ? " Con gusto podemos confirmar esos detalles contigo."
        : "";
      return `Para avanzar necesitamos una identificación vigente y comprobante de ingresos.${detailBridge} ¿Cuentas con ambos?`;
    }
    if (stage === "clean_title") {
      return `Buena pregunta. Podemos verificar si el ${vehicle} tiene título limpio. ¿Qué detalle te gustaría que confirmemos?`;
    }
    if (stage === "clean_title_and_warranty") {
      return `Buena pregunta. Podemos verificar el título limpio y la cobertura exacta de garantía del ${vehicle}, incluyendo lo que aplica si compras de contado. ¿Qué detalle te gustaría que confirmemos primero?`;
    }
    if (stage === "warranty_info") {
      return `Buena pregunta. Podemos verificar la cobertura exacta de garantía del ${vehicle}. ¿Qué detalle te gustaría que confirmemos?`;
    }
    if (stage === "advisor_question") {
      return `Buena pregunta. Podemos confirmar ese detalle del ${vehicle}. ¿Qué te gustaría saber?`;
    }
    return `Con gusto te ayudo con el ${vehicle}. ¿Qué te gustaría saber?`;
  }
  if (stage === "open_question") {
    return `Great question. I do not have that detail confirmed for the ${vehicle}, but I can verify it. What would you like to know?`;
  }
  if (stage === "vehicle_link_request") {
    return "The vehicle page is not available in the feed yet, but I can verify it.";
  }
  if (stage === "carfax_request") {
    return "I do not have a VIN-specific Carfax report link here; the salesperson can send it to you.";
  }
    if (stage === "store_phone_requested") {
      return `Of course, our number is ${storePhone}. We are here if you need anything else.`;
    }
    if (stage === "phone_received") {
      return `Thanks! I have your number. ${downPaymentRequestReply("en", downPaymentPolicy)}`;
    }
    if (stage === "interest_confirmation") {
      return `Yes, the ${vehicle} is available. Would a weekday or the weekend work better?`;
    }
    if (stage === "interest_declined") {
      return "I understand, and I appreciate your time. If you change your mind, we will be here to help. Have a great day!";
    }
    if (stage === "down_payment_request") {
      return downPaymentRequestReply("en", downPaymentPolicy);
    }
    if (stage === "down_payment_low") {
      return downPaymentLowReply("en", downPaymentPolicy);
    }
    if (stage === "down_payment_declined") {
      return downPaymentDeclinedReply("en", downPaymentPolicy);
    }
    if (stage === "timeline_request") {
      return "Perfect. Would a weekday or the weekend work better?";
    }
  if (stage === "timeline_received") {
    return "Perfect. What number should the salesperson call to confirm the time?";
    }
    if (stage === "timeline_declined") {
      return "I understand. Right now we are prioritizing buyers planning to purchase this week or this month. When you are ready, we will be happy to help. Have a great day!";
    }
    if (stage === "documents_request") {
      return "To move forward, we need a valid ID and proof of income. Do you have both?";
    }
    if (stage === "documents_declined") {
      return "I understand. We currently require a valid ID and proof of income to move forward. Please reach out when you have both. Have a great day!";
    }
    if (stage === "qualified_exit") {
      return `Perfect ✅ I have all your information and you meet the requirements. You can call us at ${storePhone}, and our team will continue with you. Thanks for your interest!`;
    }
  if (stage === "request_phone") {
    return `Great. What's the best phone number to reach you about the ${vehicle}?`;
  }
  if (stage === "cash_visit_request_phone") {
    return `Great. What's the best phone number to coordinate a visit or cash purchase for the ${vehicle}? You can also call us at ${storePhone}.`;
  }
  if (stage === "urgent_vehicle_request_phone") {
    return `We can help you right away with the ${vehicle}. What's the best phone number to reach you? You can also call us at ${storePhone}.`;
  }
  if (stage === "stalled_conversation_request_phone") {
    return `To help you better with the ${vehicle}, what's the best phone number to reach you? You can also call us at ${storePhone}.`;
  }
  if (stage === "salesperson_request_phone") {
    return `Our salesperson can give you more information about the ${vehicle}. What's the best phone number to reach you? You can also call us at ${storePhone}.`;
  }
  if (stage === "availability") {
    return availabilityQuickReplyAccepted
      ? `Hello, this is Alpha Motorsports. We have the ${vehicle} available. What would you like to know?`
      : `Hello, this is Alpha Motorsports. Yes, the ${vehicle} is available. What would you like to know?`;
  }
  if (stage === "price_inquiry") {
    return `We will be happy to confirm that detail for the ${vehicle}. What would you like to know?`;
  }
  if (stage === "financing_intro") {
    return "Perfect. To move forward, we need a valid ID and proof of income. Do you have both?";
  }
  if (stage === "financing_declined") {
    return `No problem, thanks for letting us know. Are you planning to purchase cash or would you like to come see the ${vehicle}?`;
  }
  if (stage === "address_request") {
    return `We are at ${storeAddress}. Would today or tomorrow work better?`;
  }
  if (stage === "inventory_options") {
    return `Yes, we have more vehicles available besides the ${vehicle}. Which option would you like to explore?`;
  }
    if (stage === "document_requirements") {
      const detailBridge = buyerAskedDetailedVehicleInfo(currentMessage)
        ? " We will be happy to confirm those details with you."
        : "";
      return `To move forward, we need a valid ID and proof of income.${detailBridge} Do you have both?`;
  }
  if (stage === "clean_title") {
    return `Good question. We can verify whether the ${vehicle} has a clean title. What would you like us to confirm?`;
  }
  if (stage === "clean_title_and_warranty") {
    return `Great question. We can verify the clean-title status and exact warranty coverage for the ${vehicle}, including what applies if you pay cash. Which detail would you like us to confirm first?`;
  }
  if (stage === "warranty_info") {
    return `Great question. We can verify the exact warranty coverage for the ${vehicle}. What would you like us to confirm?`;
  }
  if (stage === "advisor_question") {
    return `Great question. We can confirm that detail for the ${vehicle}. What would you like to know?`;
  }
  return `I'd be happy to help with the ${vehicle}. What would you like to know?`;
}

function addMarketplaceValueFact(
  reply: string,
  language: string,
  facts?: MarketplaceVehicleFacts,
): string {
  if (!facts || !vehicleValueFact(facts, language === "es" ? "es" : "en")) return reply;
  if (hasVehicleValueFact(reply, facts)) return reply;
  const fact = vehicleValueFact(facts, language === "es" ? "es" : "en");
  return `${fact}. ${reply}`;
}

function buildSafeFallbackReply(
  language: string,
  vehicleTitle?: string,
  storePhone: string = DEFAULT_STORE_PHONE,
  visibleMessages: string[] = [],
  currentMessage: string = "",
  availabilityQuickReplyAccepted: boolean = false,
  lotLocation?: string | null,
  downPaymentPolicy: DownPaymentPolicy = NO_DOWN_PAYMENT_POLICY,
  vehicleFacts?: MarketplaceVehicleFacts,
): string {
  const requestKind = detectVehicleRequestKind(currentMessage);
  const stage = resolveSalesReplyStage(visibleMessages, currentMessage, downPaymentPolicy);
  if (requestKind === "photos" && vehicleFacts?.vdpUrl) {
    return addMarketplaceValueFact(
      language === "es"
        ? `Aquí está la ficha completa con todas las fotos: ${vehicleFacts.vdpUrl}.`
        : `Here is the complete vehicle page with all the photos: ${vehicleFacts.vdpUrl}.`,
      language,
      vehicleFacts,
    );
  }
  if (requestKind === "carfax" && vehicleFacts?.carfaxUrl) {
    return addMarketplaceValueFact(
      language === "es"
        ? `Claro, aquí está el reporte del carro: ${vehicleFacts.carfaxUrl}.`
        : `Sure, here is the vehicle report: ${vehicleFacts.carfaxUrl}.`,
      language,
      vehicleFacts,
    );
  }
  if (stage === "price_inquiry" && vehicleFacts?.price != null) {
    return addMarketplaceValueFact(
      language === "es"
        ? `El precio publicado es $${vehicleFacts.price.toLocaleString("en-US")}. ¿Qué te gustaría saber?`
        : `The listed price is $${vehicleFacts.price.toLocaleString("en-US")}. What would you like to know?`,
      language,
      vehicleFacts,
    );
  }
  const base = buildBaseSafeFallbackReply(
    language,
    vehicleTitle,
    storePhone,
    visibleMessages,
    currentMessage,
    availabilityQuickReplyAccepted,
    lotLocation,
    downPaymentPolicy,
  );
  return addMarketplaceValueFact(base, language, vehicleFacts);
}

function isAiReplyAligned(
  reply: string,
  stage: SalesReplyStage,
  storePhone: string,
  firstDealerReply: boolean = false,
  downPaymentPolicy: DownPaymentPolicy = NO_DOWN_PAYMENT_POLICY,
  vehicleFacts?: MarketplaceVehicleFacts,
): boolean {
  const normalized = cleanConversationText(reply).toLowerCase();
  if (!normalized) return false;
  const legacyLocationToken = String.fromCharCode(
    102, 114, 101, 100, 101, 114, 105, 99, 107, 115, 98, 117, 114, 103,
  );
  const legacyAddressToken = ["410", "hudgins"].join(" ");
  if (normalized.includes(legacyLocationToken) || normalized.includes(legacyAddressToken)) return false;
  if (/\b(?:bank account|cuenta bancaria|cuenta de banco)\b/i.test(normalized)) return false;
  if (!replyUsesOnlyConfiguredDownPayments(reply, downPaymentPolicy)) return false;
  if (firstDealerReply && stage !== "store_phone_requested" && !replyHasFirstGreeting(reply)) return false;
  if (firstDealerReply && /\b(?:finance|financing|financiamiento|financiar)\b/i.test(normalized)) return false;
  if (!isConciseMarketplaceReply(reply)) return false;
  if (vehicleFacts && vehicleValueFact(vehicleFacts, /[¿¡áéíóúñ]/i.test(reply) ? "es" : "en") && stage !== "store_phone_requested" && !hasVehicleValueFact(reply, vehicleFacts)) return false;
  if (stageRequiresStorePhone(stage) && !replyIncludesStorePhone(reply, storePhone)) return false;
  if (/\badvisor\b|\basesor\b/i.test(normalized)) return false;
  if (!vehicleFacts && replyGivesRestrictedVehicleDetails(reply) && !["phone_received", "down_payment_request", "down_payment_low", "down_payment_declined"].includes(stage)) return false;
  if (stage === "open_question") {
    return /(?:confirm|confirmed|verify|verif|detail|detalle|information|informaci[oó]n|question|pregunta|great question|buena pregunta|not available|not have|no tengo|no hay|can check|puedo verificar)/i.test(normalized) &&
      /\?/.test(reply) &&
      !/phone|number|tel[eé]fono|n[uú]mero|financ|financing|down payment|enganche|inicial|document|requisit|follow[- ]?up/.test(normalized);
  }
  if (stage === "vehicle_link_request") {
    if (vehicleFacts && !vehicleFacts.vdpUrl) {
      return /(?:not available|no .*page|no est[aá] disponible|no tengo .*ficha|verif|confirm)/.test(normalized) &&
        !/https?:\/\//.test(normalized) &&
        !/phone|number|tel[eé]fono|n[uú]mero|financ|financing/.test(normalized);
    }
    return /https?:\/\//.test(normalized) && /photo|foto|image|imagen|ficha|page|pagina/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero|financ|financing/.test(normalized);
  }
  if (stage === "carfax_request") {
    if (vehicleFacts && !vehicleFacts.carfaxUrl) {
      return /(?:carfax|vehicle report|reporte|historial)/.test(normalized) &&
        /(?:salesperson|vendedor|send|enviar|not available|no .*link|no tengo)/.test(normalized) &&
        !/https?:\/\//.test(normalized) &&
        !/phone|number|tel[eé]fono|n[uú]mero|financ|financing/.test(normalized);
    }
    return (/carfax|vehicle report|reporte|historial/.test(normalized) &&
      (/https?:\/\//.test(normalized) || /salesperson|vendedor|send|enviar/.test(normalized)) &&
      !/phone|number|tel[eé]fono|n[uú]mero|financ|financing/.test(normalized));
  }
  if (stage === "availability") {
    return /alpha/.test(normalized) &&
      /(?:what would you like to know|qué te gustaría saber|que te gustaria saber)/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero/.test(normalized) &&
      !/financ|financing|financiar/.test(normalized) &&
      !normalized.includes(storePhone.toLowerCase());
  }
  if (stage === "interest_confirmation") {
    return /available|disponible/.test(normalized) && /weekday|weekend|entre semana|fin de semana/.test(normalized);
  }
  if (stage === "interest_declined") {
    return /thank|gracias|understand|entiendo/.test(normalized) && !/\?/.test(normalized);
  }
  if (stage === "phone_received" || stage === "down_payment_request") {
    const hasConfiguredAmount = downPaymentPolicy.vehicleOverride != null || downPaymentPolicy.planAmounts.length > 0
      ? downPaymentAmountsMentioned(reply).some((amount) =>
        (downPaymentPolicy.vehicleOverride != null ? [downPaymentPolicy.vehicleOverride] : downPaymentPolicy.planAmounts).includes(amount),
      )
      : downPaymentAmountsMentioned(reply).length === 0;
    return /down|down payment|enganche|inicial/.test(normalized) && hasConfiguredAmount && /\?/.test(normalized);
  }
  if (stage === "down_payment_low") {
    return downPaymentPolicy.minimumAmount != null &&
      downPaymentAmountsMentioned(reply).includes(downPaymentPolicy.minimumAmount) &&
      /down|enganche|inicial/.test(normalized) && /\?/.test(normalized);
  }
  if (stage === "down_payment_declined") {
    return downPaymentPolicy.minimumAmount != null &&
      downPaymentAmountsMentioned(reply).includes(downPaymentPolicy.minimumAmount) &&
      /down|enganche|inicial/.test(normalized) && !/\?/.test(normalized);
  }
  if (stage === "timeline_request") {
    return /weekday|weekend|entre semana|fin de semana/.test(normalized) && /\?/.test(normalized);
  }
  if (stage === "timeline_received") {
    return /(?:phone|number|tel[eé]fono|n[uú]mero)/.test(normalized) && /(?:confirm|confirmar)/.test(normalized) && /\?/.test(normalized);
  }
  if (stage === "timeline_declined" || stage === "documents_declined") {
    return !/\?/.test(normalized) && /thank|gracias|understand|entiendo/.test(normalized);
  }
  if (stage === "documents_request") {
    return /id|identification|identificaci[oó]n/.test(normalized) && /proof of income|comprobante de ingresos|prueba de ingresos|income/.test(normalized) && /\?/.test(normalized);
  }
  if (stage === "qualified_exit") {
    return /information|informaci[oó]n/.test(normalized) && /requirement|requisit/.test(normalized) && replyIncludesStorePhone(reply, storePhone) && !/\?/.test(normalized);
  }
  if (stage === "price_inquiry") {
    if (vehicleFacts?.price != null) {
      return /(?:listed price|precio publicado|price is|precio es)/.test(normalized) &&
        normalized.replace(/\D/g, "").includes(String(vehicleFacts.price)) &&
        !/phone|number|tel[eé]fono|n[uú]mero|financ|financing|requirements|requisitos/.test(normalized);
    }
    return /confirm|confirmar/.test(normalized) &&
      !/\$\s*\d/.test(normalized) &&
      !/id|tax\s*id|passport|pasaporte|bank account|cuenta bancaria|requirements|requisitos/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  if (stage === "store_phone_requested") {
    return replyIncludesStorePhone(reply, storePhone) &&
      !/\?/.test(normalized) &&
      !/id|tax\s*id|passport|pasaporte|bank account|cuenta bancaria|requirements|requisitos/.test(normalized);
  }
  if (stage === "financing_intro") {
    return /\b(id|tax\s*id|passport|pasaporte|identification|identificaci[oó]n)\b/.test(normalized) &&
      /proof of income|comprobante de ingresos|prueba de ingresos|income/.test(normalized) &&
      /requirements|requisitos|cuentas|tienes|have/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  if (stage === "financing_declined") {
    return /no problem|no hay problema|thanks|gracias/.test(normalized) &&
      !/id|tax\s*id|passport|pasaporte|bank account|cuenta bancaria|requirements|requisitos/.test(normalized) &&
      !/are you interested in financing|te interesa financiar|do you have those requirements|cuentas con esos requisitos/.test(normalized);
  }
  if (stage === "request_phone") {
    return /phone|number|tel[eé]fono|n[uú]mero/.test(normalized) && /(?:confirm|coordina|visit|cita|salesperson|vendedor)/.test(normalized) && !/financ|financing|down payment|enganche/.test(normalized);
  }
  if (stage === "urgent_vehicle_request_phone") {
    return /phone|number|telefono|numero/.test(normalizeIntentText(reply)) &&
      !/financing requirements|requisitos de financiamiento|bank account|cuenta bancaria|passport|pasaporte|tax\s*id/.test(normalized);
  }
  if (stage === "stalled_conversation_request_phone") {
    return /phone|number|telefono|numero/.test(normalizeIntentText(reply)) &&
      !/financing requirements|requisitos de financiamiento|bank account|cuenta bancaria|passport|pasaporte|tax\s*id/.test(normalized);
  }
  if (stage === "salesperson_request_phone") {
    return /(?:salesperson|vendedor)/.test(normalizeIntentText(reply)) &&
      /phone|number|telefono|numero/.test(normalizeIntentText(reply)) &&
      !/financing requirements|requisitos de financiamiento|bank account|cuenta bancaria|passport|pasaporte|tax\s*id/.test(normalized);
  }
  if (stage === "cash_visit_request_phone") {
    return /phone|number|telefono|numero/.test(normalized) &&
      /visit|cash|compra|visita/.test(normalized) &&
      !/financing|finance|financiar|financiamiento|requirements|requisitos/.test(normalized);
  }
  if (stage === "inventory_options") {
    const normalizedIntent = normalizeIntentText(reply);
    return /\b(?:more vehicles|more options|similar options|mas vehiculos|mas opciones|opciones similares|which option|que opcion|qué opción)\b/.test(normalizedIntent) &&
      !/financ|financiar|financiamiento|id|tax id|passport|pasaporte|bank account|cuenta bancaria|requisitos|requirements|phone|number|telefono|numero/.test(normalizedIntent);
  }
  if (stage === "document_requirements") {
    return /\b(id|tax\s*id|passport|pasaporte|identification|identificaci[oó]n)\b/.test(normalized) &&
      /proof of income|comprobante de ingresos|prueba de ingresos|income/.test(normalized) &&
      /requisitos|cuentas|tienes|have|both|ambos/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  if (stage === "clean_title") {
    return /clean title|clear title|titulo limpio|t[ií]tulo limpio|certification|certificaci[oó]n/.test(normalized) &&
      /what would you like us to confirm|qué detalle te gustaría que confirmemos|que detalle te gustaria que confirmemos|verify|verificar|confirm/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero|financ|financing/.test(normalized);
  }
  if (stage === "clean_title_and_warranty") {
    return /clean title|clean-title|titulo limpio|t[ií]tulo limpio/.test(normalized) &&
      /warranty|coverage|garantia|cobertura/.test(normalized) &&
      /what would you like us to confirm|which detail would you like us to confirm|qué detalle te gustaría que confirmemos|que detalle te gustaria que confirmemos|verify|verificar|confirm/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero|financ|financing/.test(normalized);
  }
  if (stage === "warranty_info") {
    return /warranty|coverage|garantia|cobertura|confirm|confirmar/.test(normalized) &&
      /what would you like us to confirm|qué detalle te gustaría que confirmemos|que detalle te gustaria que confirmemos|verify|verificar|confirm/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero|financ|financing/.test(normalized);
  }
  if (stage === "advisor_question") {
    return /detail|detalle|confirm|confirmar|verify|verificar/.test(normalized) &&
      /what would you like to know|qué te gustaría saber|que te gustaria saber|verify|verificar|confirm/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero|financ|financing/.test(normalized);
  }
  return true;
}

function isReplyRelevantToCurrentMessage(reply: string, currentMessage: string): boolean {
  const normalizedReply = normalizeIntentText(reply);
  const normalizedBuyer = normalizeIntentText(currentMessage);
  const topicContracts = [
    {
      reply: /\b(?:cash price|asking price|precio(?: en efectivo)?|precio exacto)\b/,
      buyer: /\b(?:cash|price|precio|cuanto|cuesta|valor)\b/,
    },
    {
      reply: /\b(?:warranty|coverage|deductible|garantia|cobertura|deducible)\b/,
      buyer: /\b(?:warranty|coverage|deductible|garantia|cobertura|deducible)\b/,
    },
    {
      reply: /\b(?:address|location|directions|direccion|ubicacion|como llegar)\b/,
      buyer: /\b(?:address|location|directions|direccion|ubicacion|ubicad[oa]s?|donde|como llegar)\b/,
    },
    {
      reply: /\b(?:passport|tax id|bank account|pasaporte|cuenta bancaria|requisitos|documentos)\b/,
      buyer: /\b(?:passport|tax id|bank account|pasaporte|cuenta bancaria|requisitos|documentos|necesit|aplicar|apply|financ|interested|interesad|me interesa|si|s[ií]|yes|claro)\b/,
    },
    {
      reply: /\b(?:clean title|titulo limpio)\b/,
      buyer: /\b(?:clean title|clear title|titulo limpio)\b/,
    },
  ];
  return topicContracts.every((topic) => !topic.reply.test(normalizedReply) || topic.buyer.test(normalizedBuyer));
}

function isReplyLanguageMirrored(reply: string, language: string): boolean {
  const text = cleanConversationText(reply);
  if (!text) return false;
  return detectLanguage(text) === language;
}

function replyRepeatsRecentDealerMessage(reply: string, visibleMessages: string[]): boolean {
  const normalizedReply = cleanConversationText(reply).toLowerCase();
  if (!normalizedReply) return false;
  return visibleMessages.slice(-8).some((message) => {
    const match = cleanConversationText(message).match(/^(?:Dealer|DealerPilot AI|Assistant):\s*(.+)$/i);
    return cleanConversationText(match?.[1] || "").toLowerCase() === normalizedReply;
  });
}

function avoidRepeatedFallback(
  reply: string,
  language: string,
  visibleMessages: string[],
  currentMessage: string,
  vehicleTitle?: string,
  downPaymentPolicy: DownPaymentPolicy = NO_DOWN_PAYMENT_POLICY,
  vehicleFacts?: MarketplaceVehicleFacts,
): string {
  if (!replyRepeatsRecentDealerMessage(reply, visibleMessages)) return reply;
  const stage = resolveSalesReplyStage(visibleMessages, currentMessage, downPaymentPolicy);
  const vehicle = vehicleTitle ?? (language === "es" ? "el vehículo" : "the vehicle");
  if (stage === "open_question") {
    return language === "es"
      ? addMarketplaceValueFact(`Buena pregunta. Puedo verificar ese detalle del ${vehicle}. ¿Qué te gustaría saber?`, language, vehicleFacts)
      : addMarketplaceValueFact(`Great question. I can verify that detail about the ${vehicle}. What would you like to know?`, language, vehicleFacts);
  }
  if (stage === "warranty_info" || stage === "advisor_question") {
    return language === "es"
      ? addMarketplaceValueFact(`Podemos verificar ese detalle del ${vehicle}. ¿Qué te gustaría saber?`, language, vehicleFacts)
      : addMarketplaceValueFact(`We can verify that detail for the ${vehicle}. What would you like to know?`, language, vehicleFacts);
  }
  if (stage === "clean_title") {
    return language === "es"
      ? addMarketplaceValueFact(`Podemos verificar si el ${vehicle} tiene título limpio. ¿Qué detalle te gustaría que confirmemos?`, language, vehicleFacts)
      : addMarketplaceValueFact(`We can verify whether the ${vehicle} has a clean title. What would you like us to confirm?`, language, vehicleFacts);
  }
  if (stage === "clean_title_and_warranty") {
    return language === "es"
      ? addMarketplaceValueFact(`Podemos verificar el título limpio y la cobertura exacta de garantía del ${vehicle}, incluyendo lo que aplica si compras de contado. ¿Qué detalle te gustaría que confirmemos primero?`, language, vehicleFacts)
      : addMarketplaceValueFact(`We can verify the clean-title status and exact warranty coverage for the ${vehicle}, including what applies if you pay cash. Which detail would you like us to confirm first?`, language, vehicleFacts);
  }
  return reply;
}

type AiReplyResult = {
  reply: string;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  aiStartedAt: Date;
  aiCompletedAt: Date;
  aiDurationMs: number;
};

const SALES_REPLY_STAGES: readonly SalesReplyStage[] = [
  "open_question",
  "availability",
  "store_phone_requested",
  "vehicle_link_request",
  "carfax_request",
  "price_inquiry",
  "financing_intro",
  "financing_declined",
  "cash_visit_request_phone",
  "urgent_vehicle_request_phone",
  "stalled_conversation_request_phone",
  "salesperson_request_phone",
  "request_phone",
  "phone_received",
  "address_request",
  "inventory_options",
  "document_requirements",
  "clean_title",
  "clean_title_and_warranty",
  "warranty_info",
  "advisor_question",
  "general",
];

function isSalesReplyStage(value: unknown): value is SalesReplyStage {
  return typeof value === "string" && (SALES_REPLY_STAGES as readonly string[]).includes(value);
}

type StructuredSalesReply = {
  intent?: string;
  urgency?: "high" | "normal";
  vehicleIntent?: "strong" | "unclear";
  reply?: string;
};

function parseStructuredReply(content: unknown): StructuredSalesReply | null {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return null;
  const jsonText = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\s*```$/i, "").trim();
  if (!jsonText.startsWith("{") || !jsonText.endsWith("}")) {
    const first = jsonText.indexOf("{");
    const last = jsonText.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    return extractStructuredReply(jsonText.slice(first, last + 1));
  }
  return extractStructuredReply(jsonText);
}

function extractStructuredReply(jsonText: string): StructuredSalesReply | null {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const intent = (parsed as Record<string, unknown>).intent;
    const urgency = (parsed as Record<string, unknown>).urgency;
    const vehicleIntent = (parsed as Record<string, unknown>).vehicleIntent;
    const reply = (parsed as Record<string, unknown>).reply;
    return {
      intent: typeof intent === "string" && intent.trim() ? intent.trim() : undefined,
      urgency: urgency === "high" || urgency === "normal" ? urgency : undefined,
      vehicleIntent: vehicleIntent === "strong" || vehicleIntent === "unclear" ? vehicleIntent : undefined,
      reply: typeof reply === "string" && reply.trim() ? reply.trim() : undefined,
    };
  } catch {
    return null;
  }
}

const ALPHA_RULES = `
You are a warm, helpful, and professional sales representative speaking directly as Alpha Motorsports, a used car dealership. Sound natural and welcoming, not robotic or transactional.

LOCATION RULE: Alpha Motorsports serves customers from Manassas only. Use only the supplied Manassas address. Never mention any former branch or any other address or location.

QUALIFICATION FUNNEL FOR ALPHA MANASSAS:
1. Start with a warm greeting as Alpha Motorsports, confirm that the exact vehicle from the Vehicle field is available, include exactly one useful vehicle fact from the Feed-backed Vehicle facts, and ask what the buyer would like to know. Never ask about financing in the first reply.
2. Answer the buyer's latest question first. Keep one useful vehicle fact in every reply when one is available. If the buyer confirms interest, ask whether this week or the weekend works better; do not ask for a phone number yet.
3. Once the buyer gives a visit day or proposes coming to the lot, ask for the buyer's phone number to confirm the tentative visit. The seller calls to confirm the hour; never promise a confirmed appointment.
4. A buyer phone number, a down-payment amount, or a concrete cash offer triggers immediate handoff. Do not ask another qualification question and do not send a bot reply after that signal.
4. If an approved minimum is supplied and the buyer has less than that minimum down, explain the requirement using only that configured minimum. If no approved configuration is supplied, never state a down-payment number. If the buyer says no, thank them and close politely without asking another question.
5. If financing is explicitly mentioned by the buyer, answer only from supplied policy and never invent approval, rate, or terms. Do not use financing to evade another question.
6. If the buyer asks for photos, send the single dealer-domain VDP URL when available. Send at most one VDP link per conversation and never in the first message.
7. If the buyer asks for Carfax, send a VIN-specific report URL only when one is explicitly available. Otherwise say the salesperson can send it; never infer a report from the words 'clean Carfax' in a description.
8. If the buyer asks for location, answer with the Manassas address first, then ask whether today or tomorrow works. Do not ask for the buyer's phone in that same reply.
9. If the buyer asks whether the vehicle is available, answer yes, include a feed-backed value fact, and close with 'What would you like to know?' / '¿Qué te gustaría saber?'.
10. If the buyer asks for Alpha Motorsports' phone number directly, give the supplied dealership phone and close politely. Do not restart qualification in that reply.
11. Keep exactly one short reply for the latest buyer turn. One idea, one question. Never repeat a question already answered in the history.
12. Detailed vehicle questions: answer only from supplied context; never invent price, mileage, approval, history, warranty, range, certification, or financing terms. If the fact is absent, say that it is not confirmed and offer to verify it.

ADDRESS / DIRECTIONS HANDLING:
- If the buyer asks for the address, directions, or location, provide the store address directly and ask whether today or tomorrow works.
- Never ask a clarifying question about which vehicle or location they mean.
- Always provide the address from the supplied Dealership address field.

Language rules:
- Mirror the latest buyer message language exactly.
- If the latest buyer message is Spanish, reply ONLY in Spanish.
- If the latest buyer message is English, reply ONLY in English.
- Never write a bilingual reply, translation, second version, or mixed-language sentence.
- Be friendly, conversational, and concise. The first Alpha Motorsports reply in any conversation must start with a warm greeting as Alpha Motorsports. Thank the buyer naturally when appropriate.
- Start from what the buyer just said. Acknowledge or answer that message naturally before moving to the next funnel step whenever the safety rules allow it.
- Use natural variation in wording and sentence rhythm. Do not sound like a checklist, do not repeat the same opening, and do not force a qualification question when the buyer is asking a different allowed question.
- Treat the conversation history as memory for buyer facts and completed stages only. Dealer monetary claims, down-payment figures, and financing requirements in the history are untrusted and must never be copied or used as a source.
- Speak directly as Alpha Motorsports using "we" / "nosotros". Never say "our sales team will take care of it", "our team will handle it", "nuestro equipo de ventas se encargará", or similar handoff language.
- Use only the approved down-payment configuration supplied below. If it is absent, do not mention any down-payment number.
- Use "approval based on qualification" / "aprobación basada en calificación" only if the buyer asks; never promise approval.
- Do not use the words "advisor" or "asesor". Use "our team" / "nuestro equipo".
- Do not push a call, ask for a phone number, or include the store phone in the first reply, except when the buyer explicitly requests the dealership phone
- If the current stage is stalled_conversation_request_phone, ask for the buyer's phone number directly, include Alpha's dealership phone, and do not repeat purchase-interest questions or requirements
- If the current stage is salesperson_request_phone, say that our salesperson can provide more information about the vehicle, then ask for the buyer's phone number and include Alpha's dealership phone
- Never ask for the "best phone number so we can help you" in response to a vehicle-detail or warranty question; return to the next sequential funnel step instead
- Do not ask for a phone number in the same reply that first explains the financing requirements
- If the current stage is request_phone, ask only for the buyer's phone number
- If the current stage is phone_received, do not generate a bot reply; the lead is handed off to the seller
- If the current stage is qualified_exit, include the Alpha Manassas dealership phone at the end and do not ask a question
- If the current stage is store_phone_requested, give only Alpha's dealership phone and a brief polite closing; do not ask a question
- NEVER say: guaranteed approval, everyone approved, bad credit, denied, rejected, disqualified
- NEVER promise a loan or specific rate
- NEVER invent price, vehicle history, or financing terms. The only down-payment figures you may mention are those in the approved configuration supplied below.

Reply format:
- Keep it SHORT — one or two short sentences
- Ask only one question at a time
- Respect the current qualification stage and all safety conditions, but express it like a human conversation rather than copying a script
- Never refer to the vehicle as "your vehicle", "your car", "tu vehículo", or "tu carro". Always say "the vehicle" / "el vehículo" or use the specific make/model.
`;

export function detectLanguage(text: string): "en" | "es" {
  const normalized = cleanConversationText(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const spanishWords =
    /\b(hola|buenas|gracias|disponible|tengo|quiero|estoy|interesad[oa]s?|claro|podemos|ayuda(?:r|rte)?|inicial|comprar|semana|numero|telefono|itin|ingresos|esta|esa|ese|eso|esto|este|tiene|tienen|techo|panoramico|precio|cuanto|cuánto|cual|donde|cuando|carro|auto|vehiculo|si|como|necesit[ao]|aplicar|requisitos?|documentos?|pasaporte|cuenta|bancaria|financiar|financiamiento|asesor|opciones?|disponibles?|tambien|puedo|puedes?|mira|dime|informa(?:ci[oó]n)?|diferencia|herramientas|paquete|alturas|precios?|millas|miles|kilometros?|garant[ií]a|motor|automatico|mecanico|manual|camioneta|sedan|historial|accidente|condici[oó]n|ped[oó]|ahora|listo|nuevo|viejo|gusta|encanta|necesitaria|estaria|alguno|alguna|otro|otra|mas|qu[eé]|talvez|tal ?vez|seguir)\b/i;
  return /[¿¡ñáéíóúü]/i.test(cleanConversationText(text)) || spanishWords.test(normalized) ? "es" : "en";
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
  downPaymentPolicy: DownPaymentPolicy = NO_DOWN_PAYMENT_POLICY,
  vehicleFacts: MarketplaceVehicleFacts = {},
): Promise<string> {
  const langNote =
    language === "es"
      ? "The latest buyer message is Spanish. Respond ONLY in Spanish. Do not include English."
      : "The latest buyer message is English. Respond ONLY in English. Do not include Spanish.";

  const storeAddress = resolveStoreAddress(lotLocation);
  void publishedDownPayment;
  const feedFacts = [
    vehicleFacts.mileage != null ? `mileage=${vehicleFacts.mileage.toLocaleString("en-US")} miles` : null,
    vehicleFacts.exteriorColor ? `exterior_color=${vehicleFacts.exteriorColor}` : null,
    vehicleFacts.price != null ? `price=$${vehicleFacts.price.toLocaleString("en-US")}` : null,
    vehicleFacts.photoCount != null ? `photo_count=${vehicleFacts.photoCount}` : null,
    vehicleFacts.vdpUrl ? `vdp_url=${vehicleFacts.vdpUrl}` : null,
    vehicleFacts.carfaxUrl ? `carfax_url=${vehicleFacts.carfaxUrl}` : "carfax_url=not_available",
  ].filter(Boolean).join(", ");
  const vehicleContext = vehicleTitle
    ? `Vehicle: ${vehicleTitle}${vehicleType ? ` (${vehicleType})` : ""}${feedFacts ? `\nFeed-backed Vehicle facts: ${feedFacts}` : ""}${downPaymentPolicy.vehicleOverride != null ? ` — Approved vehicle down payment: $${downPaymentPolicy.vehicleOverride.toLocaleString()}` : ""}`
    : "";
  const locationContext = `Dealership address: ${storeAddress}`;
  const phoneContext = `Dealership phone: ${storePhone}`;

  const history = visibleMessages.slice(-8).join("\n");

  const stage = resolveSalesReplyStage(visibleMessages, currentMessage, downPaymentPolicy);
  const persistentUnansweredBuyerTurns = hasPersistentUnansweredBuyerTurns(
    visibleMessages,
    currentMessage,
  );
  const firstDealerReply = isFirstDealerReply(visibleMessages);
  const promptStage = stage === "advisor_question" ? "detailed_question" : stage;
  const stageInstruction = {
    open_question: "The buyer asked a question that must be answered before qualification advances. Answer that exact question from supplied facts only. If the fact is not supplied, say clearly that it is not confirmed and offer to verify it. Then ask only one short question that keeps the buyer on this vehicle; do not ask for a phone number, financing, down payment, documents, or a follow-up.",
    availability: availabilityQuickReplyAccepted
      ? "Greet as Alpha Motorsports, state that the exact vehicle is available, include one feed-backed value fact, then ask what the buyer would like to know. Do not ask for a phone number or financing."
      : "Greet as Alpha Motorsports, explicitly confirm that the exact vehicle is available, include one feed-backed value fact, then ask what the buyer would like to know. Do not ask for a phone number or financing.",
    interest_confirmation: "Confirm the exact vehicle is available, include one feed-backed value fact, and ask whether this week or the weekend works better. Do not ask for a phone number yet.",
    interest_declined: "Thank the buyer for their time and close politely. Do not ask another question.",
    store_phone_requested: `The buyer requested Alpha Motorsports' phone number. Reply immediately with exactly the supplied dealership phone: ${storePhone}. Start with \"Con gusto, nuestro número es\" / \"Of course, our number is\", add a short polite closing, and do not ask a question, request buyer information, or mention financing requirements.`,
    price_inquiry: vehicleFacts.price != null
      ? `Answer with the feed-backed listed price $${vehicleFacts.price.toLocaleString("en-US")}, include one other useful vehicle fact, and ask what the buyer would like to know next. Do not ask for a phone number or financing.`
      : "The buyer is asking for price. Say the exact price is not confirmed in the available vehicle facts; do not provide a number. Then ask what the buyer would like to know. Do not ask for a phone number or financing.",
    financing_intro: "The buyer is ready to continue. Do not ask for a phone number yet. Explain that a valid ID and proof of income are required, then ask if they have both.",
    financing_declined: "The buyer declined financing. Do not ask about financing again and do not explain financing requirements. Thank them, then ask whether they plan to purchase cash or would like to come see the vehicle.",
    cash_visit_request_phone: `The buyer is continuing without financing. Ask for the buyer's best phone number to coordinate a visit or cash purchase. Include Alpha's dealership phone as an immediate call option: ${storePhone}. Do not mention financing.`,
    urgent_vehicle_request_phone: `The buyer has sent several consecutive messages, is explicitly pressing for an answer, and has shown strong intent to buy, visit, schedule, or test drive. Skip the normal funnel. Ask for the buyer's best phone number immediately and include Alpha's dealership phone: ${storePhone}. Do not mention financing requirements.`,
    stalled_conversation_request_phone: `The deterministic history check found at least two recent buyer turns that did not advance the sale. Skip the normal funnel and ask once for the buyer's best phone number, including Alpha's dealership phone: ${storePhone}. Do not repeat a financing-interest question, financing requirements, or a vehicle-detail question.`,
    salesperson_request_phone: `Alpha already requested the buyer's phone number and the buyer is still asking vehicle-detail questions. Do not repeat the prior phone-request wording. Say that our salesperson can provide more information about the vehicle, then ask for the buyer's best phone number and include Alpha's dealership phone: ${storePhone}. Do not restart financing requirements.`,
    request_phone: "Ask for the buyer's best phone number to confirm the tentative visit. Include one feed-backed value fact. Do not ask about financing or down payment.",
    phone_received: "Do not generate a reply. The buyer has been handed off to the seller.",
    down_payment_request: "Ask how much the buyer has available for the down payment. Mention approved amounts only when the configuration below contains them.",
    down_payment_low: "Explain the configured minimum down payment and ask whether the buyer can reach it. Do not invent a minimum.",
    down_payment_declined: "Thank the buyer and close politely because the configured minimum down payment is required. Do not invent or repeat a number from history.",
    timeline_request: "Ask when the buyer plans to purchase. Accept any clear Spanish or English timeframe, such as this week, this month, in 15 days, in one week, next month, the other month, or a named month. Ask only that one question.",
    timeline_received: "The buyer gave a visit day. Ask for the buyer's phone number to confirm the tentative visit; the seller will call to confirm the exact hour. Do not promise a confirmed hour.",
    timeline_declined: "Thank the buyer and close politely because a clear purchase timeframe is required. Do not ask another question.",
    documents_request: "Ask whether the buyer has both a valid ID and proof of income. Both are required; do not substitute a bank account question.",
    documents_declined: "Explain that both a valid ID and proof of income are currently required, then close politely without asking another question.",
    qualified_exit: `Confirm that all required information was received and that the buyer meets the requirements. Suggest the Alpha Manassas dealership phone ${storePhone} at the end and do not ask a question.`,
    address_request: `The buyer is asking for the address or directions. Provide the dealership address first, include one feed-backed value fact, then ask whether today or tomorrow works. Do NOT ask clarifying questions or for a phone number in this reply.`,
    vehicle_link_request: vehicleFacts.vdpUrl
      ? `Send exactly this dealer-domain VDP link once: ${vehicleFacts.vdpUrl}. Mention that it has the vehicle's photos. Include one feed-backed value fact and do not ask for a phone number.`
      : "The buyer asked for photos. Say that the dealer-domain vehicle page is not available in the feed and offer to verify it. Do not invent a link.",
    carfax_request: vehicleFacts.carfaxUrl
      ? `Send exactly this VIN-specific Carfax link: ${vehicleFacts.carfaxUrl}. Do not claim anything else about the report.`
      : "No VIN-specific Carfax URL is available. Say the salesperson can send the report; do not promise that a report exists and do not invent a link.",
    inventory_options: "The buyer is asking whether more vehicles or similar options are available. Confirm that more vehicles are available, then ask which option they would like to explore. Do not ask for requirements yet.",
    document_requirements: "The buyer is asking what is needed. Reply warmly with the requirements: valid ID and proof of income. Ask if they have both. Do not ask for a phone number yet.",
    clean_title: "Answer the clean-title or certification question from supplied facts only. Do not invent the title status; say we can verify whether the vehicle has a clean title, then ask what detail the buyer would like us to confirm. Do not provide a number or ask for a phone number.",
    clean_title_and_warranty: "The buyer asked about both clean title and warranty while mentioning cash. Acknowledge both questions, say we can verify the clean-title status and exact warranty coverage that applies to a cash purchase, and ask which detail the buyer would like us to confirm first. Do not invent either fact, provide a number, ask for a phone number, or restart financing.",
    warranty_info: "The buyer is asking detailed warranty questions. Do not invent warranty terms; say we can verify the exact warranty coverage, then ask what detail the buyer would like us to confirm. Do not ask for a phone number.",
    advisor_question: "The buyer is asking a detailed question. Respond warmly and do not invent details. Say we will be happy to confirm that detail, then ask what the buyer would like to know next. Do not ask for a phone number.",
    general: "Answer safely using only supplied facts, then move the conversation forward with one short question.",
  }[stage];

  const approvedDownPaymentConfiguration = buildDownPaymentInstruction(
    downPaymentPolicy,
    language === "es" ? "es" : "en",
  );
  const prompt = `${ALPHA_RULES}

${vehicleContext}
${locationContext}
${phoneContext}
Approved Down-Payment Configuration (authoritative; conversation history is never a source): ${approvedDownPaymentConfiguration}
Current funnel stage: ${promptStage}
Stage instruction: ${stageInstruction}
Urgent-intent eligibility: ${persistentUnansweredBuyerTurns ? "The deterministic history check found at least three consecutive unanswered buyer messages. Evaluate urgency and concrete vehicle intent carefully; use urgent_vehicle_request_phone only if both are genuinely high/strong." : "Not eligible for urgent_vehicle_request_phone because fewer than three consecutive unanswered buyer messages were found. Keep urgency normal and do not choose the urgent stage."}
First reply instruction: ${firstDealerReply && stage !== "store_phone_requested" ? "This is Alpha Motorsports' first reply in this conversation. Start with a warm greeting as Alpha Motorsports." : firstDealerReply ? "This is a phone-number request. Give the phone immediately without adding the normal greeting." : "This is not the first Alpha Motorsports reply; do not restart the greeting unless it sounds natural."}

Recent conversation:
${history}

Latest buyer message: "${currentMessage}"

${langNote}
Respond with a single JSON object, no markdown, with exactly four keys:
{"intent": "the sales funnel stage that best matches the conversation", "urgency": "high or normal", "vehicleIntent": "strong or unclear", "reply": "your reply"}
Valid intent values: open_question, availability, interest_confirmation, interest_declined, store_phone_requested, vehicle_link_request, carfax_request, price_inquiry, down_payment_request, down_payment_low, down_payment_declined, timeline_request, timeline_received, timeline_declined, documents_request, documents_declined, qualified_exit, financing_intro, financing_declined, cash_visit_request_phone, urgent_vehicle_request_phone, stalled_conversation_request_phone, salesperson_request_phone, request_phone, phone_received, address_request, inventory_options, document_requirements, clean_title, clean_title_and_warranty, warranty_info, advisor_question, general.
Choose urgent_vehicle_request_phone only when Urgent-intent eligibility allows it, urgency is high, and vehicleIntent is strong. Otherwise follow the supplied Current funnel stage and Stage instruction.
The "reply" must be one short message that follows the stage instruction exactly, mentions the vehicle naturally, and mirrors the buyer's language.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.choices[0]?.message?.content?.trim();

  const structured = parseStructuredReply(raw);
  const candidateReply = (structured?.reply ?? raw ?? "").trim();
  const ambiguousStage = stage === "general" || stage === "advisor_question";
  const modelConfirmedUrgentVehicleIntent =
    persistentUnansweredBuyerTurns &&
    structured?.intent === "urgent_vehicle_request_phone" &&
    structured.urgency === "high" &&
    structured.vehicleIntent === "strong";
  const candidateStage =
    modelConfirmedUrgentVehicleIntent
      ? "urgent_vehicle_request_phone"
      : structured?.intent && isSalesReplyStage(structured.intent) && ambiguousStage
      ? structured.intent
      : stage;

  if (
    candidateReply &&
    isAiReplyAligned(candidateReply, candidateStage, storePhone, firstDealerReply, downPaymentPolicy, vehicleFacts) &&
    isReplyLanguageMirrored(candidateReply, language) &&
    isReplyRelevantToCurrentMessage(candidateReply, currentMessage) &&
    !replyRepeatsRecentDealerMessage(candidateReply, visibleMessages)
    && replyUsesOnlyConfiguredDownPayments(candidateReply, downPaymentPolicy)
  ) {
    return candidateReply;
  }

  return avoidRepeatedFallback(
    withFirstReplyGreeting(
      buildSafeFallbackReply(
        language,
        vehicleTitle,
        storePhone,
        visibleMessages,
        currentMessage,
        availabilityQuickReplyAccepted,
        lotLocation,
        downPaymentPolicy,
        vehicleFacts,
      ),
      language,
      firstDealerReply,
    ),
    language,
    visibleMessages,
    currentMessage,
    vehicleTitle,
    downPaymentPolicy,
    vehicleFacts,
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
  downPaymentPolicy: DownPaymentPolicy = NO_DOWN_PAYMENT_POLICY,
  vehicleFacts: MarketplaceVehicleFacts = {},
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
        downPaymentPolicy,
        vehicleFacts,
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
  const firstDealerReply = isFirstDealerReply(visibleMessages);
  return {
    reply: avoidRepeatedFallback(
      withFirstReplyGreeting(
        buildSafeFallbackReply(
          language,
          vehicleTitle,
          storePhone,
          visibleMessages,
          currentMessage,
          availabilityQuickReplyAccepted,
          lotLocation,
          downPaymentPolicy,
          vehicleFacts,
        ),
        language,
        firstDealerReply,
      ),
      language,
      visibleMessages,
      currentMessage,
      vehicleTitle,
      downPaymentPolicy,
      vehicleFacts,
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
    visibleImages,
    visibleAudios,
    currentMessage,
    detectedMarketplaceListingUrl,
    detectedVehicleTitle,
    marketplaceDownPayment: _marketplaceDownPayment,
    marketplaceAskingPrice,
    vehicleType,
    dealerId: requestedDealerId,
    sessionId,
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
    visibleImages?: ConversationImage[];
    visibleAudios?: ConversationAudio[];
    currentMessage?: string;
    detectedMarketplaceListingUrl?: string;
    detectedVehicleTitle?: string;
    marketplaceDownPayment?: number | string;
    marketplaceAskingPrice?: number | string;
    vehicleType?: string;
    dealerId?: number | string;
    sessionId?: string;
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

  void _marketplaceDownPayment;
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

  const parsedDealerId = Number(requestedDealerId);
  const dealerId = Number.isInteger(parsedDealerId) && parsedDealerId > 0
    ? parsedDealerId
    : DEALER_ID;
  const [targetDealer] = await db
    .select({ id: dealersTable.id })
    .from(dealersTable)
    .where(eq(dealersTable.id, dealerId))
    .limit(1);
  if (!targetDealer) {
    res.status(400).json({ error: "Unknown dealerId" });
    return;
  }
  // Outbound storage is additive. An unavailable migration must never stop
  // the established Sales AI intake and normal response path.
  try {
    await ensureMessengerOutboundSchema();
  } catch (error) {
    req.log.error({ error, dealerId }, "Messenger outbound schema unavailable; normal intake continues");
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
  let incomingMsgs = mergeCurrentConversationMessage(parsedMsgs, currentParsed);
  // The extension validates currentMessage against the live Messenger bubble.
  // Preserve it as the source of truth even if Facebook momentarily returns
  // stale or reordered history rows around a DOM rerender.
  const currentBuyerMessage = currentParsed?.role === "user" ? currentParsed.content : "";
  let latestParsed = incomingMsgs[incomingMsgs.length - 1] ?? null;
  const latestBuyerMessage = currentBuyerMessage ||
    (latestParsed?.role === "user"
      ? latestParsed.content
      : [...incomingMsgs].reverse().find((msg) => msg.role === "user")?.content ?? "");
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
  const media = await understandConversationMedia({
    images: visibleImages,
    audios: visibleAudios,
    language: detectLanguage(latestBuyerMessage),
  });
  if (media.context) {
    const latestBuyerIndex = [...incomingMsgs].map((message) => message.role).lastIndexOf("user");
    if (latestBuyerIndex >= 0) {
      incomingMsgs = incomingMsgs.map((message, index) => index === latestBuyerIndex
        ? { ...message, content: `${message.content}\n${media.context}`.slice(0, 4000) }
        : message);
      latestParsed = incomingMsgs[incomingMsgs.length - 1] ?? null;
    }
  }
  const inbound = media.context
    ? `${latestBuyerMessage}\n${media.context}`.slice(0, 4000)
    : latestBuyerMessage;
  const language = detectLanguage(inbound);
  const buyerQualification = extractBuyerQualification(incomingMsgs);
  const extractedPhone = extractPhoneNumber(inbound);
  const currentDownPaymentAmount = extractDownPaymentAmount(inbound);
  const immediateHandoffReason = extractedPhone
    ? "buyer_phone_received"
    : currentDownPaymentAmount !== null
      ? "down_payment_amount_received"
      : hasConcreteCashOffer(inbound)
        ? "concrete_cash_offer_received"
        : null;
  if (isTerminalBuyerAcknowledgement(inbound) || isConversationClosingBuyerAcknowledgement(inbound)) {
    req.log.info(
      { externalThreadRef, extensionId: extensionId ?? null, messageHash: messageHash ?? idempotencyKey ?? null },
      "Conversation intake skipped - terminal or closed buyer acknowledgement",
    );
    res.json({
      skipped: true,
      reason: isConversationClosingBuyerAcknowledgement(inbound) ? "conversation_closed" : "terminal_acknowledgement",
      language,
      timings: {
        messageDetectedAt: messageDetectedAt.toISOString(),
        backendReceivedAt: backendReceivedAt.toISOString(),
        totalResponseMs: Date.now() - messageDetectedAt.getTime(),
      },
    });
    return;
  }
  const parsedAskingPrice = parseMoney(marketplaceAskingPrice);

  let vehicleId: number | undefined;
  let listingId: number | undefined;
  let lotLocation: string | null = null;
  let vehicleTitleFromDb: string | undefined;
  let vehicleFacts: MarketplaceVehicleFacts = {};
  let vehicleMatchSource: "marketplace_listing_url" | "detected_vehicle_title" | null = null;
  let verifiedInventoryLookupFailed = false;

  const [existingConv] = await db
    .select()
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.dealerId, dealerId),
      eq(conversationsTable.externalThreadRef, externalThreadRef),
    ))
    .limit(1);

  if (detectedMarketplaceListingUrl) {
    const detectedMarketplaceItemId = extractMarketplaceItemId(detectedMarketplaceListingUrl);
    try {
      const marketplaceListings = await db
        .select({
          vehicleId: marketplaceListingsTable.vehicleId,
          listingUrl: marketplaceListingsTable.listingUrl,
          facebookListingId: marketplaceListingsTable.facebookListingId,
          dealerId: vehiclesTable.dealerId,
          lotLocation: vehiclesTable.lotLocation,
          sourceRaw: vehiclesTable.sourceRaw,
        })
        .from(marketplaceListingsTable)
        .innerJoin(vehiclesTable, eq(vehiclesTable.id, marketplaceListingsTable.vehicleId))
        .where(and(
          eq(marketplaceListingsTable.dealerId, dealerId),
          eq(vehiclesTable.lotLocation, ALPHA_LOT_MANASSAS),
        ));
      const marketplaceListing = marketplaceListings.find((listing) => {
        if (!detectedMarketplaceItemId) return listing.listingUrl === detectedMarketplaceListingUrl;
        return (
          listing.facebookListingId === detectedMarketplaceItemId ||
          extractMarketplaceItemId(listing.listingUrl) === detectedMarketplaceItemId
        );
      });
      if (marketplaceListing && isAlphaManassasVehicle(marketplaceListing)) {
        vehicleId = marketplaceListing.vehicleId;
        vehicleMatchSource = "marketplace_listing_url";
      }
    } catch (error) {
      // The verified-lot lookup was added for the Alpha safety gate. A stale
      // production schema or a transient catalog read must not turn Messenger
      // intake into an HTTP 500 or prevent a generic reply from being prepared.
      verifiedInventoryLookupFailed = true;
      req.log.error(
        { error, dealerId, externalThreadRef, detectedMarketplaceListingUrl },
        "Conversation intake verified inventory lookup failed; continuing without new vehicle binding",
      );
      if (existingConv?.vehicleId) {
        vehicleId = existingConv.vehicleId;
        listingId = existingConv.listingId ?? undefined;
      }
    }
  }

  if (!vehicleId && detectedVehicleTitle && !verifiedInventoryLookupFailed) {
    const normalizedDetectedTitle = normalizeVehicleTitle(detectedVehicleTitle);
    const vRow = await db
      .select(vehicleOperationalColumns)
      .from(vehiclesTable)
      .where(and(
        eq(vehiclesTable.dealerId, dealerId),
        eq(vehiclesTable.lotLocation, ALPHA_LOT_MANASSAS),
      ));

    const match = vRow.find((v) => {
      if (!detectedVehicleTitle) return false;
      const exactTitles = [
        [v.year, v.make, v.model].filter(Boolean).join(" "),
        [v.year, v.make, v.model, v.trim].filter(Boolean).join(" "),
      ].map(normalizeVehicleTitle);
      return exactTitles.includes(normalizedDetectedTitle);
    });
    if (match && isAlphaManassasVehicle(match)) {
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

  if (vehicleId) {
    const [vehicle] = await db
      .select({
        lotLocation: vehiclesTable.lotLocation,
        year: vehiclesTable.year,
        make: vehiclesTable.make,
        model: vehiclesTable.model,
        trim: vehiclesTable.trim,
        mileage: vehiclesTable.mileage,
        exteriorColor: vehiclesTable.exteriorColor,
        price: vehiclesTable.price,
        vdpUrl: vehiclesTable.vdpUrl,
        sourceRaw: vehiclesTable.sourceRaw,
      })
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, vehicleId))
      .limit(1);
    lotLocation = vehicle?.lotLocation ?? null;
    vehicleTitleFromDb = vehicle
      ? [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ")
      : undefined;
    if (vehicle) {
      const [imageCount] = await db
        .select({ count: count() })
        .from(vehicleImagesTable)
        .where(eq(vehicleImagesTable.vehicleId, vehicleId));
      vehicleFacts = {
        title: vehicleTitleFromDb,
        mileage: vehicle.mileage,
        exteriorColor: vehicle.exteriorColor,
        price: vehicle.price,
        vdpUrl: vehicle.vdpUrl,
        photoCount: Number(imageCount?.count ?? 0),
        carfaxUrl: extractCarfaxUrlFromSourceRaw(vehicle.sourceRaw),
      };
    }
  }

  const storePhone = resolveStorePhone(lotLocation);
  vehicleFacts = {
    ...vehicleFacts,
    dealerPhone: storePhone,
    dealerAddress: resolveStoreAddress(lotLocation),
  };

  if (vehicleId) {
    const lRow = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.vehicleId, vehicleId))
      .limit(1);
    if (lRow[0]) listingId = lRow[0].id;
  }
  const resolvedVehicleTitle = vehicleId ? vehicleTitleFromDb ?? detectedVehicleTitle : undefined;
  const downPaymentPolicy = await getDownPaymentPolicy(dealerId, vehicleId);
  const trustedDownPayment = downPaymentPolicy.minimumAmount;

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
        marketplaceDownPayment: trustedDownPayment,
        marketplaceAskingPrice:
          parsedAskingPrice ?? existingConv.marketplaceAskingPrice,
        vehicleType: vehicleType ?? existingConv.vehicleType,
        sessionId: sessionId ?? existingConv.sessionId,
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
        dealerId,
        sessionId: sessionId ?? null,
        externalThreadRef,
        buyerName,
        language,
        sourceUrl: resolvedSourceUrl,
        detectedListingUrl: detectedMarketplaceListingUrl,
        detectedVehicleTitle: resolvedVehicleTitle,
        vehicleId,
        listingId,
        marketplaceDownPayment: trustedDownPayment,
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

  // A BDC handoff may still need a delivery retry for its final confirmation.
  // Once a new buyer message arrives, however, terminal conversations must not
  // be reopened by the automated intake path.
  if (existingConv && hasNewBuyerMessage && isTerminalConversationStatus(existingConv.status)) {
    req.log.info(
      { conversationId: existingConv.id, externalThreadRef, status: existingConv.status },
      "Conversation intake skipped - conversation is already terminal",
    );
    res.json({
      skipped: true,
      reason: "conversation_closed",
      timings: {
        messageDetectedAt: messageDetectedAt.toISOString(),
        backendReceivedAt: backendReceivedAt.toISOString(),
        totalResponseMs: Date.now() - messageDetectedAt.getTime(),
      },
    });
    return;
  }

  if (hasNewBuyerMessage) {
    await db
      .update(conversationsTable)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(conversationsTable.id, conversationId));
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
    const retryHistory = formatConversationHistoryForAi(
      conversationHistoryForAi.length ? conversationHistoryForAi : incomingMsgs,
    );
    const retryStage = resolveSalesReplyStage(retryHistory, inbound, downPaymentPolicy);
    if (
      retryableReply &&
      (
        !isReplyLanguageMirrored(retryableReply, language) ||
        !isAiReplyAligned(retryableReply, retryStage, storePhone, isFirstDealerReply(retryHistory), downPaymentPolicy, vehicleFacts) ||
        !isReplyRelevantToCurrentMessage(retryableReply, inbound)
      )
    ) {
      const repairedReply = await generateAiReplyWithFallback(
        retryHistory,
        inbound,
        language,
        resolvedVehicleTitle,
        vehicleType,
        trustedDownPayment ?? undefined,
        storePhone,
        availabilityQuickReplyAccepted === true,
        lotLocation,
        downPaymentPolicy,
        vehicleFacts,
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
        { conversationId, externalThreadRef, language, retryStage },
        "Conversation intake repaired stale reply before Messenger delivery retry",
      );
    }
    if (retryableReply) {
      const outboundJob = latestAssistantMessage
        ? await findOutboundJobForAssistantMessage(latestAssistantMessage.id)
          .catch((error) => {
            req.log.warn({ error, conversationId }, "Delivery retry continues without outbound job lookup");
            return null;
          })
        : null;
      req.log.info(
        { conversationId, externalThreadRef, extensionId: extensionId ?? null, messageHash: messageHash ?? idempotencyKey ?? null },
        "Conversation intake returning existing reply for Messenger delivery retry",
      );
      res.json({
        conversationId,
        suggestedReply: retryableReply,
        deliveryRetry: true,
        outboundJob,
        closeConversationAfterDelivery: retryStage === "store_phone_requested",
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

  let suggestedReply: string | null = null;
  let outboundJob = null;
  let aiReplyResult: AiReplyResult | null = null;
  const currentStage = resolveSalesReplyStage(
    formatConversationHistoryForAi(conversationHistoryForAi.length ? conversationHistoryForAi : incomingMsgs),
    inbound,
    downPaymentPolicy,
  );
  const closeAfterDelivery = [
    // Sharing the dealership phone is an informational reply. The buyer may
    // still need to provide their phone and complete the qualification flow.
    "interest_declined",
    "down_payment_declined",
    "timeline_declined",
    "documents_declined",
    "qualified_exit",
  ].includes(currentStage);
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
      trustedDownPayment ?? undefined,
      storePhone,
      availabilityQuickReplyAccepted === true,
      lotLocation,
      downPaymentPolicy,
      vehicleFacts,
    );
    suggestedReply = aiReplyResult.reply;

    const [assistantMessage] = await db.insert(conversationMessagesTable).values({
      conversationId,
      role: "assistant",
      content: suggestedReply,
    }).returning({ id: conversationMessagesTable.id });
    if (!extractedPhone && !closeAfterDelivery && assistantMessage?.id) {
      outboundJob = await queueNormalReply({
        conversationId,
        dealerId,
        assistantMessageId: assistantMessage.id,
        externalThreadRef,
        sourceUrl: resolvedSourceUrl,
        content: suggestedReply,
      }).catch((error) => {
        req.log.warn({ error, conversationId }, "Normal reply sent without outbound delivery entry");
        return null;
      });
    }
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
    const resolvedDownPayment = buyerQualification.downPayment ?? existingLead.buyerAvailableDownPayment;
    const resolvedTimeline = buyerQualification.timeline ?? existingLead.buyerTimeline;
    const resolvedDocuments = buyerQualification.documents;
    const { score, temperature } = computeLeadScore({
      buyerTimeline: existingLead.buyerTimeline,
      buyerAvailableDownPayment: existingLead.buyerAvailableDownPayment,
      publishedDownPayment: trustedDownPayment,
      hasId: existingLead.hasId,
      hasProofOfIncome: existingLead.hasProofOfIncome,
      phone: resolvedPhone,
      appointmentIntent: existingLead.appointmentIntent,
    });
    // Buyer providing phone number → force HOT, assign to BDC
    const finalTemperature = immediateHandoffReason ? "Hot" : temperature;
    resolvedLeadQuality = finalTemperature;
    await db
      .update(leadsTable)
      .set({
      buyerName: buyerName ?? existingLead.buyerName,
        language,
        vehicleId: vehicleId ?? existingLead.vehicleId,
        listingId: listingId ?? existingLead.listingId,
        sourceUrl: resolvedSourceUrl ?? existingLead.sourceUrl,
        publishedDownPayment: trustedDownPayment,
        suggestedReply: suggestedReply ?? existingLead.suggestedReply,
        phone: resolvedPhone,
        buyerAvailableDownPayment: resolvedDownPayment,
        buyerTimeline: resolvedTimeline,
        hasId: resolvedDocuments?.hasId ?? existingLead.hasId,
        hasProofOfIncome: resolvedDocuments?.hasProofOfIncome ?? existingLead.hasProofOfIncome,
        leadScore: immediateHandoffReason ? Math.max(score, 70) : score,
        temperature: finalTemperature,
        status: immediateHandoffReason ? "BDC Assigned" : existingLead.status,
        updatedAt: new Date(),
      })
      .where(eq(leadsTable.id, existingLead.id));
  } else {
    const { score, temperature } = computeLeadScore({
      publishedDownPayment: trustedDownPayment,
      phone: extractedPhone,
    });
    const finalTemperature = immediateHandoffReason ? "Hot" : temperature;
    resolvedLeadQuality = finalTemperature;
    const [newLead] = await db
      .insert(leadsTable)
      .values({
        conversationId,
        dealerId,
        buyerName,
        language,
        vehicleId,
        listingId,
        sourceUrl: resolvedSourceUrl,
        publishedDownPayment: trustedDownPayment,
        suggestedReply,
        phone: extractedPhone,
        buyerAvailableDownPayment: buyerQualification.downPayment,
        buyerTimeline: buyerQualification.timeline,
        hasId: buyerQualification.documents?.hasId ?? null,
        hasProofOfIncome: buyerQualification.documents?.hasProofOfIncome ?? null,
        leadScore: immediateHandoffReason ? Math.max(score, 70) : score,
        temperature: finalTemperature,
        status: immediateHandoffReason ? "BDC Assigned" : "New",
      })
      .returning();
    leadId = newLead.id;
  }

  const secondarySyncs = await Promise.allSettled([
    db
      .insert(downPaymentIntelligenceTable)
      .values({
        dealerId,
        conversationId,
        vehicleId,
        listingId,
        vehicleType,
        publishedDownPayment: trustedDownPayment,
        buyerAvailableDownPayment: buyerQualification.downPayment,
        buyerTimeline: buyerQualification.timeline,
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
    outboundJob,
    handoff: !!immediateHandoffReason,
    handoffReason: immediateHandoffReason,
    closeConversationAfterDelivery: closeAfterDelivery && !!suggestedReply,
    language,
    fallbackUsed: aiReplyResult?.fallbackUsed ?? false,
    fallbackReason: aiReplyResult?.fallbackReason ?? null,
    timings,
  });
});

router.post("/conversations/outbound/:jobId/delivered", async (req, res) => {
  const jobId = Number(req.params.jobId);
  const dealerId = Number(req.body?.dealerId) || DEALER_ID;
  const externalThreadRef = String(req.body?.externalThreadRef || "").trim();
  if (!Number.isInteger(jobId) || jobId <= 0 || !externalThreadRef) {
    res.status(400).json({ error: "jobId and externalThreadRef are required" });
    return;
  }
  try {
    const confirmed = await confirmOutboundDelivery({
      jobId,
      dealerId,
      externalThreadRef,
      extensionId: typeof req.body?.extensionId === "string" ? req.body.extensionId : null,
    });
    res.json({ ok: true, ...confirmed });
  } catch (error) {
    req.log.warn({ error, jobId, dealerId }, "Messenger outbound delivery confirmation rejected");
    res.status(409).json({ error: error instanceof Error ? error.message : "outbound_delivery_confirmation_failed" });
  }
});

router.post("/conversations/:id/close-after-delivery", async (req, res) => {
  const conversationId = Number(req.params.id);
  const dealerId = Number(req.body?.dealerId) || DEALER_ID;
  const externalThreadRef = String(req.body?.externalThreadRef || "").trim();
  if (!Number.isInteger(conversationId) || conversationId <= 0 || !externalThreadRef) {
    res.status(400).json({ error: "conversation id and externalThreadRef are required" });
    return;
  }
  const [closedConversation] = await db
    .update(conversationsTable)
    .set({ status: "closed", updatedAt: new Date() })
    .where(and(
      eq(conversationsTable.id, conversationId),
      eq(conversationsTable.dealerId, dealerId),
      eq(conversationsTable.externalThreadRef, externalThreadRef),
    ))
    .returning({ id: conversationsTable.id, status: conversationsTable.status });
  if (!closedConversation) {
    res.status(404).json({ error: "Conversation not found for this Messenger thread" });
    return;
  }
  req.log.info({ conversationId, dealerId, externalThreadRef }, "Conversation closed after dealership phone delivery");
  res.json({ ok: true, conversation: closedConversation });
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
  const m = normalizeIntentText(message);
  if (/disponible|still.*for sale|still.*available|is it available|está disponible/.test(m)) return "availability";
  if (/\bprecio\b|how much|what.*price|cuánto.*cuesta|cuanto.*cuesta/.test(m)) return "price_inquiry";
  if (/financiamiento|financing|finance|monthly|mensual|payment plan/.test(m)) return "financing";
  if (/donde|ubicad[oa]s?|location|address|direccion|where.*are.*you|where.*located/.test(m)) return "location";
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
  let testDownPaymentPolicy = NO_DOWN_PAYMENT_POLICY;

  if (vehicleId) {
    const [v] = await db
      .select(vehicleOperationalColumns)
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, vehicleId))
      .limit(1);
    if (v) {
      vehicleTitle = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
      vehicleType = v.bodyStyle ?? undefined;
      testStorePhone = resolveStorePhone(v.lotLocation);
      testDownPaymentPolicy = await getDownPaymentPolicy(v.dealerId, v.id);
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
    false,
    undefined,
    testDownPaymentPolicy,
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
