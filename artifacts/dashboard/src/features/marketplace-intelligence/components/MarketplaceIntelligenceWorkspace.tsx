import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/shared/layout/AppLayout";
import { useDealerLocation } from "@/context/LocationContext";
import { PageHeader } from "@/shared/ui";
import { cn } from "@/lib/utils";
import { formatCurrency, formatMileage } from "@/lib/format";
import { PublishNowModal } from "@/features/publishing/components/PublishNowModal";
import {
  useListListingWorkspaces,
  useListPublishingJobs,
  useListMarketplaceRecommendations,
} from "@workspace/api-client-react";
import {
  buildDailyMarketplacePlan,
} from "@/lib/dailyPlan";
import {
  Flame, TrendingDown, DollarSign, Clock, MapPin, BarChart3,
  Car, Zap, Star, ChevronRight, RefreshCw, ArrowUp, ArrowDown,
  Minus, Target, Trophy, AlertTriangle, Calendar, Camera,
  SendHorizontal, Eye, CheckCircle2, ImageIcon, UploadCloud,
  ShieldCheck, ChevronDown, ChevronUp,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type OpportunityLabel = "Hot" | "Strong" | "Watch" | "Low";
type RecommendedAction = "Publish Today" | "Hold" | "Review Price" | "Needs Better Photos";

interface OpportunityVehicle {
  vehicleId: number;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  price: number | null;
  mileage: number | null;
  bodyStyle: string | null;
  status: string;
  lotLocation: string | null;
  thumbnailUrl: string | null;
  photoCount: number;
  missingPrice: boolean;
  opportunityScore: number;
  opportunityLabel: OpportunityLabel;
  recommendedAction: RecommendedAction;
  marketDemandScore: number;
  priceScore: number;
  vehicleQualityScore: number;
  buyerSegmentScore: number;
  seasonalScore: number;
  dealerPerformanceScore: number;
  buyerDemandScore: number;
  inventoryHealthScore: number;
  creativePerformanceScore: number;
  pricingPosition: string;
  daysOnLot: number;
  opportunityFactors: string[];
  primarySegment: string;
  secondarySegment: string | null;
  adAngle: string;
  suggestedLanguage: string;
  whyThisAudience: string;
  strategyName: string | null;
  recommendedDayLabel: string | null;
  recommendedTimeLabel: string | null;
  expectedLeadQuality: string;
  confidenceScore: number;
  // Marketplace Demand Engine v1
  demandScore: number;
  demandLabel: string;
  demandFactors: string[];
  marketplacePopularityScore: number | null;
  latinoPreferenceScore: number | null;
  financingProbabilityScore: number | null;
  historicalEngagementScore: number | null;
  duplicateSaturationScore: number | null;
  demandWeightsVersion: string | null;
}

interface Insights {
  avgOpportunityScore: number;
  hotCount: number;
  warmCount: number;
  coldCount: number;
  agingCount: number;
  belowMarketCount: number;
  atMarketCount: number;
  aboveMarketCount: number;
  seasonContext: string;
  topBodyType: string;
  avgDaysOnLot: number;
  totalVehicles: number;
}

interface BodyTypeTrend {
  bodyType: string;
  count: number;
  avgScore: number;
}

interface LotBreakdown {
  location: string;
  count: number;
  avgOpportunityScore: number;
  hotCount: number;
}

interface OpportunityResponse {
  vehicles: OpportunityVehicle[];
  insights: Insights | null;
  sections: {
    hot: OpportunityVehicle[];
    cooling: OpportunityVehicle[];
    competitive: OpportunityVehicle[];
    byLot: LotBreakdown[];
    bodyTypeTrend: BodyTypeTrend[];
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useOpportunityData() {
  const [data, setData] = useState<OpportunityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/marketplace-intelligence/opportunity");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as OpportunityResponse);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  return { data, loading, error, refresh: load };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return "text-success";
  if (score >= 60) return "text-warning";
  if (score >= 45) return "text-yellow-400/70";
  return "text-destructive/60";
}

function scoreBg(score: number): string {
  if (score >= 75) return "bg-success";
  if (score >= 60) return "bg-warning";
  if (score >= 45) return "bg-yellow-400/70";
  return "bg-destructive/50";
}

function labelColor(label: OpportunityLabel): string {
  if (label === "Hot") return "text-success";
  if (label === "Strong") return "text-warning";
  if (label === "Watch") return "text-yellow-400/70";
  return "text-destructive/60";
}

const ACTION_CONFIG: Record<RecommendedAction, {
  icon: React.ElementType;
  bg: string;
  text: string;
  border: string;
}> = {
  "Publish Today": {
    icon: SendHorizontal,
    bg: "bg-success/15",
    text: "text-success",
    border: "border-success/25",
  },
  "Hold": {
    icon: Eye,
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-border",
  },
  "Review Price": {
    icon: DollarSign,
    bg: "bg-destructive/10",
    text: "text-destructive/70",
    border: "border-destructive/20",
  },
  "Needs Better Photos": {
    icon: Camera,
    bg: "bg-warning/10",
    text: "text-warning/80",
    border: "border-warning/20",
  },
};

function ActionBadge({ action }: { action: RecommendedAction }) {
  const cfg = ACTION_CONFIG[action];
  const Icon = cfg.icon;
  return (
    <div className={cn(
      "flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-semibold  tracking-wide shrink-0 whitespace-nowrap",
      cfg.bg, cfg.text, cfg.border,
    )}>
      <Icon className="w-2.5 h-2.5" />
      {action}
    </div>
  );
}

function pricingIcon(position: string) {
  if (position === "Below Market") return <ArrowDown className="w-3 h-3 text-success" />;
  if (position === "Above Market") return <ArrowUp className="w-3 h-3 text-destructive/70" />;
  return <Minus className="w-3 h-3 text-muted-foreground" />;
}

function pricingColor(position: string): string {
  if (position === "Below Market") return "text-success";
  if (position === "Above Market") return "text-destructive/70";
  return "text-muted-foreground";
}

function starCount(score: number): number {
  if (score >= 85) return 5;
  if (score >= 70) return 4;
  if (score >= 55) return 3;
  if (score >= 40) return 2;
  return 1;
}

function Stars({ score }: { score: number }) {
  const filled = starCount(score);
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn("w-3 h-3", i < filled ? "text-warning fill-amber-400" : "text-muted-foreground")}
        />
      ))}
    </div>
  );
}

function SubScoreBar({
  label, score, accentClass,
}: {
  label: string;
  score: number | null;
  accentClass: string;
}) {
  const display = score ?? 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-16 shrink-0 font-mono  tracking-wide truncate">{label}</span>
      <div className="flex-1 h-[3px] bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", score == null ? "bg-muted" : accentClass)} style={{ width: `${display}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground font-mono w-6 text-right">{score == null ? "—" : display}</span>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function langBadgeCls(lang: string): string {
  if (lang === "Spanish-first") return "bg-orange-500/15 text-orange-400 border-orange-500/25";
  if (lang === "Bilingual") return "bg-teal-500/15 text-teal-400 border-teal-500/25";
  return "bg-muted text-muted-foreground border-border";
}

function segBadgeCls(seg: string): string {
  const s = seg.toLowerCase();
  if (s.includes("spanish")) return "bg-orange-500/15 text-orange-400 border-orange-500/25";
  if (s.includes("ev") || s.includes("tech")) return "bg-primary/15 text-primary border-primary/25";
  if (s.includes("truck") || s.includes("work")) return "bg-warning/15 text-warning border-warning/25";
  if (s.includes("family") || s.includes("suv")) return "bg-primary/15 text-primary border-primary/25";
  if (s.includes("payment") || s.includes("affordable")) return "bg-success/15 text-success border-success/25";
  return "bg-muted text-muted-foreground border-border";
}

// ── Diversity guardrails (mirrors dailyPlan.ts logic for the Marketplace view) ─

const MAINSTREAM_MAKES_MI = new Set([
  "toyota", "honda", "ford", "chevrolet", "chevy", "gmc",
  "ram", "nissan", "hyundai", "kia", "subaru", "mazda",
]);
const EV_MAKES_MI = new Set(["tesla", "rivian", "lucid", "polestar", "fisker"]);

function isEvOpportunity(v: OpportunityVehicle): boolean {
  return EV_MAKES_MI.has(v.make.toLowerCase()) || v.primarySegment.toLowerCase().includes("ev");
}

function conversationLane(v: OpportunityVehicle): string {
  const text = [
    v.make,
    v.model,
    v.bodyStyle ?? "",
    v.primarySegment,
    v.secondarySegment ?? "",
    v.adAngle,
    v.whyThisAudience,
  ].join(" ").toLowerCase();
  if (isEvOpportunity(v)) return "ev";
  if (/\b(truck|pickup|work|silverado|f-150|f150|ram|tacoma|sierra|colorado)\b/.test(text)) return "truck";
  if (/\b(suv|family|pilot|cr-v|crv|rav4|rogue|escape|explorer|highlander|cx-5|cx5)\b/.test(text)) return "family";
  if ((v.price != null && v.price < 22_000) || /\b(payment|affordable|budget|spanish)\b/.test(text)) return "payment";
  return MAINSTREAM_MAKES_MI.has(v.make.toLowerCase()) ? "mainstream" : "general";
}

function conversationBalancedTop3(pool: OpportunityVehicle[]): OpportunityVehicle[] {
  const selected: OpportunityVehicle[] = [];
  const selectedIds = new Set<number>();

  const hasDifferentMakeAvailable = (make: string) =>
    pool.some((v) => !selectedIds.has(v.vehicleId) && v.make.toLowerCase() !== make.toLowerCase());
  const hasDifferentLaneAvailable = (lane: string) =>
    pool.some((v) => !selectedIds.has(v.vehicleId) && conversationLane(v) !== lane);
  const hasNonEvAvailable = () =>
    pool.some((v) => !selectedIds.has(v.vehicleId) && !isEvOpportunity(v));

  for (const v of pool) {
    if (selected.length >= 3) continue;
    const lane = conversationLane(v);
    const repeatsMake = selected.some((s) => s.make.toLowerCase() === v.make.toLowerCase());
    const repeatsLane = selected.some((s) => conversationLane(s) === lane);
    const repeatsEv = isEvOpportunity(v) && selected.some((s) => isEvOpportunity(s));

    if ((repeatsEv && hasNonEvAvailable()) ||
        (repeatsMake && hasDifferentMakeAvailable(v.make)) ||
        (repeatsLane && hasDifferentLaneAvailable(lane))) {
      continue;
    }

    selected.push(v);
    selectedIds.add(v.vehicleId);
  }

  for (const v of pool) {
    if (selected.length >= 3) break;
    if (!selectedIds.has(v.vehicleId)) {
      selected.push(v);
      selectedIds.add(v.vehicleId);
    }
  }

  return [...selected, ...pool.filter((v) => !selectedIds.has(v.vehicleId))];
}

function applyDiversityTop10(sorted: OpportunityVehicle[]): OpportunityVehicle[] {
  const modelSlots = new Map<string, number>();
  let evCount = 0;
  let mainstreamCount = 0;
  const top10: OpportunityVehicle[] = [];
  const deferred: OpportunityVehicle[] = [];

  for (const v of sorted) {
    const modelKey = `${v.make.toLowerCase()}_${v.model.toLowerCase()}`;
    const slotsTaken = modelSlots.get(modelKey) ?? 0;
    const isEV = isEvOpportunity(v);
    if (top10.length >= 10) { deferred.push(v); continue; }
    if (slotsTaken >= 2) { deferred.push(v); continue; }
    if (isEV && evCount >= 3 && v.demandScore < 90) { deferred.push(v); continue; }
    top10.push(v);
    modelSlots.set(modelKey, slotsTaken + 1);
    if (isEV) evCount++;
    if (MAINSTREAM_MAKES_MI.has(v.make.toLowerCase())) mainstreamCount++;
  }

  // Mainstream backfill
  if (mainstreamCount < 3) {
    for (const v of deferred) {
      if (top10.length >= 10 || mainstreamCount >= 3) break;
      if (!MAINSTREAM_MAKES_MI.has(v.make.toLowerCase())) continue;
      const modelKey = `${v.make.toLowerCase()}_${v.model.toLowerCase()}`;
      if ((modelSlots.get(modelKey) ?? 0) >= 2) continue;
      top10.push(v);
      modelSlots.set(modelKey, (modelSlots.get(modelKey) ?? 0) + 1);
      mainstreamCount++;
    }
  }
  return conversationBalancedTop3(top10);
}

// ── Vehicle Row ───────────────────────────────────────────────────────────────

function VehicleRow({
  vehicle,
  rank,
  onPublish,
}: {
  vehicle: OpportunityVehicle;
  rank: number;
  onPublish?: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const name = `${vehicle.year ?? ""} ${vehicle.make} ${vehicle.model}`.trim();
  const hasSegment = vehicle.primarySegment && vehicle.primarySegment !== "General";

  return (
    <div
      className={cn(
        "border-b border-border last:border-0 transition-colors hover:bg-muted",
        vehicle.demandScore >= 80 && "border-l-2 border-l-green-500/40",
        vehicle.demandScore >= 65 && vehicle.demandScore < 80 && "border-l-2 border-l-amber-500/30",
        vehicle.daysOnLot >= 90 && "border-l-2 border-l-red-500/30",
      )}
    >
      <div className="flex items-center gap-4 px-5 py-3.5">
        {/* Rank */}
        <div className="w-6 shrink-0 text-center">
          <span className={cn(
            "text-[11px] font-semibold tabular-nums",
            rank <= 3 ? "text-warning" : "text-muted-foreground",
          )}>#{rank}</span>
        </div>

        {/* Thumbnail */}
        <div className="w-[68px] h-[48px] shrink-0 rounded-md overflow-hidden bg-muted border border-border">
          {vehicle.thumbnailUrl ? (
            <img src={vehicle.thumbnailUrl} alt={name} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Car className="w-4 h-4 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Vehicle info */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded((e) => !e)}>
          {/* Inline badges */}
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            {hasSegment && (
              <span className={cn("text-[11px] font-semibold px-1.5 py-0.5 rounded border  tracking-wide shrink-0", segBadgeCls(vehicle.primarySegment))}>
                {vehicle.primarySegment}
              </span>
            )}
            {vehicle.suggestedLanguage && vehicle.suggestedLanguage !== "English-first" && (
              <span className={cn("text-[11px] font-semibold px-1.5 py-0.5 rounded border  tracking-wide shrink-0", langBadgeCls(vehicle.suggestedLanguage))}>
                {vehicle.suggestedLanguage}
              </span>
            )}
          </div>
          <p className="text-[13px] font-semibold text-foreground truncate">{name}</p>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-[11px] text-muted-foreground font-mono">
              {vehicle.price != null ? formatCurrency(vehicle.price) : "—"}
              {vehicle.mileage != null ? ` · ${formatMileage(vehicle.mileage)}` : ""}
              {` · ${vehicle.daysOnLot}d lot`}
            </span>
            {vehicle.photoCount > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <ImageIcon className="w-2.5 h-2.5" />{vehicle.photoCount}
              </span>
            )}
            {vehicle.lotLocation && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <MapPin className="w-2.5 h-2.5" />{vehicle.lotLocation}
              </span>
            )}
            {vehicle.missingPrice && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-bold  tracking-wide bg-warning/20 text-warning border border-warning/30">
                No Price
              </span>
            )}
          </div>
          {/* Ad angle */}
          {vehicle.adAngle && (
            <p className="text-xs text-muted-foreground italic truncate mt-0.5">"{vehicle.adAngle}"</p>
          )}
        </div>

        {/* Demand Score (primary) */}
        <div className="shrink-0 flex flex-col items-center gap-1 w-16" onClick={() => setExpanded((e) => !e)}>
          <Stars score={vehicle.demandScore} />
          <div className={cn("text-2xl font-semibold tabular-nums leading-none", scoreColor(vehicle.demandScore))}>
            {vehicle.demandScore}
          </div>
          <span className={cn("text-[11px] font-semibold  tracking-wide", labelColor(vehicle.demandLabel as OpportunityLabel))}>
            {vehicle.demandLabel}
          </span>
        </div>

        {/* Actions */}
        <div className="shrink-0 hidden md:flex flex-col items-end gap-1.5">
          {onPublish && vehicle.recommendedAction === "Publish Today" ? (
            <button
              onClick={(e) => { e.stopPropagation(); onPublish(vehicle.vehicleId); }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-success/15 border border-success/25 text-success text-xs font-semibold  tracking-wide hover:bg-success/25 transition-colors"
            >
              <UploadCloud className="w-3 h-3" />
              Publish Today
            </button>
          ) : (
            <ActionBadge action={vehicle.recommendedAction} />
          )}
          <div className="flex items-center gap-1">
            {pricingIcon(vehicle.pricingPosition)}
            <span className={cn("text-[11px] font-mono", pricingColor(vehicle.pricingPosition))}>
              {vehicle.pricingPosition === "Below Market" ? "below mkt" : vehicle.pricingPosition === "Above Market" ? "above mkt" : "at mkt"}
            </span>
          </div>
        </div>

        <ChevronRight
          className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform cursor-pointer", expanded && "rotate-90")}
          onClick={() => setExpanded((e) => !e)}
        />
      </div>

      {/* Expanded: reason bullets + sub-score bars */}
      {expanded && (
        <div className="px-5 pb-4 pl-[98px]">
          <div className="border border-border rounded-lg p-4 bg-muted space-y-4">
            {/* Demand Signals (Marketplace Demand Engine v1) */}
            {vehicle.demandFactors.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold  tracking-wide text-muted-foreground mb-2">
                  Marketplace Demand Signals
                  {vehicle.demandWeightsVersion && (
                    <span className="ml-2 text-[11px] font-mono text-muted-foreground normal-case tracking-normal">{vehicle.demandWeightsVersion}</span>
                  )}
                </p>
                <ul className="space-y-1.5">
                  {vehicle.demandFactors.map((factor, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full shrink-0 mt-1.5 bg-primary/50" />
                      <span className="text-[11px] leading-relaxed text-muted-foreground">{factor}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Opportunity factors (secondary) */}
            {vehicle.opportunityFactors.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold  tracking-wide text-muted-foreground mb-2">Opportunity Factors</p>
                <ul className="space-y-1.5">
                  {vehicle.opportunityFactors.map((factor, i) => {
                    const isEstimate = factor.includes("internal estimate");
                    const cleanText = factor.replace(" (internal estimate)", "");
                    return (
                      <li key={i} className="flex items-start gap-2">
                        <span className={cn("w-1 h-1 rounded-full shrink-0 mt-1.5", isEstimate ? "bg-muted" : "bg-success/60")} />
                        <span className={cn("text-[11px] leading-relaxed", isEstimate ? "text-muted-foreground" : "text-muted-foreground")}>
                          {cleanText}
                          {isEstimate && (
                            <span className="ml-1 text-[11px] text-muted-foreground font-mono">[est]</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {/* Buyer Segment */}
            {vehicle.primarySegment && vehicle.primarySegment !== "General" && (
              <div className="rounded-lg border border-border bg-muted p-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold  tracking-wide text-muted-foreground mb-1">Buyer Segment</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-bold text-foreground">{vehicle.primarySegment} Buyers</span>
                      {vehicle.secondarySegment && (
                        <span className="text-xs text-muted-foreground">· also {vehicle.secondarySegment}</span>
                      )}
                    </div>
                  </div>
                  <span className={cn(
                    "shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold  tracking-wide",
                    vehicle.suggestedLanguage === "Spanish-first"
                      ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                      : vehicle.suggestedLanguage === "Bilingual"
                      ? "bg-teal-500/20 text-teal-400 border border-teal-500/30"
                      : "bg-muted text-muted-foreground border border-border",
                  )}>
                    {vehicle.suggestedLanguage}
                  </span>
                </div>
                {vehicle.whyThisAudience && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{vehicle.whyThisAudience}</p>
                )}
                {vehicle.adAngle && (
                  <div className="pt-1 border-t border-border">
                    <p className="text-[11px] text-muted-foreground  tracking-wide mb-0.5">Suggested Ad Angle</p>
                    <p className="text-[11px] text-muted-foreground font-medium italic">"{vehicle.adAngle}"</p>
                  </div>
                )}
              </div>
            )}
            {/* Demand signal bars */}
            <div>
              <p className="text-[11px] font-semibold  tracking-wide text-muted-foreground mb-2">Demand Signals (12-factor composite)</p>
              <div className="space-y-1.5">
                <SubScoreBar label="Opportunity" score={vehicle.opportunityScore} accentClass="bg-success/70" />
                <SubScoreBar label="Mkt Popular." score={vehicle.marketplacePopularityScore} accentClass="bg-teal-500/70" />
                <SubScoreBar label="Latino Pref." score={vehicle.latinoPreferenceScore} accentClass="bg-orange-500/70" />
                <SubScoreBar label="Financing" score={vehicle.financingProbabilityScore} accentClass="bg-primary/70" />
                <SubScoreBar label="Engagement" score={vehicle.historicalEngagementScore} accentClass="bg-fuchsia-500/70" />
                <SubScoreBar label="Saturation" score={vehicle.duplicateSaturationScore != null ? 100 - vehicle.duplicateSaturationScore : null} accentClass="bg-rose-500/70" />
              </div>
            </div>
            {/* Opportunity sub-score bars */}
            <div>
              <p className="text-[11px] font-semibold  tracking-wide text-muted-foreground mb-2">Opportunity Sub-scores</p>
              <div className="space-y-1.5">
                <SubScoreBar label="Mkt Demand" score={vehicle.marketDemandScore} accentClass="bg-success/70" />
                <SubScoreBar label="Price" score={vehicle.priceScore} accentClass="bg-primary/70" />
                <SubScoreBar label="Veh Quality" score={vehicle.vehicleQualityScore} accentClass="bg-success/70" />
                <SubScoreBar label="Buyer Seg" score={vehicle.buyerSegmentScore} accentClass="bg-fuchsia-500/70" />
                <SubScoreBar label="Dlr Perf" score={vehicle.dealerPerformanceScore} accentClass="bg-primary/70" />
                <SubScoreBar label="Seasonal" score={vehicle.seasonalScore} accentClass="bg-primary/70" />
                <SubScoreBar label="Buyer" score={vehicle.buyerDemandScore} accentClass="bg-pink-500/70" />
                <SubScoreBar label="Inv Age" score={vehicle.inventoryHealthScore} accentClass="bg-orange-500/70" />
                <SubScoreBar label="Photos" score={vehicle.creativePerformanceScore} accentClass="bg-warning/70" />
              </div>
            </div>
            {/* Action row */}
            <div className="pt-2 border-t border-border flex items-center gap-2">
              <CheckCircle2 className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground">Recommended:</span>
              <ActionBadge action={vehicle.recommendedAction} />
              {vehicle.recommendedDayLabel && vehicle.recommendedTimeLabel && (
                <span className="text-xs text-muted-foreground ml-auto font-mono">
                  Post {vehicle.recommendedDayLabel} @ {vehicle.recommendedTimeLabel}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section containers ────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  eyebrow,
  title,
  accentColor,
  children,
  count,
}: {
  icon: React.ElementType;
  eyebrow: string;
  title: string;
  accentColor: string;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Icon className={cn("w-4 h-4", accentColor)} />
        <div>
          <p className="text-[11px] font-semibold  tracking-wide text-muted-foreground">{eyebrow}</p>
          <div className="flex items-baseline gap-2">
            <h3 className="text-[13px] font-bold text-foreground">{title}</h3>
            {count != null && (
              <span className="text-[11px] text-muted-foreground font-mono">{count} vehicles</span>
            )}
          </div>
        </div>
      </div>
      <div className="border border-border rounded-xl bg-muted overflow-hidden">
        {children}
      </div>
    </div>
  );
}

// ── Compact vehicle row for side sections ─────────────────────────────────────

function CompactRow({
  vehicle,
  showDays,
  showPrice,
}: {
  vehicle: OpportunityVehicle;
  showDays?: boolean;
  showPrice?: boolean;
}) {
  const name = `${vehicle.year ?? ""} ${vehicle.make} ${vehicle.model}`.trim();
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-muted transition-colors">
      <div className="w-[52px] h-[36px] shrink-0 rounded overflow-hidden bg-muted">
        {vehicle.thumbnailUrl ? (
          <img src={vehicle.thumbnailUrl} alt={name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car className="w-3 h-3 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-foreground truncate">{name}</p>
        <p className="text-xs text-muted-foreground font-mono mt-0.5">
          {showDays && `${vehicle.daysOnLot}d on lot`}
          {showDays && showPrice && " · "}
          {showPrice && vehicle.price != null && formatCurrency(vehicle.price)}
        </p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-0.5">
        <span className={cn("text-[13px] font-semibold tabular-nums", scoreColor(vehicle.opportunityScore))}>
          {vehicle.opportunityScore}
        </span>
        {showPrice && (
          <span className={cn("text-[11px] font-semibold  tracking-wide", pricingColor(vehicle.pricingPosition))}>
            {vehicle.pricingPosition === "Below Market" ? "below mkt" :
             vehicle.pricingPosition === "Above Market" ? "above mkt" : "at mkt"}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Insights Strip ─────────────────────────────────────────────────────────────

function InsightKpi({
  label, value, sub, accent, icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex-1 min-w-0 px-5 py-4 border-r border-border last:border-0">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("w-3.5 h-3.5", accent)} />
        <span className="text-[11px] font-semibold  tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className={cn("text-2xl font-semibold tabular-nums leading-none", accent)}>{value}</div>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type ActiveSection = "opportunities" | "market" | "regional" | "insights";

export default function MarketIntelligencePage() {
  const [, setLocation] = useLocation();
  const { data, loading, error, refresh } = useOpportunityData();
  const [activeSection, setActiveSection] = useState<ActiveSection>("opportunities");
  const [refreshing, setRefreshing] = useState(false);
  const [publishNowVehicleId, setPublishNowVehicleId] = useState<number | null>(null);
  const [conflictsExpanded, setConflictsExpanded] = useState(false);

  // Publishing conflicts data (React Query — cached, no extra API call)
  const { selectedLocation } = useDealerLocation();
  const { data: workspacesData } = useListListingWorkspaces({ location: selectedLocation });
  const { data: recsData } = useListMarketplaceRecommendations({ location: selectedLocation });
  const { data: jobsData } = useListPublishingJobs({ location: selectedLocation });

  const conflictsPlan = useMemo(() => {
    if (!workspacesData?.workspaces || !recsData?.recommendations || !jobsData?.jobs) return null;
    return buildDailyMarketplacePlan(
      workspacesData.workspaces,
      recsData.recommendations as never,
      jobsData.jobs,
    );
  }, [workspacesData, recsData, jobsData]);

  const duplicateGroups = conflictsPlan?.duplicateGroups ?? [];
  const protectedCount = duplicateGroups.reduce((sum, g) => sum + g.holdOthers.length, 0);

  const ins = data?.insights;
  const sections = data?.sections;

  async function handleRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  const tabs: Array<{ id: ActiveSection; label: string }> = [
    { id: "opportunities", label: "Best Opportunities" },
    { id: "market", label: "Market Trends" },
    { id: "regional", label: "Regional Demand" },
    { id: "insights", label: "Dealer Insights" },
  ];

  return (
    <AppLayout>
      <div className="flex flex-col h-full overflow-y-auto">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border flex items-start justify-between">
          <div>
            <PageHeader
              eyebrow="MARKETPLACE"
              title="Market Intelligence"
            />
            <p className="text-[12px] text-muted-foreground mt-1 max-w-lg">
              What should I sell next, and why? — DealerPilot ranks every vehicle by lead probability, market demand, and competitive position.
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition disabled:opacity-40"
          >
            <RefreshCw className={cn("w-3 h-3", (loading || refreshing) && "animate-spin")} />
            Refresh
          </button>
        </div>

        {/* Market Pulse KPI strip */}
        {ins && (
          <div className="flex border-b border-border bg-muted">
            <InsightKpi
              icon={Target}
              label="Avg Opportunity"
              value={ins.avgOpportunityScore}
              sub={`across ${ins.totalVehicles} active vehicles`}
              accent="text-success"
            />
            <InsightKpi
              icon={Flame}
              label="Hot Vehicles"
              value={ins.hotCount}
              sub="score ≥ 75"
              accent="text-success"
            />
            <InsightKpi
              icon={AlertTriangle}
              label="Aging Inventory"
              value={ins.agingCount}
              sub="60+ days on lot"
              accent="text-orange-400"
            />
            <InsightKpi
              icon={DollarSign}
              label="Below Market"
              value={ins.belowMarketCount}
              sub="priced competitively"
              accent="text-primary"
            />
            <InsightKpi
              icon={Clock}
              label="Avg Days on Lot"
              value={ins.avgDaysOnLot}
              sub="days"
              accent="text-muted-foreground"
            />
          </div>
        )}

        {/* Season context banner */}
        {ins?.seasonContext && (
          <div className="px-6 py-2.5 border-b border-border flex items-center gap-2 bg-muted">
            <Calendar className="w-3.5 h-3.5 text-warning/60 shrink-0" />
            <span className="text-[11px] text-muted-foreground">{ins.seasonContext}</span>
          </div>
        )}

        {/* Tab strip */}
        <div className="flex border-b border-border px-6 gap-1 bg-muted">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={cn(
                "px-4 py-3 text-xs font-semibold border-b-2 -mb-px transition-colors",
                activeSection === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 px-6 py-6 space-y-8">
          {loading && (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              Computing opportunity scores…
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-48 text-destructive/70 text-sm">
              Failed to load: {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* ── Best Opportunities tab ────────────────────────────────── */}
              {activeSection === "opportunities" && (
                <div className="space-y-8">

                  {/* Publishing Conflicts panel */}
                  {duplicateGroups.length > 0 && (
                    <div className="rounded-xl border border-warning/15 overflow-hidden">
                      <button
                        onClick={() => setConflictsExpanded(v => !v)}
                        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-warning/[0.04] transition-colors"
                      >
                        <ShieldCheck className="w-4 h-4 text-warning/60 shrink-0" />
                        <div className="flex-1 text-left">
                          <p className="text-[12px] font-bold text-warning/70">
                            Publishing Conflicts
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            DealerPilot automatically prevents inventory self-competition.
                          </p>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right hidden sm:block">
                            <p className="text-[11px] font-bold text-warning/60">
                              {duplicateGroups.length} duplicate group{duplicateGroups.length !== 1 ? "s" : ""} detected
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {protectedCount} vehicles protected · Est. +{Math.min(Math.round(protectedCount * 0.45), 28)}% visibility
                            </p>
                          </div>
                          {conflictsExpanded
                            ? <ChevronUp className="w-4 h-4 text-warning/40" />
                            : <ChevronDown className="w-4 h-4 text-warning/40" />
                          }
                        </div>
                      </button>

                      {conflictsExpanded && (
                        <div className="border-t border-warning/10 px-5 pb-4 pt-3 space-y-2">
                          {duplicateGroups.slice(0, 5).map(g => (
                            <div key={g.key} className="flex items-center gap-3 text-[11px]">
                              <span className="text-warning/50 font-bold w-[140px] shrink-0 truncate">
                                {g.make} {g.model}
                              </span>
                              <span className="text-muted-foreground">
                                Publish: {g.publishFirst.label}
                              </span>
                              <span className="text-muted-foreground">·</span>
                              <span className="text-muted-foreground">
                                Hold {g.holdOthers.length} other{g.holdOthers.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                          ))}
                          {duplicateGroups.length > 5 && (
                            <p className="text-xs text-muted-foreground">
                              +{duplicateGroups.length - 5} more groups
                            </p>
                          )}
                          <button
                            onClick={() => setLocation("/marketplace-intelligence/publishing-conflicts")}
                            className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-warning/50 hover:text-warning/80 transition-colors  tracking-wider"
                          >
                            View Duplicate Groups →
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Hot Vehicles — diversity-guardrailed Top 10 */}
                  {(() => {
                    const diverseTop10 = applyDiversityTop10(data.vehicles);
                    return (
                      <Section
                        icon={Flame}
                        eyebrow="TODAY'S SELLING PLAN · DIVERSITY BALANCED"
                        title="Top 10 Opportunity Queue"
                        accentColor="text-success"
                        count={diverseTop10.length}
                      >
                        {diverseTop10.length === 0 ? (
                          <div className="px-5 py-8 text-center text-muted-foreground text-sm">
                            No vehicles scored yet — scores are computed on startup.
                          </div>
                        ) : (
                          diverseTop10.map((v, i) => (
                            <VehicleRow
                              key={v.vehicleId}
                              vehicle={v}
                              rank={i + 1}
                              onPublish={setPublishNowVehicleId}
                            />
                          ))
                        )}
                      </Section>
                    );
                  })()}

                  {/* Fastest Sellers — high dealer performance score */}
                  <Section
                    icon={Trophy}
                    eyebrow="TRACK RECORD"
                    title="Fastest Sellers"
                    accentColor="text-warning"
                    count={Math.min(5, data.vehicles.filter(v => v.dealerPerformanceScore >= 70).length)}
                  >
                    {data.vehicles
                      .filter(v => v.dealerPerformanceScore >= 70)
                      .sort((a, b) => b.dealerPerformanceScore - a.dealerPerformanceScore)
                      .slice(0, 5)
                      .map((v, i) => (
                        <VehicleRow key={v.vehicleId} vehicle={v} rank={i + 1} />
                      ))}
                    {data.vehicles.filter(v => v.dealerPerformanceScore >= 70).length === 0 && (
                      <div className="px-5 py-6 text-center text-muted-foreground text-sm">
                        No performance history yet — data builds as vehicles are published.
                      </div>
                    )}
                  </Section>

                  {/* Highest Opportunity — full ranked list */}
                  <Section
                    icon={BarChart3}
                    eyebrow="ALL ACTIVE VEHICLES"
                    title="Opportunity Rankings"
                    accentColor="text-muted-foreground"
                    count={data.vehicles.length}
                  >
                    {data.vehicles.slice(0, 20).map((v, i) => (
                      <VehicleRow key={v.vehicleId} vehicle={v} rank={i + 1} />
                    ))}
                    {data.vehicles.length > 20 && (
                      <div className="px-5 py-3 text-center text-[11px] text-muted-foreground border-t border-border">
                        Showing top 20 of {data.vehicles.length} vehicles
                      </div>
                    )}
                  </Section>
                </div>
              )}

              {/* ── Market Trends tab ─────────────────────────────────────── */}
              {activeSection === "market" && (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Cooling Inventory */}
                    <Section
                      icon={TrendingDown}
                      eyebrow="AGING INVENTORY"
                      title="Cooling Vehicles"
                      accentColor="text-orange-400"
                      count={sections?.cooling?.length ?? 0}
                    >
                      {sections?.cooling?.map((v) => (
                        <CompactRow key={v.vehicleId} vehicle={v} showDays />
                      ))}
                      {(sections?.cooling?.length ?? 0) === 0 && (
                        <div className="px-5 py-6 text-center text-muted-foreground text-sm">
                          No aging inventory — great turnover rate!
                        </div>
                      )}
                    </Section>

                    {/* Most Competitive Prices */}
                    <Section
                      icon={DollarSign}
                      eyebrow="PRICE COMPETITIVENESS"
                      title="Price Leaders"
                      accentColor="text-primary"
                      count={sections?.competitive?.length ?? 0}
                    >
                      {sections?.competitive?.map((v) => (
                        <CompactRow key={v.vehicleId} vehicle={v} showPrice />
                      ))}
                    </Section>
                  </div>

                  {/* Body type demand chart */}
                  {sections?.bodyTypeTrend && sections.bodyTypeTrend.length > 0 && (
                    <Section
                      icon={BarChart3}
                      eyebrow="SEASONAL DEMAND BY TYPE"
                      title="Market Demand by Body Type"
                      accentColor="text-primary"
                    >
                      <div className="px-5 py-4 space-y-3">
                        {sections.bodyTypeTrend.map((bt) => (
                          <div key={bt.bodyType} className="flex items-center gap-3">
                            <span className="text-[11px] text-muted-foreground w-28 shrink-0">{bt.bodyType}</span>
                            <div className="flex-1 h-[6px] bg-muted rounded-full overflow-hidden">
                              <div
                                className={cn("h-full rounded-full", bt.avgScore >= 80 ? "bg-success/70" : bt.avgScore >= 65 ? "bg-warning/70" : "bg-muted")}
                                style={{ width: `${bt.avgScore}%` }}
                              />
                            </div>
                            <span className={cn("text-[12px] font-bold tabular-nums w-8 text-right", scoreColor(bt.avgScore))}>
                              {bt.avgScore}
                            </span>
                            <span className="text-xs text-muted-foreground w-14 text-right font-mono">
                              {bt.count} vehicles
                            </span>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Pricing distribution */}
                  {ins && (
                    <Section
                      icon={DollarSign}
                      eyebrow="PRICE POSITIONING"
                      title="Inventory vs. Market"
                      accentColor="text-success"
                    >
                      <div className="px-5 py-4 space-y-3">
                        {[
                          { label: "Below Market", count: ins.belowMarketCount, color: "bg-success/70", textColor: "text-success" },
                          { label: "At Market", count: ins.atMarketCount, color: "bg-muted", textColor: "text-muted-foreground" },
                          { label: "Above Market", count: ins.aboveMarketCount, color: "bg-destructive/60", textColor: "text-destructive/70" },
                        ].map((row) => {
                          const pct = ins.totalVehicles > 0
                            ? Math.round((row.count / ins.totalVehicles) * 100) : 0;
                          return (
                            <div key={row.label} className="flex items-center gap-3">
                              <span className="text-[11px] text-muted-foreground w-24 shrink-0">{row.label}</span>
                              <div className="flex-1 h-[6px] bg-muted rounded-full overflow-hidden">
                                <div className={cn("h-full rounded-full", row.color)} style={{ width: `${pct}%` }} />
                              </div>
                              <span className={cn("text-[12px] font-bold tabular-nums w-6 text-right", row.textColor)}>{row.count}</span>
                              <span className="text-xs text-muted-foreground w-8 text-right font-mono">{pct}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </Section>
                  )}
                </div>
              )}

              {/* ── Regional Demand tab ───────────────────────────────────── */}
              {activeSection === "regional" && (
                <div className="space-y-8">
                  <Section
                    icon={MapPin}
                    eyebrow="BY LOT LOCATION"
                    title="Regional Demand"
                    accentColor="text-primary"
                  >
                    {(sections?.byLot?.length ?? 0) === 0 ? (
                      <div className="px-5 py-8 text-center text-muted-foreground text-sm">No lot location data</div>
                    ) : (
                      <div className="px-5 py-4 space-y-4">
                        {sections?.byLot?.map((lot) => (
                          <div key={lot.location} className="flex items-center gap-4 py-2 border-b border-border last:border-0">
                            <MapPin className="w-3.5 h-3.5 text-primary/60 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold text-foreground">{lot.location}</p>
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                {lot.count} vehicles · {lot.hotCount} hot
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-0.5">
                              <span className={cn("text-xl font-semibold tabular-nums", scoreColor(lot.avgOpportunityScore))}>
                                {lot.avgOpportunityScore}
                              </span>
                              <span className="text-[11px] text-muted-foreground  tracking-wide">avg score</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>

                  {/* Vehicles by lot */}
                  {sections?.byLot?.map((lot) => (
                    <Section
                      key={lot.location}
                      icon={MapPin}
                      eyebrow={lot.location.toUpperCase()}
                      title={`Top Opportunities — ${lot.location}`}
                      accentColor="text-primary"
                      count={lot.hotCount}
                    >
                      {data.vehicles
                        .filter(v => (v.lotLocation ?? "Unknown") === lot.location)
                        .slice(0, 5)
                        .map((v, i) => (
                          <VehicleRow key={v.vehicleId} vehicle={v} rank={i + 1} />
                        ))}
                    </Section>
                  ))}
                </div>
              )}

              {/* ── Dealer Insights tab ───────────────────────────────────── */}
              {activeSection === "insights" && (
                <div className="space-y-8">
                  {/* Score distribution */}
                  {ins && (
                    <Section
                      icon={BarChart3}
                      eyebrow="PORTFOLIO HEALTH"
                      title="Opportunity Score Distribution"
                      accentColor="text-primary"
                    >
                      <div className="px-5 py-4 space-y-3">
                        {[
                          { label: "Hot (75–100)", count: data.vehicles.filter(v => v.opportunityScore >= 75).length, color: "bg-success/70", textColor: "text-success" },
                          { label: "Strong (60–74)", count: data.vehicles.filter(v => v.opportunityScore >= 60 && v.opportunityScore < 75).length, color: "bg-warning/70", textColor: "text-warning" },
                          { label: "Watch (45–59)", count: data.vehicles.filter(v => v.opportunityScore >= 45 && v.opportunityScore < 60).length, color: "bg-yellow-400/50", textColor: "text-yellow-400/70" },
                          { label: "Low (<45)", count: data.vehicles.filter(v => v.opportunityScore < 45).length, color: "bg-destructive/40", textColor: "text-destructive/60" },
                        ].map((row) => {
                          const pct = ins.totalVehicles > 0 ? Math.round((row.count / ins.totalVehicles) * 100) : 0;
                          return (
                            <div key={row.label} className="flex items-center gap-3">
                              <span className="text-[11px] text-muted-foreground w-28 shrink-0">{row.label}</span>
                              <div className="flex-1 h-[6px] bg-muted rounded-full overflow-hidden">
                                <div className={cn("h-full rounded-full", row.color)} style={{ width: `${Math.max(pct, 1)}%` }} />
                              </div>
                              <span className={cn("text-[12px] font-bold tabular-nums w-6 text-right", row.textColor)}>{row.count}</span>
                              <span className="text-xs text-muted-foreground w-8 text-right font-mono">{pct}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </Section>
                  )}

                  {/* AI Explanation — what the engine is answering */}
                  <div className="border border-success/15 rounded-xl bg-success/[0.03] p-5">
                    <div className="flex items-start gap-3">
                      <Zap className="w-4 h-4 text-success shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[11px] font-semibold  tracking-wide text-success/60 mb-2">
                          Opportunity Engine v1.0
                        </p>
                        <p className="text-[13px] text-muted-foreground leading-relaxed">
                          DealerPilot no longer asks <em className="text-muted-foreground">"What cars do I have?"</em>
                        </p>
                        <p className="text-[13px] text-foreground font-semibold leading-relaxed mt-1">
                          It answers: <em className="text-success">"What should I sell next, and why?"</em>
                        </p>
                        <p className="text-[12px] text-muted-foreground mt-3 leading-relaxed">
                          Every vehicle is scored on 7 dimensions — Market Demand (30%), Price Competitiveness (20%), Dealer Performance (15%), Inventory Health (10%), Buyer Demand (10%), Seasonality (10%), Creative Performance (5%) — weighted into a single Opportunity Score from 0 to 100.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <PublishNowModal
        vehicleId={publishNowVehicleId}
        onClose={() => setPublishNowVehicleId(null)}
      />
    </AppLayout>
  );
}
