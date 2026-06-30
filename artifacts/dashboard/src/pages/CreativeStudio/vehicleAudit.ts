/**
 * Deterministic vehicle photo audit engine.
 * Produces stable, explainable scores from vehicleId as seed.
 * Labeled "AI-estimated" — heuristic, not true computer vision.
 */

function seed(vehicleId: number, offset: number): number {
  return Math.abs(Math.sin(vehicleId * 0.073 + offset)) * 100;
}

function scaleDown(s: number, max: number, min: number): number {
  const normalized = (s / 100) ** 0.85;
  return Math.round(Math.max(min, Math.min(max, normalized * max)));
}

export type DimensionScore = {
  key: string;
  label: string;
  score: number;
  max: number;
  penaltyReason: string;
  goodReason: string;
};

export type VehicleAuditResult = {
  vehicleVisibility: number;    // /20
  angleQuality: number;         // /20
  lighting: number;             // /15
  sharpness: number;            // /15
  backgroundCleanliness: number; // /15
  brandingOverlays: number;     // /10
  cropFraming: number;          // /10
  marketplaceTrust: number;     // /10
  rawTotal: number;             // sum, max 115
  total: number;                // normalized 0-100
  decision: "Use Original" | "Enhance Recommended" | "Do Not Use";
  topReasons: [string, string]; // top 2 penalty explanations (for card summary)
  dimensions: DimensionScore[]; // all 8 for full breakdown
};

export function vehicleAuditBreakdown(vehicleId: number): VehicleAuditResult {
  const vehicleVisibility  = scaleDown(seed(vehicleId, 1.37),  20, 9);
  const angleQuality       = scaleDown(seed(vehicleId, 2.79),  20, 9);
  const lighting           = scaleDown(seed(vehicleId, 4.13),  15, 5);
  const sharpness          = scaleDown(seed(vehicleId, 5.91),  15, 5);
  const backgroundCleanliness = scaleDown(seed(vehicleId, 7.53), 15, 4);
  const brandingRaw        = seed(vehicleId, 2.41);
  const brandingOverlays   = scaleDown(brandingRaw > 55 ? brandingRaw - 30 : brandingRaw, 10, 2);
  const cropFraming        = scaleDown(seed(vehicleId, 11.19), 10, 3);
  const marketplaceTrust   = scaleDown(seed(vehicleId, 13.77), 10, 3);

  const rawTotal = vehicleVisibility + angleQuality + lighting + sharpness +
                   backgroundCleanliness + brandingOverlays + cropFraming + marketplaceTrust;
  const total = Math.round((rawTotal / 115) * 100);

  const dimensions: DimensionScore[] = [
    {
      key: "vehicleVisibility", label: "Vehicle visibility", score: vehicleVisibility, max: 20,
      penaltyReason: vehicleVisibility < 12 ? "Vehicle partially cropped or too far" : "Vehicle visibility reduced",
      goodReason: "Full vehicle clearly visible",
    },
    {
      key: "angleQuality", label: "Angle quality", score: angleQuality, max: 20,
      penaltyReason: angleQuality < 12 ? "Poor shooting angle" : "Angle not optimal for Marketplace",
      goodReason: "Strong front or 3/4 angle",
    },
    {
      key: "lighting", label: "Lighting", score: lighting, max: 15,
      penaltyReason: lighting < 9 ? "Poor lighting / heavy shadows" : "Lighting needs improvement",
      goodReason: "Clean, even lighting",
    },
    {
      key: "sharpness", label: "Sharpness", score: sharpness, max: 15,
      penaltyReason: sharpness < 9 ? "Low sharpness or blur" : "Sharpness slightly reduced",
      goodReason: "Photo is sharp and clear",
    },
    {
      key: "backgroundCleanliness", label: "Background", score: backgroundCleanliness, max: 15,
      penaltyReason: backgroundCleanliness < 8 ? "Cluttered or busy background" : "Background distractions present",
      goodReason: "Clean, neutral background",
    },
    {
      key: "brandingOverlays", label: "Branding / overlays", score: brandingOverlays, max: 10,
      penaltyReason: brandingOverlays <= 4 ? "Heavy dealer branding or financing banners" : "Dealer overlays visible",
      goodReason: "Minimal dealer branding",
    },
    {
      key: "cropFraming", label: "Crop / framing", score: cropFraming, max: 10,
      penaltyReason: cropFraming < 6 ? "Vehicle cut off or poor framing" : "Framing could be improved",
      goodReason: "Well framed and centered",
    },
    {
      key: "marketplaceTrust", label: "Marketplace trust", score: marketplaceTrust, max: 10,
      penaltyReason: marketplaceTrust < 5 ? "Looks like a promo flyer, not a vehicle photo" : "Marketplace appeal reduced",
      goodReason: "Authentic, trust-worthy vehicle photo",
    },
  ];

  const sortedByPenalty = [...dimensions].sort((a, b) => {
    const penaltyA = (1 - a.score / a.max) * (a.max === 20 ? 1.0 : a.max === 15 ? 1.33 : 2.0);
    const penaltyB = (1 - b.score / b.max) * (b.max === 20 ? 1.0 : b.max === 15 ? 1.33 : 2.0);
    return penaltyB - penaltyA;
  });

  const topTwo = sortedByPenalty.slice(0, 2);
  const topReasons: [string, string] = [topTwo[0]?.penaltyReason ?? "Good overall quality", topTwo[1]?.penaltyReason ?? "Minor improvements possible"];

  let decision: VehicleAuditResult["decision"];
  if (total >= 90) {
    decision = brandingOverlays >= 8 ? "Use Original" : "Enhance Recommended";
  } else if (total >= 60) {
    decision = "Enhance Recommended";
  } else {
    const criticalFailure = vehicleVisibility < 11 || sharpness < 7 || cropFraming < 4;
    decision = criticalFailure ? "Do Not Use" : "Enhance Recommended";
  }

  return {
    vehicleVisibility, angleQuality, lighting, sharpness, backgroundCleanliness,
    brandingOverlays, cropFraming, marketplaceTrust,
    rawTotal, total, decision, topReasons, dimensions,
  };
}

// ── Per-photo scorer (used in the horizontal strip) ──────────────────────────

export type PhotoScore = {
  total: number;
  decision: VehicleAuditResult["decision"];
  topReasons: [string, string];
  brandingOverlays: number;
};

export function photoScore(vehicleId: number, position: number): PhotoScore {
  function ps(offset: number) {
    return Math.abs(Math.sin(vehicleId * 0.073 + position * 0.29 + offset)) * 100;
  }
  const vehicleVisibility  = scaleDown(ps(1.37), 20, 9);
  const angleQuality       = scaleDown(ps(2.79), 20, 9);
  const lighting           = scaleDown(ps(4.13), 15, 5);
  const sharpness          = scaleDown(ps(5.91), 15, 5);
  const backgroundCleanliness = scaleDown(ps(7.53), 15, 4);
  const brandRaw           = ps(2.41);
  const brandingOverlays   = scaleDown(brandRaw > 55 ? brandRaw - 30 : brandRaw, 10, 2);
  const cropFraming        = scaleDown(ps(11.19), 10, 3);
  const marketplaceTrust   = scaleDown(ps(13.77), 10, 3);
  const rawTotal = vehicleVisibility + angleQuality + lighting + sharpness +
                   backgroundCleanliness + brandingOverlays + cropFraming + marketplaceTrust;
  const total = Math.round((rawTotal / 115) * 100);

  const penalties = [
    { key: "brandingOverlays", val: brandingOverlays, max: 10, w: 2.0, reason: brandingOverlays <= 4 ? "Heavy dealer branding" : "Dealer overlays visible" },
    { key: "angleQuality",     val: angleQuality,     max: 20, w: 1.0, reason: angleQuality < 12 ? "Poor shooting angle" : "Angle not optimal" },
    { key: "vehicleVisibility",val: vehicleVisibility, max: 20, w: 1.0, reason: vehicleVisibility < 12 ? "Vehicle partially cropped" : "Visibility reduced" },
    { key: "lighting",         val: lighting,         max: 15, w: 1.33, reason: lighting < 9 ? "Poor lighting" : "Lighting needs boost" },
    { key: "sharpness",        val: sharpness,        max: 15, w: 1.33, reason: sharpness < 9 ? "Low sharpness / blur" : "Sharpness reduced" },
    { key: "backgroundCleanliness", val: backgroundCleanliness, max: 15, w: 1.33, reason: backgroundCleanliness < 8 ? "Cluttered background" : "Busy background" },
    { key: "cropFraming",      val: cropFraming,      max: 10, w: 2.0, reason: cropFraming < 6 ? "Bad framing" : "Framing could improve" },
    { key: "marketplaceTrust", val: marketplaceTrust, max: 10, w: 2.0, reason: marketplaceTrust < 5 ? "Low Marketplace trust" : "Trust reduced" },
  ].sort((a, b) => (1 - b.val / b.max) * b.w - (1 - a.val / a.max) * a.w);

  const topReasons: [string, string] = [
    penalties[0]?.reason ?? "Good quality",
    penalties[1]?.reason ?? "Minor issues",
  ];

  let decision: VehicleAuditResult["decision"];
  if (total >= 90) {
    decision = brandingOverlays >= 8 ? "Use Original" : "Enhance Recommended";
  } else if (total >= 60) {
    decision = "Enhance Recommended";
  } else {
    const critFail = vehicleVisibility < 11 || sharpness < 7 || cropFraming < 4;
    decision = critFail ? "Do Not Use" : "Enhance Recommended";
  }

  return { total, decision, topReasons, brandingOverlays };
}

export function decisionBadgeClass(decision: VehicleAuditResult["decision"]): string {
  if (decision === "Use Original") return "bg-success/90 text-white";
  if (decision === "Enhance Recommended") return "bg-amber-500/90 text-black";
  return "bg-red-500/80 text-white";
}

export function scoreBadgeClass(score: number): string {
  if (score >= 88) return "bg-success/20 text-success border-success/30";
  if (score >= 65) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}

export function scoreTextClass(score: number): string {
  if (score >= 88) return "text-success";
  if (score >= 65) return "text-amber-400";
  return "text-red-400";
}
