import { PHOTO_CLASSIFICATIONS } from "./providers/types";

export const HIGH_FIDELITY_RESTORATION_VERSION = "dealerpilot-photo-enhancement-v3-gpt-image";
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
  "Act as a professional automotive photo restoration AI.",
  "",
  "Image restoration only.",
  "No creative edits.",
  "No redesign.",
  "No object replacement.",
  "Preserve exact geometry.",
  "",
  "Your goal is NOT to redesign or modify the vehicle.",
  "Restore this image as if it were captured with a professional DSLR camera inside a dealership showroom.",
  "",
  "Requirements:",
  "- Preserve 100% of the original vehicle, interior, colors, textures and materials.",
  "- Do NOT hallucinate or invent buttons, trim pieces, stitching, controls or reflections.",
  "- Remove blur while preserving natural detail.",
  "- Recover fine leather texture and stitching.",
  "- Sharpen the gear selector, PRND letters and surrounding buttons.",
  "- Improve local contrast without creating halos.",
  "- Correct white balance to neutral daylight.",
  "- Increase dynamic range.",
  "- Recover highlights and shadow detail.",
  "- Remove JPEG artifacts and compression noise.",
  "- Enhance micro-contrast.",
  "- Improve edge definition.",
  "- Improve clarity of plastics and brushed aluminum trim.",
  "- Reduce sensor noise.",
  "- Maintain realistic reflections.",
  "- Preserve original perspective.",
  "- Preserve all branding exactly.",
  "- Do not crop.",
  "- Do not zoom.",
  "- Do not replace any part of the vehicle.",
  "- Do not generate artificial interiors.",
  "- Do not add fake leather texture.",
  "- Do not oversharpen.",
  "- Keep the image looking completely natural.",
  "",
  "Target quality:",
  "Luxury automotive dealership photography.",
  "Ultra clean.",
  "Ultra sharp.",
  "Natural lighting.",
  "Realistic.",
  "8K detail.",
  "Professional inventory photo.",
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
