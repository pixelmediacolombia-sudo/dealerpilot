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

  if (greetingOnly) {
    return language === "es"
      ? "¡Hola! Somos Lucki Mazda. ¿Qué te gustaría saber?"
      : "Hello! This is Lucki Mazda. What would you like to know?";
  }

  if (phoneProvided) {
    return language === "es"
      ? "Gracias por tu número. Un agente de Lucki Mazda te contactará en breve."
      : "Thanks for your number. A Lucki Mazda sales agent will contact you shortly.";
  }
  if (phoneRequested) {
    return language === "es"
      ? `Con gusto, el número de Lucki Mazda es ${params.storePhone}.`
      : `Of course, Lucki Mazda's number is ${params.storePhone}.`;
  }
  if (cleanTitleRequested) {
    return params.hasCleanTitleInventory
      ? language === "es"
        ? `Sí, el ${names.short} tiene título limpio.`
        : `Yes, the ${names.short} has a clean title.`
      : language === "es"
        ? "Un agente de Lucki Mazda puede confirmar ese detalle."
        : "A Lucki Mazda sales agent can confirm that detail.";
  }
  if (photosRequested && params.vehicleFacts.vdpUrl && isLuckiReplySafe(params.vehicleFacts.vdpUrl)) {
    return language === "es"
      ? `Aquí está la ficha del ${names.full} con sus fotos: ${params.vehicleFacts.vdpUrl}.`
      : `Here is the ${names.full} vehicle page with its photos: ${params.vehicleFacts.vdpUrl}.`;
  }
  if (/\b(?:price|precio|how much|cuanto|cuánto)\b/.test(normalized) && params.vehicleFacts.price != null) {
    return language === "es"
      ? `El precio publicado del ${names.full} es $${params.vehicleFacts.price.toLocaleString("en-US")}.`
      : `The listed price for the ${names.full} is $${params.vehicleFacts.price.toLocaleString("en-US")}.`;
  }
  if (/\b(?:mileage|miles|millas|millaje|kilometraje)\b/.test(normalized) && params.vehicleFacts.mileage != null) {
    return language === "es"
      ? `El ${names.full} tiene ${params.vehicleFacts.mileage.toLocaleString("en-US")} millas.`
      : `The ${names.full} has ${params.vehicleFacts.mileage.toLocaleString("en-US")} miles.`;
  }
  if (/\b(?:color|colour|paint)\b/.test(normalized) && params.vehicleFacts.exteriorColor) {
    return language === "es"
      ? `El color exterior es ${params.vehicleFacts.exteriorColor}.`
      : `The exterior color is ${params.vehicleFacts.exteriorColor}.`;
  }
  if (/\bvin\b/.test(normalized) && params.vehicleFacts.vin) {
    return language === "es"
      ? `El VIN del ${names.full} es ${params.vehicleFacts.vin}.`
      : `The VIN for the ${names.full} is ${params.vehicleFacts.vin}.`;
  }
  if (/\b(?:where|location|address|donde|dónde|ubicad[oa]|direccion|dirección)\b/.test(normalized)) {
    return language === "es"
      ? `Lucki Mazda está en Woodbridge, Virginia. Puedes llamarnos al ${params.storePhone}.`
      : `Lucki Mazda is in Woodbridge, Virginia. You can call us at ${params.storePhone}.`;
  }
  if (/\b(?:available|disponible|still for sale|sigue en venta|sigue disponible)\b/.test(normalized)) {
    return language === "es"
      ? `Hola, somos Lucki Mazda. Sí, el ${names.full} está disponible. ¿Qué te gustaría saber?`
      : `Hello, this is Lucki Mazda. Yes, the ${names.full} is available. What would you like to know?`;
  }
  return language === "es"
    ? `Con gusto te ayudamos con preguntas generales sobre el ${names.full}. ¿Qué te gustaría saber?`
    : `We are happy to help with general questions about the ${names.full}. What would you like to know?`;
}
