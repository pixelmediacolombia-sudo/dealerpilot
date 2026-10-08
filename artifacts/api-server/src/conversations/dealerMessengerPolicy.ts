import type { DealerMarketplaceKnowledge } from "@workspace/db";

export const LUCKI_MAZDA_DEALER_ID = 2;
export const LUCKI_MAZDA_PHONE = "+15717747848";
export const LUCKI_MAZDA_LOCATION = "Woodbridge, VA";

export type MessengerDealerPolicy = {
  dealerId: number;
  displayName: string;
  phone: string | null;
  location: string | null;
  cleanTitleClaimsAllowed: boolean;
  generalQuestionsOnly: boolean;
};

export function getMessengerDealerPolicy(dealerId: number): MessengerDealerPolicy {
  if (dealerId === LUCKI_MAZDA_DEALER_ID) {
    return {
      dealerId,
      displayName: "Lucki Mazda",
      phone: LUCKI_MAZDA_PHONE,
      location: LUCKI_MAZDA_LOCATION,
      cleanTitleClaimsAllowed: true,
      generalQuestionsOnly: true,
    };
  }

  return {
    dealerId,
    displayName: dealerId === 1 ? "Alpha Motorsports" : "",
    phone: null,
    location: null,
    cleanTitleClaimsAllowed: false,
    generalQuestionsOnly: false,
  };
}

export function getEffectiveMessengerKnowledge(
  dealerId: number,
  knowledge: DealerMarketplaceKnowledge | null | undefined,
): DealerMarketplaceKnowledge {
  const base = knowledge ?? {};
  const policy = getMessengerDealerPolicy(dealerId);
  if (!policy.generalQuestionsOnly) return base;

  return {
    ...base,
    en: {
      ...base.en,
      // Never inherit a phone or address from another dealer's knowledge
      // block. Lucki's identity is fixed by its internal dealer id.
      phone: policy.phone || undefined,
      address: /\b(?:alpha|manassas|fredericksburg)\b/i.test(base.en?.address || "")
        ? policy.location || undefined
        : base.en?.address?.trim() || policy.location || undefined,
      title: base.en?.title?.trim() || "All vehicles have a clean title",
    },
    es: {
      ...base.es,
      phone: policy.phone || undefined,
      address: /\b(?:alpha|manassas|fredericksburg)\b/i.test(base.es?.address || "")
        ? policy.location || undefined
        : base.es?.address?.trim() || policy.location || undefined,
      title: base.es?.title?.trim() || "Todos los vehículos tienen título limpio",
    },
  };
}

export function isLuckiMazdaPhone(phone: string | null | undefined): boolean {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits === "15717747848" || digits === "5717747848";
}

export function isLuckiReplySafe(reply: string): boolean {
  return !/\b(?:alpha|manassas|down\s*payment|down|enganche|inicial|financ(?:e|ing|iamiento)|financiar)\b/i.test(reply);
}

export type LuckiVehicleFacts = {
  price?: number | null;
  mileage?: number | null;
  vin?: string | null;
  vdpUrl?: string | null;
  exteriorColor?: string | null;
};

function clean(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalize(value: string): string {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasLuckiConcreteCashOffer(value: string): boolean {
  const text = normalize(value);
  const offerSignal = /\b(?:offer|oferta|sell|vender|take|accept|aceptar|deal|trato|can you do|would you take|will you take)\b/.test(text);
  const firstPersonCashPurchaseSignal =
    /\b(?:i|we)\s+(?:can|could|would|will)\s+(?:pay|buy|purchase)\b.{0,40}\b(?:cash|contado|efectivo)\b/.test(text);
  const firstPersonOfferSignal =
    /\b(?:i|we)\s+(?:can|could|would|will)\s+(?:do|offer)\b/.test(text);
  const withoutPhone = text.replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, " ");
  const hasOfferAmount = /(?:\$\s*\d{4,6}\b|\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s*(?:k|thousand|mil)\b)/.test(withoutPhone);
  return (offerSignal || firstPersonCashPurchaseSignal || firstPersonOfferSignal) && hasOfferAmount;
}

function vehicleName(value?: string): { full: string; short: string } {
  const full = clean(value) || "vehicle";
  const parts = full.split(/\s+/);
  const short = parts.length >= 3 && /^\d{4}$/.test(parts[0] || "") ? parts[2] || full : parts.at(-1) || full;
  return { full, short };
}

/** Deterministic general-only reply path for Lucki until its own sales policy is approved. */
export function buildLuckiGeneralOnlyReply(params: {
  language: string;
  currentMessage: string;
  vehicleTitle?: string;
  storePhone: string;
  vehicleFacts: LuckiVehicleFacts;
  hasCleanTitleInventory: boolean;
  firstDealerReply?: boolean;
}): string {
  const language = params.language === "es" ? "es" : "en";
  const names = vehicleName(params.vehicleTitle);
  const latest = clean(params.currentMessage);
  const normalized = normalize(latest);
  const phoneProvided = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(latest);
  const phoneRequested = /\b(?:phone|telephone|telefono|teléfono)\b/.test(normalized) ||
    /\b(?:dealer|store|call|contact|llamar|contactar)\b.{0,24}\b(?:number|numero|número)\b/.test(normalized);
  const cleanTitleRequested = /\b(?:clean title|clear title|titulo limpio|t[ií]tulo limpio|warranty|garantia|garant[ií]a)\b/.test(normalized);
  const photosRequested = /\b(?:photo|photos|picture|pictures|image|images|foto|fotos|imagen|imagenes)\b/.test(normalized);
  const greetingOnly = /^(?:hi|hello|hey|hola|buenas(?:\s+(?:dias|d[ií]as|tardes|noches))?)[\s!,.?]*$/i.test(normalized);
  const firstDealerReply = params.firstDealerReply ?? true;
  const finish = (reply: string): string => {
    const cleaned = clean(reply);
    if (!firstDealerReply || /^(?:hello|hola),?\s+(?:this is|somos) lucki mazda\b/i.test(cleaned)) return cleaned;
    return language === "es"
      ? `Hola, somos Lucki Mazda. ${cleaned}`
      : `Hello, this is Lucki Mazda. ${cleaned}`;
  };
  const buyerPhoneHandoff = language === "es"
    ? `Nuestros agentes de ventas pueden confirmar ese detalle. ¿Cuál es el mejor número para comunicarnos contigo? También puedes llamarnos a Lucki Mazda al ${params.storePhone}.`
    : `Our sales agents can confirm that detail. What's the best phone number to reach you? You can also call Lucki Mazda at ${params.storePhone}.`;

  if (hasLuckiConcreteCashOffer(latest)) {
    const reply = language === "es"
      ? `Gracias por tu oferta en efectivo por el ${names.full}. ¿Cuál es el mejor número para comunicarnos contigo? También puedes llamar a Lucki Mazda al ${params.storePhone}.`
      : `Thanks for your cash offer on the ${names.full}. What's the best phone number to reach you? You can also call Lucki Mazda at ${params.storePhone}.`;
    return finish(reply);
  }

  if (greetingOnly) {
    return finish(language === "es"
      ? "¡Hola! Somos Lucki Mazda. ¿Qué te gustaría saber?"
      : "Hello! This is Lucki Mazda. What would you like to know?");
  }

  if (phoneProvided) {
    return finish(language === "es"
      ? "Gracias por tu número. Un agente de Lucki Mazda te contactará en breve. ¡Que tengas un buen día!"
      : "Thanks for your number. A Lucki Mazda sales agent will contact you shortly. Goodbye, and have a great day!");
  }
  if (phoneRequested) {
    return finish(language === "es"
      ? `Con gusto, el número de Lucki Mazda es ${params.storePhone}.`
      : `Of course, Lucki Mazda's number is ${params.storePhone}.`);
  }
  if (cleanTitleRequested) {
    return finish(params.hasCleanTitleInventory
      ? language === "es"
        ? `Sí, el ${names.short} tiene título limpio.`
        : `Yes, the ${names.short} has a clean title.`
      : buyerPhoneHandoff);
  }
  if (photosRequested && params.vehicleFacts.vdpUrl && isLuckiReplySafe(params.vehicleFacts.vdpUrl)) {
    return finish(language === "es"
      ? `Aquí está la ficha del ${names.full} con sus fotos: ${params.vehicleFacts.vdpUrl}.`
      : `Here is the ${names.full} vehicle page with its photos: ${params.vehicleFacts.vdpUrl}.`);
  }
  if (/\b(?:price|precio|how much|cuanto|cuánto)\b/.test(normalized) && params.vehicleFacts.price != null) {
    return finish(language === "es"
      ? `El precio publicado del ${names.full} es $${params.vehicleFacts.price.toLocaleString("en-US")}.`
      : `The listed price for the ${names.full} is $${params.vehicleFacts.price.toLocaleString("en-US")}.`);
  }
  if (/\b(?:mileage|miles|millas|millaje|kilometraje)\b/.test(normalized) && params.vehicleFacts.mileage != null) {
    return finish(language === "es"
      ? `El ${names.full} tiene ${params.vehicleFacts.mileage.toLocaleString("en-US")} millas.`
      : `The ${names.full} has ${params.vehicleFacts.mileage.toLocaleString("en-US")} miles.`);
  }
  if (/\b(?:color|colour|paint)\b/.test(normalized) && params.vehicleFacts.exteriorColor) {
    return finish(language === "es"
      ? `El color exterior es ${params.vehicleFacts.exteriorColor}.`
      : `The exterior color is ${params.vehicleFacts.exteriorColor}.`);
  }
  if (/\bvin\b/.test(normalized) && params.vehicleFacts.vin) {
    return finish(language === "es"
      ? `El VIN del ${names.full} es ${params.vehicleFacts.vin}.`
      : `The VIN for the ${names.full} is ${params.vehicleFacts.vin}.`);
  }
  if (/\b(?:where|location|address|donde|dónde|ubicad[oa]|direccion|dirección)\b/.test(normalized)) {
    return finish(language === "es"
      ? `Lucki Mazda está en Woodbridge, Virginia. Puedes llamarnos al ${params.storePhone}.`
      : `Lucki Mazda is in Woodbridge, Virginia. You can call us at ${params.storePhone}.`);
  }
  if (/\b(?:available|disponible|still for sale|sigue en venta|sigue disponible)\b/.test(normalized)) {
    return finish(language === "es"
      ? `Hola, somos Lucki Mazda. Sí, el ${names.full} está disponible. ¿Qué te gustaría saber?`
      : `Hello, this is Lucki Mazda. Yes, the ${names.full} is available. What would you like to know?`);
  }
  return finish(buyerPhoneHandoff);
}
