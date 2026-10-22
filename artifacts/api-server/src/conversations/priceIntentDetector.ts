export const CONFIRM_PRICE_INTENT = "CONFIRM_PRICE_INTENT" as const;

export type PriceIntent = typeof CONFIRM_PRICE_INTENT | null;

function normalize(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Detects whether the buyer is confirming that the shown amount is total/final. */
export function detectPriceIntent(value: string): PriceIntent {
  const text = normalize(value);
  if (!text) return null;

  const totalOrFinal = "(?:total|final|completo|completa|definitivo|definitiva)";
  const priceOrValue = "(?:precio|valor|costo|coste)";
  const vehicle = "(?:vehiculo|carro|auto|coche|vehicle|car|truck)";

  if (
    new RegExp(`\\b(?:ese|eso|esa|el mostrado|lo mostrado)\\b.{0,24}\\b(?:es|seria)\\b.{0,16}\\b${priceOrValue}\\b.{0,16}\\b${totalOrFinal}\\b`).test(text) ||
    new RegExp(`\\b(?:ese|esa|eso)\\s+${priceOrValue}\\s+(?:es|seria)\\s+(?:el\\s+)?${totalOrFinal}\\b`).test(text) ||
    new RegExp(`\\b(?:el\\s+)?${priceOrValue}\\s+(?:es|seria)\\s+(?:el\\s+)?${totalOrFinal}\\b`).test(text) ||
    new RegExp(`\\b(?:es|seria)\\b.{0,12}\\b${priceOrValue}\\b.{0,16}\\b${totalOrFinal}\\b.{0,16}\\b(?:del|de la|del)\\b.{0,12}\\b${vehicle}\\b`).test(text) ||
    new RegExp(`\\b(?:cuesta|vale)\\b.{0,18}\\b(?:eso|ese precio|lo mostrado|la cantidad)\\b.{0,16}\\b${vehicle}\\b`).test(text) ||
    new RegExp(`\\b(?:precio|valor)\\b.{0,20}\\b(?:mostrado|publicado)\\b.{0,16}\\b(?:es|incluye)\\b.{0,16}\\b${totalOrFinal}\\b`).test(text) ||
    /\b(?:is that|is this|does that include)\b.{0,24}\b(?:the )?(?:total|final|full)\b.{0,12}\b(?:price|amount|cost)\b/.test(text) ||
    /\b(?:does|is)\b.{0,24}\b(?:the )?(?:vehicle|car|truck)\b.{0,12}\b(?:cost|price)\b.{0,12}\b(?:that|this)\b/.test(text)
  ) {
    return CONFIRM_PRICE_INTENT;
  }

  return null;
}

export function isConfirmPriceIntent(value: string): boolean {
  return detectPriceIntent(value) === CONFIRM_PRICE_INTENT;
}
