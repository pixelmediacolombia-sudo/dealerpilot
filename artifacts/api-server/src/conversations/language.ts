export type ConversationLanguage = "en" | "es";

function normalizeLanguageText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const SPANISH_TOKENS = /\b(?:buenas|gracias|disponible|tengo|quiero|estoy|interesad[oa]s?|claro|podemos|ayuda|inicial|comprar|semana|numero|telefono|itin|ingresos|esta|esa|ese|eso|esto|este|tiene|tienen|precio|cuanto|cual|donde|cuando|carro|auto|vehiculo|si|como|necesit[ao]|aplicar|requisitos?|documentos?|pasaporte|cuenta|bancaria|financiar|financiamiento|asesor|opciones?|disponibles?|tambien|puedo|puedes?|mira|dime|informacion|diferencia|paquete|millas|kilometros?|garantia|motor|automatico|mecanico|manual|camioneta|sedan|historial|accidente|condicion|pido|ahora|listo|nuevo|viejo|gusta|encanta|necesitaria|estaria|alguno|alguna|otro|otra|mas|talvez|seguir|pago|pag[oó]|contado|efectivo|solo|enviamos|mandamos|ubicacion|direccion)\b/g;
const ENGLISH_TOKENS = /\b(?:hello|thanks|available|have|has|interested|sure|could|would|need|buy|week|number|phone|price|what|where|when|cash|pay|financing|finance|requirements|documents|passport|bank|account|vehicle|car|mileage|miles|warranty|history|accident|condition|engine|transmission|color|colour|please|send|call|located|address|today|tomorrow|weekend)\b/g;

export function languageScores(value: unknown): { en: number; es: number } {
  const text = normalizeLanguageText(value);
  if (!text) return { en: 0, es: 0 };
  const spanishTokens = text.match(SPANISH_TOKENS)?.length ?? 0;
  const englishTokens = text.match(ENGLISH_TOKENS)?.length ?? 0;
  const spanishPhrase = /\b(?:de un solo pago|de contado|en efectivo|me das|cual es|a que numero|que documentos|donde estan|donde estan ubicados)\b/.test(text);
  const englishPhrase = /\b(?:one payment|pay in cash|what number|where are you located|what documents do i need)\b/.test(text);
  return {
    en: englishTokens + (englishPhrase ? 3 : 0),
    es: spanishTokens + (spanishPhrase ? 3 : 0) + (/[¿¡ñáéíóúü]/i.test(String(value ?? "")) ? 2 : 0),
  };
}

export function detectLanguage(value: unknown): ConversationLanguage {
  const scores = languageScores(value);
  return scores.es > scores.en ? "es" : "en";
}

export function detectConversationLanguage(
  currentMessage: unknown,
  priorBuyerMessages: unknown[] = [],
): ConversationLanguage {
  const currentScores = languageScores(currentMessage);
  if (currentScores.en > 0 || currentScores.es > 0) {
    return currentScores.es > currentScores.en ? "es" : "en";
  }

  for (const message of [...priorBuyerMessages].reverse()) {
    const scores = languageScores(message);
    if (scores.en > 0 || scores.es > 0) return scores.es > scores.en ? "es" : "en";
  }

  return "en";
}
