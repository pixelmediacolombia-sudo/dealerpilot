// Static catalog for the Creative Intelligence Engine: templates, output sizes,
// pipeline steps, and the brand/background style vocabularies. Seeded into the
// database on startup and used as the source of truth by the worker.

export interface CreativeTemplateSeed {
  key: string;
  name: string;
  description: string;
  category: string;
  recommendedBrandStyle: string;
  sortOrder: number;
}

export const CREATIVE_TEMPLATES: CreativeTemplateSeed[] = [
  {
    key: "marketplace-standard",
    name: "Marketplace Standard",
    description: "Clean, Marketplace-ready cover with dealer branding.",
    category: "Standard",
    recommendedBrandStyle: "Modern",
    sortOrder: 1,
  },
  {
    key: "marketplace-premium",
    name: "Marketplace Premium",
    description: "High-contrast premium treatment engineered for click-through.",
    category: "Premium",
    recommendedBrandStyle: "Sport",
    sortOrder: 2,
  },
  {
    key: "luxury-vehicle",
    name: "Luxury Vehicle",
    description: "Editorial, low-key lighting for premium inventory.",
    category: "Luxury",
    recommendedBrandStyle: "Luxury",
    sortOrder: 3,
  },
  {
    key: "truck",
    name: "Truck",
    description: "Rugged, bold layout tuned for trucks.",
    category: "Truck",
    recommendedBrandStyle: "Aggressive",
    sortOrder: 4,
  },
  {
    key: "suv",
    name: "SUV",
    description: "Family-forward, spacious composition for SUVs.",
    category: "SUV",
    recommendedBrandStyle: "Modern",
    sortOrder: 5,
  },
  {
    key: "sedan",
    name: "Sedan",
    description: "Balanced, efficient layout for sedans.",
    category: "Sedan",
    recommendedBrandStyle: "Minimal",
    sortOrder: 6,
  },
  {
    key: "sport",
    name: "Sport",
    description: "Dynamic, motion-led styling for performance cars.",
    category: "Sport",
    recommendedBrandStyle: "Sport",
    sortOrder: 7,
  },
  {
    key: "electric",
    name: "Electric",
    description: "Clean, futuristic treatment for EVs.",
    category: "Electric",
    recommendedBrandStyle: "Modern",
    sortOrder: 8,
  },
];

export interface OutputSize {
  format: string;
  label: string;
  width: number;
  height: number;
}

// Image outputs generated per creative. Instagram / Google Vehicle Ads /
// Craigslist are intentionally future placements (not generated yet).
export const OUTPUT_SIZES: OutputSize[] = [
  { format: "marketplace-cover", label: "Marketplace Cover", width: 1080, height: 1080 },
  { format: "marketplace-story", label: "Marketplace Story", width: 1080, height: 1920 },
  { format: "facebook-feed", label: "Facebook Feed", width: 1200, height: 1200 },
];

// The deterministic creative pipeline, in order. Real image providers can be
// slotted behind these step names later without changing the contract.
export const PIPELINE_STEPS = [
  "Original Vehicle Images",
  "Remove Background",
  "Vehicle Segmentation",
  "AI Enhancement",
  "Dealer Background",
  "Professional Shadow",
  "Professional Reflection",
  "Lighting Enhancement",
  "Export",
];

export const BRAND_STYLES = [
  "Luxury",
  "Sport",
  "Modern",
  "Minimal",
  "Urban",
  "Aggressive",
  "Premium",
];

export const BACKGROUND_STYLES = [
  "Dark Studio",
  "Showroom",
  "Modern Garage",
  "Outdoor",
  "Luxury Showroom",
  "Night Lights",
  "Industrial",
];
