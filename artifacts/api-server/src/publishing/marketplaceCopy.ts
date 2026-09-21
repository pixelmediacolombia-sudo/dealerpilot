import { ALPHA_DEALER_ID, LUCKI_MAZDA_DEALER_ID } from "../lib/dealer.ts";

export type FallbackMarketplaceCopyInput = {
  dealerId: number;
  autoTitle: string;
  priceTextEn: string;
  priceTextEs: string;
  mileageTextEn: string | null;
  mileageTextEs: string | null;
  lotLocation: string | null;
};

export type FallbackMarketplaceCopy = {
  english: string;
  spanish: string;
};

/**
 * Builds only the fallback text used when no listing version exists.
 * Existing Alpha copy is kept byte-for-byte; Lucki never inherits Alpha's
 * name or phone number.
 */
export function buildFallbackMarketplaceCopy(
  input: FallbackMarketplaceCopyInput,
): FallbackMarketplaceCopy {
  if (input.dealerId === ALPHA_DEALER_ID) {
    return {
      english: [
        `🚗 ${input.autoTitle} available now at Alpha Motorsport.`,
        `💰 Total price: ${input.priceTextEn}.`,
        input.mileageTextEn ? `✅ ${input.mileageTextEn}.` : null,
        "✅ Easy financing options available for qualified buyers.",
        "✅ Clean, simple buying process for serious buyers.",
        "",
        "📞 Call +1 703-763-4675 for fast details or to schedule a visit today.",
      ].filter(Boolean).join("\n"),
      spanish: [
        `🚗 ${input.autoTitle} disponible ahora en Alpha Motorsport.`,
        `💰 Precio total: ${input.priceTextEs}.`,
        input.mileageTextEs ? `✅ ${input.mileageTextEs}.` : null,
        "✅ Financiamiento disponible para compradores calificados.",
        "✅ Proceso fácil, claro y rápido para compradores serios.",
        "",
        "📲 Llama al +1 703-763-4675 o escríbenos para verla hoy.",
      ].filter(Boolean).join("\n"),
    };
  }

  if (input.dealerId === LUCKI_MAZDA_DEALER_ID) {
    const location = input.lotLocation?.trim() ? ` in ${input.lotLocation.trim()}` : "";
    const locationEs = input.lotLocation?.trim() ? ` en ${input.lotLocation.trim()}` : "";
    return {
      english: [
        `🚗 ${input.autoTitle} available now at Lucki Mazda${location}.`,
        `💰 Total price: ${input.priceTextEn}.`,
        input.mileageTextEn ? `✅ ${input.mileageTextEn}.` : null,
        "✅ Easy financing options available for qualified buyers.",
        "✅ Clean, simple buying process for serious buyers.",
        "",
        "📞 Call +1 571-774-7848 for fast details or to schedule a visit today.",
      ].filter(Boolean).join("\n"),
      spanish: [
        `🚗 ${input.autoTitle} disponible ahora en Lucki Mazda${locationEs}.`,
        `💰 Precio total: ${input.priceTextEs}.`,
        input.mileageTextEs ? `✅ ${input.mileageTextEs}.` : null,
        "✅ Financiamiento disponible para compradores calificados.",
        "✅ Proceso fácil, claro y rápido para compradores serios.",
        "",
        "📲 Llama al +1 571-774-7848 o escríbenos para verla hoy.",
      ].filter(Boolean).join("\n"),
    };
  }

  return {
    english: `🚗 ${input.autoTitle} is available now.\n💰 Total price: ${input.priceTextEn}.`,
    spanish: `🚗 ${input.autoTitle} está disponible ahora.\n💰 Precio total: ${input.priceTextEs}.`,
  };
}
