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
  dealersTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  cancelClaimedFollowUp,
  cancelFollowUpsForBuyerActivity,
  claimDueFollowUp,
  confirmOutboundDelivery,
  ensureMessengerFollowUpSchema,
  findOutboundJobForAssistantMessage,
  queueNormalReplyForFollowUp,
} from "../conversations/followUpQueue";


const router = Router();

const DEALER_ID = 1;

const DEFAULT_STORE_PHONE = "+1 703-763-4675";
const SALES_AI_REPLY_TIMEOUT_MS = 12000;
// Retry a prepared reply quickly when Facebook did not confirm the first
// composer/send attempt. The extension still deduplicates by message hash, so
// this does not create duplicate AI replies; it only removes the old 2-minute
// dead time between delivery attempts.
const MESSENGER_DELIVERY_RETRY_DELAY_MS = 15000;

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
  | "availability"
  | "price_inquiry"
  | "financing_intro"
  | "financing_declined"
  | "cash_visit_request_phone"
  | "urgent_vehicle_request_phone"
  | "request_phone"
  | "phone_received"
  | "address_request"
  | "inventory_options"
  | "document_requirements"
  | "clean_title"
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

function historyGaveFinancingRequirements(history: string): boolean {
  return /\b(?:dealer|dealerpilot ai|assistant):[\s\S]{0,360}\b(?:id|tax\s*id|passport|pasaporte)[\s\S]{0,180}\b(?:bank account|cuenta bancaria|cuenta de banco)\b/i.test(history);
}

function historyRequestedPhone(history: string): boolean {
  return /\b(?:dealer|dealerpilot ai|assistant):[\s\S]{0,280}\b(?:best phone number|phone number|n[uú]mero de tel[eé]fono|tel[eé]fono)\b/i.test(history);
}

function historyAskedCashOrVisit(history: string): boolean {
  return /\b(?:dealer|dealerpilot ai|assistant):[\s\S]{0,320}\b(?:purchase cash|pay cash|cash purchase|come see|visit|venir a ver|comprar de contado|pagar en efectivo)\b/i.test(history);
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

function buyerAskedWarrantyInfo(latest: string): boolean {
  return /\b(?:warranty|garant[ií]a|deductible|deducible|engine|motor|transmission|transmisi[oó]n|mechanic|mec[aá]nico|repair|reparaci[oó]n|third-party|dealership|included|cover|days|miles|mill?as)\b/i.test(latest);
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
  return stage === "request_phone" ||
    stage === "cash_visit_request_phone" ||
    stage === "urgent_vehicle_request_phone";
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
  if (!firstDealerReply || replyHasFirstGreeting(cleaned)) return cleaned;
  return language === "es"
    ? `Hola, somos Alpha Motorsports. ${cleaned}`
    : `Hello, this is Alpha Motorsports. ${cleaned}`;
}

function replyGivesRestrictedVehicleDetails(reply: string): boolean {
  const normalized = cleanConversationText(reply).toLowerCase();
  return /\$\s*\d/.test(normalized) ||
    /\b(?:price|precio|mileage|millaje|millas|miles|down payment|inicial)\b.{0,24}\b\d[\d,]*(?:\s*(?:mi|miles|millas))?\b/i.test(normalized) ||
    /\b\d[\d,]*\s*(?:mi|miles|millas)\b/i.test(normalized);
}

function resolveSalesReplyStage(visibleMessages: string[], currentMessage: string): SalesReplyStage {
  const latest = cleanConversationText(currentMessage).toLowerCase();
  const latestIntent = normalizeIntentText(currentMessage);
  const history = visibleMessages.slice(-8).map(cleanConversationText).join(" ").toLowerCase();
  if (hasPhoneNumber(latest)) return "phone_received";
  if (historyAskedCashOrVisit(history) && buyerAcceptedCashOrVisitStep(latest)) {
    return "cash_visit_request_phone";
  }
  if (historyGaveFinancingRequirements(history) && buyerLacksRequirements(latest)) {
    return "document_requirements";
  }
  if (buyerDeclinedFinancing(latest, history)) return "financing_declined";
  if (historyGaveFinancingRequirements(history) && buyerConfirmedRequirements(latest)) {
    return "request_phone";
  }
  if (buyerAskedDocumentRequirements(latest)) return "document_requirements";
  if (buyerAskedPriceInquiry(latest)) return "price_inquiry";
  if (buyerAskedInventoryOptions(latestIntent)) return "inventory_options";
  if (historyAskedAboutFinancing(history) && buyerAcceptedFinancingStep(latest)) {
    return "financing_intro";
  }
  if (/\b(application|apply|financ(?:e|ing)|loan|monthly payment|payment plan|solicitud|aplicar|financiamiento|financiar|credito|crédito|cuota mensual)\b/i.test(latest)) {
    return historyGaveFinancingRequirements(history) || historyRequestedPhone(history)
      ? "request_phone"
      : "financing_intro";
  }
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
      return `¡Gracias! Recibimos tu número y te contactaremos pronto para ayudarte con el ${vehicle}. Si prefieres, también puedes llamarnos al ${storePhone}.`;
    }
    if (stage === "request_phone") {
      return `Perfecto. ¿Cuál es el mejor número de teléfono para ayudarte con el financiamiento del ${vehicle}? También puedes llamarnos al ${storePhone}.`;
    }
    if (stage === "cash_visit_request_phone") {
      return `Perfecto. Cual es el mejor numero de telefono para coordinar la visita o la compra del ${vehicle}? Tambien puedes llamarnos al ${storePhone}.`;
    }
    if (stage === "urgent_vehicle_request_phone") {
      return `Con gusto te ayudamos de inmediato con el ${vehicle}. Cual es el mejor numero de telefono para comunicarnos contigo? Tambien puedes llamarnos al ${storePhone}.`;
    }
    if (stage === "availability") {
      return availabilityQuickReplyAccepted
        ? `Hola, somos Alpha Motorsports. Tenemos el ${vehicle} disponible. ¿Estás interesado en financiarlo?`
        : `Hola, somos Alpha Motorsports. Sí, el ${vehicle} está disponible. ¿Estás interesado en financiarlo?`;
    }
    if (stage === "price_inquiry") {
      return `Con gusto podemos confirmar ese detalle del ${vehicle}. Te encuentras interesado?`;
    }
    if (stage === "financing_intro") {
      return "Perfecto. Para aplicar solo necesitas tu ID y una cuenta bancaria activa; puede ser pasaporte o Tax ID. ¿Cuentas con esos requisitos?";
    }
    if (stage === "financing_declined") {
      return `No hay problema, gracias por avisarnos. Planeas comprar de contado o te gustaria venir a ver el ${vehicle}?`;
    }
    if (stage === "address_request") {
      return `Nuestra dirección es: ${storeAddress}. ¿Te gustaría venir a ver el ${vehicle} o te interesa financiarlo?`;
    }
    if (stage === "inventory_options") {
      return `Sí, tenemos más vehículos disponibles además del ${vehicle}. ¿Te interesa financiar este vehículo o quieres ver opciones similares?`;
    }
    if (stage === "document_requirements") {
      const detailBridge = buyerAskedDetailedVehicleInfo(currentMessage)
        ? " Con gusto podemos confirmar esos detalles contigo."
        : "";
      return `Solo necesitas tu ID y una cuenta bancaria activa; puede ser pasaporte o Tax ID.${detailBridge} ¿Cuentas con esos requisitos?`;
    }
    if (stage === "clean_title") {
      return "Sí, este vehículo tiene título limpio. ¿Te interesa financiarlo?";
    }
    if (stage === "warranty_info") {
      return `Buena pregunta. Con gusto podemos confirmar los detalles exactos de garantía y cobertura del ${vehicle}. ¿Te interesa financiarlo?`;
    }
    if (stage === "advisor_question") {
      return `Buena pregunta. Con gusto podemos confirmar ese detalle del ${vehicle}. ¿Te interesa financiarlo?`;
    }
    return `Con gusto te ayudo con el ${vehicle}. ¿Te interesa financiarlo?`;
  }
  if (stage === "phone_received") {
    return `Thank you! We received your number and will contact you shortly to help with the ${vehicle}. You can also call us at ${storePhone} if you prefer.`;
  }
  if (stage === "request_phone") {
    return `Great. What's the best phone number to help you with financing for the ${vehicle}? You can also call us at ${storePhone}.`;
  }
  if (stage === "cash_visit_request_phone") {
    return `Great. What's the best phone number to coordinate a visit or cash purchase for the ${vehicle}? You can also call us at ${storePhone}.`;
  }
  if (stage === "urgent_vehicle_request_phone") {
    return `We can help you right away with the ${vehicle}. What's the best phone number to reach you? You can also call us at ${storePhone}.`;
  }
  if (stage === "availability") {
    return availabilityQuickReplyAccepted
      ? `Hello, this is Alpha Motorsports. We have the ${vehicle} available. Are you interested in financing it?`
      : `Hello, this is Alpha Motorsports. Yes, the ${vehicle} is available. Are you interested in financing it?`;
  }
  if (stage === "price_inquiry") {
    return `We will be happy to confirm that detail for the ${vehicle}. Are you still interested?`;
  }
  if (stage === "financing_intro") {
    return "Perfect. To apply, you only need your ID and an active bank account; a passport or Tax ID works. Do you have those requirements?";
  }
  if (stage === "financing_declined") {
    return `No problem, thanks for letting us know. Are you planning to purchase cash or would you like to come see the ${vehicle}?`;
  }
  if (stage === "address_request") {
    return `Our address is: ${storeAddress}. Would you like to come see the ${vehicle} or are you interested in financing it?`;
  }
  if (stage === "inventory_options") {
    return `Yes, we have more vehicles available besides the ${vehicle}. Are you interested in financing this vehicle or would you like to see similar options?`;
  }
  if (stage === "document_requirements") {
    const detailBridge = buyerAskedDetailedVehicleInfo(currentMessage)
      ? " We will be happy to confirm those details with you."
      : "";
    return `You only need your ID and an active bank account; a passport or Tax ID works.${detailBridge} Do you have those requirements?`;
  }
  if (stage === "clean_title") {
    return "Yes, this vehicle has a clean title. Are you interested in financing it?";
  }
  if (stage === "warranty_info") {
    return `Great question. We will be happy to confirm the exact warranty and coverage details for the ${vehicle}. Are you interested in financing it?`;
  }
  if (stage === "advisor_question") {
    return `Great question. We will be happy to confirm that detail for the ${vehicle}. Are you interested in financing it?`;
  }
  return `I'd be happy to help with the ${vehicle}. Are you interested in financing it?`;
}

function isAiReplyAligned(
  reply: string,
  stage: SalesReplyStage,
  storePhone: string,
  firstDealerReply: boolean = false,
): boolean {
  const normalized = cleanConversationText(reply).toLowerCase();
  if (!normalized) return false;
  const legacyLocationToken = String.fromCharCode(
    102, 114, 101, 100, 101, 114, 105, 99, 107, 115, 98, 117, 114, 103,
  );
  const legacyAddressToken = ["410", "hudgins"].join(" ");
  if (normalized.includes(legacyLocationToken) || normalized.includes(legacyAddressToken)) return false;
  if (firstDealerReply && !replyHasFirstGreeting(reply)) return false;
  if (stageRequiresStorePhone(stage) && !replyIncludesStorePhone(reply, storePhone)) return false;
  if (/\badvisor\b|\basesor\b/i.test(normalized)) return false;
  if (replyGivesRestrictedVehicleDetails(reply)) return false;
  if (stage === "availability") {
    return /alpha/.test(normalized) &&
      /financ|financiar|financiamiento/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero/.test(normalized) &&
      !normalized.includes(storePhone.toLowerCase());
  }
  if (stage === "price_inquiry") {
    return /confirm|confirmar/.test(normalized) &&
      !/\$\s*\d/.test(normalized) &&
      !/id|tax\s*id|passport|pasaporte|bank account|cuenta bancaria|requirements|requisitos/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  if (stage === "financing_intro") {
    return /\b(id|tax\s*id|passport|pasaporte)\b/.test(normalized) &&
      /bank account|cuenta bancaria|cuenta de banco/.test(normalized) &&
      /requirements|requisitos|cuentas|tienes|have/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  if (stage === "financing_declined") {
    return /no problem|no hay problema|thanks|gracias/.test(normalized) &&
      !/id|tax\s*id|passport|pasaporte|bank account|cuenta bancaria|requirements|requisitos/.test(normalized) &&
      !/are you interested in financing|te interesa financiar|do you have those requirements|cuentas con esos requisitos/.test(normalized);
  }
  if (stage === "request_phone") {
    return /phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  if (stage === "urgent_vehicle_request_phone") {
    return /phone|number|telefono|numero/.test(normalizeIntentText(reply)) &&
      !/financing requirements|requisitos de financiamiento|bank account|cuenta bancaria|passport|pasaporte|tax\s*id/.test(normalized);
  }
  if (stage === "cash_visit_request_phone") {
    return /phone|number|telefono|numero/.test(normalized) &&
      /visit|cash|compra|visita/.test(normalized) &&
      !/financing|finance|financiar|financiamiento|requirements|requisitos/.test(normalized);
  }
  if (stage === "phone_received") {
    return /call|contact|llam|comunicar/.test(normalized);
  }
  if (stage === "inventory_options") {
    const normalizedIntent = normalizeIntentText(reply);
    return /\b(?:more vehicles|more options|similar options|mas vehiculos|mas opciones|opciones similares)\b/.test(normalizedIntent) &&
      /financ|financiar|financiamiento/.test(normalizedIntent) &&
      !/id|tax id|passport|pasaporte|bank account|cuenta bancaria|requisitos|requirements|phone|number|telefono|numero/.test(normalizedIntent);
  }
  if (stage === "document_requirements") {
    return /\b(id|tax\s*id|passport|pasaporte)\b/.test(normalized) &&
      /bank account|cuenta bancaria|cuenta de banco/.test(normalized) &&
      /requirements|requisitos|cuentas|tienes|have/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  if (stage === "clean_title") {
    return /\b(?:yes|si|sí)\b/i.test(normalized) &&
      /clean title|titulo limpio|t[ií]tulo limpio/i.test(normalized) &&
      /financ|financiar|financiamiento/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  if (stage === "warranty_info") {
    return /confirm|confirmar/.test(normalized) &&
      /financ|financiar|financiamiento/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
  }
  if (stage === "advisor_question") {
    return /confirm|confirmar/.test(normalized) &&
      /financ|financiar|financiamiento/.test(normalized) &&
      !/phone|number|tel[eé]fono|n[uú]mero/.test(normalized);
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
): string {
  if (!replyRepeatsRecentDealerMessage(reply, visibleMessages)) return reply;
  const stage = resolveSalesReplyStage(visibleMessages, currentMessage);
  const vehicle = vehicleTitle ?? (language === "es" ? "el vehículo" : "the vehicle");
  if (stage === "warranty_info" || stage === "advisor_question") {
    return language === "es"
      ? `Con gusto podemos verificar ese detalle del ${vehicle}. ¿Te gustaría conocer las opciones de financiamiento?`
      : `We will be happy to verify that detail for the ${vehicle}. Would you like to explore financing options?`;
  }
  if (stage === "clean_title") {
    return language === "es"
      ? "Correcto, este vehículo tiene título limpio. ¿Te gustaría conocer las opciones de financiamiento?"
      : "Correct, this vehicle has a clean title. Would you like to explore financing options?";
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
  "availability",
  "price_inquiry",
  "financing_intro",
  "financing_declined",
  "cash_visit_request_phone",
  "urgent_vehicle_request_phone",
  "request_phone",
  "phone_received",
  "address_request",
  "inventory_options",
  "document_requirements",
  "clean_title",
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

CONVERSATION FUNNEL:
1. Initial availability inquiry: greet with "Hello, this is Alpha Motorsports" / "Hola, somos Alpha Motorsports", explicitly confirm that the specific vehicle from the Vehicle field is available, then ask whether the buyer is interested in financing it. Always name the year, make, and model. Do not ask for a phone number.
1a. If the buyer asks whether there are more vehicles, other options, similar vehicles, or "only that one", confirm that Alpha Motorsports has more vehicles available, then continue the flow by asking whether they are interested in financing this vehicle or seeing similar options. Do not ask for requirements yet.
1b. Urgent vehicle-intent exception: read the full recent conversation with careful human judgment. Use urgent_vehicle_request_phone only when the buyer has sent several consecutive unanswered messages, shows unmistakably high urgency, and shows strong concrete intent to acquire or act on this vehicle, such as buying it, coming today or tomorrow, scheduling, visiting, or test driving. Mere repetition, impatience, curiosity, a price question, or one emotional phrase is not enough. When all signals are present, skip the normal funnel and ask for the best phone number immediately; include Alpha's dealership phone. Do not mention financing requirements.
2. If the buyer says they are interested in financing, do not ask for the phone number yet. Explain the basic requirements: ID and active bank account; passport or Tax ID works. Ask if they have those requirements.
2a. If the buyer declines financing or says they do not need financing, do not ask about financing again and do not explain requirements. Thank them, ask whether they plan to purchase cash or would like to come see the vehicle, then continue by collecting a phone number if they say yes.
3. If the buyer asks what requirements/documents are needed to apply, answer the requirements first: ID and active bank account; passport or Tax ID works. Ask if they have those requirements. Do not ask for a phone number in this same reply.
4. Only after the buyer confirms they have the requirements or explicitly wants to continue with the application, ask for the buyer's best phone number and include Alpha's dealership phone as an immediate call option.
5. If the buyer asks a detailed question about the vehicle, payment, warranty, coverage, deductible, inspection, or anything else not answered by the supplied context, do not invent details. Kindly say that Alpha Motorsports will be happy to confirm that detail, then ask whether they are interested in financing. Do not ask for a phone number or address in this reply.
5a. Clean-title confirmation: if the buyer asks whether the vehicle has a clean title, confirm that it does (do not defer), then ask whether they are interested in financing. Do not ask for a phone number in this reply.
6. If the conversation already asked for the buyer's phone number and the buyer replies without a number, do not restart the financing question. Continue by asking for the best phone number.
7. Once the buyer provides a phone number, thank them warmly and say "we will contact you shortly." You may also offer the store phone as an immediate option.
8. Send exactly one short reply for the latest buyer turn. Never repeat a previous reply.
8a. Read the recent conversation before replying. Never reuse the exact wording of a recent Dealer message; vary the wording while remaining in the same funnel stage.
9. Do not give price, mileage, approval, history, warranty, or financing details in Messenger, except that you must confirm a clean title when explicitly asked.
9a. If the buyer asks for price, do not provide a number and do not jump to requirements. Say that Alpha Motorsports can confirm that detail, then ask whether they are still interested.

ADDRESS / DIRECTIONS HANDLING:
- If the buyer asks for the address, directions, or location, provide the store address directly and invite them to visit, then ask whether they are interested in financing.
- Never ask a clarifying question about which vehicle or location they mean.
- Always provide the address from the supplied Dealership address field.

Language rules:
- Mirror the latest buyer message language exactly.
- If the latest buyer message is Spanish, reply ONLY in Spanish.
- If the latest buyer message is English, reply ONLY in English.
- Never write a bilingual reply, translation, second version, or mixed-language sentence.
- Be friendly, conversational, and concise. The first Alpha Motorsports reply in any conversation must start with a warm greeting as Alpha Motorsports. Thank the buyer naturally when appropriate.
- Speak directly as Alpha Motorsports using "we" / "nosotros". Never say "our sales team will take care of it", "our team will handle it", "nuestro equipo de ventas se encargará", or similar handoff language.
- Use "easy financing options" / "opciones de financiamiento fáciles"
- Use "approval based on qualification" / "aprobación basada en calificación"
- Do not use the words "advisor" or "asesor". Use "our team" / "nuestro equipo".
- Do not push a call, ask for a phone number, or include the store phone in the first reply, except when the confirmed stage is urgent_vehicle_request_phone
- Never ask for the "best phone number so we can help you" in response to a vehicle-detail or warranty question; return to the next sequential funnel step instead
- Do not ask for a phone number in the same reply that first explains the financing requirements
- If the current stage is request_phone, ask for the buyer's phone number and include Alpha's dealership phone as an immediate call option
- If the current stage is urgent_vehicle_request_phone, ask for the buyer's phone number immediately, include Alpha's dealership phone, and do not mention financing requirements
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
  const phoneContext = `Dealership phone: ${storePhone}`;

  const history = visibleMessages.slice(-8).join("\n");

  const stage = resolveSalesReplyStage(visibleMessages, currentMessage);
  const persistentUnansweredBuyerTurns = hasPersistentUnansweredBuyerTurns(
    visibleMessages,
    currentMessage,
  );
  const firstDealerReply = isFirstDealerReply(visibleMessages);
  const promptStage = stage === "advisor_question" ? "detailed_question" : stage;
  const stageInstruction = {
    availability: availabilityQuickReplyAccepted
      ? "Greet as Alpha Motorsports, state that the exact year/make/model from the Vehicle field is available, then ask whether the buyer is interested in financing it. Do not ask for a phone number."
      : "Greet as Alpha Motorsports, explicitly confirm that the exact year/make/model from the Vehicle field is available, then ask whether the buyer is interested in financing it. Do not ask for a phone number.",
    price_inquiry: "The buyer is asking for price. Do not provide a number, do not ask for requirements, and do not ask for a phone number. Say Alpha Motorsports can confirm that detail, then ask whether they are still interested.",
    financing_intro: "The buyer is interested in financing. Do not ask for a phone number yet. Explain the basic requirements: ID and an active bank account; passport or Tax ID works. Ask if they have those requirements.",
    financing_declined: "The buyer declined financing. Do not ask about financing again and do not explain financing requirements. Thank them, then ask whether they plan to purchase cash or would like to come see the vehicle.",
    cash_visit_request_phone: `The buyer is continuing without financing. Ask for the buyer's best phone number to coordinate a visit or cash purchase. Include Alpha's dealership phone as an immediate call option: ${storePhone}. Do not mention financing.`,
    urgent_vehicle_request_phone: `The buyer has sent several consecutive messages, is explicitly pressing for an answer, and has shown strong intent to buy, visit, schedule, or test drive. Skip the normal funnel. Ask for the buyer's best phone number immediately and include Alpha's dealership phone: ${storePhone}. Do not mention financing requirements.`,
    request_phone: `Ask for the buyer's best phone number so we can help them. End with Alpha's dealership phone as an immediate call option: ${storePhone}.`,
    phone_received: `A phone number was provided. Thank the buyer warmly, say "we will contact you shortly," and optionally offer ${storePhone} as an immediate call option. Do not transfer them to or mention a separate sales team.`,
    address_request: `The buyer is asking for the address or directions. Provide the dealership address and invite them to visit, then ask whether they are interested in financing. Do NOT ask clarifying questions.`,
    inventory_options: "The buyer is asking whether more vehicles or similar options are available. Confirm that more vehicles are available, then ask whether they are interested in financing this vehicle or seeing similar options. Do not ask for requirements yet.",
    document_requirements: "The buyer is asking what is needed to apply. Reply warmly with the requirements: ID and an active bank account; passport or Tax ID works. If they also ask price, miles, or other details, do not provide those values; kindly say we will be happy to confirm them. Ask if they have those requirements. Do not ask for a phone number yet.",
    clean_title: "Confirm that the vehicle has a clean title, then ask whether the buyer is interested in financing it. Do not ask for a phone number.",
    warranty_info: "The buyer is asking detailed warranty questions. Respond warmly and do not invent warranty terms. Say we will be happy to confirm the exact warranty or coverage details; then continue the funnel by asking whether they are interested in financing. Do not mention a separate team or ask for a phone number.",
    advisor_question: "The buyer is asking a detailed question. Respond warmly and do not invent details. Say we will be happy to confirm that detail; then continue the funnel by asking whether they are interested in financing. Do not mention a separate team or ask for a phone number.",
    general: "Answer safely using only supplied facts, then move the conversation forward with one short question.",
  }[stage];

  const prompt = `${ALPHA_RULES}

${vehicleContext}
${locationContext}
${phoneContext}
Current funnel stage: ${promptStage}
Stage instruction: ${stageInstruction}
Urgent-intent eligibility: ${persistentUnansweredBuyerTurns ? "The deterministic history check found at least three consecutive unanswered buyer messages. Evaluate urgency and concrete vehicle intent carefully; use urgent_vehicle_request_phone only if both are genuinely high/strong." : "Not eligible for urgent_vehicle_request_phone because fewer than three consecutive unanswered buyer messages were found. Keep urgency normal and do not choose the urgent stage."}
First reply instruction: ${firstDealerReply ? "This is Alpha Motorsports' first reply in this conversation. Start with a warm greeting as Alpha Motorsports." : "This is not the first Alpha Motorsports reply; do not restart the greeting unless it sounds natural."}

Recent conversation:
${history}

Latest buyer message: "${currentMessage}"

${langNote}
Respond with a single JSON object, no markdown, with exactly four keys:
{"intent": "the sales funnel stage that best matches the conversation", "urgency": "high or normal", "vehicleIntent": "strong or unclear", "reply": "your reply"}
Valid intent values: availability, price_inquiry, financing_intro, financing_declined, cash_visit_request_phone, urgent_vehicle_request_phone, request_phone, phone_received, address_request, inventory_options, document_requirements, clean_title, warranty_info, advisor_question, general.
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
    isAiReplyAligned(candidateReply, candidateStage, storePhone, firstDealerReply) &&
    isReplyLanguageMirrored(candidateReply, language) &&
    isReplyRelevantToCurrentMessage(candidateReply, currentMessage) &&
    !replyRepeatsRecentDealerMessage(candidateReply, visibleMessages)
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
      ),
      language,
      firstDealerReply,
    ),
    language,
    visibleMessages,
    currentMessage,
    vehicleTitle,
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
        ),
        language,
        firstDealerReply,
      ),
      language,
      visibleMessages,
      currentMessage,
      vehicleTitle,
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
    followUpEligible,
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
    followUpEligible?: boolean;
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
  // Follow-up storage is additive. An unavailable migration must never stop
  // the established Sales AI intake and normal response path.
  try {
    await ensureMessengerFollowUpSchema();
  } catch (error) {
    req.log.error({ error, dealerId }, "Messenger follow-up schema unavailable; normal intake continues");
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
  // The extension validates currentMessage against the live Messenger bubble.
  // Preserve it as the source of truth even if Facebook momentarily returns
  // stale or reordered history rows around a DOM rerender.
  const currentBuyerMessage = currentParsed?.role === "user" ? currentParsed.content : "";
  const latestParsed = incomingMsgs[incomingMsgs.length - 1] ?? null;
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
  const inbound = latestBuyerMessage;
  const language = detectLanguage(inbound);
  const extractedPhone = extractPhoneNumber(inbound);
  if (isTerminalBuyerAcknowledgement(inbound) || isConversationClosingBuyerAcknowledgement(inbound)) {
    await cancelFollowUpsForBuyerActivity({
      dealerId,
      externalThreadRef,
      reason: isConversationClosingBuyerAcknowledgement(inbound) ? "conversation_closed" : "buyer_replied",
    })
      .catch((error) => req.log.warn({ error, externalThreadRef }, "Terminal acknowledgement follow-up cancel skipped"));
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
    .where(and(
      eq(conversationsTable.dealerId, dealerId),
      eq(conversationsTable.externalThreadRef, externalThreadRef),
    ))
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
      .where(eq(marketplaceListingsTable.dealerId, dealerId));
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
      .where(eq(vehiclesTable.dealerId, dealerId));

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

  if (hasNewBuyerMessage) {
    await cancelFollowUpsForBuyerActivity({
      dealerId,
      externalThreadRef,
      reason: extractedPhone ? "phone_received" : "buyer_replied",
    }).catch((error) => req.log.warn({ error, externalThreadRef }, "Buyer activity follow-up cancel skipped"));
    await db
      .update(conversationsTable)
      .set({ status: extractedPhone ? "BDC Assigned" : "active", updatedAt: new Date() })
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
    const retryStage = resolveSalesReplyStage(retryHistory, inbound);
    if (
      retryableReply &&
      (
        !isReplyLanguageMirrored(retryableReply, language) ||
        !isAiReplyAligned(retryableReply, retryStage, storePhone, isFirstDealerReply(retryHistory)) ||
        !isReplyRelevantToCurrentMessage(retryableReply, inbound)
      )
    ) {
      const repairedReply = await generateAiReplyWithFallback(
        retryHistory,
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
        { conversationId, externalThreadRef, language, retryStage },
        "Conversation intake repaired stale reply before Messenger delivery retry",
      );
    }
    if (retryableReply) {
      const outboundJob = latestAssistantMessage
        ? await findOutboundJobForAssistantMessage(latestAssistantMessage.id)
          .catch((error) => {
            req.log.warn({ error, conversationId }, "Delivery retry continues without follow-up job lookup");
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

    const [assistantMessage] = await db.insert(conversationMessagesTable).values({
      conversationId,
      role: "assistant",
      content: suggestedReply,
    }).returning({ id: conversationMessagesTable.id });
    if (followUpEligible === true && !extractedPhone && assistantMessage?.id) {
      outboundJob = await queueNormalReplyForFollowUp({
        conversationId,
        dealerId,
        assistantMessageId: assistantMessage.id,
        externalThreadRef,
        sourceUrl: resolvedSourceUrl,
        content: suggestedReply,
      }).catch((error) => {
        req.log.warn({ error, conversationId }, "Normal reply sent without follow-up queue entry");
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
        dealerId,
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
        dealerId,
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
    outboundJob,
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

router.post("/conversations/follow-ups/claim", async (req, res) => {
  const dealerId = Number(req.body?.dealerId) || DEALER_ID;
  const extensionId = String(req.body?.extensionId || "").trim();
  if (!extensionId) {
    res.status(400).json({ error: "extensionId required" });
    return;
  }
  const claimed = await claimDueFollowUp({ dealerId, extensionId });
  res.json({ ok: true, ...claimed });
});

router.post("/conversations/follow-ups/:jobId/cancel", async (req, res) => {
  const jobId = Number(req.params.jobId);
  const dealerId = Number(req.body?.dealerId) || DEALER_ID;
  const externalThreadRef = String(req.body?.externalThreadRef || "").trim();
  const reason = req.body?.reason === "manual_reply_detected"
    ? "manual_reply_detected"
    : req.body?.reason === "thread_changed"
      ? "thread_changed"
      : req.body?.reason === "conversation_closed"
        ? "conversation_closed"
      : "buyer_replied";
  if (!Number.isInteger(jobId) || jobId <= 0 || !externalThreadRef) {
    res.status(400).json({ error: "jobId and externalThreadRef are required" });
    return;
  }
  const followUp = await cancelClaimedFollowUp({ jobId, dealerId, externalThreadRef, reason });
  res.json({ ok: true, followUp });
});

router.post("/conversations/follow-ups/cancel-by-thread", async (req, res) => {
  const dealerId = Number(req.body?.dealerId) || DEALER_ID;
  const externalThreadRef = String(req.body?.externalThreadRef || "").trim();
  if (!externalThreadRef) {
    res.status(400).json({ error: "externalThreadRef required" });
    return;
  }
  const followUp = await cancelFollowUpsForBuyerActivity({
    dealerId,
    externalThreadRef,
    reason: req.body?.reason === "phone_received"
      ? "phone_received"
      : req.body?.reason === "conversation_closed"
        ? "conversation_closed"
        : "buyer_replied",
  });
  res.json({ ok: true, followUp });
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
