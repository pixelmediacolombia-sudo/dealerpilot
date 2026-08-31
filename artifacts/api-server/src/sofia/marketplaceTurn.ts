export type MarketplaceLanguage = "en" | "es" | string;

export type MarketplaceMessage = {
  role: "buyer" | "dealer";
  text: string;
  ts?: string;
};

export type MarketplaceEnvelope = {
  envelope_version: "1.0";
  idempotency_key: string;
  dealer: {
    dealer_id: string;
    marketplace_identity_id: string;
    location?: string | null;
    phone?: string | null;
  };
  lead: {
    lead_id: string;
    buyer_display_name: string;
    language_detected?: MarketplaceLanguage;
  };
  thread: {
    thread_id: string;
    listing_id?: string | null;
    listing_title?: string | null;
    listing_price_shown?: number | null;
    turn_number?: number | null;
  };
  vehicle: {
    matched: boolean;
    match_source?: string | null;
    vin?: string | null;
    stock?: string | null;
    year?: number | null;
    make?: string | null;
    model?: string | null;
    price?: number | null;
    mileage?: number | null;
    vdp_url?: string | null;
    photo_count?: number | null;
    status?: string | null;
  };
  messages: MarketplaceMessage[];
  known_facts?: Record<string, unknown>;
};

export type MarketplaceFacts = {
  vehicle_of_interest: string | null;
  phone: string | null;
  payment_type: "cash" | "finance" | "unknown";
  down_payment_available: number | null;
  visit_window: string | null;
  buyer_location: string | null;
  trade_in: { mentioned: boolean; description: string | null };
  open_question: string | null;
  questions_asked_by_bot: string[];
};

export type TurnDecision = {
  reply_text: string;
  facts: MarketplaceFacts;
  level: "A" | "B" | "C";
  next_step: string;
  handoff: { trigger: boolean };
  answered_buyer_question: boolean;
  hard_rule_violation: string | null;
  confidence: number;
  fallback_reason: string | null;
};

const PHONE_RE = /(?:^|\D)((?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})(?=$|\D)/;
const MONEY_RE = /(?:\$\s*)?(\d{1,3}(?:[,.]\d{3})?|\d{1,2}(?:\.\d+)?)\s*(k|thousand|mil)?\b/i;

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown): string {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function moneyFromText(text: string): number | null {
  const withoutPhones = text.replace(PHONE_RE, " ");
  const match = withoutPhones.match(MONEY_RE);
  if (!match?.[1]) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const suffix = (match[2] ?? "").toLowerCase();
  return Math.round(amount * (suffix === "k" || suffix === "thousand" || suffix === "mil" ? 1000 : 1));
}

function phoneFromText(text: string): string | null {
  const match = text.match(PHONE_RE);
  if (!match?.[1]) return null;
  const digits = match[1].replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10 ? `+1${local}` : null;
}

function vehicleLabel(envelope: MarketplaceEnvelope): string {
  return clean([
    envelope.vehicle.year,
    envelope.vehicle.make,
    envelope.vehicle.model,
  ].filter(Boolean).join(" ") || envelope.thread.listing_title || "this vehicle");
}

function hasQuestion(text: string): boolean {
  const value = normalize(text);
  return /\?|\b(?:what|which|how|where|when|is|can|do|does|cu[aá]l|qu[eé]|c[oó]mo|d[oó]nde|cu[aá]ndo|tiene|puedo)\b/.test(value);
}

function latestBuyerMessage(envelope: MarketplaceEnvelope): MarketplaceMessage | null {
  return [...envelope.messages].reverse().find((message) => message.role === "buyer") ?? null;
}

function hasDealerReply(envelope: MarketplaceEnvelope): boolean {
  return envelope.messages.some((message) => message.role === "dealer");
}

function hasExistingLink(envelope: MarketplaceEnvelope): boolean {
  return envelope.messages.some((message) => /https?:\/\/\S+/i.test(message.text));
}

export function validateMarketplaceEnvelope(value: unknown): string[] {
  const input = value as Partial<MarketplaceEnvelope> | null;
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["body must be an object"];
  if (input.envelope_version !== "1.0") errors.push("envelope_version must be 1.0");
  if (!clean(input.idempotency_key)) errors.push("idempotency_key is required");
  if (!clean(input.dealer?.dealer_id)) errors.push("dealer.dealer_id is required");
  if (!clean(input.dealer?.marketplace_identity_id)) errors.push("dealer.marketplace_identity_id is required");
  if (!clean(input.lead?.lead_id)) errors.push("lead.lead_id is required");
  if (!clean(input.thread?.thread_id)) errors.push("thread.thread_id is required");
  if (!input.vehicle || typeof input.vehicle.matched !== "boolean") errors.push("vehicle.matched is required");
  if (!Array.isArray(input.messages)) errors.push("messages must be an array");
  if (Array.isArray(input.messages) && input.messages.some((message) =>
    !message || (message.role !== "buyer" && message.role !== "dealer") || !clean(message.text))) {
    errors.push("messages must contain buyer/dealer messages with text");
  }
  return errors;
}

export function extractMarketplaceFacts(envelope: MarketplaceEnvelope): MarketplaceFacts {
  const buyerMessages = envelope.messages.filter((message) => message.role === "buyer");
  const dealerMessages = envelope.messages.filter((message) => message.role === "dealer");
  const allBuyerText = buyerMessages.map((message) => message.text).join(" ");
  const latestBuyer = latestBuyerMessage(envelope)?.text ?? "";
  const phone = phoneFromText(allBuyerText);
  const cash = /\b(?:cash|cash buyer|pay(?:ing)? in cash|contado|de contado|efectivo)\b/i.test(normalize(allBuyerText));
  const finance = /\b(?:finance|financing|financiar|financiamiento|cr[eé]dito)\b/i.test(normalize(allBuyerText));
  const downPayment = buyerMessages
    .map((message) => moneyFromText(message.text))
    .find((amount) => amount !== null) ?? null;
  const visitMatch = allBuyerText.match(/\b(?:this weekend|weekend|saturday|sunday|sábado|sabado|domingo|after work|después del trabajo|despues del trabajo|today|tomorrow|hoy|mañana|manana)\b/i);
  const locationMatch = allBuyerText.match(/\b(?:in|from|desde|en)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s-]{2,40})/i);
  const tradeMatch = allBuyerText.match(/\b(?:trade|trade[- ]?in|cambio|cambiaría|cambiaria)\b[,:]?\s*(.{0,80})/i);
  const openQuestion = hasQuestion(latestBuyer) ? clean(latestBuyer) : null;

  return {
    vehicle_of_interest: envelope.vehicle.vin || envelope.vehicle.stock || envelope.thread.listing_id || null,
    phone,
    payment_type: cash ? "cash" : finance ? "finance" : "unknown",
    down_payment_available: downPayment,
    visit_window: visitMatch?.[0] ?? null,
    buyer_location: locationMatch?.[1]?.trim() ?? null,
    trade_in: { mentioned: !!tradeMatch, description: tradeMatch?.[1]?.trim() || null },
    open_question: openQuestion,
    questions_asked_by_bot: dealerMessages.filter((message) => hasQuestion(message.text)).map((message) => clean(message.text)),
  };
}

export function classifyMarketplaceLevel(facts: MarketplaceFacts): "A" | "B" | "C" {
  if (facts.phone && (facts.down_payment_available !== null || facts.visit_window)) return "A";
  if (facts.phone) return "B";
  return "C";
}

export function detectMarketplaceIntent(text: string): string {
  const value = normalize(text);
  if (/\b(?:sold|vendi[oó]|already gone|no longer available)\b/.test(value)) return "vehiculo_vendido";
  if (/\b(?:out.?the.?door|cash price|real price|precio real|precio de contado|cu[aá]nto cuesta|how much|price)\b/.test(value)) return "precio_real";
  if (/\b(?:range|battery|battery health|charge|charger|autonom[ií]a|bater[ií]a|cargar|millas)\b/.test(value)) return "specs_vehiculo";
  if (/\b(?:where|located|address|location|d[oó]nde|direcci[oó]n|ubicad[oa]s?)\b/.test(value)) return "ubicacion";
  if (/\b(?:financ|lender|cr[eé]dito|credit|monthly payment)\b/.test(value)) return "financiamiento";
  if (/\b(?:need|requirements|documents|id|passport|tax id|income|necesito|requisitos|documentos|pasaporte)\b/.test(value)) return "requisitos";
  if (/\b(?:certif|certificaci[oó]n|certification)\b/.test(value)) return "certificacion";
  if (/\b(?:weekend|saturday|sunday|come in|visit|appointment|week|sábado|sabado|domingo|cita|visita)\b/.test(value)) return "senal_visita";
  if (/\b(?:down|down payment|enganche|inicial|tengo \$?\d|\$?\d{1,2}\s*k\b)\b/i.test(value)) return "enganche";
  if (/\b(?:another|similar|other|otra|otro|parecida|toyota|honda)\b/.test(value)) return "otro_vehiculo";
  if (/\b(?:available|still for sale|disponible|sigue)\b/.test(value)) return "disponibilidad";
  return "general";
}

function languageFor(envelope: MarketplaceEnvelope, text: string): "en" | "es" {
  if (envelope.lead.language_detected === "es" || /[¿¡ñáéíóúü]/i.test(text)) return "es";
  return /\b(?:hola|precio|d[oó]nde|cu[aá]ndo|tengo|quiero|enganche|inicial|disponible|cita|visita)\b/i.test(text) ? "es" : "en";
}

function currency(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function configuredDownPaymentPlans(envelope: MarketplaceEnvelope): number[] {
  const raw = envelope.known_facts?.down_payment_plans;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw
    .map((value) => typeof value === "number" ? Math.round(value) : Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

function configuredDownPaymentText(envelope: MarketplaceEnvelope, language: "en" | "es"): string {
  const plans = configuredDownPaymentPlans(envelope);
  if (!plans.length) {
    return language === "es"
      ? "Podemos revisar las opciones vigentes de enganche según tu perfil"
      : "We can review the current down-payment options based on your profile";
  }
  const formatted = plans.map(currency);
  const list = formatted.length === 1
    ? formatted[0]
    : formatted.length === 2
      ? `${formatted[0]} ${language === "es" ? "y" : "and"} ${formatted[1]}`
      : `${formatted.slice(0, -1).join(", ")} ${language === "es" ? "y" : "and"} ${formatted.at(-1)}`;
  return language === "es"
    ? `tenemos planes desde ${list} de enganche`
    : `plans start at ${list} down`;
}

function addLink(reply: string, envelope: MarketplaceEnvelope, buyerMessage: string): string {
  if (!hasDealerReply(envelope) || hasExistingLink(envelope) || !envelope.vehicle.vdp_url) return reply;
  if (!/\b(?:photo|photos|picture|pictures|image|images|fotos|imagenes|informaci[oó]n|information|details|detalles|ficha)\b/i.test(normalize(buyerMessage))) return reply;
  return `${reply} Aquí tienes la ficha completa: ${envelope.vehicle.vdp_url}`;
}

function visitQuestion(language: "en" | "es", cash: boolean): string {
  if (language === "es") return cash ? "¿Qué día te queda mejor para venir a verlo?" : "¿Te queda mejor pasar entre semana o el sábado?";
  return cash ? "What day works best for you to come see it?" : "Would a weekday or Saturday work better for you?";
}

export function buildMarketplaceTurnDecision(envelope: MarketplaceEnvelope): TurnDecision {
  const facts = extractMarketplaceFacts(envelope);
  const latest = latestBuyerMessage(envelope)?.text ?? "";
  const latestPhone = phoneFromText(latest);
  const previousBuyerText = envelope.messages
    .slice(0, Math.max(0, envelope.messages.length - 1))
    .filter((message) => message.role === "buyer")
    .map((message) => message.text)
    .join(" ");
  const phoneCapturedThisTurn = !!latestPhone && !phoneFromText(previousBuyerText);
  const language = languageFor(envelope, latest);
  const vehicle = vehicleLabel(envelope);
  const intent = detectMarketplaceIntent(latest);
  const cash = facts.payment_type === "cash";
  const downPaymentText = configuredDownPaymentText(envelope, language);
  let reply = "";
  let nextStep = "ask_visit_window";
  let handoff = false;
  let answered = false;

  if (phoneCapturedThisTurn) {
    reply = language === "es"
      ? "Gracias, ya tengo tu número. Se lo entregamos ahora mismo al vendedor para que te confirme la visita."
      : "Thanks, I have your number. I am handing it to the salesperson now so they can confirm your visit.";
    nextStep = "handoff";
    handoff = true;
    answered = true;
  } else if (intent === "precio_real") {
    const shownAsDown = envelope.known_facts?.price_role === "down_payment";
    if (envelope.vehicle.price && shownAsDown && envelope.thread.listing_price_shown) {
      reply = language === "es"
        ? `Los ${currency(envelope.thread.listing_price_shown ?? 0)} del anuncio son el enganche. El precio del ${vehicle} es ${currency(envelope.vehicle.price)}; el total final depende de impuestos y placas. ${visitQuestion(language, cash)}`
        : `The ${currency(envelope.thread.listing_price_shown ?? 0)} shown in the ad is the down payment. The ${vehicle} price is ${currency(envelope.vehicle.price)}; the final out-the-door total depends on taxes and plates. ${visitQuestion(language, cash)}`;
    } else if (envelope.vehicle.price) {
      reply = language === "es"
        ? `El precio vigente del ${vehicle} en el inventario es ${currency(envelope.vehicle.price)}. El total final depende de impuestos y placas. ${visitQuestion(language, cash)}`
        : `The current inventory price for the ${vehicle} is ${currency(envelope.vehicle.price)}. The final out-the-door total depends on taxes and plates. ${visitQuestion(language, cash)}`;
    } else {
      reply = language === "es"
        ? `Puedo confirmar el precio vigente en el lote y dejarte el total por escrito. ${visitQuestion(language, cash)}`
        : `I can confirm the current price at the lot and give you the total in writing. ${visitQuestion(language, cash)}`;
    }
    answered = true;
  } else if (intent === "ubicacion") {
    reply = language === "es"
      ? `Estamos en ${clean(envelope.dealer.location) || "nuestra ubicación del anuncio"}. ${visitQuestion(language, cash)}`
      : `We are located at ${clean(envelope.dealer.location) || "the location shown in the listing"}. ${visitQuestion(language, cash)}`;
    answered = true;
  } else if (intent === "specs_vehiculo") {
    const range = clean(envelope.known_facts?.battery_range || envelope.known_facts?.range);
    reply = range
      ? (language === "es" ? `La autonomía indicada por el dealer es ${range}. ${visitQuestion(language, cash)}` : `The dealer's listed range is ${range}. ${visitQuestion(language, cash)}`)
      : (language === "es" ? `Nuestros agentes de ventas pueden ayudarte con ese detalle. ¿A qué número te lo enviamos?` : `Our sales agents can help with that detail. What number should we use to reach you?`);
    answered = true;
  } else if (intent === "vehiculo_vendido" || envelope.vehicle.status && envelope.vehicle.status !== "available") {
    reply = language === "es"
      ? `Ese ${vehicle} ya no aparece disponible. Puedo revisar opciones parecidas en el inventario. ¿Quieres que te muestre alternativas?`
      : `That ${vehicle} is no longer available. I can check similar options in inventory. Would you like me to show you alternatives?`;
    nextStep = "offer_inventory_options";
    answered = true;
  } else if (intent === "financiamiento") {
    reply = language === "es"
      ? `Sí, podemos revisar opciones de financiamiento según tu perfil; ${downPaymentText}. ¿Quieres venir a verlo o prefieres que coordinemos una visita?`
      : `Yes, we can review financing options based on your profile; ${downPaymentText}. Would you like to come see it or coordinate a visit?`;
    answered = true;
  } else if (intent === "requisitos") {
    reply = language === "es"
      ? `${cash ? "Para avanzar con la compra" : "Para revisar financiamiento"} necesitamos pasaporte o una identificación vigente y comprobante de ingresos. ${visitQuestion(language, cash)}`
      : `${cash ? "To move forward with the purchase" : "For financing"}, we need a passport or valid ID and proof of income. ${visitQuestion(language, cash)}`;
    answered = true;
  } else if (facts.down_payment_available !== null || intent === "enganche") {
    reply = language === "es"
      ? `Perfecto, anoto tu enganche disponible; ${downPaymentText}. ¿Qué número usamos para confirmar tu visita?`
      : `Great, I noted your available down payment; ${downPaymentText}. What number should we use to confirm your visit?`;
    nextStep = "request_phone";
    answered = true;
  } else if (facts.visit_window || intent === "senal_visita") {
    reply = language === "es" ? `Perfecto, ${facts.visit_window ? `anoto ${facts.visit_window}` : "anoto tu visita"}. ${visitQuestion(language, cash)}` : `Perfect, I noted ${facts.visit_window ?? "your visit"}. ${visitQuestion(language, cash)}`;
    answered = true;
  } else if (intent === "disponibilidad") {
    reply = language === "es" ? `Sí, el ${vehicle} está disponible. ${visitQuestion(language, cash)}` : `Yes, the ${vehicle} is available. ${visitQuestion(language, cash)}`;
    answered = true;
  } else if (facts.open_question) {
    reply = language === "es" ? `Nuestros agentes de ventas pueden ayudarte con ese detalle. ¿A qué número te contactamos?` : `Our sales agents can help with that detail. What number should we use to reach you?`;
    answered = true;
  } else {
    reply = language === "es" ? `Con gusto te ayudo con el ${vehicle}. ${visitQuestion(language, cash)}` : `I would be happy to help with the ${vehicle}. ${visitQuestion(language, cash)}`;
  }

  reply = addLink(reply, envelope, latest);
  const level = classifyMarketplaceLevel(facts);
  const questionCount = (reply.replace(/https?:\/\/\S+/gi, "").match(/[?]/g) ?? []).length;
  const violation = !handoff && questionCount !== 1
    ? "reply_must_contain_exactly_one_question"
    : cash && /\b(?:finance|financing|financiamiento|financiar)\b/i.test(reply)
      ? "cash_buyer_offered_financing"
      : null;

  return {
    reply_text: reply,
    facts,
    level,
    next_step: nextStep,
    handoff: { trigger: handoff },
    answered_buyer_question: answered,
    hard_rule_violation: violation,
    confidence: handoff || answered ? 0.9 : 0.72,
    fallback_reason: null,
  };
}
