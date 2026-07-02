// DealerPilot Photo Quality Evaluator — Phase 1.5
// Uses GPT-5-mini vision to score photos like a professional automotive photographer.
// Scoring scale: 0–100 per dimension.
// Also generates business-language AI analysis bullets and enforces the quality gate.
//
// Quality Gate (enhanced must pass ALL to earn "Use Enhanced"):
//   Marketplace Ready Score  >= 85
//   Naturalness              >= 85
//   Artifact Detection       >= 85
//   Improvement Delta        >= +5  (overallEnhanced - overallOriginal)

import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "placeholder",
});

const MODEL = "gpt-5-mini";

// 10 scoring dimensions — spec order.
export const QUALITY_DIMENSIONS = [
  { key: "lighting",          label: "Lighting" },
  { key: "exposure",          label: "Exposure" },
  { key: "whiteBalance",      label: "White Balance" },
  { key: "dynamicRange",      label: "Dynamic Range" },
  { key: "paintQuality",      label: "Paint Quality" },
  { key: "glassQuality",      label: "Glass Quality" },
  { key: "materialQuality",   label: "Interior Material Quality" },
  { key: "naturalness",       label: "Naturalness" },
  { key: "artifactDetection", label: "Artifact Detection" },
  { key: "marketplaceReady",  label: "Marketplace Ready" },
] as const;

export type DimensionKey = (typeof QUALITY_DIMENSIONS)[number]["key"];

export interface DimensionScore {
  original: number | null;    // 0–100, null if N/A for this photo type
  enhanced: number | null;
  delta: number | null;
}

export interface QualityGateResult {
  passed: boolean;
  recommendation: "Use Enhanced" | "Use Original";
  failReasons: string[];       // empty when passed
}

export interface PhotoQualityReport {
  photoType: "exterior" | "interior" | "technical";
  vehicleLabel: string;
  caption: string;

  // Dimension scores
  dimensions: Record<DimensionKey, DimensionScore>;

  // Overall (mean of applicable dimensions)
  overallOriginal: number;
  overallEnhanced: number;
  overallDelta: number;

  // Marketplace Ready Score (for badge, same as marketplaceReady.enhanced)
  marketplaceReadyScore: number | null;

  // AI analysis bullets — business/photo language only
  originalAnalysis: string[];   // flaws found in original
  enhancedAnalysis: string[];   // improvements in enhanced

  // Quality gate
  gate: QualityGateResult;

  evalModel: string;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional automotive photographer and photo editor with 20 years of experience at luxury car dealerships.

You evaluate vehicle listing photos and compare an ORIGINAL (first/left image) against an AI-ENHANCED version (second/right image).

SCORING SCALE 0–100:
  0–40   = poor — hurts the listing
  41–60  = acceptable — typical dealer photo
  61–80  = good — professional quality
  81–100 = excellent — luxury dealership standard

Evaluate 10 dimensions. If a dimension does not apply to this photo type, output null for both scores.

ANALYSIS LANGUAGE RULES — critical:
- Write like a photographer or car buyer, NOT an engineer
- Forbidden words: sharpness ratio, CLAHE, gamma, m2, provider, Sharp.js, algorithm, pixel, kernel, sigma, convolution, threshold, JPEG artifact
- Good words: exposure, lighting, gloss, depth, reflections, color cast, shadow detail, highlight, white balance, paint richness, glass clarity, material texture, natural, processed

Respond ONLY with valid JSON. No markdown fences, no extra text.

Required format:
{
  "dimensions": {
    "lighting":           { "original": <0-100 or null>, "enhanced": <0-100 or null> },
    "exposure":           { "original": <0-100 or null>, "enhanced": <0-100 or null> },
    "whiteBalance":       { "original": <0-100 or null>, "enhanced": <0-100 or null> },
    "dynamicRange":       { "original": <0-100 or null>, "enhanced": <0-100 or null> },
    "paintQuality":       { "original": <0-100 or null>, "enhanced": <0-100 or null> },
    "glassQuality":       { "original": <0-100 or null>, "enhanced": <0-100 or null> },
    "materialQuality":    { "original": <0-100 or null>, "enhanced": <0-100 or null> },
    "naturalness":        { "original": <0-100 or null>, "enhanced": <0-100 or null> },
    "artifactDetection":  { "original": <0-100 or null>, "enhanced": <0-100 or null> },
    "marketplaceReady":   { "original": <0-100 or null>, "enhanced": <0-100 or null> }
  },
  "originalAnalysis": [
    "Brief observation about a flaw or weakness in the original (1 short sentence, photography language)"
  ],
  "enhancedAnalysis": [
    "Brief observation about an improvement in the enhanced version (1 short sentence, photography language)"
  ]
}

Provide 3–6 bullets in each analysis array. Be honest — if the enhancement did not improve a dimension, say so. Only claim improvements that are visually real.`;

function buildUserPrompt(photoType: "exterior" | "interior" | "technical", caption: string): string {
  const context =
    photoType === "exterior"
      ? "EXTERIOR vehicle photo — evaluate paint gloss, lighting, glass clarity, and overall presentation."
      : photoType === "interior"
      ? "INTERIOR vehicle photo — evaluate cabin lighting, material quality, and seat/trim presentation. Paint, glass, and exterior dimensions are not applicable (null)."
      : "TECHNICAL/DOCUMENT photo (odometer, VIN, gauge cluster, or similar). Evaluate readability and clarity only. Paint, glass, material, and most aesthetic dimensions are not applicable (null).";

  return `${context}
Photo: ${caption}

First image = ORIGINAL (unprocessed). Second image = AI-ENHANCED.
Score both versions. Be honest — only reward genuine improvements.`;
}

// ── Quality Gate ──────────────────────────────────────────────────────────────

const GATE_MARKETPLACE_READY = 85;
const GATE_NATURALNESS        = 85;
const GATE_ARTIFACT_DETECTION = 85;
const GATE_DELTA              = 5;

function applyQualityGate(report: Omit<PhotoQualityReport, "gate">): QualityGateResult {
  const failReasons: string[] = [];

  const mr  = report.dimensions.marketplaceReady.enhanced;
  const nat = report.dimensions.naturalness.enhanced;
  const art = report.dimensions.artifactDetection.enhanced;

  if (mr  !== null && mr  < GATE_MARKETPLACE_READY) failReasons.push(`Marketplace Ready score ${mr} is below ${GATE_MARKETPLACE_READY}`);
  if (nat !== null && nat < GATE_NATURALNESS)        failReasons.push(`Naturalness score ${nat} is below ${GATE_NATURALNESS}`);
  if (art !== null && art < GATE_ARTIFACT_DETECTION) failReasons.push(`Artifact Detection score ${art} is below ${GATE_ARTIFACT_DETECTION}`);
  if (report.overallDelta < GATE_DELTA)              failReasons.push(`Improvement delta +${report.overallDelta.toFixed(0)} is below required +${GATE_DELTA}`);

  const passed = failReasons.length === 0;
  return { passed, recommendation: passed ? "Use Enhanced" : "Use Original", failReasons };
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

export async function evaluatePhotoQuality(
  originalBuf: Buffer,
  enhancedBuf: Buffer,
  photoType: "exterior" | "interior" | "technical",
  vehicleLabel: string,
  caption: string,
): Promise<PhotoQualityReport> {
  const origB64 = originalBuf.toString("base64");
  const enhB64  = enhancedBuf.toString("base64");

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 4096,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: buildUserPrompt(photoType, caption) },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${origB64}`, detail: "high" } },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${enhB64}`, detail: "high" } },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content || "";
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(jsonStr) as {
    dimensions: Record<string, { original: number | null; enhanced: number | null }>;
    originalAnalysis: string[];
    enhancedAnalysis: string[];
  };

  // Build typed dimension map — clamp to 0–100
  const dimensions = {} as Record<DimensionKey, DimensionScore>;
  for (const dim of QUALITY_DIMENSIONS) {
    const d = parsed.dimensions[dim.key] ?? { original: null, enhanced: null };
    const clamp = (v: unknown): number | null =>
      typeof v === "number" ? Math.max(0, Math.min(100, Math.round(v))) : null;
    const orig = clamp(d.original);
    const enh  = clamp(d.enhanced);
    dimensions[dim.key] = {
      original: orig,
      enhanced: enh,
      delta:    orig !== null && enh !== null ? enh - orig : null,
    };
  }

  // Overall scores
  const origScores = QUALITY_DIMENSIONS.map(d => dimensions[d.key].original).filter((v): v is number => v !== null);
  const enhScores  = QUALITY_DIMENSIONS.map(d => dimensions[d.key].enhanced).filter((v): v is number => v !== null);
  const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const overallOriginal = parseFloat(mean(origScores).toFixed(1));
  const overallEnhanced = parseFloat(mean(enhScores).toFixed(1));
  const overallDelta    = parseFloat((overallEnhanced - overallOriginal).toFixed(1));

  const partial = {
    photoType,
    vehicleLabel,
    caption,
    dimensions,
    overallOriginal,
    overallEnhanced,
    overallDelta,
    marketplaceReadyScore: dimensions.marketplaceReady.enhanced,
    originalAnalysis: parsed.originalAnalysis ?? [],
    enhancedAnalysis: parsed.enhancedAnalysis ?? [],
    evalModel: MODEL,
  };

  const gate = applyQualityGate(partial);
  return { ...partial, gate };
}
