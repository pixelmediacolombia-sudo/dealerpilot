import type {
  CreativeOutput,
  CreativeRenderSpec,
  CreativeTemplate,
  DealerBrandDna,
  Vehicle,
} from "@workspace/db";
import { OUTPUT_SIZES, PIPELINE_STEPS } from "./templates";

// Brand-red defaults matched to the dashboard theme, used when a dealer has not
// configured a palette yet.
const DEFAULT_PRIMARY = "#E11D2A";
const DEFAULT_SECONDARY = "#0B0B0F";
const DEFAULT_ACCENT = "#F5F5F5";

const CTA_BY_STYLE: Record<string, string> = {
  Luxury: "Schedule a Private Viewing",
  Sport: "Message for a Test Drive",
  Modern: "Message Us Today",
  Minimal: "Inquire Now",
  Urban: "DM to Reserve",
  Aggressive: "Claim This Deal",
  Premium: "Book Your Test Drive",
};

function pick(arr: string[] | undefined | null, fallback: string): string {
  return arr && arr.length > 0 ? arr[0]! : fallback;
}

function formatPrice(price: number | null): string {
  if (!price || price <= 0) return "Call for Price";
  return "$" + price.toLocaleString("en-US");
}

function formatMileage(mileage: number | null): string | null {
  if (!mileage || mileage <= 0) return null;
  return `${mileage.toLocaleString("en-US")} mi`;
}

export interface BuildCreativeInput {
  vehicle: Vehicle;
  primaryImageUrl: string | null;
  dna: DealerBrandDna | null;
  template: CreativeTemplate;
  dealerName: string;
}

export interface BuiltCreative {
  renderSpec: CreativeRenderSpec;
  outputs: CreativeOutput[];
}

/**
 * Deterministically compose a creative recipe from the vehicle, the dealer's
 * Brand DNA, and the chosen template. This is the placeholder transformation:
 * it produces a faithful render spec (and output descriptors) without calling
 * any external image-generation API. A real provider can later consume the same
 * spec and fill each output URL with a generated asset — no schema/UI change.
 */
export function buildCreative(input: BuildCreativeInput): BuiltCreative {
  const { vehicle, primaryImageUrl, dna, template, dealerName } = input;

  const brandStyle = dna?.brandStyle ?? template.recommendedBrandStyle ?? "Sport";
  const backgroundStyle = dna?.backgroundStyle ?? "Dark Studio";

  const headlineParts = [
    vehicle.year ? String(vehicle.year) : "",
    vehicle.make,
    vehicle.model,
    vehicle.trim ?? "",
  ].filter(Boolean);
  const headline = headlineParts.join(" ").trim();

  const sublineParts = [vehicle.bodyStyle ?? null, formatMileage(vehicle.mileage)].filter(
    Boolean,
  ) as string[];
  const subline = sublineParts.join("  •  ");

  const renderSpec: CreativeRenderSpec = {
    template: template.name,
    brandStyle,
    backgroundStyle,
    colors: {
      primary: pick(dna?.primaryColors, DEFAULT_PRIMARY),
      secondary: pick(dna?.secondaryColors, DEFAULT_SECONDARY),
      accent: pick(dna?.accentColors, DEFAULT_ACCENT),
    },
    font: dna?.preferredFont ?? "Inter",
    dealerName,
    logoUrl: dna?.logoUrl ?? null,
    vehicleImageUrl: primaryImageUrl,
    headline,
    subline,
    price: formatPrice(vehicle.price ?? null),
    cta: CTA_BY_STYLE[brandStyle] ?? "Message Us Today",
    steps: [...PIPELINE_STEPS],
  };

  // Placeholder outputs: each Marketplace size points at the source image for
  // now. The render spec carries the on-brand composition the UI displays.
  const outputs: CreativeOutput[] = OUTPUT_SIZES.map((size) => ({
    format: size.format,
    label: size.label,
    width: size.width,
    height: size.height,
    url: primaryImageUrl ?? "",
  }));

  return { renderSpec, outputs };
}
