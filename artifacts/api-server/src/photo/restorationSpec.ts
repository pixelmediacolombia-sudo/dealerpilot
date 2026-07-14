import { PHOTO_CLASSIFICATIONS } from "./providers/types";

export const HIGH_FIDELITY_RESTORATION_VERSION = "dealerpilot-photo-enhancement-v2";
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
  "You are NOT an image generation model.",
  "You are a professional automotive photo restoration engine.",
  "Your only task is restoring image quality while preserving 100% of the original vehicle.",
  "Never redesign.",
  "Never replace.",
  "Never hallucinate.",
  "Never create missing details.",
  "Never alter vehicle geometry.",
  "Never modify trims.",
  "Never modify stitching.",
  "Never modify leather grain.",
  "Never change reflections.",
  "Never modify plastics.",
  "Never change steering wheel.",
  "Never change buttons.",
  "Never modify dashboard.",
  "Never change screens.",
  "Never change wheel shape.",
  "Never crop.",
  "Never zoom.",
  "Never change perspective.",
  "Improve ONLY:",
  "- sharpness",
  "- resolution",
  "- lighting",
  "- dynamic range",
  "- white balance",
  "- local contrast",
  "- edge clarity",
  "- micro detail",
  "- JPEG artifacts",
  "- image noise",
  "Target:",
  "Professional dealership inventory photography.",
  "Luxury OEM quality.",
  "Natural.",
  "Photo-realistic.",
  "Zero AI artifacts.",
  "Zero hallucination.",
  "Zero redesign.",
  "The customer must not notice the image was processed by AI.",
];

const NEGATIVE_TERMS = [
  "hallucinated texture",
  "fake leather",
  "fake stitching",
  "plastic looking",
  "oversharpen",
  "HDR look",
  "CGI",
  "painting",
  "extra buttons",
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
  "cartoon",
  "anime",
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
