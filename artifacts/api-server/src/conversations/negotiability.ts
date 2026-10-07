export type NegotiabilityIntent = "ASK_NEGOTIABLE";

function normalizeNegotiabilityText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function detectNegotiabilityIntent(value: unknown): NegotiabilityIntent | null {
  const normalized = normalizeNegotiabilityText(value);
  if (!normalized) return null;

  return /\b(?:negociable|negotiable)\b/.test(normalized) ||
    /\b(?:se puede|puedo|podemos|can(?: you| we)?)\s+(?:negociar|negotiate)\b/.test(normalized) ||
    /\b(?:best offer|mejor oferta|accept offers|aceptan ofertas)\b/.test(normalized)
    ? "ASK_NEGOTIABLE"
    : null;
}

export function buildNegotiabilityReply(language: string, dealerName = "Alpha Motorsports"): string {
  return language === "es"
    ? `Hola, somos ${dealerName}: sí, el precio es negociable. ¿Qué te gustaría saber?`
    : `Hello, this is ${dealerName}: yes, the price is negotiable. What would you like to know?`;
}
