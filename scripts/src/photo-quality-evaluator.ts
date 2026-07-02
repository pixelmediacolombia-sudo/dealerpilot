// DealerPilot Photo Quality Evaluator
// Uses GPT-5-mini vision to assess photographic quality using the language
// of professional automotive photography — not image processing metrics.
//
// Evaluates 10 dimensions for Original vs Enhanced side-by-side.
// Returns a structured scorecard with per-dimension scores (1–10),
// delta, a headline verdict, and a brief photographer's note per dimension.

import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "placeholder",
});

const MODEL = "gpt-5-mini";

// The 10 dimensions from the spec.
// Each has a label (shown in the report) and a scope note for the prompt.
export const QUALITY_DIMENSIONS = [
  { key: "lighting",          label: "Lighting",                 scope: "Quality and direction of light. Does the car look well-lit, evenly exposed, free of harsh shadows or blown hotspots?" },
  { key: "exposure",          label: "Exposure",                 scope: "Overall brightness. Is it too dark, too bright, or balanced? Are shadow areas visible without being muddy?" },
  { key: "whiteBalance",      label: "White Balance",            scope: "Color temperature accuracy. Does the image look neutral, or is it too warm (orange cast) or too cool (blue cast)?" },
  { key: "dynamicRange",      label: "Dynamic Range",            scope: "Detail retained in both highlights and shadows simultaneously. Can you see paint detail in bright reflections AND shadow areas?" },
  { key: "paintQuality",      label: "Paint Quality",            scope: "Gloss, depth, and richness of the paint finish. Does the color look deep and saturated, or flat and dull? (Mark N/A for technical photos)" },
  { key: "glassQuality",      label: "Glass Quality",            scope: "Clarity of windows, windshield. Do the windows look clean and transparent? (Mark N/A for interior/technical photos)" },
  { key: "materialQuality",   label: "Interior Material Quality", scope: "Leather, fabric, trim, stitching texture. Does the interior look premium and detailed? (Mark N/A for exterior photos)" },
  { key: "naturalness",       label: "Naturalness",              scope: "Does the image look like a real photograph or like a filter was applied? No HDR halos, no plastic paint, no artificial glow." },
  { key: "artifactDetection", label: "Artifact Detection",       scope: "Absence of JPEG blocking, color banding, crunchy noise, sharpening halos, or processing artifacts. Higher score = fewer artifacts." },
  { key: "marketplaceReady",  label: "Marketplace Readiness",    scope: "Would a car buyer looking at Facebook Marketplace or AutoTrader stop scrolling for this photo? Professional confidence score." },
] as const;

export type DimensionKey = (typeof QUALITY_DIMENSIONS)[number]["key"];

export interface DimensionScore {
  original: number | null;    // 1–10, null if N/A
  enhanced: number | null;    // 1–10, null if N/A
  delta: number | null;       // enhanced - original, null if either N/A
  note: string;               // Photographer's 1-sentence observation
}

export interface PhotoQualityReport {
  photoType: "exterior" | "interior" | "technical";
  vehicleLabel: string;
  caption: string;
  overallOriginal: number;    // mean of applicable dimension scores
  overallEnhanced: number;
  overallDelta: number;
  verdict: string;            // One sentence headline
  dimensions: Record<DimensionKey, DimensionScore>;
  evalModel: string;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional automotive photographer and photo editor with 20 years of experience shooting inventory for luxury dealerships including Mercedes-Benz, BMW, Porsche, and Audi.

You are evaluating vehicle photos for a car dealership's online marketplace listings. Your job is to compare the ORIGINAL photo (left/first) against an AI-ENHANCED version (right/second) and score both on professional photography criteria.

Score each dimension from 1 to 10:
  1–3  = poor, would hurt the listing
  4–6  = acceptable, typical dealer photo
  7–8  = good, professional quality
  9–10 = excellent, luxury dealership standard

If a dimension does not apply to the photo type, output null for both original and enhanced scores.

Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.

Required format:
{
  "verdict": "One sentence: is the enhancement a meaningful improvement?",
  "dimensions": {
    "lighting":        { "original": <1-10 or null>, "enhanced": <1-10 or null>, "note": "<1 sentence photographer observation>" },
    "exposure":        { "original": <1-10 or null>, "enhanced": <1-10 or null>, "note": "<1 sentence>" },
    "whiteBalance":    { "original": <1-10 or null>, "enhanced": <1-10 or null>, "note": "<1 sentence>" },
    "dynamicRange":    { "original": <1-10 or null>, "enhanced": <1-10 or null>, "note": "<1 sentence>" },
    "paintQuality":    { "original": <1-10 or null>, "enhanced": <1-10 or null>, "note": "<1 sentence>" },
    "glassQuality":    { "original": <1-10 or null>, "enhanced": <1-10 or null>, "note": "<1 sentence>" },
    "materialQuality": { "original": <1-10 or null>, "enhanced": <1-10 or null>, "note": "<1 sentence>" },
    "naturalness":     { "original": <1-10 or null>, "enhanced": <1-10 or null>, "note": "<1 sentence>" },
    "artifactDetection": { "original": <1-10 or null>, "enhanced": <1-10 or null>, "note": "<1 sentence>" },
    "marketplaceReady": { "original": <1-10 or null>, "enhanced": <1-10 or null>, "note": "<1 sentence>" }
  }
}`;

function buildUserPrompt(photoType: "exterior" | "interior" | "technical", caption: string): string {
  const context = photoType === "exterior"
    ? "This is an EXTERIOR vehicle photo. Evaluate paint, glass, and overall presentation."
    : photoType === "interior"
    ? "This is an INTERIOR vehicle photo. Evaluate material quality, lighting, and cabin presentation."
    : "This is a TECHNICAL/DOCUMENT photo (odometer, VIN, gauge cluster, etc.). Evaluate readability and clarity. Mark paint, glass, and material dimensions as null.";

  return `${context}

Photo: ${caption}

The FIRST image is the ORIGINAL (unprocessed dealer photo).
The SECOND image is the AI-ENHANCED version.

Score both using the 10 photography dimensions. Be honest — if the enhancement is not an improvement on a dimension, score it the same or lower. Only reward genuine improvements.`;
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

export async function evaluatePhotoQuality(
  originalBuf: Buffer,
  enhancedBuf: Buffer,
  photoType: "exterior" | "interior" | "technical",
  vehicleLabel: string,
  caption: string,
): Promise<PhotoQualityReport> {
  const origB64  = originalBuf.toString("base64");
  const enhB64   = enhancedBuf.toString("base64");

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 2048,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: buildUserPrompt(photoType, caption) },
          // Original — always first
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${origB64}`, detail: "high" } },
          // Enhanced — always second
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${enhB64}`, detail: "high" } },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content || "";

  // Parse — strip possible markdown fences
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(jsonStr) as {
    verdict: string;
    dimensions: Record<string, { original: number | null; enhanced: number | null; note: string }>;
  };

  // Build typed dimension map
  const dimensions = {} as Record<DimensionKey, DimensionScore>;
  for (const dim of QUALITY_DIMENSIONS) {
    const d = parsed.dimensions[dim.key] ?? { original: null, enhanced: null, note: "" };
    const orig = typeof d.original === "number" ? Math.max(1, Math.min(10, d.original)) : null;
    const enh  = typeof d.enhanced === "number" ? Math.max(1, Math.min(10, d.enhanced))  : null;
    dimensions[dim.key] = {
      original: orig,
      enhanced: enh,
      delta:    orig !== null && enh !== null ? enh - orig : null,
      note:     d.note ?? "",
    };
  }

  // Overall scores: mean of applicable (non-null) dimensions
  const origScores = QUALITY_DIMENSIONS.map(d => dimensions[d.key].original).filter((v): v is number => v !== null);
  const enhScores  = QUALITY_DIMENSIONS.map(d => dimensions[d.key].enhanced).filter((v): v is number => v !== null);
  const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const overallOriginal = parseFloat(mean(origScores).toFixed(1));
  const overallEnhanced = parseFloat(mean(enhScores).toFixed(1));

  return {
    photoType,
    vehicleLabel,
    caption,
    overallOriginal,
    overallEnhanced,
    overallDelta: parseFloat((overallEnhanced - overallOriginal).toFixed(1)),
    verdict: parsed.verdict || "No verdict provided.",
    dimensions,
    evalModel: MODEL,
  };
}
