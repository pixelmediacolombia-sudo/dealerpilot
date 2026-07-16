import { PHOTO_CLASSIFICATIONS } from "./providers/types";

export const HIGH_FIDELITY_RESTORATION_VERSION = "dealerpilot-photo-enhancement-v4-gpt-image-2-premium-marketplace";
export const MIN_PHOTO_FIDELITY_SCORE = 9.5;

export const HIGH_FIDELITY_PIPELINE_STEPS = [
  "Super Resolution",
  "Deblur",
  "Noise Reduction",
  "White Balance",
  "Dynamic Range Recovery",
  "Shadow Recovery",
  "Local Contrast",
  "Micro Detail Enhancement",
  "Automotive Quality Validation",
] as const;

const MASTER_PROMPT = [
  "You are a professional automotive inventory photo retoucher.",
  "",
  "Improve this dealership inventory photo so it matches the visual quality of premium automotive marketplaces such as Cars.com, AutoTrader, or manufacturer-certified inventory.",
  "",
  "Preserve the exact vehicle geometry, paint color, wheels, badges, VIN labels, reflections, dealership branding, text, trim, interior controls, and camera angle.",
  "",
  "Do NOT redesign, hallucinate, replace, invent, remove, crop, zoom, or alter any part of the vehicle or scene.",
  "",
  "Requirements:",
  "- Increase micro contrast.",
  "- Recover highlight detail.",
  "- Recover shadow detail.",
  "- Improve paint depth.",
  "- Improve metallic reflections.",
  "- Clean windshield reflections.",
  "- Improve headlight clarity.",
  "- Improve grille definition.",
  "- Improve leather and fabric texture.",
  "- Improve dashboard readability.",
  "- Improve infotainment screen sharpness.",
  "- Remove sensor noise.",
  "- Preserve natural colors.",
  "- Preserve the exact OEM paint color; do not shift hue, color temperature, or saturation of the vehicle paint.",
  "- Preserve original chrome brightness and metallic highlights without dulling or over-brightening chrome trim.",
  "- Keep whites neutral and avoid over-brightening white walls, curtains, floors, labels, or studio backgrounds.",
  "- Keep blacks deep but detailed.",
  "- Preserve readable logos, badges, labels, and screen text.",
  "",
  "Avoid:",
  "- HDR look.",
  "- Oversharpening.",
  "- Artificial saturation.",
  "- AI-generated appearance.",
  "- Fake texture.",
  "- Invented reflections.",
  "- Geometry changes.",
  "- Logo or text deformation.",
  "",
  "Final result should look like a professionally retouched dealership inventory photo, not an AI-generated image.",
];

const NEGATIVE_TERMS = [
  "blurry",
  "hallucinated texture",
  "fake leather",
  "fake stitching",
  "plastic looking",
  "oversharpen",
  "oversharpened",
  "HDR look",
  "HDR effect",
  "CGI",
  "painting",
  "cartoon",
  "extra buttons",
  "extra gear selector",
  "missing buttons",
  "new trim",
  "changed geometry",
  "fake reflections",
  "different perspective",
  "different dashboard",
  "different steering wheel",
  "invented details",
  "artificial lighting",
  "over saturation",
  "anime",
  "over saturated",
  "color shift",
  "lens distortion",
  "cropped",
  "warped",
  "diffusion artifacts",
];

function normalizeClassification(classification: string): string {
  return (PHOTO_CLASSIFICATIONS as readonly string[]).includes(classification)
    ? classification
    : "Miscellaneous";
}

export function shouldUseHighFidelityAiRestoration(classification: string): boolean {
  const normalized = normalizeClassification(classification);
  if (normalized.startsWith("Dealer")) return false;
  if (normalized === "Technical VIN Sticker" || normalized === "Technical Window Sticker") return false;
  return true;
}

export function buildHighFidelityRestorationPrompt(classification: string): string {
  const normalized = normalizeClassification(classification);
  const subjectGuidance = normalized.startsWith("Interior")
    ? "Interior photo: preserve every button, PRND letter, screen pixel, dashboard line, leather grain, stitch and plastic surface exactly."
    : normalized.startsWith("Exterior")
      ? "Exterior photo: preserve exact body geometry, wheel shape, trim, paint color, badges, glass and real reflections."
      : "Inventory detail photo: preserve all text, icons, materials, geometry and visible markings exactly.";

  return [
    ...MASTER_PROMPT,
    subjectGuidance,
    `Detected DealerPilot classification: ${normalized}.`,
    `Required pipeline: ${HIGH_FIDELITY_PIPELINE_STEPS.join(" -> ")}.`,
    `Accept only if Photo Fidelity Score is ${MIN_PHOTO_FIDELITY_SCORE}/10 or higher.`,
  ].join("\n");
}

export function getHighFidelityNegativePrompt(): string {
  return NEGATIVE_TERMS.join(", ");
}
