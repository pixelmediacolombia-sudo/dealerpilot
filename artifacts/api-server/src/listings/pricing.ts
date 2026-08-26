import type { Vehicle } from "@workspace/db";
import { categorize } from "./rules";

export type PriceMode = "FULL_PRICE" | "DOWN_PAYMENT";

export interface MarketplacePricing {
  actualVehiclePrice: number;
  marketplaceDisplayedPrice: number;
  priceMode: PriceMode;
  recommendedDownPayment: number | null;
  pricingReason: string;
}

function fmt(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export function buildMarketplaceTitle(
  vehicle: Pick<Vehicle, "year" | "make" | "model" | "trim">,
  downPayment?: number | null,
): string {
  const baseTitle = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter((value) => value != null && String(value).trim() !== "")
    .map((value) => String(value).trim())
    .join(" ");

  if (downPayment == null || downPayment <= 0) return baseTitle;
  return `${baseTitle} — ${fmt(downPayment)} DE ENGANCHE`;
}

export function getMarketplacePricing(
  vehicle: Vehicle,
  storedDownPayment?: number | null,
): MarketplacePricing {
  const actualVehiclePrice = vehicle.price ?? 0;
  const recommendedDownPayment = storedDownPayment ?? null;
  const category = categorize(vehicle);
  const downPaymentContext = recommendedDownPayment == null
    ? "no approved down-payment amount is configured"
    : `${fmt(recommendedDownPayment)} is the approved down-payment context for Sales AI`;

  return {
    actualVehiclePrice,
    marketplaceDisplayedPrice: actualVehiclePrice,
    priceMode: "FULL_PRICE",
    recommendedDownPayment,
    pricingReason: `${category} priced at ${fmt(actualVehiclePrice)} - full asking price is posted on Marketplace; ${downPaymentContext}.`,
  };
}
