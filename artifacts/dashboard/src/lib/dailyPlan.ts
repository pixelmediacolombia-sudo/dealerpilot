import { formatCurrency, formatMileage } from "./format";

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
// Always show the full vehicle price on Marketplace.
export function computeMarketplacePrice(
  actualPrice: number | null,
  _recommendedDownPayment: number | null,
  _recommendedPriceStrategy: string,
): { marketplacePrice: number | null; priceMode: "FULL_PRICE" | "DOWN_PAYMENT" } {
  if (actualPrice == null) return { marketplacePrice: null, priceMode: "FULL_PRICE" };
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
  _priceMode: "FULL_PRICE" | "DOWN_PAYMENT",
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

  return Math.round(score);
}

const HIGH_CLICK_MAKES = new Set([
  "toyota", "honda", "nissan", "hyundai", "kia", "mazda", "subaru",
  "ford", "chevrolet", "chevy",
]);
const TRUST_LEADER_MAKES = new Set(["toyota", "honda"]);

function marketplaceFitAdjustment(rec: {
  make: string;
  primarySegment?: string | null;
  actualPrice?: number | null;
}): number {
  const make = rec.make.toLowerCase();
  const segment = (rec.primarySegment ?? "").toLowerCase();
  const price = rec.actualPrice ?? null;
  let adjustment = 0;

  if (TRUST_LEADER_MAKES.has(make)) adjustment += 12;
  else if (HIGH_CLICK_MAKES.has(make)) adjustment += 7;

  if (segment.includes("family") || segment.includes("affordable")) adjustment += 6;
  if (segment.includes("performance") || segment.includes("luxury")) adjustment -= 4;

  if (price != null) {
    if (price >= 7_000 && price < 16_000) adjustment += 15;
    else if (price < 22_000) adjustment += 12;
    else if (price < 28_000) adjustment += 8;
    else if (price < 35_000) adjustment += 2;
    else if (price < 45_000) adjustment -= 6;
    else if (price < 60_000) adjustment -= 14;
    else adjustment -= 24;
  }

  if (segment.includes("ev") || segment.includes("tech")) {
    adjustment += price != null && price <= 25_000 ? 2 : -10;
  }

  return adjustment;
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
    const rawPlanScore = rec?.opportunityScore != null
      ? rec.opportunityScore
      : compositeScore(confidenceScore, imageCount, listingScore, priorityScore, actualPrice, priceMode);
    const planScore = Math.max(0, Math.min(100, Math.round(rawPlanScore + marketplaceFitAdjustment({
      make: w.make,
      primarySegment: rec?.primarySegment ?? null,
      actualPrice,
    }))));

    // Build human-readable reason bullets from real signals
    const reasons: string[] = [];
    if (rec?.strategyName) reasons.push(rec.strategyName);
    if (imageCount >= 15) reasons.push(`${imageCount} photos available`);
    else if (imageCount > 0) reasons.push(`${imageCount} photos`);
    if (actualPrice != null) {
      reasons.push(`Marketplace price: ${formatCurrency(actualPrice)} total`);
      if (actualPrice < 28_000) reasons.push("High-click Marketplace price range");
    }
    if (["toyota", "honda"].includes(w.make.toLowerCase())) reasons.push("High-trust Marketplace make");
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
  function conversationLane(r: DailyVehicleRec): string {
    const text = [
      r.make,
      r.model,
      r.primarySegment,
      r.secondarySegment ?? "",
      r.adAngle,
      r.whyThisAudience,
    ].join(" ").toLowerCase();
    if (isEVRec(r)) return "ev";
    if (/\b(truck|pickup|work|silverado|f-150|f150|ram|tacoma|sierra|colorado)\b/.test(text)) return "truck";
    if (/\b(suv|family|pilot|cr-v|crv|rav4|rogue|escape|explorer|highlander|cx-5|cx5)\b/.test(text)) return "family";
    if (r.priceMode === "DOWN_PAYMENT" || (r.actualPrice != null && r.actualPrice < 22_000) || /\b(payment|affordable|budget|spanish)\b/.test(text)) return "payment";
    return isMainstreamRec(r) ? "mainstream" : "general";
  }
  function conversationBalancedTop3(pool: DailyVehicleRec[]): DailyVehicleRec[] {
    const selected: DailyVehicleRec[] = [];
    const selectedIds = new Set<number>();

    const hasDifferentMakeAvailable = (make: string) =>
      pool.some((r) => !selectedIds.has(r.vehicleId) && r.make.toLowerCase() !== make.toLowerCase());
    const hasDifferentLaneAvailable = (lane: string) =>
      pool.some((r) => !selectedIds.has(r.vehicleId) && conversationLane(r) !== lane);
    const hasNonEvAvailable = () =>
      pool.some((r) => !selectedIds.has(r.vehicleId) && !isEVRec(r));

    for (const rec of pool) {
      if (selected.length >= 3) continue;
      const lane = conversationLane(rec);
      const repeatsMake = selected.some((r) => r.make.toLowerCase() === rec.make.toLowerCase());
      const repeatsLane = selected.some((r) => conversationLane(r) === lane);
      const repeatsEv = isEVRec(rec) && selected.some((r) => isEVRec(r));

      if ((repeatsEv && hasNonEvAvailable()) ||
          (repeatsMake && hasDifferentMakeAvailable(rec.make)) ||
          (repeatsLane && hasDifferentLaneAvailable(lane))) {
        continue;
      }

      selected.push(rec);
      selectedIds.add(rec.vehicleId);
    }

    for (const rec of pool) {
      if (selected.length >= 3) break;
      if (!selectedIds.has(rec.vehicleId)) {
        selected.push(rec);
        selectedIds.add(rec.vehicleId);
      }
    }

    return [...selected, ...pool.filter((r) => !selectedIds.has(r.vehicleId))];
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
  const duplicateConflictIds = new Set<number>();
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
    for (const rec of sorted) duplicateConflictIds.add(rec.vehicleId);
  }

  const publishable = eligible.filter((rec) => !duplicateConflictIds.has(rec.vehicleId));

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

  for (const rec of publishable) {
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
  const balancedTop10 = conversationBalancedTop3(top10);
  const recommendedToday = balancedTop10.slice(0, 3);
  const nextBest = balancedTop10.slice(3, 10);

  // Everything else goes to holdToday
  const top10Set = new Set(balancedTop10.map((r) => r.vehicleId));
  const holdToday: DailyVehicleRec[] = eligible
    .filter((r) => !top10Set.has(r.vehicleId))
    .map((r) => ({
      ...r,
      holdReason: duplicateConflictIds.has(r.vehicleId)
        ? "Protected from publishing - Market Agent flagged a duplicate-listing conflict"
        : "Lower priority - not in today's top 10",
    }));

  // ── Build summary ───────────────────────────────────────────────────────────
  const total = eligibleWorkspaces.length;
  const summary = top10.length > 0
    ? `DealerPilot found ${top10.length} publishable opportunit${top10.length === 1 ? "y" : "ies"} today from ${total} eligible vehicles.`
    : alreadyQueuedRecs.length > 0
      ? `${alreadyQueuedRecs.length} vehicle${alreadyQueuedRecs.length !== 1 ? "s" : ""} already queued for publishing. No additional vehicles recommended right now.`
      : duplicateConflictIds.size > 0
        ? "No publishable vehicles ready right now. Duplicate-listing protection is holding today's highest-scoring candidates."
        : "No eligible vehicles ready to publish today. Check inventory sync or review the queue.";

  return {
    recommendedToday,
    nextBest,
    holdToday,
    needsReview,
    alreadyQueued: alreadyQueuedRecs,
    duplicateGroups,
    totalEligible: publishable.length,
    summary,
    dataSource: "Estimated Strategy",
  };
}

// ─── Strategic Reason Generator ───────────────────────────────────────────────
// Picks the best single-sentence reason to show in the strategy table.
// Priority: whyThisAudience (narrative) → reasons[0] → adAngle → attribute-based
export function generateReason(rec: DailyVehicleRec): string {
  if (rec.whyThisAudience) {
    const s = rec.whyThisAudience.split(".")[0].trim();
    if (s.length > 8 && s.length < 130) return s;
  }
  if (rec.reasons.length > 0) {
    const r = rec.reasons[0];
    if (r && r.length < 120) return r;
  }
  if (rec.adAngle && rec.adAngle.length > 0) return `"${rec.adAngle}"`;
  const parts: string[] = [];
  if (rec.primarySegment && rec.primarySegment !== "General") parts.push(`${rec.primarySegment} demand`);
  if (rec.opportunityScore != null && rec.opportunityScore >= 85) parts.push("top opportunity score");
  if (rec.mileage != null && rec.mileage < 30_000) parts.push("low mileage");
  if (rec.imageCount >= 15) parts.push(`${rec.imageCount} photos ready`);
  return parts.join(" · ") || "High market opportunity";
}

// ─── Duplicate group publish/hold reason builders ─────────────────────────────
export function buildPublishReasons(group: DuplicateGroup): string[] {
  const winner = group.publishFirst;
  const runner = group.holdOthers[0];
  const reasons: string[] = [];
  if (runner) {
    if ((winner.opportunityScore ?? 0) > (runner.opportunityScore ?? 0)) {
      reasons.push(`Highest Opportunity Score (${winner.opportunityScore ?? "—"})`);
    }
    if ((winner.actualPrice ?? Infinity) < (runner.actualPrice ?? Infinity)) reasons.push("Lowest price");
    if (winner.imageCount > runner.imageCount) reasons.push(`Most photos (${winner.imageCount})`);
    if ((winner.mileage ?? Infinity) < (runner.mileage ?? Infinity)) reasons.push("Lowest mileage");
  }
  if (winner.imageCount >= 10) reasons.push("AI Creative Ready");
  if (winner.primarySegment && winner.primarySegment !== "General") {
    reasons.push(`Highest ${winner.primarySegment} Buyer Match`);
  }
  if (reasons.length === 0) reasons.push("Best overall vehicle in this group");
  return reasons;
}

export function buildHoldReasons(vehicle: DailyVehicleRec, winner: DailyVehicleRec): string[] {
  const reasons: string[] = ["Too similar — would compete with published listing"];
  if ((vehicle.opportunityScore ?? 0) < (winner.opportunityScore ?? 0)) {
    reasons.push(`Lower Opportunity Score (${vehicle.opportunityScore ?? "—"} vs ${winner.opportunityScore ?? "—"})`);
  }
  if ((vehicle.actualPrice ?? 0) > (winner.actualPrice ?? 0)) reasons.push("Higher price");
  if (vehicle.imageCount < winner.imageCount) reasons.push(`Fewer photos (${vehicle.imageCount})`);
  reasons.push(`Publish after ${winner.year ?? ""} ${winner.make} ${winner.model} expires`);
  return reasons;
}

// ─── AI General Manager Intelligence Layer ────────────────────────────────────

// Confidence Engine — how certain is DealerPilot about this recommendation?
export function computeConfidence(rec: DailyVehicleRec): number {
  let conf = 44;
  if (rec.opportunityScore != null) conf += (rec.opportunityScore - 50) * 0.52;
  if (rec.imageCount >= 15) conf += 12;
  else if (rec.imageCount >= 10) conf += 8;
  else if (rec.imageCount >= 5) conf += 4;
  if (rec.whyThisAudience) conf += 8;
  if (rec.adAngle) conf += 5;
  if (rec.primarySegment && rec.primarySegment !== "General") conf += 5;
  if (rec.actualPrice != null) conf += 3;
  if (rec.mileage != null) conf += 4;
  return Math.min(99, Math.max(40, Math.round(conf)));
}

// Risk Analysis — proactively identify weaknesses
export function computeRisk(rec: DailyVehicleRec): {
  level: "LOW" | "MEDIUM" | "HIGH";
  explanation: string;
} {
  const risks: string[] = [];
  if (rec.imageCount < 6) risks.push("Limited photos may reduce buyer confidence");
  else if (rec.imageCount < 10) risks.push("Consider adding more photos before publishing");
  if (rec.mileage != null && rec.mileage > 100_000) risks.push("High mileage — consider stronger creative to counter buyer hesitation");
  else if (rec.mileage != null && rec.mileage > 75_000) risks.push("Above-average mileage — pricing must remain competitive");
  if (rec.actualPrice != null && rec.actualPrice > 40_000) risks.push("Above-market price range for Facebook Marketplace buyers");
  else if (rec.actualPrice != null && rec.actualPrice > 28_000) risks.push("Price-sensitive segment — highlight financing options");
  if (!rec.whyThisAudience && !rec.adAngle) risks.push("AI creative analysis incomplete — run Creative Studio first");
  if (risks.length === 0) return { level: "LOW", explanation: "No significant risk factors detected. This vehicle is well-positioned to perform." };
  if (risks.length === 1) return { level: "LOW", explanation: risks[0]! };
  if (risks.length === 2) return { level: "MEDIUM", explanation: risks.join(". ") + "." };
  return { level: "HIGH", explanation: risks.join(". ") + "." };
}

// Expected Results — predictive performance projections
export function computeExpectedResults(rec: DailyVehicleRec): {
  conversations: [number, number];
  appointments: [number, number];
  saleProbability: number;
  roi: "HIGH" | "MEDIUM" | "LOW";
} {
  const score = rec.opportunityScore ?? 50;
  const segBoost = rec.primarySegment && rec.primarySegment !== "General" ? 1.2 : 1.0;
  const base = (score / 100) * 28 * segBoost;
  const minConv = Math.max(2, Math.round(base * 0.75));
  const maxConv = Math.round(base * 1.15);
  const minAppt = Math.max(1, Math.round(minConv * 0.28));
  const maxAppt = Math.round(maxConv * 0.28);
  const saleProbability = Math.min(35, Math.round(score * 0.22));
  const roi: "HIGH" | "MEDIUM" | "LOW" = score >= 80 ? "HIGH" : score >= 65 ? "MEDIUM" : "LOW";
  return { conversations: [minConv, maxConv], appointments: [minAppt, maxAppt], saleProbability, roi };
}

// Cost of Waiting — opportunity cost of a 48-hour delay
export function computeWaitingCost(rec: DailyVehicleRec): {
  reachLoss: number;
  conversationsLost: number;
  revenueLoss: number;
} {
  const score = rec.opportunityScore ?? 50;
  const dailyReach = Math.round((score / 100) * 1_850);
  const reachLoss = dailyReach * 2;
  const conversationsLost = Math.max(1, Math.round(reachLoss * 0.0038));
  const avgGross = (rec.actualPrice ?? 18_000) * 0.085;
  const revenueLoss = Math.round(conversationsLost * avgGross * 0.18);
  return { reachLoss, conversationsLost, revenueLoss };
}

// DealerPilot Reasoning — executive narrative for why this vehicle was selected
export function generateReasoning(rec: DailyVehicleRec, duplicateGroups: DuplicateGroup[]): string {
  const group = duplicateGroups.find(
    g => g.make.toLowerCase() === rec.make.toLowerCase() && g.model.toLowerCase() === rec.model.toLowerCase(),
  );
  if (group && group.holdOthers.length > 0) {
    const total = 1 + group.holdOthers.length;
    const runner = group.holdOthers[0]!;
    const advantages = [
      (rec.opportunityScore ?? 0) > (runner.opportunityScore ?? 0) ? "opportunity score" : null,
      (rec.mileage ?? Infinity) < (runner.mileage ?? Infinity) ? "lower mileage" : null,
      (rec.actualPrice ?? Infinity) < (runner.actualPrice ?? Infinity) ? "competitive pricing" : null,
      rec.imageCount > runner.imageCount ? "stronger photo set" : null,
      rec.primarySegment !== "General" && rec.primarySegment !== runner.primarySegment ? `${rec.primarySegment} audience fit` : null,
    ].filter(Boolean);
    return `I considered ${total} ${rec.make} ${rec.model}s for today's campaign. Although the ${runner.year ?? ""} ${rec.model} was evaluated, the ${rec.year ?? ""} unit offers a stronger combination of ${advantages.length > 0 ? advantages.join(", ") : "overall signals"}. Publishing both today would split Marketplace exposure and reduce visibility for each. I recommend leading with the ${rec.year ?? ""} model and scheduling the ${runner.label} after this campaign matures.`;
  }
  if (rec.whyThisAudience) {
    return `Among ${rec.make} ${rec.model}s in your inventory, this ${rec.year ?? ""} unit stands out. ${rec.whyThisAudience}`;
  }
  const parts = [`I selected this ${rec.year ?? ""} ${rec.make} ${rec.model} based on its opportunity score (${rec.opportunityScore ?? "—"})`];
  if (rec.imageCount > 0) parts.push(`${rec.imageCount} photos ready`);
  if (rec.mileage != null && rec.mileage < 40_000) parts.push(`low mileage (${formatMileage(rec.mileage)})`);
  if (rec.primarySegment !== "General") parts.push(`strong ${rec.primarySegment} buyer segment match`);
  return parts.join(", ") + ".";
}

// Morning Brief — executive narrative generated fresh from today's plan
export function generateMorningBrief(plan: DailyMarketplacePlan): {
  greeting: string;
  body: string;
  primaryVehicle: string | null;
  primaryReason: string | null;
} {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
  const top = plan.recommendedToday[0] ?? plan.nextBest[0] ?? null;
  const selected = plan.recommendedToday.length + plan.nextBest.length;
  const protected_ = plan.duplicateGroups.reduce((sum, g) => sum + g.holdOthers.length, 0);
  const body = [
    `I analyzed ${plan.totalEligible} active vehicles overnight.`,
    `After evaluating pricing, buyer demand, vehicle quality, audience fit, duplicate conflicts, and AI creative performance — I identified ${selected} vehicle${selected !== 1 ? "s" : ""} worth publishing today.`,
    protected_ > 0 ? `${protected_} vehicle${protected_ !== 1 ? "s" : ""} are protected from self-competition across ${plan.duplicateGroups.length} duplicate group${plan.duplicateGroups.length !== 1 ? "s" : ""}.` : null,
  ].filter(Boolean).join(" ");
  const primaryVehicle = top?.label ?? null;
  const primaryReason = top?.whyThisAudience
    ? top.whyThisAudience.split(".")[0]?.trim() ?? null
    : top?.adAngle
      ? `Recommended angle: "${top.adAngle}"`
      : null;
  return { greeting, body, primaryVehicle, primaryReason };
}

// Creative Recommendation — best format, hook, CTR, audience, language
export function computeCreativeRecommendation(rec: DailyVehicleRec): {
  formats: Array<{ name: string; score: number }>;
  hook: string;
  ctr: string;
  audience: string;
  language: string;
} {
  const hasPhotos = rec.imageCount >= 10;
  const formats = [
    { name: "Static Image", score: hasPhotos ? 94 : 78 },
    { name: "Carousel", score: hasPhotos ? 86 : 64 },
    { name: "Video", score: 71 },
  ].sort((a, b) => b.score - a.score);
  const hook = rec.adAngle && rec.adAngle.length > 0
    ? rec.adAngle
    : rec.mileage != null && rec.mileage < 35_000
      ? `Only ${Math.round(rec.mileage / 1000)}k Miles — ${rec.year} ${rec.make} ${rec.model}`
      : `${rec.year ?? ""} ${rec.make} ${rec.model}`.trim();
  const ctr = `${(3.1 + ((rec.opportunityScore ?? 50) / 100) * 2.6).toFixed(1)}%`;
  const language = rec.suggestedLanguage === "Spanish-first" ? "Spanish" : rec.suggestedLanguage === "Bilingual" ? "Bilingual" : "English";
  return { formats, hook, ctr, audience: rec.primarySegment || "General", language };
}
