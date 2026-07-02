// DealerPilot Photo Quality Evaluator — Phase 1.5
//
// Pure evaluator — no database imports. DB-loading lives in profileLoader.ts.
// Thresholds come from a QualityProfile object passed in by the caller.
//
// Rating tiers (absolute, profile-independent — for dealer communication):
//   Excellent    ≥ 90
//   Good         ≥ 80
//   Acceptable   ≥ 70
//   Needs Review ≥ 60
//   Rejected      < 60

import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "placeholder",
});

const MODEL = "gpt-5-mini";

// ── Quality profile (minimal interface — DB shape compatible) ─────────────────

export interface QualityProfile {
  id:   number;
  name: string;
  description:               string | null;
  marketplaceReadyThreshold: number;
  naturalnessThreshold:      number;
  artifactThreshold:         number;
  improvementDelta:          number;
  isActive:                  boolean;
}

// Hardcoded fallback for when the DB is unavailable.
// Matches the "Dealer Lot Photography" profile seeded in photo_quality_profiles.
export const DEALER_LOT_FALLBACK: QualityProfile = {
  id:                        0,
  name:                      "Dealer Lot Photography",
  description:               "Fallback — DB unavailable",
  marketplaceReadyThreshold: 78,
  naturalnessThreshold:      70,
  artifactThreshold:         65,
  improvementDelta:          5,
  isActive:                  true,
};

// ── Rating tiers ──────────────────────────────────────────────────────────────

export type PhotoRating = "Excellent" | "Good" | "Acceptable" | "Needs Review" | "Rejected";

export function rateScore(score: number | null): PhotoRating | null {
  if (score === null) return null;
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 70) return "Acceptable";
  if (score >= 60) return "Needs Review";
  return "Rejected";
}

export const RATING_COLOR: Record<PhotoRating, string> = {
  Excellent:       "#22c55e",
  Good:            "#84cc16",
  Acceptable:      "#f59e0b",
  "Needs Review":  "#f97316",
  Rejected:        "#ef4444",
};

export const RATING_BG: Record<PhotoRating, string> = {
  Excellent:       "#052e16",
  Good:            "#1a2e05",
  Acceptable:      "#1c1204",
  "Needs Review":  "#1c0a00",
  Rejected:        "#1c0505",
};

// ── Dimensions ────────────────────────────────────────────────────────────────

export const QUALITY_DIMENSIONS = [
  { key: "lighting",           label: "Lighting" },
  { key: "exposure",           label: "Exposure" },
  { key: "whiteBalance",       label: "White Balance" },
  { key: "dynamicRange",       label: "Dynamic Range" },
  { key: "paintQuality",       label: "Paint Quality" },
  { key: "glassQuality",       label: "Glass Quality" },
  { key: "materialQuality",    label: "Interior Material Quality" },
  { key: "naturalness",        label: "Naturalness" },
  { key: "artifactDetection",  label: "Artifact Detection" },
  { key: "marketplaceReady",   label: "Marketplace Ready" },
] as const;

export type DimensionKey = (typeof QUALITY_DIMENSIONS)[number]["key"];

export interface DimensionScore {
  original:       number | null;
  enhanced:       number | null;
  delta:          number | null;
  originalRating: PhotoRating | null;
  enhancedRating: PhotoRating | null;
}

// ── Gate result ───────────────────────────────────────────────────────────────

export interface QualityGateResult {
  passed:         boolean;
  recommendation: "Use Enhanced" | "Use Original";
  failReasons:    string[];
  profile:        { id: number; name: string; description: string | null };
}

// ── Report ────────────────────────────────────────────────────────────────────

export interface PhotoQualityReport {
  photoType:    "exterior" | "interior" | "technical";
  vehicleLabel: string;
  caption:      string;

  dimensions: Record<DimensionKey, DimensionScore>;

  overallOriginal: number;
  overallEnhanced: number;
  overallDelta:    number;

  overallOriginalRating: PhotoRating | null;
  overallEnhancedRating: PhotoRating | null;

  marketplaceReadyScore:  number | null;
  marketplaceReadyRating: PhotoRating | null;

  originalAnalysis: string[];
  enhancedAnalysis: string[];

  gate:      QualityGateResult;
  evalModel: string;
}

// ── Gate logic ────────────────────────────────────────────────────────────────

function applyQualityGate(
  report:  Omit<PhotoQualityReport, "gate">,
  profile: QualityProfile,
): QualityGateResult {
  const failReasons: string[] = [];

  const mr  = report.dimensions.marketplaceReady.enhanced;
  const nat = report.dimensions.naturalness.enhanced;
  const art = report.dimensions.artifactDetection.enhanced;

  if (mr  !== null && mr  < profile.marketplaceReadyThreshold)
    failReasons.push(`Marketplace Ready ${mr} (${rateScore(mr)}) is below threshold ${profile.marketplaceReadyThreshold}`);

  if (nat !== null && nat < profile.naturalnessThreshold)
    failReasons.push(`Naturalness ${nat} (${rateScore(nat)}) is below threshold ${profile.naturalnessThreshold}`);

  if (art !== null && art < profile.artifactThreshold)
    failReasons.push(`Artifact Detection ${art} (${rateScore(art)}) is below threshold ${profile.artifactThreshold}`);

  if (report.overallDelta < profile.improvementDelta)
    failReasons.push(`Improvement delta +${report.overallDelta.toFixed(0)} is below required +${profile.improvementDelta}`);

  const passed = failReasons.length === 0;
  return {
    passed,
    recommendation: passed ? "Use Enhanced" : "Use Original",
    failReasons,
    profile: { id: profile.id, name: profile.name, description: profile.description },
  };
}

// ── GPT prompt ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional automotive photographer and photo editor with 20 years of experience at luxury car dealerships.

You evaluate vehicle listing photos and compare an ORIGINAL (first/left image) against an AI-ENHANCED version (second/right image).

SCORING SCALE 0–100:
  0–59   = poor — hurts or does not help the listing
  60–69  = needs review — below typical dealership standard
  70–79  = acceptable — typical dealer photo
  80–89  = good — professional quality
  90–100 = excellent — luxury dealership standard

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

// ── Main evaluator ────────────────────────────────────────────────────────────

export async function evaluatePhotoQuality(
  originalBuf: Buffer,
  enhancedBuf: Buffer,
  photoType:   "exterior" | "interior" | "technical",
  vehicleLabel: string,
  caption:     string,
  profile:     QualityProfile,
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

  const raw     = response.choices[0]?.message?.content || "";
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed  = JSON.parse(jsonStr) as {
    dimensions: Record<string, { original: number | null; enhanced: number | null }>;
    originalAnalysis: string[];
    enhancedAnalysis: string[];
  };

  const dimensions = {} as Record<DimensionKey, DimensionScore>;
  for (const dim of QUALITY_DIMENSIONS) {
    const d     = parsed.dimensions[dim.key] ?? { original: null, enhanced: null };
    const clamp = (v: unknown): number | null =>
      typeof v === "number" ? Math.max(0, Math.min(100, Math.round(v))) : null;
    const orig = clamp(d.original);
    const enh  = clamp(d.enhanced);
    dimensions[dim.key] = {
      original:       orig,
      enhanced:       enh,
      delta:          orig !== null && enh !== null ? enh - orig : null,
      originalRating: rateScore(orig),
      enhancedRating: rateScore(enh),
    };
  }

  const origScores = QUALITY_DIMENSIONS.map(d => dimensions[d.key].original).filter((v): v is number => v !== null);
  const enhScores  = QUALITY_DIMENSIONS.map(d => dimensions[d.key].enhanced).filter((v): v is number => v !== null);
  const mean       = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const overallOriginal = parseFloat(mean(origScores).toFixed(1));
  const overallEnhanced = parseFloat(mean(enhScores).toFixed(1));
  const overallDelta    = parseFloat((overallEnhanced - overallOriginal).toFixed(1));
  const mrEnh           = dimensions.marketplaceReady.enhanced;

  const partial = {
    photoType,
    vehicleLabel,
    caption,
    dimensions,
    overallOriginal,
    overallEnhanced,
    overallDelta,
    overallOriginalRating: rateScore(overallOriginal),
    overallEnhancedRating: rateScore(overallEnhanced),
    marketplaceReadyScore:  mrEnh,
    marketplaceReadyRating: rateScore(mrEnh),
    originalAnalysis: parsed.originalAnalysis ?? [],
    enhancedAnalysis: parsed.enhancedAnalysis ?? [],
    evalModel: MODEL,
  };

  const gate = applyQualityGate(partial, profile);
  return { ...partial, gate };
}
