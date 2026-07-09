// DealerPilot Marketplace Demand Engine v1.0
//
// Replaces pure Opportunity Score ranking with a 12-signal composite
// Marketplace Demand Score (0–100). The existing Opportunity Score
// becomes one ~20% input — real Marketplace outcomes dominate the ranking.
//
// Signal weights (initial — the Learning Agent calibrates them nightly via EMA):
//
//   opportunityScore        20%  — existing 9-signal composite (quality baseline)
//   marketplaceDemand       18%  — historical listing performance for this body type
//   vehicleSegmentDemand    12%  — buyer segment fit (audience match strength)
//   latinoBuyerPreference   10%  — Spanish conversation ratio + language segment fit
//   financingProbability     8%  — price tier × hot lead financing signals
//   historicalConversations  8%  — real buyer messages linked to this vehicle/type
//   historicalAppointments   6%  — appointment-ready leads for this vehicle type
//   historicalSales          5%  — actual sold count via listing performance
//   daysInInventory          5%  — urgency (inventoryHealthScore — aging = push harder)
//   priceCompetitiveness     4%  — vs dealer inventory median
//   duplicateSaturation      2%  — penalty: high market saturation reduces ranking
//   seasonalDemand           2%  — month + body type seasonal boost
//
// Demand Labels: Hot Demand ≥ 75 · Strong 60–74 · Moderate 45–59 · Slow < 45

// ── Default weights (must sum to 1.0) ─────────────────────────────────────────

export const DEFAULT_DEMAND_WEIGHTS: DemandWeights = {
  opportunityScore:          0.20,
  marketplaceDemand:         0.18,
  vehicleSegmentDemand:      0.12,
  latinoBuyerPreference:     0.10,
  financingProbability:      0.08,
  historicalConversations:   0.08,
  historicalAppointments:    0.06,
  historicalSales:           0.05,
  daysInInventory:           0.05,
  priceCompetitiveness:      0.04,
  duplicateSaturation:       0.02,
  seasonalDemand:            0.02,
};

export const DEMAND_WEIGHTS_VERSION = "v1.0-default";

export interface DemandWeights {
  opportunityScore:          number;
  marketplaceDemand:         number;
  vehicleSegmentDemand:      number;
  latinoBuyerPreference:     number;
  financingProbability:      number;
  historicalConversations:   number;
  historicalAppointments:    number;
  historicalSales:           number;
  daysInInventory:           number;
  priceCompetitiveness:      number;
  duplicateSaturation:       number;
  seasonalDemand:            number;
}

export type DemandLabel = "Hot Demand" | "Strong" | "Moderate" | "Slow";

export interface DemandInput {
  // From Opportunity Engine (pass the full OpportunityScores result)
  opportunityScore: number;
  buyerSegmentScore: number;
  priceScore: number;
  inventoryHealthScore: number;
  seasonalScore: number;
  suggestedLanguage: string;
  opportunityFactors: string[];

  // Vehicle
  vehiclePrice: number | null;

  // Marketplace popularity: aggregate outcomes for this body style from listing_performance
  bodyTypeAvgOutcome: number;   // 0–100 avg outcome score across all listings of this body type
  bodyTypeListingCount: number; // number of historical listings for confidence weighting

  // Latino buyer preference (real data from conversations table)
  spanishConversationRatio: number; // 0–1: fraction of dealer's conversations in Spanish/es

  // Historical engagement (vehicle-specific real data)
  vehicleConversations: number;
  vehicleHotLeads: number;
  vehicleAppointments: number; // appointmentReadyCount from listing_performance
  vehicleSales: number;        // soldCount from listing_performance

  // Market saturation (0 if no market scan data available)
  duplicateConflictCount: number;

  // Learned weights (falls back to DEFAULT_DEMAND_WEIGHTS if absent)
  learnedWeights?: DemandWeights;
  weightsVersion?: string;
}

export interface DemandScores {
  demandScore: number;
  demandLabel: DemandLabel;
  demandFactors: string[];

  // Stored sub-scores for breakdown UI and weight calibration
  marketplacePopularityScore: number;
  latinoPreferenceScore: number;
  financingProbabilityScore: number;
  historicalEngagementScore: number;
  duplicateSaturationScore: number;
  demandWeightsVersion: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function computeDemandLabel(score: number): DemandLabel {
  if (score >= 75) return "Hot Demand";
  if (score >= 60) return "Strong";
  if (score >= 45) return "Moderate";
  return "Slow";
}

// ── Signal: Marketplace Demand (body-type historical outcome) ─────────────────

function signalMarketplaceDemand(
  bodyTypeAvgOutcome: number,
  bodyTypeListingCount: number,
): { score: number; factor: string | null } {
  if (bodyTypeListingCount === 0) {
    return { score: 58, factor: null }; // no history — slightly below neutral
  }

  let score: number;
  if (bodyTypeAvgOutcome >= 70) {
    score = 95;
  } else if (bodyTypeAvgOutcome >= 55) {
    score = 80;
  } else if (bodyTypeAvgOutcome >= 40) {
    score = 65;
  } else if (bodyTypeAvgOutcome >= 25) {
    score = 50;
  } else {
    score = 35;
  }

  // Confidence bonus for large sample sizes
  if (bodyTypeListingCount >= 15) score = Math.min(100, score + 5);
  else if (bodyTypeListingCount >= 5) score = Math.min(100, score + 2);

  const factor =
    bodyTypeAvgOutcome >= 55
      ? `This vehicle type averages ${Math.round(bodyTypeAvgOutcome)}/100 outcome on Marketplace (${bodyTypeListingCount} listings)`
      : bodyTypeAvgOutcome < 30 && bodyTypeListingCount >= 3
        ? `This body type has historically low Marketplace engagement (avg ${Math.round(bodyTypeAvgOutcome)}/100)`
        : null;

  return { score: clamp(score), factor };
}

// ── Signal: Latino Buyer Preference ──────────────────────────────────────────

function signalLatinoBuyerPreference(
  spanishConversationRatio: number,
  suggestedLanguage: string,
): { score: number; factor: string | null } {
  let score = 48; // neutral baseline
  let factor: string | null = null;

  // Real conversation language data (highest-confidence signal)
  if (spanishConversationRatio >= 0.60) {
    score = 93;
    factor = `${Math.round(spanishConversationRatio * 100)}% of conversations in Spanish — strong Latino buyer demand (live data)`;
  } else if (spanishConversationRatio >= 0.35) {
    score = 79;
    factor = `${Math.round(spanishConversationRatio * 100)}% Spanish conversations — bilingual audience active (live data)`;
  } else if (spanishConversationRatio >= 0.15) {
    score = 63;
    factor = `${Math.round(spanishConversationRatio * 100)}% Spanish conversations detected (live data)`;
  } else if (spanishConversationRatio >= 0.05) {
    score = 54;
  }

  // Language-fit signal from Opportunity Engine heuristic (secondary)
  if (suggestedLanguage === "Spanish-first") {
    score = Math.min(100, score + 12);
    if (!factor) factor = "Spanish-first buyer segment — high Latino market fit (audience model)";
  } else if (suggestedLanguage === "Bilingual") {
    score = Math.min(100, score + 6);
    if (!factor && spanishConversationRatio < 0.15) factor = "Bilingual buyer segment — mixed-language audience reach";
  }

  return { score: clamp(score), factor };
}

// ── Signal: Financing Probability ────────────────────────────────────────────

function signalFinancingProbability(
  vehiclePrice: number | null,
  vehicleHotLeads: number,
  vehicleConversations: number,
): { score: number; factor: string | null } {
  const p = vehiclePrice ?? 0;
  let score: number;
  let factor: string | null = null;

  if (p <= 0) {
    score = 52; // unknown price — neutral
  } else if (p < 12000) {
    score = 85; // cash-deal range — fastest closing on Marketplace
    factor = `Under $12k — cash/buy-here-pay-here tier, highest close rate on Marketplace`;
  } else if (p < 20000) {
    score = 90; // Marketplace financing sweet spot
    factor = `$${Math.round(p / 1000)}k — prime Marketplace financing range, maximum buyer pool`;
  } else if (p < 30000) {
    score = 80;
    factor = `$${Math.round(p / 1000)}k — strong financing tier, broad down-payment buyer audience`;
  } else if (p < 45000) {
    score = 65;
  } else if (p < 60000) {
    score = 50;
  } else {
    score = 38; // luxury range — smaller Marketplace financing pool
  }

  // Hot-lead boost: confirmed buyer intent amplifies financing probability
  if (vehicleHotLeads >= 3) {
    score = Math.min(100, score + 12);
    factor = factor ?? `${vehicleHotLeads} hot leads confirmed financing intent (live data)`;
  } else if (vehicleHotLeads >= 1) {
    score = Math.min(100, score + 6);
    factor = factor ?? `${vehicleHotLeads} hot lead${vehicleHotLeads > 1 ? "s" : ""} confirmed buyer intent (live data)`;
  } else if (vehicleConversations >= 5) {
    score = Math.min(100, score + 4);
  }

  return { score: clamp(score), factor };
}

// ── Signal: Historical Conversations ─────────────────────────────────────────

function signalHistoricalConversations(conversations: number): { score: number; factor: string | null } {
  let score: number;
  let factor: string | null = null;

  if (conversations >= 15) {
    score = 96; factor = `${conversations} buyer conversations recorded — exceptional demand (live data)`;
  } else if (conversations >= 8) {
    score = 88; factor = `${conversations} buyer conversations — strong market interest (live data)`;
  } else if (conversations >= 4) {
    score = 76; factor = `${conversations} buyer conversations on record (live data)`;
  } else if (conversations >= 2) {
    score = 62;
  } else if (conversations >= 1) {
    score = 54;
  } else {
    score = 42; // no conversations yet — below neutral (not zero, as the vehicle is new)
  }

  return { score: clamp(score), factor };
}

// ── Signal: Historical Appointments ──────────────────────────────────────────

function signalHistoricalAppointments(appointments: number): { score: number; factor: string | null } {
  if (appointments >= 4) return { score: 97, factor: `${appointments} appointment-ready leads — top demand signal (live data)` };
  if (appointments >= 2) return { score: 84, factor: `${appointments} appointment-ready leads (live data)` };
  if (appointments >= 1) return { score: 70, factor: "1 appointment-ready lead (live data)" };
  return { score: 45, factor: null };
}

// ── Signal: Historical Sales ──────────────────────────────────────────────────

function signalHistoricalSales(sales: number): { score: number; factor: string | null } {
  if (sales >= 5) return { score: 98, factor: `${sales} previous sales of this vehicle type — proven seller (live data)` };
  if (sales >= 3) return { score: 90, factor: `${sales} previous sales recorded — strong sell-through (live data)` };
  if (sales >= 1) return { score: 75, factor: `${sales} previous sale${sales > 1 ? "s" : ""} recorded (live data)` };
  return { score: 45, factor: null };
}

// ── Signal: Duplicate Saturation (inverted — more competing = lower score) ───

function signalDuplicateSaturation(duplicateCount: number): { score: number; factor: string | null } {
  if (duplicateCount === 0) return { score: 88, factor: null }; // no competition
  if (duplicateCount <= 2) return { score: 75, factor: null };
  if (duplicateCount <= 5) return { score: 60, factor: `${duplicateCount} similar vehicles listed — moderate market saturation` };
  if (duplicateCount <= 10) return { score: 44, factor: `${duplicateCount} competing listings — high saturation, differentiate or retime` };
  return { score: 28, factor: `${duplicateCount}+ competing listings — oversaturated segment, consider week-shift` };
}

// ── Composite historical engagement score (for DB storage / display) ─────────

function computeEngagementComposite(conversations: number, appointments: number, sales: number): number {
  let score = 40;
  if (conversations >= 10) score += 25;
  else if (conversations >= 5) score += 18;
  else if (conversations >= 2) score += 10;
  else if (conversations >= 1) score += 5;

  if (appointments >= 3) score += 25;
  else if (appointments >= 1) score += 16;

  if (sales >= 2) score += 20;
  else if (sales >= 1) score += 12;

  return clamp(score);
}

// ── Main scoring function ─────────────────────────────────────────────────────

export function computeDemandScores(input: DemandInput): DemandScores {
  const w = input.learnedWeights ?? DEFAULT_DEMAND_WEIGHTS;
  const weightsVersion = input.weightsVersion ?? DEMAND_WEIGHTS_VERSION;

  // Compute each signal's 0–100 score
  const popularity = signalMarketplaceDemand(input.bodyTypeAvgOutcome, input.bodyTypeListingCount);
  const latino = signalLatinoBuyerPreference(input.spanishConversationRatio, input.suggestedLanguage);
  const financing = signalFinancingProbability(input.vehiclePrice, input.vehicleHotLeads, input.vehicleConversations);
  const conversations = signalHistoricalConversations(input.vehicleConversations);
  const appointments = signalHistoricalAppointments(input.vehicleAppointments);
  const sales = signalHistoricalSales(input.vehicleSales);
  const saturation = signalDuplicateSaturation(input.duplicateConflictCount);

  // Weighted composite (all 12 signals)
  const rawScore =
    input.opportunityScore          * w.opportunityScore +
    popularity.score                * w.marketplaceDemand +
    input.buyerSegmentScore         * w.vehicleSegmentDemand +
    latino.score                    * w.latinoBuyerPreference +
    financing.score                 * w.financingProbability +
    conversations.score             * w.historicalConversations +
    appointments.score              * w.historicalAppointments +
    sales.score                     * w.historicalSales +
    input.inventoryHealthScore      * w.daysInInventory +
    input.priceScore                * w.priceCompetitiveness +
    saturation.score                * w.duplicateSaturation +
    input.seasonalScore             * w.seasonalDemand;

  const demandScore = clamp(rawScore);

  // Collect explanation bullets (highest-signal first)
  const rawFactors: Array<string | null> = [
    appointments.factor,
    sales.factor,
    conversations.factor,
    latino.factor,
    popularity.factor,
    financing.factor,
    saturation.factor,
    ...input.opportunityFactors,
  ];
  const demandFactors = rawFactors.filter((f): f is string => !!f).slice(0, 6);

  return {
    demandScore,
    demandLabel: computeDemandLabel(demandScore),
    demandFactors,

    // Stored sub-scores (for breakdown UI and calibration)
    marketplacePopularityScore: popularity.score,
    latinoPreferenceScore: latino.score,
    financingProbabilityScore: financing.score,
    historicalEngagementScore: computeEngagementComposite(
      input.vehicleConversations,
      input.vehicleAppointments,
      input.vehicleSales,
    ),
    duplicateSaturationScore: saturation.score,
    demandWeightsVersion: weightsVersion,
  };
}

// ── Weight calibration (called by Learning Agent) ─────────────────────────────
//
// Adjusts weights using a simple EMA gradient step based on signal accuracy.
// For each signal: if actual outcomes were better than what the signal predicted,
// increase the signal's weight slightly; if worse, decrease it.

export interface SignalFeedback {
  signal: keyof DemandWeights;
  // signalScore  × weight at prediction time vs actual outcome contribution
  predictedContribution: number; // signal_score × signal_weight (0–100)
  actualRelevance: number;       // observed outcome contribution (0–100)
}

export function calibrateDemandWeights(
  currentWeights: DemandWeights,
  signalFeedback: SignalFeedback[],
  learningRate = 0.04,
): { weights: DemandWeights; version: string } {
  const updated = { ...currentWeights };

  for (const { signal, predictedContribution, actualRelevance } of signalFeedback) {
    const error = (actualRelevance - predictedContribution) / 100;
    updated[signal] = Math.max(0.01, Math.min(0.40, updated[signal] + error * learningRate));
  }

  // Renormalise weights to sum to 1.0
  const total = (Object.values(updated) as number[]).reduce((s, w) => s + w, 0);
  for (const key of Object.keys(updated) as Array<keyof DemandWeights>) {
    updated[key] = Math.round((updated[key] / total) * 1000) / 1000;
  }

  const version = `v1.0-calibrated-${new Date().toISOString().slice(0, 10)}`;
  return { weights: updated, version };
}
