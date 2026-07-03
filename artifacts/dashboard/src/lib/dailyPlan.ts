/**
 * dailyPlan.ts — DealerPilot AI Publishing Decision Engine
 *
 * buildDailyMarketplacePlan() is the centralized function that decides:
 *   - which vehicles to publish today
 *   - which to hold
 *   - which need human review
 *   - duplicate model groups and who wins
 *
 * Rules:
 *   - NO random numbers
 *   - NO Math.sin
 *   - NO list position as signal
 *   - NO seeded Marketplace performance treated as real
 *   - All scoring is deterministic from real vehicle attributes + strategy engine
 */

// ─── Marketplace price rule (Part 4 of sprint spec) ──────────────────────────
// If vehicle actual price < $16,000 → full price
// If vehicle actual price >= $16,000 → show recommended down payment
export function computeMarketplacePrice(
  actualPrice: number | null,
  recommendedDownPayment: number | null,
  recommendedPriceStrategy: string,
): { marketplacePrice: number | null; priceMode: "FULL_PRICE" | "DOWN_PAYMENT" } {
  if (actualPrice == null) return { marketplacePrice: null, priceMode: "FULL_PRICE" };
  if (
    actualPrice >= 16_000 &&
    recommendedDownPayment != null &&
    recommendedPriceStrategy === "down_payment"
  ) {
    return { marketplacePrice: recommendedDownPayment, priceMode: "DOWN_PAYMENT" };
  }
  return { marketplacePrice: actualPrice, priceMode: "FULL_PRICE" };
}

// ─── Input types ──────────────────────────────────────────────────────────────

export type PlanWorkspace = {
  vehicleId: number;
  label?: string | null;
  make: string;
  model: string;
  year?: number | null;
  price?: number | null;
  imageCount?: number | null;
  listingScore?: number | null;
  priorityScore?: number | null;
  publishStatus: string;
  vehicleStatus?: string | null;
  aiStatus?: string | null;
  primaryImageUrl?: string | null;
  vin?: string | null;
  downPayment?: number | null;
};

export type PlanRecommendation = {
  vehicleId: number;
  make: string;
  model: string;
  year?: number | null;
  price?: number | null;
  mileage?: number | null;
  photoCount?: number | null;
  confidenceScore: number;
  strategyName?: string | null;
  reason?: string | null;
  recommendedDownPayment?: number | null;
  recommendedPriceStrategy: string;
  supportingSignals?: string[] | null;
  expectedImpact?: string | null;
  // Opportunity Engine — single source of truth
  opportunityScore?: number | null;
  opportunityLabel?: string | null;
  primarySegment?: string | null;
  secondarySegment?: string | null;
  adAngle?: string | null;
  suggestedLanguage?: string | null;
  whyThisAudience?: string | null;
};

export type PlanJob = {
  vehicleId: number;
  status: string;
};

// ─── Output types ─────────────────────────────────────────────────────────────

export type DailyVehicleRec = {
  vehicleId: number;
  label: string;
  make: string;
  model: string;
  year: number | null;
  vin: string | null;
  actualPrice: number | null;
  marketplacePrice: number | null;
  priceMode: "FULL_PRICE" | "DOWN_PAYMENT";
  recommendedDownPayment: number | null;
  mileage: number | null;
  imageCount: number;
  strategyName: string | null;
  reasons: string[];
  supportingSignals: string[];
  expectedImpact: string | null;
  confidenceScore: number;
  listingScore: number | null;
  primaryImageUrl: string | null;
  planScore: number;
  holdReason: string | null;
  isDuplicate: boolean;
  duplicateGroupKey: string | null;
  // Opportunity Engine — single source of truth
  opportunityScore: number | null;
  opportunityLabel: string | null;
  primarySegment: string;
  secondarySegment: string | null;
  adAngle: string;
  suggestedLanguage: string;
  whyThisAudience: string;
};

export type DuplicateGroup = {
  key: string;
  make: string;
  model: string;
  count: number;
  publishFirst: DailyVehicleRec;
  holdOthers: DailyVehicleRec[];
  winReason: string;
};

export type DailyMarketplacePlan = {
  recommendedToday: DailyVehicleRec[];  // Top 3 — publish now
  nextBest: DailyVehicleRec[];          // Positions 4–10 — visible, selectable
  holdToday: DailyVehicleRec[];
  needsReview: DailyVehicleRec[];
  alreadyQueued: DailyVehicleRec[];
  duplicateGroups: DuplicateGroup[];
  totalEligible: number;
  summary: string;
  dataSource: "Estimated Strategy";
};

// ─── Composite priority score ─────────────────────────────────────────────────
// Deterministic. Inputs: real vehicle attributes + strategy engine confidence.
//
// Facebook Marketplace is a budget-first marketplace. Everyday affordable
// vehicles (< $25K) have dramatically higher buyer engagement than exotic or
// luxury vehicles. Price affordability is weighted heavily so that a Porsche 911
// or GR Supra does not outrank a well-photographed $18K Honda Accord.
function compositeScore(
  confidenceScore: number,
  imageCount: number,
  listingScore: number | null,
  priorityScore: number | null,
  actualPrice: number | null,
  priceMode: "FULL_PRICE" | "DOWN_PAYMENT",
): number {
  // Strategy engine confidence: 0–100 → 35 pts max (reduced — price now co-anchors)
  let score = confidenceScore * 0.35;

  // Photo count: coverage for Marketplace → 20 pts max (20+ photos = full score)
  score += Math.min(imageCount / 20, 1) * 20;

  // Listing readiness → 10 pts max
  score += ((listingScore ?? 0) / 100) * 10;

  // Priority score from backend → 5 pts max
  score += ((priorityScore ?? 0) / 100) * 5;

  // ── FB Marketplace price-fit bonus/penalty ──────────────────────────────
  // Affordable everyday vehicles move much faster on FB Marketplace.
  // Luxury/exotic vehicles are a poor fit for the platform and rank down.
  if (actualPrice != null) {
    if (actualPrice < 10_000) score += 30;       // budget — best FB fit
    else if (actualPrice < 16_000) score += 25;  // affordable sweet spot
    else if (actualPrice < 22_000) score += 18;  // good everyday range
    else if (actualPrice < 30_000) score += 10;  // above average, still moves
    else if (actualPrice < 40_000) score += 2;   // marginal FB fit
    else if (actualPrice < 60_000) score -= 10;  // poor FB fit
    else score -= 20;                            // luxury/exotic — not FB Marketplace material
  }

  // Down payment display preferred for higher-priced vehicles → +3
  if (priceMode === "DOWN_PAYMENT") score += 3;

  return Math.round(score);
}

// ─── Main function ────────────────────────────────────────────────────────────

export function buildDailyMarketplacePlan(
  workspaces: PlanWorkspace[],
  recommendations: PlanRecommendation[],
  activeJobs: PlanJob[],
): DailyMarketplacePlan {
  // Vehicle IDs already in an active job (queued / publishing)
  const queuedIds = new Set(
    activeJobs
      .filter((j) => ["Queued", "Scheduled", "Assigned", "Publishing"].includes(j.status))
      .map((j) => j.vehicleId),
  );

  // Recommendation map by vehicleId
  const recMap = new Map<number, PlanRecommendation>();
  for (const r of recommendations) recMap.set(r.vehicleId, r);

  // Build enriched vehicle records for all workspaces
  function toRec(w: PlanWorkspace, holdReason: string | null = null): DailyVehicleRec {
    const rec = recMap.get(w.vehicleId);
    const actualPrice = w.price ?? rec?.price ?? null;
    const { marketplacePrice, priceMode } = computeMarketplacePrice(
      actualPrice,
      w.downPayment ?? rec?.recommendedDownPayment ?? null,
      rec?.recommendedPriceStrategy ?? "full_price",
    );
    const confidenceScore = rec?.confidenceScore ?? 30;
    const imageCount = w.imageCount ?? 0;
    const listingScore = w.listingScore ?? null;
    const priorityScore = w.priorityScore ?? null;
    // Opportunity Engine score is the single source of truth.
    // Fall back to compositeScore only when intelligence hasn't run yet.
    const planScore = rec?.opportunityScore != null
      ? rec.opportunityScore
      : compositeScore(confidenceScore, imageCount, listingScore, priorityScore, actualPrice, priceMode);

    // Build human-readable reason bullets from real signals
    const reasons: string[] = [];
    if (rec?.strategyName) reasons.push(rec.strategyName);
    if (imageCount >= 15) reasons.push(`${imageCount} photos available`);
    else if (imageCount > 0) reasons.push(`${imageCount} photos`);
    if (priceMode === "DOWN_PAYMENT" && marketplacePrice != null) {
      reasons.push(`Marketplace price: $${marketplacePrice.toLocaleString()} down`);
    } else if (actualPrice != null && actualPrice < 16_000) {
      reasons.push(`Affordable price: $${actualPrice.toLocaleString()}`);
    }
    if (rec?.reason && !reasons.some((r) => r === rec.reason)) {
      const shortReason = rec.reason.split(".")[0];
      // Skip backend reasons that say "under $16k" when the car is actually above $16k —
      // those are seeded strategy engine labels that don't match this vehicle's real price.
      const contradictsPrice =
        shortReason?.toLowerCase().includes("under $16k") && (actualPrice ?? 0) >= 16_000;
      if (shortReason && shortReason.length < 120 && !contradictsPrice) {
        reasons.push(shortReason);
      }
    }

    return {
      vehicleId: w.vehicleId,
      label: w.label ?? `${w.year ?? rec?.year ?? ""} ${w.make} ${w.model}`.trim(),
      make: w.make,
      model: w.model,
      year: w.year ?? rec?.year ?? null,
      vin: w.vin ?? null,
      actualPrice,
      marketplacePrice,
      priceMode,
      recommendedDownPayment: w.downPayment ?? rec?.recommendedDownPayment ?? null,
      mileage: rec?.mileage ?? null,
      imageCount,
      strategyName: rec?.strategyName ?? null,
      reasons,
      supportingSignals: rec?.supportingSignals ?? [],
      expectedImpact: rec?.expectedImpact ?? null,
      confidenceScore,
      listingScore,
      primaryImageUrl: w.primaryImageUrl ?? null,
      planScore,
      holdReason,
      isDuplicate: false, // set below
      duplicateGroupKey: null,
      // Opportunity Engine fields
      opportunityScore: rec?.opportunityScore ?? null,
      opportunityLabel: rec?.opportunityLabel ?? null,
      primarySegment: rec?.primarySegment ?? "General",
      secondarySegment: rec?.secondarySegment ?? null,
      adAngle: rec?.adAngle ?? "",
      suggestedLanguage: rec?.suggestedLanguage ?? "English-first",
      whyThisAudience: rec?.whyThisAudience ?? "",
    };
  }

  // Separate published/sold from the rest
  const publishedRecs: DailyVehicleRec[] = [];
  const alreadyQueuedRecs: DailyVehicleRec[] = [];
  const eligibleWorkspaces: PlanWorkspace[] = [];
  const needsReviewWorkspaces: PlanWorkspace[] = [];

  for (const w of workspaces) {
    if (w.publishStatus === "Published") { publishedRecs.push(toRec(w)); continue; }
    if (w.vehicleStatus === "Sold/Removed") continue;
    if (queuedIds.has(w.vehicleId)) { alreadyQueuedRecs.push(toRec(w)); continue; }
    if (w.imageCount === 0 || w.imageCount == null) {
      needsReviewWorkspaces.push(w); continue;
    }
    if (w.publishStatus === "Needs Review" || w.publishStatus === "Failed") {
      needsReviewWorkspaces.push(w); continue;
    }
    eligibleWorkspaces.push(w);
  }

  const needsReview: DailyVehicleRec[] = needsReviewWorkspaces.map((w) => {
    const reason = w.imageCount === 0
      ? "No photos — needs at least 1 photo before publishing"
      : w.publishStatus === "Needs Review"
        ? "Flagged for manual review before publishing"
        : "Previous publish attempt failed — check extension and retry";
    return toRec(w, reason);
  });

  // ── Diversity guardrail constants ───────────────────────────────────────────
  const MAINSTREAM_MAKES = new Set([
    "toyota", "honda", "ford", "chevrolet", "chevy", "gmc",
    "ram", "nissan", "hyundai", "kia", "subaru", "mazda",
  ]);
  const EV_MAKES = new Set(["tesla", "rivian", "lucid", "polestar", "fisker"]);

  function isEVRec(r: DailyVehicleRec): boolean {
    const m = r.make.toLowerCase();
    const seg = r.primarySegment.toLowerCase();
    return EV_MAKES.has(m) || seg.includes("ev") || seg.includes("tech");
  }
  function isMainstreamRec(r: DailyVehicleRec): boolean {
    return MAINSTREAM_MAKES.has(r.make.toLowerCase());
  }

  // ── Build eligible recs and apply tiebreaker sort ───────────────────────────
  const eligible: DailyVehicleRec[] = eligibleWorkspaces.map((w) => toRec(w));
  eligible.sort((a, b) => {
    // 1. planScore descending (opportunityScore is the primary signal)
    if (b.planScore !== a.planScore) return b.planScore - a.planScore;
    // 2. Lower mileage wins (fresher vehicle)
    const aMi = a.mileage ?? 999_999;
    const bMi = b.mileage ?? 999_999;
    if (aMi !== bMi) return aMi - bMi;
    // 3. Lower price wins (better FB Marketplace fit)
    const aP = a.actualPrice ?? 999_999;
    const bP = b.actualPrice ?? 999_999;
    if (aP !== bP) return aP - bP;
    // 4. More photos wins
    if (b.imageCount !== a.imageCount) return b.imageCount - a.imageCount;
    // 5. Stable
    return a.vehicleId - b.vehicleId;
  });

  // ── Duplicate detection: group by normalized make + model ───────────────────
  const groupMap = new Map<string, DailyVehicleRec[]>();
  for (const r of eligible) {
    const key = `${r.make.trim().toLowerCase()}_${r.model.trim().toLowerCase()}`;
    const bucket = groupMap.get(key) ?? [];
    bucket.push(r);
    groupMap.set(key, bucket);
  }
  for (const [key, group] of groupMap.entries()) {
    if (group.length > 1) {
      for (const r of group) { r.isDuplicate = true; r.duplicateGroupKey = key; }
    }
  }

  // ── Duplicate groups for display ────────────────────────────────────────────
  const duplicateGroups: DuplicateGroup[] = [];
  for (const [, group] of groupMap.entries()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort((a, b) => b.planScore - a.planScore);
    const winner = sorted[0]!;
    const others = sorted.slice(1);
    const runner = others[0];
    const winSignals: string[] = [];
    if (runner) {
      if (winner.imageCount > runner.imageCount) winSignals.push(`${winner.imageCount} vs ${runner.imageCount} photos`);
      if ((winner.actualPrice ?? Infinity) < (runner.actualPrice ?? Infinity)) winSignals.push("lower price");
      if ((winner.year ?? 0) > (runner.year ?? 0)) winSignals.push("newer year");
      if (winner.confidenceScore > runner.confidenceScore) winSignals.push("higher confidence");
    }
    duplicateGroups.push({
      key: `${winner.make} ${winner.model}`,
      make: winner.make,
      model: winner.model,
      count: sorted.length,
      publishFirst: winner,
      holdOthers: others,
      winReason: winSignals.length > 0
        ? `Chosen because: ${winSignals.join(", ")}. Hold the others to avoid competing against yourself on Marketplace.`
        : "Publish this unit first to avoid flooding Marketplace with the same model.",
    });
  }

  // ── Diversity-guardrailed Top 10 selection ──────────────────────────────────
  // Rules:
  //   • Max 2 vehicles per exact make+model
  //   • Max 3 EVs unless score ≥ 90
  //   • Mainstream backfill: if < 3 mainstream makes in top 10, inject from remainder
  //   • Audience mix: naturally emerges from diversity pass; no hard quotas beyond above

  const modelSlots = new Map<string, number>();  // model key → count picked
  let evCount = 0;
  let mainstreamCount = 0;
  const top10: DailyVehicleRec[] = [];
  const deferred: DailyVehicleRec[] = [];

  for (const rec of eligible) {
    const modelKey = rec.duplicateGroupKey ?? `${rec.make.toLowerCase()}_${rec.model.toLowerCase()}`;
    const slotsTaken = modelSlots.get(modelKey) ?? 0;
    const ev = isEVRec(rec);

    if (top10.length >= 10) { deferred.push(rec); continue; }
    if (slotsTaken >= 2) { deferred.push(rec); continue; }
    if (ev && evCount >= 3 && (rec.planScore ?? 0) < 90) { deferred.push(rec); continue; }

    top10.push(rec);
    modelSlots.set(modelKey, slotsTaken + 1);
    if (ev) evCount++;
    if (isMainstreamRec(rec)) mainstreamCount++;
  }

  // Mainstream backfill: guarantee ≥ 3 mainstream makes when available
  if (mainstreamCount < 3) {
    for (const rec of deferred) {
      if (top10.length >= 10) break;
      if (!isMainstreamRec(rec)) continue;
      const modelKey = rec.duplicateGroupKey ?? `${rec.make.toLowerCase()}_${rec.model.toLowerCase()}`;
      const slotsTaken = modelSlots.get(modelKey) ?? 0;
      if (slotsTaken >= 2) continue;
      top10.push(rec);
      modelSlots.set(modelKey, slotsTaken + 1);
      mainstreamCount++;
      if (mainstreamCount >= 3) break;
    }
  }

  // Fill any remaining top-10 slots with next-best from deferred
  if (top10.length < 10) {
    const inTop10 = new Set(top10.map((r) => r.vehicleId));
    for (const rec of deferred) {
      if (top10.length >= 10) break;
      if (!inTop10.has(rec.vehicleId)) top10.push(rec);
    }
  }

  // ── Split top10 into Today's 3 + Next Best 7 ────────────────────────────────
  const recommendedToday = top10.slice(0, 3);
  const nextBest = top10.slice(3, 10);

  // Everything else goes to holdToday
  const top10Set = new Set(top10.map((r) => r.vehicleId));
  const holdToday: DailyVehicleRec[] = eligible
    .filter((r) => !top10Set.has(r.vehicleId))
    .map((r) => ({ ...r, holdReason: "Lower priority — not in today's top 10" }));

  // ── Build summary ───────────────────────────────────────────────────────────
  const total = eligibleWorkspaces.length;
  const summary = top10.length > 0
    ? `DealerPilot found ${top10.length} opportunit${top10.length === 1 ? "y" : "ies"} today from ${total} eligible vehicles.`
    : alreadyQueuedRecs.length > 0
      ? `${alreadyQueuedRecs.length} vehicle${alreadyQueuedRecs.length !== 1 ? "s" : ""} already queued for publishing. No additional vehicles recommended right now.`
      : "No eligible vehicles ready to publish today. Check inventory sync or review the queue.";

  return {
    recommendedToday,
    nextBest,
    holdToday,
    needsReview,
    alreadyQueued: alreadyQueuedRecs,
    duplicateGroups,
    totalEligible: total,
    summary,
    dataSource: "Estimated Strategy",
  };
}
