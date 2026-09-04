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
  type DealerMarketplaceKnowledge,
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
  buildVehiclePhotoRequestReply,
  extractCarfaxUrlFromSourceRaw,
  hasConcreteCashOffer,
  hasVisitDaySignal,
  isConciseMarketplaceReply,
  type MarketplaceVehicleFacts,
} from "../sofia/marketplaceTone";
import { ALPHA_LOT_MANASSAS, isAlphaManassasVehicle } from "../lib/dealer";
import { vehicleOperationalColumns } from "../lib/vehicleColumns";
import { detectConversationLanguage, detectLanguage } from "../conversations/language";


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

function resolveStorePhone(
  lotLocation?: string | null,
  dealerKnowledge?: DealerMarketplaceKnowledge,
): string {
  void lotLocation;
  return dealerKnowledge?.en?.phone?.trim() || dealerKnowledge?.es?.phone?.trim() || DEFAULT_STORE_PHONE;
}

function resolveStoreAddress(
  lotLocation?: string | null,
  dealerKnowledge?: DealerMarketplaceKnowledge,
): string {
  if (lotLocation === ALPHA_LOT_MANASSAS) return "9120 Euclid Ave, Manassas, VA 20110";
  return dealerKnowledge?.en?.address?.trim() || dealerKnowledge?.es?.address?.trim() || "9120 Euclid Ave, Manassas, VA 20110";
}

function dealerKnowledgeValue(
  dealerKnowledge: DealerMarketplaceKnowledge | undefined,
  language: string,
  key: keyof NonNullable<DealerMarketplaceKnowledge["en"]>,
  fallback = "",
): string {
  const locale = language === "es" ? dealerKnowledge?.es : dealerKnowledge?.en;
  return locale?.[key]?.trim() || fallback;
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
  | "vin_inquiry"
  | "mileage_inquiry"
  | "color_inquiry"
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
  | "test_drive_request"
  | "dealer_hours"
  | "trade_in_request"
  | "payment_methods_request"
  | "urgent_vehicle_request_phone"
  | "stalled_conversation_request_phone"
  | "salesperson_request_phone"
  | "request_phone"
  | "phone_received"
  | "handoff_confirmation"
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
  // A buyer may ask for a down payment that supports a monthly target, e.g.
  // "what's the lowest down payment for 500 monthly". The number in that
  // question is the desired monthly payment, not money the buyer has ready.
  // Only treat a nearby number as a down payment when it is explicitly
  // labeled as down/enganche/inicial or is not labeled as a monthly target.
  const monthlyTargetAmount = /(?:\$?\d[\d,.]*|one thousand|two thousand|three thousand)\s*(?:per\s+month|monthly|a\s+month|\/\s*mo(?:nth)?)\b/i.test(withoutPhoneNumber);
  const explicitlyLabeledDownPayment = /(?:\$?\d[\d,.]*|one thousand|two thousand|three thousand)\s*(?:k|mil|thousand)?\s*(?:down(?:\s+payment)?|enganche|inicial)\b/i.test(withoutPhoneNumber);
  if (monthlyTargetAmount && !explicitlyLabeledDownPayment) return null;
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

type ImmediateHandoffReason = "buyer_phone_received" | "down_payment_amount_received" | "concrete_cash_offer_received";

function resolveImmediateHandoffReason(text: string): ImmediateHandoffReason | null {
  if (extractPhoneNumber(text)) return "buyer_phone_received";
  if (hasConcreteCashOffer(text)) return "concrete_cash_offer_received";
  if (extractDownPaymentAmount(text) !== null) return "down_payment_amount_received";
  return null;
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

function buyerAskedVin(latest: string): boolean {
  return /\b(?:vin|vehicle identification number|numero de identificacion del vehiculo|n[uú]mero de identificaci[oó]n del veh[ií]culo)\b/i.test(latest);
}

function buyerAskedMileage(latest: string): boolean {
  return /\b(?:mileage|miles|millas|odometer|od[oó]metro|kilometraje)\b/i.test(latest);
}

function buyerAskedColor(latest: string): boolean {
  return /\b(?:color|colour|exterior color|color exterior|de que color|de qu[eé] color)\b/i.test(latest);
}

function buyerAskedDealerHours(latest: string): boolean {
  return /\b(?:hours?|open|opens|close|closes|sunday|domingo|what time|qu[eé] hora|horario|abren|cierran|abierto|cerrado)\b/i.test(latest);
}

function buyerAskedTradeIn(latest: string): boolean {
  return /\b(?:trade[- ]?in|trade my car|take my car|part(?:e)? de pago|reciben mi carro|recibir mi carro|cambiar mi carro)\b/i.test(latest);
}

function buyerAskedPaymentMethods(latest: string): boolean {
  return /\b(?:payment methods?|ways to pay|pay with|cash and financing|contado y financiamiento|formas de pago|m[eé]todos de pago|pago en efectivo)\b/i.test(latest);
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
  return /\b(?:warranty|garant[ií]a|deductible|deducible|certif(?:ied|ication)|certificad[oa]|engine|motor|transmission|transmisi[oó]n|mechanic|mec[aá]nico|repair|reparaci[oó]n|issue|issues|problem|problems|third-party|dealership|included|cover|days|miles|mill?as)\b/i.test(latest);
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
  if (buyerAskedCleanTitle(latest) || buyerAskedWarrantyInfo(latest)) return false;
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
    stage === "open_question" ||
    stage === "advisor_question" ||
    stage === "vin_inquiry" ||
    stage === "address_request" ||
    stage === "vehicle_link_request" ||
    stage === "carfax_request" ||
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
  // BDC Assigned is a handoff state, not a terminal conversation state.
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

function replyClaimsUnrequestedVehicleStatus(reply: string, stage: SalesReplyStage): boolean {
  const normalized = cleanConversationText(reply).toLowerCase();
  const titleStages: SalesReplyStage[] = ["clean_title", "clean_title_and_warranty", "warranty_info"];
  const warrantyStages: SalesReplyStage[] = ["clean_title", "clean_title_and_warranty", "warranty_info"];
  if (!titleStages.includes(stage) && /\b(?:clean title|clear title|t[ií]tulo limpio|titulo limpio|salvage|rebuilt|reconstruido|certified|certificado)\b/i.test(normalized)) return true;
  if (!warrantyStages.includes(stage) && /\b(?:warranty|garant[ií]a|coverage|cobertura|deductible|deducible)\b/i.test(normalized)) return true;
  if (stage !== "carfax_request" && /\b(?:carfax|vehicle history|history report|historial|accident|accidente|one owner|un solo dueño)\b/i.test(normalized)) return true;
  return false;
}

function replyContainsUnauthorizedPromise(reply: string): boolean {
  const normalized = cleanConversationText(reply).toLowerCase();
  return /\b(?:guaranteed approval|guarantee approval|everyone approved|aprobaci[oó]n garantizada|todos aprobados|bad credit|mal cr[eé]dito|guaranteed rate|tasa garantizada|free delivery|entrega gratis|we deliver|hacemos entregas|discount|descuento|denied|denegado|rejected|rechazado)\b/i.test(normalized) ||
    /\b(?:approved|aprobado)\b.{0,30}\b(?:loan|rate|financing|pr[eé]stamo|tasa|financiamiento)\b/i.test(normalized);
}

function replyClaimsConfirmedAppointment(reply: string): boolean {
  const normalized = cleanConversationText(reply).toLowerCase();
  return /\b(?:confirmed|confirmada|confirmado|scheduled|programada|programado)\b.{0,35}\b(?:appointment|test drive|visit|cita|prueba de manejo|visita)\b/i.test(normalized) ||
    /\b(?:appointment|test drive|visit|cita|prueba de manejo|visita)\b.{0,35}\b(?:confirmed|confirmada|confirmado|scheduled|programada|programado)\b/i.test(normalized);
}

function replyMentionsWrongVehicleYear(reply: string, vehicleFacts?: MarketplaceVehicleFacts): boolean {
  const currentYear = vehicleFacts?.title?.match(/\b(?:19|20)\d{2}\b/)?.[0];
  if (!currentYear) return false;
  return [...cleanConversationText(reply).matchAll(/\b(?:19|20)\d{2}\b/g)].some((match) => match[0] !== currentYear);
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
  if (hasPhoneNumber(latest) && !buyerPhoneAlreadyKnown) return "phone_received";
  if (resolveImmediateHandoffReason(latest)) return "handoff_confirmation";
  if (vehicleRequest === "photos") return "vehicle_link_request";
  if (vehicleRequest === "carfax") return "carfax_request";
  if (buyerAskedVin(latest)) return "vin_inquiry";
  if (buyerAskedMileage(latest)) return "mileage_inquiry";
  if (buyerAskedColor(latest)) return "color_inquiry";
  if (buyerAskedCleanTitleAndWarranty(latest)) return "clean_title_and_warranty";
  if (buyerAskedCleanTitle(latest)) return "clean_title";
  if (buyerAskedWarrantyInfo(latest)) return "warranty_info";
  if (buyerAskedDealerHours(latest)) return "dealer_hours";
  if (buyerAskedTradeIn(latest)) return "trade_in_request";
  if (buyerAskedPaymentMethods(latest)) return "payment_methods_request";
  if (buyerRequestedVisitOrTestDrive(latest) && !hasVisitDaySignal(latest)) return "test_drive_request";
  if (buyerHasOpenQuestion(latest)) return "open_question";
  if (buyerRequestedStorePhone(latest)) return "store_phone_requested";
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
  if (
    /\b(direccion|address|ubicacion|location|donde esta(?:n|s)?|donde queda|donde se encuentra|ubicad[oa]s?|where are you|where (?:is|are).{0,40}located|where is (?:the )?(?:dealer|dealership|lot)|como llegar|how (?:do )?i get|esta en|store address|concesionario|lot location|physical address|visitar|visit the lot|come see|stop by|come by|directions|mapa|maps|google maps)\b/i.test(latestIntent)
  ) {
    return "address_request";
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
  if (buyerAskedAdvisorQuestion(latest)) return "advisor_question";
  if (historyAskedCashOrVisit(history)) return "cash_visit_request_phone";
  if (historyRequestedPhone(history)) return "request_phone";
  if (!/\b(?:Dealer|DealerPilot AI|Assistant):/i.test(history)) return "availability";
  return "general";
}

function formatVehicleDisplayName(value?: string | null): { full: string; short: string } {
  const raw = cleanConversationText(value);
  if (!raw) return { full: "vehicle", short: "vehicle" };
  const full = raw.split(/\s+/).map((part) => {
    if (/^\d{4}$/.test(part) || !/^[A-Z0-9-]{2,}$/.test(part)) return part;
    // Preserve standard model acronyms (GLB, CR-V, NX, RAV4) while making
    // all-caps makes/long words readable (CHEVROLET -> Chevrolet).
    if (part.length <= 4 || /[-\d]/.test(part)) return part;
    return part.charAt(0) + part.slice(1).toLowerCase();
  }).join(" ");
  const parts = full.split(" ");
  const short = parts.length >= 3 && /^\d{4}$/.test(parts[0]) ? parts[2] : parts[parts.length - 1];
  return { full, short: short || full };
}

function buildRedactedCopyBrief(params: {
  stage: SalesReplyStage;
  currentMessage: string;
  visibleMessages: string[];
  vehicleTitle?: string;
  vehicleFacts: MarketplaceVehicleFacts;
  storePhone: string;
  storeAddress: string;
  language: string;
  hasCleanTitleInventory: boolean;
  dealerKnowledge?: DealerMarketplaceKnowledge;
}): string {
  const names = formatVehicleDisplayName(params.vehicleTitle);
  const factsToDeliver: string[] = [];
  switch (params.stage) {
    case "open_question":
    case "advisor_question":
      factsToDeliver.push(`dealer_phone=${params.storePhone}`);
      break;
    case "availability":
      factsToDeliver.push("available");
      break;
    case "vin_inquiry":
      factsToDeliver.push(params.vehicleFacts.vin ? `vin=${params.vehicleFacts.vin}` : "vin=agent_help");
      factsToDeliver.push(`dealer_phone=${params.storePhone}`);
      break;
    case "mileage_inquiry":
      factsToDeliver.push(params.vehicleFacts.mileage != null
        ? `mileage=${params.vehicleFacts.mileage.toLocaleString("en-US")} miles`
        : "mileage=agent_help");
      break;
    case "color_inquiry":
      factsToDeliver.push(params.vehicleFacts.exteriorColor
        ? `exterior_color=${params.vehicleFacts.exteriorColor}`
        : "exterior_color=agent_help");
      break;
    case "price_inquiry":
      factsToDeliver.push(params.vehicleFacts.price != null
        ? `price=$${params.vehicleFacts.price.toLocaleString("en-US")}`
        : "price=agent_help");
      break;
    case "vehicle_link_request":
      if (params.vehicleFacts.vdpUrl) {
        factsToDeliver.push(`vdp_url=${params.vehicleFacts.vdpUrl}`);
      } else {
        factsToDeliver.push("sales_agent_vehicle_photos");
        factsToDeliver.push(`dealer_phone=${params.storePhone}`);
      }
      break;
    case "store_phone_requested":
      factsToDeliver.push(`dealer_phone=${params.storePhone}`);
      break;
    case "carfax_request":
      factsToDeliver.push("sales_agent_report");
      factsToDeliver.push(`dealer_phone=${params.storePhone}`);
      break;
    case "address_request":
      factsToDeliver.push(`dealer_address=${params.storeAddress}`);
      factsToDeliver.push(`dealer_phone=${params.storePhone}`);
      break;
    case "test_drive_request":
      factsToDeliver.push(`dealer_address=${params.storeAddress}`);
      factsToDeliver.push("dealer_hours");
      break;
    case "dealer_hours":
      factsToDeliver.push("dealer_hours");
      break;
    case "trade_in_request":
      factsToDeliver.push("trade_in_policy");
      break;
    case "payment_methods_request":
      factsToDeliver.push("payment_methods");
      break;
    case "clean_title":
    case "clean_title_and_warranty":
    case "warranty_info":
      if (params.hasCleanTitleInventory) factsToDeliver.push("clean_title");
      factsToDeliver.push("sales_agent_report");
      break;
    default:
      break;
  }
  const buyerTurnCount = params.visibleMessages
    .map(parseConversationMessage)
    .filter((message) => message?.role === "user").length + 1;
  const alreadyNamed = params.visibleMessages.some((message) =>
    normalizeIntentText(message).includes(normalizeIntentText(names.full)),
  );
  const shortBuyerMessage = cleanConversationText(params.currentMessage).length <= 80;
  return JSON.stringify({
    intent: params.stage,
    buyer_message: params.currentMessage,
    buyer_language: params.language,
    buyer_style: shortBuyerMessage ? "short_informal" : "conversational",
    turn_number: buyerTurnCount,
    vehicle: {
      display_name: names.full,
      short_name: names.short,
      already_named: alreadyNamed,
    },
    facts_to_deliver: factsToDeliver,
    next_step: params.stage,
    greeting_allowed: isFirstDealerReply(params.visibleMessages),
  });
}

function removePhoneNumbers(value: string): string {
  return value.replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, " ");
}

function replyMentionsUnrequestedVehicleFact(
  reply: string,
  stage: SalesReplyStage,
  facts: MarketplaceVehicleFacts,
): boolean {
  const normalizedReply = normalizeIntentText(reply);
  const replyDigits = removePhoneNumbers(reply).replace(/\D/g, "");
  const mentioned = {
    vin: !!facts.vin?.trim() && normalizedReply.includes(normalizeIntentText(facts.vin)),
    mileage: facts.mileage != null && replyDigits.includes(String(Math.round(Number(facts.mileage)))),
    price: facts.price != null && replyDigits.includes(String(Math.round(Number(facts.price)))),
    color: !!facts.exteriorColor?.trim() && normalizedReply.includes(normalizeIntentText(facts.exteriorColor)),
    vdpUrl: !!facts.vdpUrl && reply.includes(facts.vdpUrl),
  };
  const allowed = new Set<string>(
    stage === "vin_inquiry" ? ["vin"]
      : stage === "mileage_inquiry" ? ["mileage"]
        : stage === "color_inquiry" ? ["color"]
          : stage === "price_inquiry" ? ["price"]
            : stage === "vehicle_link_request" ? ["vdpUrl"]
              : [],
  );
  return Object.entries(mentioned).some(([key, value]) => value && !allowed.has(key));
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
  hasCleanTitleInventory: boolean = false,
  dealerKnowledge?: DealerMarketplaceKnowledge,
): string {
  const vehicleNames = formatVehicleDisplayName(vehicleTitle);
  const hasPriorDealerReply = historyHasDealerReply(visibleMessages);
  const vehicle = vehicleTitle
    ? (hasPriorDealerReply
      ? vehicleNames.short
      : vehicleNames.full)
    : (language === "es" ? "vehículo" : "vehicle");
  const stage = resolveSalesReplyStage(visibleMessages, currentMessage, downPaymentPolicy);
  const storeAddress = resolveStoreAddress(lotLocation, dealerKnowledge);
  const knowledge = (key: keyof NonNullable<DealerMarketplaceKnowledge["en"]>, fallback: string) =>
    dealerKnowledgeValue(dealerKnowledge, language, key, fallback);
  if (language === "es") {
    if (stage === "open_question") {
      return `Con gusto te ayudan nuestros agentes de ventas con ese detalle. También puedes llamar a Alpha Motorsports al ${storePhone}. ¿A qué número te contactamos?`;
    }
    if (stage === "vehicle_link_request") {
      return buildVehiclePhotoRequestReply("es", storePhone);
    }
    if (stage === "carfax_request") {
      return `Nuestros agentes de ventas tienen el reporte Carfax. ¿A qué número te lo enviamos? También puedes llamar a Alpha Motorsports al ${storePhone}.`;
    }
    if (stage === "store_phone_requested") {
      return `Con gusto, nuestro número es ${storePhone}. Quedamos atentos.`;
    }
    if (stage === "phone_received") {
      return "Perfecto, un agente de ventas te contactará en breve.";
    }
    if (stage === "handoff_confirmation") {
      return "Perfecto, un agente de ventas te contactará en breve.";
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
      return `Sí, todavía tenemos el ${vehicle} disponible. Estamos en ${knowledge("address", storeAddress)}. Nuestro número es ${storePhone}. ¿Cuál es el mejor número para comunicarnos contigo?`;
    }
    if (stage === "test_drive_request") {
      return `Puedes venir cuando quieras — estamos en ${knowledge("address", storeAddress)}, ${knowledge("hours", "lunes a sábado de 9am a 8pm")}. ¿Qué día te queda mejor?`;
    }
    if (stage === "dealer_hours") {
      return `Nuestro horario es ${knowledge("hours", "lunes a sábado de 9am a 8pm")}. ¿Qué día te queda mejor?`;
    }
    if (stage === "trade_in_request") {
      return `${knowledge("tradeIn", "Sí, recibimos su carro como parte de pago")}. ¿Qué te gustaría saber?`;
    }
    if (stage === "payment_methods_request") {
      return `${knowledge("payment", "Contado y financiamiento")}. ¿Qué opción te interesa?`;
    }
    if (stage === "inventory_options") {
      return `Sí, tenemos más vehículos disponibles además del ${vehicle}. ¿Qué opción te gustaría conocer?`;
    }
    if (stage === "document_requirements") {
      return `${knowledge("financingRequirements", "Para avanzar necesitamos identificación y comprobante de ingresos")}. ¿Cuentas con ambos?`;
    }
    if (stage === "clean_title") {
      return hasCleanTitleInventory
        ? knowledge("title", "Todos nuestros vehículos son de título limpio")
        : `Nuestros agentes de ventas tienen el reporte del ${vehicle} y pueden confirmar el título y los detalles de la garantía. ¿A qué número te enviamos el reporte?`;
    }
    if (stage === "clean_title_and_warranty") {
      return hasCleanTitleInventory
        ? `Sí, el ${vehicle} tiene título limpio. Nuestros agentes de ventas tienen el reporte del vehículo y pueden darte los detalles de la garantía, incluso para una compra de contado. ¿A qué número te enviamos el reporte?`
        : `Nuestros agentes de ventas tienen el reporte del ${vehicle} y pueden confirmar el título y los detalles de la garantía, incluso para una compra de contado. ¿A qué número te enviamos el reporte?`;
    }
    if (stage === "warranty_info") {
      return hasCleanTitleInventory
        ? `${knowledge("title", `Sí, el ${vehicle} tiene título limpio`)}. ${knowledge("carfax", "Nuestros agentes de ventas tienen el reporte Carfax")} y ${knowledge("warranty", "pueden darte los detalles de la garantía")}. ¿A qué número te lo enviamos?`
        : `Nuestros agentes de ventas tienen el reporte del ${vehicle} y pueden confirmar el título y los detalles de la garantía. ¿A qué número te enviamos el reporte?`;
    }
    if (stage === "advisor_question") {
      return `Nuestros agentes de ventas pueden confirmar ese detalle del ${vehicle}. También puedes llamar a Alpha Motorsports al ${storePhone}. ¿A qué número te contactamos?`;
    }
    return `Con gusto te ayudo con el ${vehicle}. ¿Qué te gustaría saber?`;
  }
  if (stage === "open_question") {
    return `Our sales agents can help with that detail. You can also call Alpha Motorsports at ${storePhone}. What number should we use to reach you?`;
  }
  if (stage === "vehicle_link_request") {
    return buildVehiclePhotoRequestReply("en", storePhone);
  }
  if (stage === "carfax_request") {
    return `Our sales agents have the Carfax report. What phone number should we send it to? You can also call Alpha Motorsports at ${storePhone}.`;
  }
    if (stage === "store_phone_requested") {
      return `Of course, our number is ${storePhone}. We are here if you need anything else.`;
    }
  if (stage === "phone_received") {
    return "Perfect, a sales agent will reach out to you shortly.";
  }
  if (stage === "handoff_confirmation") {
    return "Perfect, a sales agent will reach out to you shortly.";
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
    return `Yes, we still have the ${vehicle} available. We’re at ${knowledge("address", storeAddress)}. Our number is ${storePhone}. What’s the best number to reach you?`;
  }
  if (stage === "test_drive_request") {
    return `You can come by anytime — we're at ${knowledge("address", storeAddress)}, ${knowledge("hours", "Monday-Saturday from 9am to 8pm")}. What day works best for you?`;
  }
  if (stage === "dealer_hours") {
    return `Our hours are ${knowledge("hours", "Monday-Saturday from 9am to 8pm")}. What day works best for you?`;
  }
  if (stage === "trade_in_request") {
    return `${knowledge("tradeIn", "Yes, we take trade-ins")}. What would you like to know?`;
  }
  if (stage === "payment_methods_request") {
    return `${knowledge("payment", "Cash and financing")}. Which option interests you?`;
  }
  if (stage === "inventory_options") {
    return `Yes, we have more vehicles available besides the ${vehicle}. Which option would you like to explore?`;
  }
    if (stage === "document_requirements") {
      return `${knowledge("financingRequirements", "To move forward, we need a valid ID and proof of income")}. Do you have both?`;
  }
  if (stage === "clean_title") {
    return hasCleanTitleInventory
      ? knowledge("title", "All our vehicles have a clean title")
      : `Our sales agents have the report for the ${vehicle} and can confirm the title and warranty details. What number should we send the report to?`;
  }
  if (stage === "clean_title_and_warranty") {
    return hasCleanTitleInventory
      ? `Yes, the ${vehicle} has a clean title. Our sales agents have the vehicle report and can provide the warranty details, including what applies if you pay cash. What number should we send the report to?`
      : `Our sales agents have the report for the ${vehicle} and can confirm the title and warranty details, including what applies if you pay cash. What number should we send the report to?`;
  }
  if (stage === "warranty_info") {
    return hasCleanTitleInventory
      ? `${knowledge("title", `Yes, the ${vehicle} has a clean title`)}. ${knowledge("carfax", "Our sales agents have the Carfax report")} and ${knowledge("warranty", "handle the warranty details")}. What number should we send it to?`
      : `Our sales agents have the report for the ${vehicle} and can confirm the title and warranty details. What number should we send the report to?`;
  }
  if (stage === "advisor_question") {
    return `Great question. We can confirm that detail for the ${vehicle}. What would you like to know?`;
  }
  return `I'd be happy to help with the ${vehicle}. What would you like to know?`;
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
  hasCleanTitleInventory: boolean = false,
  dealerKnowledge?: DealerMarketplaceKnowledge,
): string {
  const requestKind = detectVehicleRequestKind(currentMessage);
  const stage = resolveSalesReplyStage(visibleMessages, currentMessage, downPaymentPolicy);
  if (requestKind === "photos" && vehicleFacts?.vdpUrl) {
    return language === "es"
      ? `Aquí está la ficha completa con todas las fotos: ${vehicleFacts.vdpUrl}.`
      : `Here is the complete vehicle page with all the photos: ${vehicleFacts.vdpUrl}.`;
  }
  if (requestKind === "photos") return buildVehiclePhotoRequestReply(language === "es" ? "es" : "en", storePhone);
  if (stage === "price_inquiry" && vehicleFacts?.price != null) {
    return language === "es"
      ? `El precio publicado es $${vehicleFacts.price.toLocaleString("en-US")}. ¿Qué te gustaría saber?`
      : `The listed price is $${vehicleFacts.price.toLocaleString("en-US")}. What would you like to know?`;
  }
  if (stage === "vin_inquiry" && vehicleFacts?.vin) {
    return language === "es"
      ? `El VIN es ${vehicleFacts.vin}. También puedes llamar a Alpha Motorsports al ${storePhone}. ¿Cuál es el mejor número para comunicarnos contigo?`
      : `The VIN is ${vehicleFacts.vin}. You can also call Alpha Motorsports at ${storePhone}. What is the best number to reach you?`;
  }
  if (stage === "mileage_inquiry" && vehicleFacts?.mileage != null) {
    const mileage = Number(vehicleFacts.mileage).toLocaleString("en-US");
    return language === "es"
      ? `Tiene ${mileage} millas. ¿Qué más te gustaría saber?`
      : `It has ${mileage} miles. What else would you like to know?`;
  }
  if (stage === "color_inquiry" && vehicleFacts?.exteriorColor) {
    return language === "es"
      ? `Es color ${vehicleFacts.exteriorColor}. ¿Qué más te gustaría saber?`
      : `It is ${vehicleFacts.exteriorColor} exterior. What else would you like to know?`;
  }
  if (stage === "vin_inquiry") {
    return language === "es"
      ? `Nuestros agentes de ventas pueden ayudarte con ese dato. También puedes llamar a Alpha Motorsports al ${storePhone}. ¿A qué número te contactamos?`
      : `Our sales agents can help with that detail. You can also call Alpha Motorsports at ${storePhone}. What number should we use to reach you?`;
  }
  if (stage === "mileage_inquiry") {
    return language === "es"
      ? "Nuestros agentes de ventas pueden ayudarte con ese dato. ¿A qué número te contactamos?"
      : "Our sales agents can help with that detail. What number should we use to reach you?";
  }
  if (stage === "color_inquiry") {
    return language === "es"
      ? "Nuestros agentes de ventas pueden ayudarte con ese dato. ¿A qué número te contactamos?"
      : "Our sales agents can help with that detail. What number should we use to reach you?";
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
    hasCleanTitleInventory,
    dealerKnowledge,
  );
  return base;
}

function isAiReplyAligned(
  reply: string,
  stage: SalesReplyStage,
  storePhone: string,
  firstDealerReply: boolean = false,
  downPaymentPolicy: DownPaymentPolicy = NO_DOWN_PAYMENT_POLICY,
  vehicleFacts?: MarketplaceVehicleFacts,
  hasCleanTitleInventory: boolean = false,
): boolean {
  const normalized = cleanConversationText(reply).toLowerCase();
  if (!normalized) return false;
  if (/(?:no tengo|i do not have|i don't have|not confirmed|no est[aá] confirmado|no est[aá] disponible|not available)/i.test(normalized)) return false;
  const legacyLocationToken = String.fromCharCode(
    102, 114, 101, 100, 101, 114, 105, 99, 107, 115, 98, 117, 114, 103,
  );
  const legacyAddressToken = ["410", "hudgins"].join(" ");
  if (normalized.includes(legacyLocationToken) || normalized.includes(legacyAddressToken)) return false;
  if (!replyUsesOnlyConfiguredDownPayments(reply, downPaymentPolicy)) return false;
  if (firstDealerReply && stage !== "store_phone_requested" && !replyHasFirstGreeting(reply)) return false;
  if (firstDealerReply && /\b(?:finance|financing|financiamiento|financiar)\b/i.test(normalized)) return false;
  if (!isConciseMarketplaceReply(reply) && stage !== "address_request") return false;
  if (vehicleFacts && replyMentionsUnrequestedVehicleFact(reply, stage, vehicleFacts)) return false;
  const stagesAllowedToMentionNumericVehicleDetails = new Set<SalesReplyStage>([
    "price_inquiry",
    "mileage_inquiry",
    "down_payment_request",
    "down_payment_low",
    "down_payment_declined",
  ]);
  if (replyGivesRestrictedVehicleDetails(reply) && !stagesAllowedToMentionNumericVehicleDetails.has(stage)) return false;
  if (replyClaimsUnrequestedVehicleStatus(reply, stage)) return false;
  if (replyContainsUnauthorizedPromise(reply)) return false;
  if (replyClaimsConfirmedAppointment(reply)) return false;
  if (replyMentionsWrongVehicleYear(reply, vehicleFacts)) return false;
  if (
    stageRequiresStorePhone(stage) &&
    !(stage === "vehicle_link_request" && vehicleFacts?.vdpUrl) &&
    !replyIncludesStorePhone(reply, storePhone)
  ) return false;
  if (/\badvisor\b|\basesor\b/i.test(normalized)) return false;
  if (stage === "open_question") {
    return /(?:detail|detalle|information|informaci[oó]n|question|pregunta|sales agent|agente de ventas|number|n[uú]mero)/i.test(normalized) &&
      /\?/.test(reply) &&
      !/financ|financing|down payment|enganche|inicial|document|requisit|follow[- ]?up/.test(normalized);
  }
  if (stage === "vehicle_link_request") {
    if (vehicleFacts?.vdpUrl) {
      return reply.includes(vehicleFacts.vdpUrl) &&
        /(?:photo|photos|picture|pictures|image|images|foto|fotos|imagen|imagenes)/.test(normalized) &&
        !/phone|number|tel[eé]fono|n[uú]mero|financ|financing/.test(normalized);
    }
    return /(?:sales agent|sales agents|agente de ventas|vendedor)/.test(normalized) &&
      /(?:photo|photos|picture|pictures|image|images|foto|fotos|imagen|imagenes)/.test(normalized) &&
      /phone|number|tel[eé]fono|n[uú]mero/.test(normalized) &&
      /\?/.test(reply) &&
      !/https?:\/\//.test(normalized) &&
      !/financ|financing/.test(normalized);
  }
  if (stage === "carfax_request") {
    const hasAgent = /(?:sales agent|salesperson|sales representative|agente de ventas|vendedor)/.test(normalized);
    const hasSend = /(?:send|enviar|will send|te env[ií]an|te lo env[ií]amos)/.test(normalized);
    const asksForPhone = /phone|number|tel[eé]fono|n[uú]mero/.test(normalized) && /\?/.test(reply);
    const offersStorePhone = replyIncludesStorePhone(reply, storePhone) && !/\?/.test(reply);
    return /(?:carfax|vehicle report|reporte|historial|accident|accidente)/.test(normalized) &&
      hasAgent && hasSend &&
      (asksForPhone || offersStorePhone) &&
      !/https?:\/\//.test(normalized) &&
      !/financ|financing/.test(normalized);
  }
  if (stage === "vin_inquiry") {
    const asksForBuyerPhone = /(?:what number should we use|best (?:phone )?number|what(?:'s| is) the best number|a que numero te contactamos|cual es el mejor numero|numero para comunicarnos|telefono.*contactamos)/.test(normalized);
    return (vehicleFacts?.vin ? normalized.includes(vehicleFacts.vin.toLowerCase()) : /\bvin\b/.test(normalized)) &&
      asksForBuyerPhone && replyIncludesStorePhone(reply, storePhone) && !/financ|financing/.test(normalized);
  }
  if (stage === "mileage_inquiry") {
    return (vehicleFacts?.mileage != null
      ? normalized.replace(/\D/g, "").includes(String(Math.round(Number(vehicleFacts.mileage))))
      : /mileage|miles|millas|kilometraje/.test(normalized)) &&
      /\?/.test(reply) && !/financ|financing/.test(normalized);
  }
  if (stage === "color_inquiry") {
    return (vehicleFacts?.exteriorColor
      ? normalized.includes(normalizeIntentText(vehicleFacts.exteriorColor))
      : /color|colour/.test(normalized)) &&
      /\?/.test(reply) && !/financ|financing/.test(normalized);
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
  if (stage === "test_drive_request") {
    return /9120\s+euclid|manassas/.test(normalized) &&
      /(?:hour|hours|horario|lunes|s[aá]bado|domingo|monday|saturday|sunday|9am|10am)/.test(normalized) &&
      /\?/.test(reply) &&
      !/phone|number|tel[eé]fono|n[uú]mero|appointment|cita|scheduled|programad/.test(normalized);
  }
  if (stage === "dealer_hours") {
    return /(?:hour|hours|horario|abren|open|sunday|domingo|monday|lunes)/.test(normalized) && /\?/.test(reply);
  }
  if (stage === "trade_in_request") {
    return /(?:trade[- ]?in|trade-ins|parte de pago|recibimos|take trade)/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  if (stage === "payment_methods_request") {
    return /(?:cash|contado|financing|financiamiento)/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  if (stage === "phone_received") {
    return /(?:sales agent|salesperson|sales representative|agente de ventas|vendedor)/.test(normalized) &&
      /(?:reach out|contact|contactar|comunicar|pondr[aá] en contacto)/.test(normalized) &&
      !/\?/.test(reply);
  }
  if (stage === "handoff_confirmation") {
    return /(?:sales agent|salesperson|sales representative|agente de ventas|vendedor)/.test(normalized) &&
      /(?:reach out|contact|contactar|comunicar|pondr[aá] en contacto|send|enviar)/.test(normalized) &&
      !/\?/.test(reply);
  }
  if (stage === "down_payment_request") {
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
  if (stage === "address_request") {
    return /9120\s+euclid|manassas/.test(normalized) &&
      /available|disponible/.test(normalized) &&
      /\?/.test(reply) &&
      /phone|number|tel[eé]fono|n[uú]mero/.test(normalized) &&
      replyIncludesStorePhone(reply, storePhone);
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
    if (hasCleanTitleInventory) {
      return /clean title|clear title|titulo limpio|t[ií]tulo limpio/.test(normalized) &&
        !/phone|number|tel[eé]fono|n[uú]mero|warranty|carfax|report|reporte/.test(normalized);
    }
    return /confirm|confirmar|report|reporte|title|t[ií]tulo/.test(normalized) &&
      !/clean title|clear title|titulo limpio|t[ií]tulo limpio/.test(normalized) &&
      /vehicle report|reporte del veh[ií]culo|report|reporte|sales agent|salesperson|agentes de ventas|vendedor/.test(normalized) &&
      /phone|number|tel[eé]fono|n[uú]mero/.test(normalized) &&
      !/financ|financing/.test(normalized);
  }
  if (stage === "clean_title_and_warranty") {
    return (hasCleanTitleInventory
      ? /clean title|clean-title|titulo limpio|t[ií]tulo limpio/.test(normalized) &&
        /(?:yes|s[ií]|has a clean title|tiene t[ií]tulo limpio)/.test(normalized)
      : /confirm|confirmar|report|reporte|title|t[ií]tulo/.test(normalized) &&
        !/clean title|clear title|titulo limpio|t[ií]tulo limpio/.test(normalized)) &&
      /warranty|coverage|garantia|cobertura/.test(normalized) &&
      /vehicle report|reporte del veh[ií]culo|sales agent|salesperson|agentes de ventas|vendedor/.test(normalized) &&
      /phone|number|tel[eé]fono|n[uú]mero/.test(normalized) &&
      !/financ|financing/.test(normalized);
  }
  if (stage === "warranty_info") {
    return (hasCleanTitleInventory
      ? /clean title|clean-title|titulo limpio|t[ií]tulo limpio/.test(normalized)
      : /confirm|confirmar|report|reporte|title|t[ií]tulo/.test(normalized) &&
        !/clean title|clear title|titulo limpio|t[ií]tulo limpio/.test(normalized)) &&
      /warranty|coverage|garantia|cobertura/.test(normalized) &&
      /vehicle report|reporte del veh[ií]culo|sales agent|salesperson|agentes de ventas|vendedor/.test(normalized) &&
      /phone|number|tel[eé]fono|n[uú]mero/.test(normalized) &&
      !/financ|financing/.test(normalized);
  }
  if (stage === "advisor_question") {
    return /detail|detalle|confirm|confirmar|verify|verificar/.test(normalized) &&
      /(?:what would you like to know|qué te gustaría saber|que te gustaria saber|what number should we use|best (?:phone )?number|a que numero te contactamos|cual es el mejor numero|numero para comunicarnos|telefono.*contactamos)/.test(normalized) &&
      /phone|number|tel[eé]fono|n[uú]mero/.test(normalized) &&
      replyIncludesStorePhone(reply, storePhone) &&
      !/financ|financing/.test(normalized);
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
      reply: /\b(?:photos?|pictures?|images?|fotos?|fotograf[ií]as?|im[aá]genes?)\b/,
      buyer: /\b(?:photos?|pictures?|images?|fotos?|fotograf[ií]as?|im[aá]genes?|pics?)\b/,
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
  hasCleanTitleInventory: boolean = false,
  dealerKnowledge?: DealerMarketplaceKnowledge,
): string {
  if (!replyRepeatsRecentDealerMessage(reply, visibleMessages)) return reply;
  const configuredPhone = resolveStorePhone(undefined, dealerKnowledge);
  const stage = resolveSalesReplyStage(visibleMessages, currentMessage, downPaymentPolicy);
  const vehicleNames = formatVehicleDisplayName(vehicleTitle);
  const vehicle = vehicleTitle
    ? (historyHasDealerReply(visibleMessages)
      ? vehicleNames.short
      : vehicleNames.full)
    : (language === "es" ? "vehículo" : "vehicle");
  if (stage === "open_question") {
      return language === "es"
      ? `Con gusto te ayudan nuestros agentes de ventas con ese detalle. También puedes llamar a Alpha Motorsports al ${configuredPhone}. ¿A qué número te contactamos?`
      : `Our sales agents can help with that detail. You can also call Alpha Motorsports at ${configuredPhone}. What number should we use to reach you?`;
  }
  if (stage === "vin_inquiry") {
    const vin = vehicleFacts?.vin?.trim();
    return language === "es"
      ? `${vin ? `El VIN es ${vin}. ` : "Nuestros agentes de ventas pueden ayudarte con ese dato. "}También puedes llamar a Alpha Motorsports al ${configuredPhone}. ¿A qué número te contactamos?`
      : `${vin ? `The VIN is ${vin}. ` : "Our sales agents can help with that detail. "}You can also call Alpha Motorsports at ${configuredPhone}. What number should we use to reach you?`;
  }
  if (stage === "carfax_request") {
    return language === "es"
      ? `Nuestros agentes de ventas tienen el reporte Carfax. ¿A qué número te lo enviamos? También puedes llamar a Alpha Motorsports al ${configuredPhone}.`
      : `Our sales agents have the Carfax report. What phone number should we send it to? You can also call Alpha Motorsports at ${configuredPhone}.`;
  }
  if (stage === "warranty_info" || stage === "advisor_question") {
    if (stage === "advisor_question") {
      return language === "es"
        ? `Con gusto te ayudan nuestros agentes de ventas con ese detalle. También puedes llamar a Alpha Motorsports al ${configuredPhone}. ¿A qué número te contactamos?`
        : `Our sales agents can help with that detail. You can also call Alpha Motorsports at ${configuredPhone}. What number should we use to reach you?`;
    }
    const reply = hasCleanTitleInventory
      ? language === "es"
        ? `Sí, el ${vehicle} tiene título limpio. Nuestros agentes de ventas tienen el reporte del vehículo y pueden darte los detalles de la garantía. ¿A qué número te enviamos el reporte?`
        : `Yes, the ${vehicle} has a clean title. Our sales agents have the vehicle report and can provide the warranty details. What number should we send the report to?`
      : language === "es"
        ? `Nuestros agentes de ventas tienen el reporte del ${vehicle} y pueden confirmar el título y los detalles de la garantía. ¿A qué número te enviamos el reporte?`
        : `Our sales agents have the report for the ${vehicle} and can confirm the title and warranty details. What number should we send the report to?`;
    return reply;
  }
  if (stage === "clean_title") {
    const reply = hasCleanTitleInventory
      ? language === "es"
        ? `Sí, el ${vehicle} tiene título limpio. Nuestros agentes de ventas tienen el reporte del vehículo y pueden darte los detalles de la garantía. ¿A qué número te enviamos el reporte?`
        : `Yes, the ${vehicle} has a clean title. Our sales agents have the vehicle report and can provide the warranty details. What number should we send the report to?`
      : language === "es"
        ? `Nuestros agentes de ventas tienen el reporte del ${vehicle} y pueden confirmar el título y los detalles de la garantía. ¿A qué número te enviamos el reporte?`
        : `Our sales agents have the report for the ${vehicle} and can confirm the title and warranty details. What number should we send the report to?`;
    return reply;
  }
  if (stage === "clean_title_and_warranty") {
    const reply = hasCleanTitleInventory
      ? language === "es"
        ? `Sí, el ${vehicle} tiene título limpio. Nuestros agentes de ventas tienen el reporte del vehículo y pueden darte los detalles de la garantía, incluso para una compra de contado. ¿A qué número te enviamos el reporte?`
        : `Yes, the ${vehicle} has a clean title. Our sales agents have the vehicle report and can provide the warranty details, including what applies if you pay cash. What number should we send the report to?`
      : language === "es"
        ? `Nuestros agentes de ventas tienen el reporte del ${vehicle} y pueden confirmar el título y los detalles de la garantía, incluso para una compra de contado. ¿A qué número te enviamos el reporte?`
        : `Our sales agents have the report for the ${vehicle} and can confirm the title and warranty details, including what applies if you pay cash. What number should we send the report to?`;
    return reply;
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
  "vin_inquiry",
  "mileage_inquiry",
  "color_inquiry",
  "price_inquiry",
  "financing_intro",
  "financing_declined",
  "cash_visit_request_phone",
  "urgent_vehicle_request_phone",
  "stalled_conversation_request_phone",
  "salesperson_request_phone",
  "request_phone",
  "phone_received",
  "handoff_confirmation",
  "address_request",
  "test_drive_request",
  "dealer_hours",
  "trade_in_request",
  "payment_methods_request",
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

DEALER KNOWLEDGE RULE: The supplied dealer knowledge block is the authoritative, editable source for address, phone, hours, title, test drive, trade-in, payment, financing requirements, Carfax, and warranty. Use the block for the current dealer only; never use a shared dealer default when a value is missing.

QUALIFICATION FUNNEL FOR ALPHA MANASSAS:
1. Start with a warm greeting as Alpha Motorsports, confirm that the exact vehicle from the Vehicle field is available, and ask what the buyer would like to know. Do not add mileage, color, VIN, price, or other feed facts unless the buyer asked for them. Never ask about financing in the first reply.
2. Answer the buyer's latest question first using only the Feed-backed Vehicle facts they asked for: VIN, mileage, color, price, photos, or more information. Give only the requested fact or facts; never turn the reply into a technical spec sheet. If the buyer confirms interest, ask whether this week or the weekend works better; do not ask for a phone number yet.
3. If the buyer asks when they can test drive, provide the dealer address and hours from the knowledge block and ask what day works. Do not invent an appointment or say one is confirmed. Once the buyer gives a visit day or proposes coming to the lot, ask for the buyer's phone number to confirm the tentative visit.
4. A buyer phone number, a down-payment amount, or a concrete cash offer triggers immediate handoff. Save the lead, assign it to BDC, and do not ask another qualification question or send another bot question after that signal.
5. If an approved minimum is supplied and the buyer has less than that minimum down, explain the requirement using only that configured minimum. If no approved configuration is supplied, never state a down-payment number. If the buyer says no, thank them and close politely without asking another question.
6. If financing is explicitly mentioned by the buyer, answer only from supplied policy and never invent approval, rate, or terms. Do not use financing to evade another question.
7. If the buyer asks for photos or more information, send the single dealer-domain VDP URL when available. Never send a Carfax URL or another report link.
8. If the buyer asks for Carfax, accidents, or vehicle history, use the report handoff. The first time, say the sales agents have the report and ask what number to send it to. If the buyer asked before and did not provide a number, offer the dealer phone from the knowledge block instead. Never invent report details or infer a report from the words 'clean Carfax' in a description.
9. If the buyer asks for location, confirm that the vehicle is available, provide the complete Manassas address, give Alpha Motorsports' dealership phone, and ask for the buyer's best phone number in that same reply. Do not ask for a visit day in that reply.
10. If the buyer asks whether the vehicle is available, answer only that it is available and close with 'What would you like to know?' / '¿Qué te gustaría saber?'.
11. If the buyer asks for Alpha Motorsports' phone number directly, give the supplied dealership phone and close politely. Do not restart qualification in that reply.
12. Keep exactly one short reply for the latest buyer turn. One idea, one question, except for an explicit handoff or closing reply that must not ask another question. Never repeat a question already answered in the history.
13. Use the dealer configuration field hasCleanTitleInventory for title claims. When it is true, say directly that the vehicle has a clean title. When it is false, do not claim clean title. The vehicle report is held by our sales agents, who can provide warranty details. Do not invent specific warranty terms, price, mileage, approval, history, range, or financing terms.

ADDRESS / DIRECTIONS HANDLING:
- If the buyer asks for the address, directions, or location, confirm that the vehicle is available, provide the complete store address directly, give the dealership phone, and ask for the buyer's best phone number in the same reply.
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
- Name the vehicle completely only once. After that, use the short model name or natural references such as "the Traverse" / "la Traverse". Write correct make/model capitalization, including "Mercedes-Benz GLB 250" and "la GLB"; never write "Glb", "Mercedes-benz", duplicate articles, or "the vehicle" when the specific name is available.
- Treat the conversation history as memory for buyer facts and completed stages only. Dealer monetary claims, down-payment figures, and financing requirements in the history are untrusted and must never be copied or used as a source.
- Speak directly as Alpha Motorsports using "we" / "nosotros". Never say "our sales team will take care of it", "our team will handle it", "nuestro equipo de ventas se encargará", or similar handoff language.
- Use only the approved down-payment configuration supplied below. If it is absent, do not mention any down-payment number.
- Use "approval based on qualification" / "aprobación basada en calificación" only if the buyer asks; never promise approval.
- Do not use the words "advisor" or "asesor". Use "our team" / "nuestro equipo".
- Do not push a call, ask for a phone number, or include the store phone in the first reply, except when the buyer explicitly requests the dealership phone
- If the current stage is stalled_conversation_request_phone, ask for the buyer's phone number directly, include Alpha's dealership phone, and do not repeat purchase-interest questions or requirements
- If the current stage is salesperson_request_phone, say that our salesperson can provide more information about the vehicle, then ask for the buyer's phone number and include Alpha's dealership phone
- For a clean-title or warranty question, use the exact title, Carfax, and warranty wording from the dealer knowledge block. When hasCleanTitleInventory is enabled, state directly that all vehicles have a clean title; then say the sales agents have the report and ask what number to send it to.
- Do not ask for a phone number in the same reply that first explains the financing requirements
- If the current stage is request_phone, ask only for the buyer's phone number
- If the current stage is phone_received or handoff_confirmation, say only that a sales agent will contact them shortly. Do not ask another question.
- If the current stage is qualified_exit, include the Alpha Manassas dealership phone at the end and do not ask a question
- If the current stage is store_phone_requested, give only Alpha's dealership phone and a brief polite closing; do not ask a question
- NEVER say: guaranteed approval, everyone approved, bad credit, denied, rejected, disqualified, "no tengo ese detalle confirmado", "I do not have that detail confirmed", "not confirmed", or variants that open by saying the bot is ignorant of the answer.
- NEVER promise a loan or specific rate
- NEVER invent price, vehicle history, or financing terms. The only down-payment figures you may mention are those in the approved configuration supplied below.

Reply format:
- Keep it SHORT — one or two short sentences
- Ask only one question at a time
- Respect the current qualification stage and all safety conditions, but express it like a human conversation rather than copying a script
- Never refer to the vehicle as "your vehicle", "your car", "tu vehículo", or "tu carro". Always say "the vehicle" / "el vehículo" or use the specific make/model.
`;

export { detectLanguage } from "../conversations/language";

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
  hasCleanTitleInventory: boolean = false,
  dealerKnowledge?: DealerMarketplaceKnowledge,
): Promise<string> {
  const langNote =
    language === "es"
      ? "The latest buyer message is Spanish. Respond ONLY in Spanish. Do not include English."
      : "The latest buyer message is English. Respond ONLY in English. Do not include Spanish.";

  const storeAddress = resolveStoreAddress(lotLocation, dealerKnowledge);
  void publishedDownPayment;
  void vehicleType;
  const stage = resolveSalesReplyStage(visibleMessages, currentMessage, downPaymentPolicy);
  const persistentUnansweredBuyerTurns = hasPersistentUnansweredBuyerTurns(
    visibleMessages,
    currentMessage,
  );
  const firstDealerReply = isFirstDealerReply(visibleMessages);
  const promptStage = stage === "advisor_question" ? "detailed_question" : stage;
  const redactedCopyBrief = buildRedactedCopyBrief({
    stage,
    currentMessage,
    visibleMessages,
    vehicleTitle,
    vehicleFacts,
    storePhone,
    storeAddress,
    language,
    hasCleanTitleInventory,
    dealerKnowledge,
  });
  const stageInstruction = {
    open_question: `The buyer asked a question that must be answered before qualification advances. If the dealer knowledge block does not contain the answer, say that the sales agents can help, give Alpha Motorsports' dealership phone ${storePhone}, and ask for the buyer's best phone number in the same reply. Never open with ignorance or say that a detail is not confirmed. Do not ask financing, down payment, or documents.`,
    availability: availabilityQuickReplyAccepted
      ? "Greet as Alpha Motorsports, state only that the exact vehicle is available, then ask what the buyer would like to know. Do not add mileage, price, color, VIN, or other feed facts. Do not ask for a phone number or financing."
      : "Greet as Alpha Motorsports, explicitly confirm only that the exact vehicle is available, then ask what the buyer would like to know. Do not add mileage, price, color, VIN, or other feed facts. Do not ask for a phone number or financing.",
    interest_confirmation: "Confirm the exact vehicle is available and ask whether this week or the weekend works better. Do not add unrequested feed facts or ask for a phone number yet.",
    interest_declined: "Thank the buyer for their time and close politely. Do not ask another question.",
    store_phone_requested: `The buyer requested Alpha Motorsports' phone number. Reply immediately with exactly the supplied dealership phone: ${storePhone}. Start with \"Con gusto, nuestro número es\" / \"Of course, our number is\", add a short polite closing, and do not ask a question, request buyer information, or mention financing requirements.`,
    price_inquiry: vehicleFacts.price != null
      ? `Answer only with the feed-backed listed price $${vehicleFacts.price.toLocaleString("en-US")}, then ask what the buyer would like to know next. Do not add another vehicle fact, ask for a phone number, or mention financing.`
      : "The buyer is asking for price, but the feed does not contain it. Say that the sales agents can help with that detail and ask what number to use to reach the buyer. Do not invent a number.",
    financing_intro: "The buyer is ready to continue. Do not ask for a phone number yet. Explain that a valid ID and proof of income are required, then ask if they have both.",
    financing_declined: "The buyer declined financing. Do not ask about financing again and do not explain financing requirements. Thank them, then ask whether they plan to purchase cash or would like to come see the vehicle.",
    cash_visit_request_phone: `The buyer is continuing without financing. Ask for the buyer's best phone number to coordinate a visit or cash purchase. Include Alpha's dealership phone as an immediate call option: ${storePhone}. Do not mention financing.`,
    urgent_vehicle_request_phone: `The buyer has sent several consecutive messages, is explicitly pressing for an answer, and has shown strong intent to buy, visit, schedule, or test drive. Skip the normal funnel. Ask for the buyer's best phone number immediately and include Alpha's dealership phone: ${storePhone}. Do not mention financing requirements.`,
    stalled_conversation_request_phone: `The deterministic history check found at least two recent buyer turns that did not advance the sale. Skip the normal funnel and ask once for the buyer's best phone number, including Alpha's dealership phone: ${storePhone}. Do not repeat a financing-interest question, financing requirements, or a vehicle-detail question.`,
    salesperson_request_phone: `Alpha already requested the buyer's phone number and the buyer is still asking vehicle-detail questions. Do not repeat the prior phone-request wording. Say that our salesperson can provide more information about the vehicle, then ask for the buyer's best phone number and include Alpha's dealership phone: ${storePhone}. Do not restart financing requirements.`,
    request_phone: "Ask for the buyer's best phone number to confirm the tentative visit. Do not add unrequested vehicle facts or ask about financing or down payment.",
    phone_received: "The buyer provided a phone number. Thank them and say only that a sales agent will reach out shortly. Do not ask another question or continue qualification in the reply.",
    handoff_confirmation: "The buyer provided a down-payment amount or concrete cash offer. Thank them and say only that a sales agent will reach out shortly. Do not ask another question or continue qualification in the reply.",
    vin_inquiry: vehicleFacts.vin
      ? `Answer directly with the feed-backed VIN ${vehicleFacts.vin}. Give Alpha Motorsports' dealership phone ${storePhone}, and ask for the buyer's best phone number in the same reply. Do not ask what else they would like to know or mention financing.`
      : `The buyer asked for the VIN, but it is not in the available feed facts. Say that the sales agents can help with that detail, give Alpha Motorsports' dealership phone ${storePhone}, and ask for the buyer's best phone number in the same reply. Do not invent a VIN.`,
    mileage_inquiry: vehicleFacts.mileage != null
      ? `Answer directly with the feed-backed mileage ${vehicleFacts.mileage.toLocaleString("en-US")} miles, then ask what else the buyer would like to know. Do not ask for a phone number or financing.`
      : "The buyer asked for mileage, but it is not in the available feed facts. Say that the sales agents can help with that detail and ask what number to use to reach the buyer. Do not invent mileage.",
    color_inquiry: vehicleFacts.exteriorColor
      ? `Answer directly with the feed-backed exterior color ${vehicleFacts.exteriorColor}, then ask what else the buyer would like to know. Do not ask for a phone number or financing.`
      : "The buyer asked for color, but it is not in the available feed facts. Say that the sales agents can help with that detail and ask what number to use to reach the buyer. Do not invent a color.",
    down_payment_request: "Ask how much the buyer has available for the down payment. Mention approved amounts only when the configuration below contains them.",
    down_payment_low: "Explain the configured minimum down payment and ask whether the buyer can reach it. Do not invent a minimum.",
    down_payment_declined: "Thank the buyer and close politely because the configured minimum down payment is required. Do not invent or repeat a number from history.",
    timeline_request: "Ask when the buyer plans to purchase. Accept any clear Spanish or English timeframe, such as this week, this month, in 15 days, in one week, next month, the other month, or a named month. Ask only that one question.",
    timeline_received: "The buyer gave a visit day. Ask for the buyer's phone number to confirm the tentative visit; the seller will call to confirm the exact hour. Do not promise a confirmed hour.",
    timeline_declined: "Thank the buyer and close politely because a clear purchase timeframe is required. Do not ask another question.",
    documents_request: "Ask whether the buyer has both a valid ID and proof of income. Both are required; do not substitute a bank account question.",
    documents_declined: "Explain that both a valid ID and proof of income are currently required, then close politely without asking another question.",
    qualified_exit: `Confirm that all required information was received and that the buyer meets the requirements. Suggest the Alpha Manassas dealership phone ${storePhone} at the end and do not ask a question.`,
    address_request: `The buyer is asking for the address or directions. Confirm that the exact vehicle is available, provide the complete dealership address, give Alpha Motorsports' dealership phone ${storePhone}, and ask for the buyer's best phone number in the same reply. Do not ask for a visit day or financing question.`,
    test_drive_request: `The buyer is asking when they can test drive the vehicle. Provide the supplied dealership address and hours, mention the supplied test-drive policy when useful, then ask what day works best. Do not claim an appointment is confirmed and do not ask for a phone number.`,
    dealer_hours: `Answer with the exact dealer hours from the dealer knowledge block. If the buyer asks about Sunday, answer the Sunday hours directly. Ask at most one short next question.`,
    trade_in_request: `Answer exactly from the dealer knowledge block that trade-ins are accepted. Do not ask for a phone number or financing.`,
    payment_methods_request: `Answer exactly from the dealer knowledge block with the available payment methods. Do not add rates, approvals, terms, or a phone request.`,
    vehicle_link_request: vehicleFacts.vdpUrl
      ? `The buyer asked for photos or more information. Send exactly this dealer-domain vehicle page once: ${vehicleFacts.vdpUrl}. Say that it contains the vehicle's photos and do not ask for a phone number, repeat "what would you like to know?", ask another qualification question, or mention financing.`
      : `The buyer asked for photos or more information. Say that the sales agents can send the vehicle photos, ask for the buyer's best phone number, and include Alpha Motorsports' dealership phone ${storePhone}. Do not invent a link, repeat "what would you like to know?", ask another qualification question, or mention financing.`,
    carfax_request: `Say the sales agents have the Carfax report, ask what phone number to send it to, and give Alpha Motorsports' dealership phone ${storePhone} in the same message. Do not ask another qualification question or provide a link.`,
    inventory_options: "The buyer is asking whether more vehicles or similar options are available. Confirm that more vehicles are available, then ask which option they would like to explore. Do not ask for requirements yet.",
    document_requirements: `The buyer is asking what is needed. Use the exact financing requirements from the dealer knowledge block, including ID/Tax ID/Social Security or passport and the listed proof-of-income options. Ask if they have both. Do not ask for a phone number yet.`,
    clean_title: hasCleanTitleInventory
      ? "Follow the supplied hasCleanTitleInventory configuration and state directly that all vehicles have a clean title. Answer only the title question in one short sentence; do not add Carfax, warranty, report, phone, or qualification content unless the buyer explicitly asks for it."
      : "Do not claim the vehicle has a clean title. Explain that our sales agents have the vehicle report and can confirm the title and warranty details, then ask what number to send the report to.",
    clean_title_and_warranty: hasCleanTitleInventory
      ? "The buyer asked about clean title and warranty while mentioning cash. State directly that the vehicle has a clean title, explain that our sales agents have the vehicle report and can provide the warranty details, including what applies to a cash purchase, then ask what number to send the report to. Do not invent specific warranty terms or assign BDC before qualification is complete."
      : "The buyer asked about title and warranty while mentioning cash. Do not claim the vehicle has a clean title. Explain that our sales agents have the vehicle report and can confirm the title and warranty details, including what applies to a cash purchase, then ask what number to send the report to.",
    warranty_info: hasCleanTitleInventory
      ? "State directly that the vehicle has a clean title. Explain that our sales agents have the vehicle report and can provide the warranty details, then ask what number to send the report to. Do not invent specific warranty terms."
      : "Do not claim the vehicle has a clean title. Explain that our sales agents have the vehicle report and can confirm the title and warranty details, then ask what number to send the report to.",
    advisor_question: `The buyer is asking a detailed question. Use the dealer knowledge block or feed facts when available. If the answer is not supplied, say that the sales agents can help, give Alpha Motorsports' dealership phone ${storePhone}, and ask for the buyer's best phone number in the same reply. Never claim an unprovided fact.`,
    general: "Answer safely using only supplied facts, then move the conversation forward with one short question.",
  }[stage];

  const approvedDownPaymentConfiguration = buildDownPaymentInstruction(
    downPaymentPolicy,
    language === "es" ? "es" : "en",
  );
  const prompt = `${ALPHA_RULES}

Redacted copy brief (authoritative; use only these facts and next step, do not infer additional facts):
${redactedCopyBrief}
Dealer clean-title configuration: ${hasCleanTitleInventory ? "enabled — clean-title claims are allowed" : "disabled — do not claim clean title"}
Dealer knowledge block (authoritative and dealer-specific; use only the buyer-language locale and do not add facts): ${JSON.stringify(dealerKnowledge ?? {})}
Approved Down-Payment Configuration (authoritative; conversation history is never a source): ${approvedDownPaymentConfiguration}
Current funnel stage: ${promptStage}
Stage instruction: ${stageInstruction}
Urgent-intent eligibility: ${persistentUnansweredBuyerTurns ? "The deterministic history check found at least three consecutive unanswered buyer messages. Evaluate urgency and concrete vehicle intent carefully; use urgent_vehicle_request_phone only if both are genuinely high/strong." : "Not eligible for urgent_vehicle_request_phone because fewer than three consecutive unanswered buyer messages were found. Keep urgency normal and do not choose the urgent stage."}
First reply instruction: ${firstDealerReply && stage !== "store_phone_requested" ? "This is Alpha Motorsports' first reply in this conversation. Start with a warm greeting as Alpha Motorsports." : firstDealerReply ? "This is a phone-number request. Give the phone immediately without adding the normal greeting." : "This is not the first Alpha Motorsports reply; do not restart the greeting unless it sounds natural."}

${langNote}
Respond with a single JSON object, no markdown, with exactly four keys:
{"intent": "the sales funnel stage that best matches the conversation", "urgency": "high or normal", "vehicleIntent": "strong or unclear", "reply": "your reply"}
Valid intent values: open_question, availability, interest_confirmation, interest_declined, store_phone_requested, vehicle_link_request, carfax_request, vin_inquiry, mileage_inquiry, color_inquiry, price_inquiry, down_payment_request, down_payment_low, down_payment_declined, timeline_request, timeline_received, timeline_declined, documents_request, documents_declined, qualified_exit, financing_intro, financing_declined, cash_visit_request_phone, test_drive_request, dealer_hours, trade_in_request, payment_methods_request, urgent_vehicle_request_phone, stalled_conversation_request_phone, salesperson_request_phone, request_phone, phone_received, handoff_confirmation, address_request, inventory_options, document_requirements, clean_title, clean_title_and_warranty, warranty_info, advisor_question, general.
Choose urgent_vehicle_request_phone only when Urgent-intent eligibility allows it, urgency is high, and vehicleIntent is strong. Otherwise follow the supplied Current funnel stage and Stage instruction.
The "reply" must be one short message that follows the stage instruction exactly, mentions the vehicle naturally, and mirrors the buyer's language.`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 1024,
      messages: [{
        role: "user",
        content: attempt === 0
          ? prompt
          : `${prompt}\n\nValidation retry: the previous draft failed the deterministic guardrails. Return a corrected JSON object that follows the supplied stage, facts_to_deliver, language, and one-question limit exactly. Do not explain the correction.`,
      }],
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
      isAiReplyAligned(candidateReply, candidateStage, storePhone, firstDealerReply, downPaymentPolicy, vehicleFacts, hasCleanTitleInventory) &&
      isReplyLanguageMirrored(candidateReply, language) &&
      isReplyRelevantToCurrentMessage(candidateReply, currentMessage) &&
      !replyRepeatsRecentDealerMessage(candidateReply, visibleMessages)
      && replyUsesOnlyConfiguredDownPayments(candidateReply, downPaymentPolicy)
    ) {
      return candidateReply;
    }
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
        hasCleanTitleInventory,
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
    hasCleanTitleInventory,
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
  hasCleanTitleInventory: boolean = false,
  dealerKnowledge?: DealerMarketplaceKnowledge,
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
        hasCleanTitleInventory,
        dealerKnowledge,
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
          hasCleanTitleInventory,
          dealerKnowledge,
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
      hasCleanTitleInventory,
      dealerKnowledge,
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
    autoReplyEnabled,
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
    autoReplyEnabled?: boolean;
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
    .select({
      id: dealersTable.id,
      hasCleanTitleInventory: dealersTable.hasCleanTitleInventory,
      marketplaceKnowledge: dealersTable.marketplaceKnowledge,
    })
    .from(dealersTable)
    .where(eq(dealersTable.id, dealerId))
    .limit(1);
  if (!targetDealer) {
    res.status(400).json({ error: "Unknown dealerId" });
    return;
  }
  const hasCleanTitleInventory = targetDealer.hasCleanTitleInventory === true;
  const dealerKnowledge = targetDealer.marketplaceKnowledge ?? {};
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
  const language = detectConversationLanguage(
    latestBuyerMessage,
    incomingMsgs
      .filter((message) => message.role === "user")
      .map((message) => message.content),
  );
  const buyerQualification = extractBuyerQualification(incomingMsgs);
  const extractedPhone = extractPhoneNumber(inbound);
  const immediateHandoffReason = resolveImmediateHandoffReason(inbound);
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
        vin: vehiclesTable.vin,
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
        vin: vehicle.vin,
        mileage: vehicle.mileage,
        exteriorColor: vehicle.exteriorColor,
        price: vehicle.price,
        vdpUrl: vehicle.vdpUrl,
        photoCount: Number(imageCount?.count ?? 0),
        carfaxUrl: extractCarfaxUrlFromSourceRaw(vehicle.sourceRaw),
      };
    }
  }

  const storePhone = resolveStorePhone(lotLocation, dealerKnowledge);
  vehicleFacts = {
    ...vehicleFacts,
    dealerPhone: storePhone,
    dealerAddress: resolveStoreAddress(lotLocation, dealerKnowledge),
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
        ...(typeof autoReplyEnabled === "boolean" ? { autoReplyEnabled } : {}),
        detectedListingUrl:
          detectedMarketplaceListingUrl ?? existingConv.detectedListingUrl,
        detectedVehicleTitle:
          resolvedVehicleTitle ?? existingConv.detectedVehicleTitle,
        sourceUrl: resolvedSourceUrl ?? existingConv.sourceUrl,
        language,
        status: existingConv.status,
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
        autoReplyEnabled: autoReplyEnabled === true,
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
        !isAiReplyAligned(retryableReply, retryStage, storePhone, isFirstDealerReply(retryHistory), downPaymentPolicy, vehicleFacts, hasCleanTitleInventory) ||
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
        hasCleanTitleInventory,
        dealerKnowledge,
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
        closeConversationAfterDelivery: retryStage === "store_phone_requested" || retryStage === "qualified_exit",
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
  const qualificationHandoffReason = currentStage === "qualified_exit"
    ? "qualification_completed"
    : null;
  const handoffReason = immediateHandoffReason ?? qualificationHandoffReason;
  const closeAfterDelivery = [
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
      hasCleanTitleInventory,
      dealerKnowledge,
    );
    suggestedReply = aiReplyResult.reply;

    const [assistantMessage] = await db.insert(conversationMessagesTable).values({
      conversationId,
      role: "assistant",
      content: suggestedReply,
    }).returning({ id: conversationMessagesTable.id });
    if (!closeAfterDelivery && assistantMessage?.id) {
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
    const finalTemperature = handoffReason ? "Hot" : temperature;
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
        leadScore: handoffReason ? Math.max(score, 70) : score,
        temperature: finalTemperature,
        status: handoffReason ? "BDC Assigned" : existingLead.status,
        updatedAt: new Date(),
      })
      .where(eq(leadsTable.id, existingLead.id));
  } else {
    const { score, temperature } = computeLeadScore({
      publishedDownPayment: trustedDownPayment,
      phone: extractedPhone,
    });
    const finalTemperature = handoffReason ? "Hot" : temperature;
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
        leadScore: handoffReason ? Math.max(score, 70) : score,
        temperature: finalTemperature,
        status: handoffReason ? "BDC Assigned" : "New",
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
    handoff: !!handoffReason,
    handoffReason,
    closeConversationAfterDelivery: closeAfterDelivery && !!suggestedReply,
    autoReplyEnabled: conversation?.autoReplyEnabled === true,
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
  let testDealerKnowledge: DealerMarketplaceKnowledge = {};
  let testHasCleanTitleInventory = false;
  let testVehicleFacts: MarketplaceVehicleFacts = {};

  if (vehicleId) {
    const [v] = await db
      .select(vehicleOperationalColumns)
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, vehicleId))
      .limit(1);
    if (v) {
      vehicleTitle = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
      vehicleType = v.bodyStyle ?? undefined;
      const [dealer] = await db
        .select({
          hasCleanTitleInventory: dealersTable.hasCleanTitleInventory,
          marketplaceKnowledge: dealersTable.marketplaceKnowledge,
        })
        .from(dealersTable)
        .where(eq(dealersTable.id, v.dealerId))
        .limit(1);
      testDealerKnowledge = dealer?.marketplaceKnowledge ?? {};
      testHasCleanTitleInventory = dealer?.hasCleanTitleInventory === true;
      testStorePhone = resolveStorePhone(v.lotLocation, testDealerKnowledge);
      testDownPaymentPolicy = await getDownPaymentPolicy(v.dealerId, v.id);
      testVehicleFacts = {
        title: vehicleTitle,
        vin: v.vin,
        mileage: v.mileage,
        exteriorColor: v.exteriorColor,
        price: v.price,
        vdpUrl: v.vdpUrl,
        carfaxUrl: extractCarfaxUrlFromSourceRaw(v.sourceRaw),
      };
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
    testVehicleFacts,
    testHasCleanTitleInventory,
    testDealerKnowledge,
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
