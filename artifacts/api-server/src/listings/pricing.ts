import type { Vehicle } from "@workspace/db";
import { categorize, suggestDownPayment } from "./rules";

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
  const recommendedDownPayment = storedDownPayment ?? suggestDownPayment(vehicle).downPayment;
  const category = categorize(vehicle);

  return {
    actualVehiclePrice,
    marketplaceDisplayedPrice: actualVehiclePrice,
    priceMode: "FULL_PRICE",
    recommendedDownPayment,
    pricingReason: `${category} priced at ${fmt(actualVehiclePrice)} - full asking price is posted on Marketplace; ${fmt(recommendedDownPayment)} stays as internal down-payment context for Sales AI.`,
  };
}
