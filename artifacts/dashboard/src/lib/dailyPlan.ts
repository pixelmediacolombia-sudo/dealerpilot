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
  confidenceScore: number;
  strategyName?: string | null;
  reason?: string | null;
  recommendedDownPayment?: number | null;
  recommendedPriceStrategy: string;
  supportingSignals?: string[] | null;
  expectedImpact?: string | null;
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
  recommendedToday: DailyVehicleRec[];
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
    const planScore = compositeScore(
      confidenceScore, imageCount, listingScore, priorityScore, actualPrice, priceMode,
    );

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

  // Build eligible recs and sort by planScore descending
  const eligible: DailyVehicleRec[] = eligibleWorkspaces.map((w) => toRec(w));
  eligible.sort((a, b) => b.planScore - a.planScore);

  // Duplicate detection: group by normalized make + model
  const groupMap = new Map<string, DailyVehicleRec[]>();
  for (const r of eligible) {
    const key = `${r.make.trim().toLowerCase()}_${r.model.trim().toLowerCase()}`;
    const bucket = groupMap.get(key) ?? [];
    bucket.push(r);
    groupMap.set(key, bucket);
  }

  // Mark duplicates
  for (const [key, group] of groupMap.entries()) {
    if (group.length > 1) {
      for (const r of group) {
        r.isDuplicate = true;
        r.duplicateGroupKey = key;
      }
    }
  }

  // Build duplicate groups (for display)
  const duplicateGroups: DuplicateGroup[] = [];
  for (const [, group] of groupMap.entries()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort((a, b) => b.planScore - a.planScore);
    const winner = sorted[0]!;
    const others = sorted.slice(1);

    const winSignals: string[] = [];
    const runner = others[0];
    if (runner) {
      if (winner.imageCount > runner.imageCount) winSignals.push(`${winner.imageCount} vs ${runner.imageCount} photos`);
      if ((winner.actualPrice ?? Infinity) < (runner.actualPrice ?? Infinity)) winSignals.push("lower price");
      if ((winner.year ?? 0) > (runner.year ?? 0)) winSignals.push("newer year");
      if (winner.confidenceScore > runner.confidenceScore) winSignals.push("higher strategy confidence");
    }
    const winReason = winSignals.length > 0
      ? `Chosen because: ${winSignals.join(", ")}. Hold the others to avoid competing against yourself on Marketplace.`
      : "Publish this unit first to avoid flooding Marketplace with the same model.";

    duplicateGroups.push({
      key: `${winner.make} ${winner.model}`,
      make: winner.make,
      model: winner.model,
      count: sorted.length,
      publishFirst: winner,
      holdOthers: others,
      winReason,
    });
  }

  // Assign recommendedToday: top 3, max 1 per make+model group
  const seenGroups = new Set<string>();
  const recommendedToday: DailyVehicleRec[] = [];
  const holdToday: DailyVehicleRec[] = [];

  for (const rec of eligible) {
    if (recommendedToday.length >= 3) {
      holdToday.push({ ...rec, holdReason: "Lower priority for today" });
      continue;
    }
    if (rec.isDuplicate && rec.duplicateGroupKey) {
      if (seenGroups.has(rec.duplicateGroupKey)) {
        holdToday.push({ ...rec, holdReason: `Hold — another ${rec.make} ${rec.model} is already recommended today. Rotate tomorrow.` });
        continue;
      }
      seenGroups.add(rec.duplicateGroupKey);
    }
    recommendedToday.push(rec);
  }

  // Build summary
  const total = eligibleWorkspaces.length;
  const summary = recommendedToday.length > 0
    ? `DealerPilot found ${recommendedToday.length} opportunit${recommendedToday.length === 1 ? "y" : "ies"} today from ${total} eligible vehicles.`
    : alreadyQueuedRecs.length > 0
      ? `${alreadyQueuedRecs.length} vehicle${alreadyQueuedRecs.length !== 1 ? "s" : ""} already queued for publishing. No additional vehicles recommended right now.`
      : "No eligible vehicles ready to publish today. Check inventory sync or review the queue.";

  return {
    recommendedToday,
    holdToday,
    needsReview,
    alreadyQueued: alreadyQueuedRecs,
    duplicateGroups,
    totalEligible: total,
    summary,
    dataSource: "Estimated Strategy",
  };
}
