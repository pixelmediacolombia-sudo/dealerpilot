import type { Vehicle } from "@workspace/db";
import { suggestDownPayment, categorize } from "./rules";

export type PriceMode = "FULL_PRICE" | "DOWN_PAYMENT";

export interface MarketplacePricing {
  actualVehiclePrice: number;
  marketplaceDisplayedPrice: number;
  priceMode: PriceMode;
  recommendedDownPayment: number | null;
  pricingReason: string;
}

const FULL_PRICE_THRESHOLD = 16_000;

function fmt(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

/**
 * Determines the correct price to display on Facebook Marketplace for a vehicle.
 *
 * Business rule:
 *   • Price < $16,000  → post full asking price  (FULL_PRICE mode)
 *   • Price ≥ $16,000  → post recommended down payment  (DOWN_PAYMENT mode)
 *
 * @param vehicle           Inventory vehicle record.
 * @param storedDownPayment Pre-computed value from the intelligence engine (preferred).
 *                          Falls back to the deterministic rule engine when absent.
 */
export function getMarketplacePricing(
  vehicle: Vehicle,
  storedDownPayment?: number | null,
): MarketplacePricing {
  const actualVehiclePrice = vehicle.price ?? 0;
  const category = categorize(vehicle);

  if (actualVehiclePrice < FULL_PRICE_THRESHOLD) {
    return {
      actualVehiclePrice,
      marketplaceDisplayedPrice: actualVehiclePrice,
      priceMode: "FULL_PRICE",
      recommendedDownPayment: null,
      pricingReason: `Priced at ${fmt(actualVehiclePrice)} — below the ${fmt(FULL_PRICE_THRESHOLD)} threshold. Full asking price is posted on Marketplace.`,
    };
  }

  const dp = storedDownPayment ?? suggestDownPayment(vehicle).downPayment;

  return {
    actualVehiclePrice,
    marketplaceDisplayedPrice: dp,
    priceMode: "DOWN_PAYMENT",
    recommendedDownPayment: dp,
    pricingReason: `${category} priced at ${fmt(actualVehiclePrice)} — Marketplace price shows ${fmt(dp)} down payment to attract qualified buyers through in-house financing.`,
  };
}
