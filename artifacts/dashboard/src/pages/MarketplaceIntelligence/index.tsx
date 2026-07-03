import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useDealerLocation } from "@/context/LocationContext";
import { PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import {
  Flame, TrendingDown, DollarSign, Clock, MapPin, BarChart3,
  Car, Zap, Star, ChevronRight, RefreshCw, ArrowUp, ArrowDown,
  Minus, Target, Trophy, AlertTriangle, Calendar,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  opportunityScore: number;
  marketDemandScore: number;
  priceScore: number;
  seasonalScore: number;
  dealerPerformanceScore: number;
  buyerDemandScore: number;
  inventoryHealthScore: number;
  creativePerformanceScore: number;
  pricingPosition: string;
  daysOnLot: number;
  opportunityFactors: string[];
  strategyName: string | null;
  recommendedDayLabel: string | null;
  recommendedTimeLabel: string | null;
  expectedLeadQuality: string;
  confidenceScore: number;
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
  if (score >= 80) return "text-green-400";
  if (score >= 65) return "text-amber-400";
  if (score >= 50) return "text-yellow-400/80";
  return "text-red-400/70";
}

function scoreBg(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 65) return "bg-amber-400";
  if (score >= 50) return "bg-yellow-400/80";
  return "bg-red-400/60";
}

function scoreLabel(score: number): string {
  if (score >= 85) return "ELITE";
  if (score >= 80) return "HOT";
  if (score >= 70) return "STRONG";
  if (score >= 60) return "WARM";
  if (score >= 50) return "FAIR";
  return "COLD";
}

function pricingIcon(position: string) {
  if (position === "Below Market") return <ArrowDown className="w-3 h-3 text-green-400" />;
  if (position === "Above Market") return <ArrowUp className="w-3 h-3 text-red-400/70" />;
  return <Minus className="w-3 h-3 text-white/40" />;
}

function pricingColor(position: string): string {
  if (position === "Below Market") return "text-green-400";
  if (position === "Above Market") return "text-red-400/70";
  return "text-white/40";
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
          className={cn("w-3 h-3", i < filled ? "text-amber-400 fill-amber-400" : "text-white/10")}
        />
      ))}
    </div>
  );
}

function SubScoreBar({
  label, score, accentClass,
}: {
  label: string;
  score: number;
  accentClass: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-white/30 w-16 shrink-0 font-mono uppercase tracking-wide truncate">{label}</span>
      <div className="flex-1 h-[3px] bg-white/[0.06] rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", accentClass)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[9px] text-white/40 font-mono w-6 text-right">{score}</span>
    </div>
  );
}

// ── Vehicle Row ───────────────────────────────────────────────────────────────

function VehicleRow({
  vehicle,
  rank,
  showSubScores,
}: {
  vehicle: OpportunityVehicle;
  rank: number;
  showSubScores?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const name = `${vehicle.year ?? ""} ${vehicle.make} ${vehicle.model}`.trim();

  return (
    <div
      className={cn(
        "border-b border-white/[0.04] last:border-0 transition-colors hover:bg-white/[0.015] cursor-pointer",
        vehicle.opportunityScore >= 80 && "border-l-2 border-l-green-500/40",
        vehicle.opportunityScore >= 65 && vehicle.opportunityScore < 80 && "border-l-2 border-l-amber-500/30",
        vehicle.daysOnLot >= 90 && "border-l-2 border-l-red-500/30",
      )}
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-center gap-4 px-5 py-3.5">
        {/* Rank */}
        <div className="w-6 shrink-0 text-center">
          <span className={cn(
            "text-[11px] font-black tabular-nums",
            rank <= 3 ? "text-amber-400" : "text-white/20",
          )}>#{rank}</span>
        </div>

        {/* Thumbnail */}
        <div className="w-[68px] h-[48px] shrink-0 rounded-md overflow-hidden bg-white/[0.03] border border-white/[0.05]">
          {vehicle.thumbnailUrl ? (
            <img src={vehicle.thumbnailUrl} alt={name} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Car className="w-4 h-4 text-white/10" />
            </div>
          )}
        </div>

        {/* Vehicle info */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-white/80 truncate">{name}</p>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-[11px] text-white/35 font-mono">
              {vehicle.price != null ? formatCurrency(vehicle.price) : "—"}
              {vehicle.mileage != null ? ` · ${vehicle.mileage.toLocaleString()} mi` : ""}
            </span>
            {vehicle.bodyStyle && (
              <span className="text-[10px] text-white/20">{vehicle.bodyStyle}</span>
            )}
            {vehicle.lotLocation && (
              <span className="flex items-center gap-0.5 text-[10px] text-white/20">
                <MapPin className="w-2.5 h-2.5" />{vehicle.lotLocation}
              </span>
            )}
          </div>
          {/* Factors */}
          {vehicle.opportunityFactors.length > 0 && (
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {vehicle.opportunityFactors.slice(0, 3).map((f, i) => (
                <span key={i} className="text-[9px] font-black uppercase tracking-[0.18em] text-white/30 border border-white/[0.06] rounded px-1.5 py-0.5">
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Opportunity Score */}
        <div className="shrink-0 flex flex-col items-center gap-1 w-20">
          <Stars score={vehicle.opportunityScore} />
          <div className={cn("text-2xl font-black tabular-nums leading-none", scoreColor(vehicle.opportunityScore))}>
            {vehicle.opportunityScore}
          </div>
          <span className={cn("text-[8px] font-black uppercase tracking-[0.2em]", scoreColor(vehicle.opportunityScore))}>
            {scoreLabel(vehicle.opportunityScore)}
          </span>
          <div className="h-[2px] w-16 bg-white/[0.06] rounded-full overflow-hidden mt-0.5">
            <div className={cn("h-full rounded-full", scoreBg(vehicle.opportunityScore))}
              style={{ width: `${vehicle.opportunityScore}%` }} />
          </div>
        </div>

        {/* Pricing position */}
        <div className="shrink-0 hidden md:flex flex-col items-center gap-1 w-20">
          {pricingIcon(vehicle.pricingPosition)}
          <span className={cn("text-[9px] font-black uppercase tracking-[0.14em] text-center leading-tight", pricingColor(vehicle.pricingPosition))}>
            {vehicle.pricingPosition}
          </span>
          <span className="text-[9px] text-white/20 font-mono">{vehicle.daysOnLot}d lot</span>
        </div>

        <ChevronRight className={cn("w-3.5 h-3.5 text-white/15 shrink-0 transition-transform", expanded && "rotate-90")} />
      </div>

      {/* Expanded sub-scores */}
      {expanded && (
        <div className="px-5 pb-4 pl-[68px]">
          <div className="border border-white/[0.05] rounded-lg p-4 bg-white/[0.01] space-y-2">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/25 mb-3">Score Breakdown</p>
            <SubScoreBar label="Mkt Demand" score={vehicle.marketDemandScore} accentClass="bg-green-500/70" />
            <SubScoreBar label="Price" score={vehicle.priceScore} accentClass="bg-blue-500/70" />
            <SubScoreBar label="Seasonal" score={vehicle.seasonalScore} accentClass="bg-cyan-500/70" />
            <SubScoreBar label="Dlr Perf" score={vehicle.dealerPerformanceScore} accentClass="bg-violet-500/70" />
            <SubScoreBar label="Buyer" score={vehicle.buyerDemandScore} accentClass="bg-pink-500/70" />
            <SubScoreBar label="Inv Health" score={vehicle.inventoryHealthScore} accentClass="bg-orange-500/70" />
            <SubScoreBar label="Creative" score={vehicle.creativePerformanceScore} accentClass="bg-amber-500/70" />
            {vehicle.strategyName && (
              <div className="mt-3 pt-3 border-t border-white/[0.05] flex items-center gap-2">
                <Zap className="w-3 h-3 text-green-400/60 shrink-0" />
                <span className="text-[10px] text-white/40">{vehicle.strategyName}</span>
                {vehicle.recommendedDayLabel && vehicle.recommendedTimeLabel && (
                  <span className="text-[10px] text-white/20 ml-auto">
                    Post {vehicle.recommendedDayLabel} at {vehicle.recommendedTimeLabel}
                  </span>
                )}
              </div>
            )}
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
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/25">{eyebrow}</p>
          <div className="flex items-baseline gap-2">
            <h3 className="text-[13px] font-bold text-white/75">{title}</h3>
            {count != null && (
              <span className="text-[11px] text-white/30 font-mono">{count} vehicles</span>
            )}
          </div>
        </div>
      </div>
      <div className="border border-white/[0.05] rounded-xl bg-white/[0.01] overflow-hidden">
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
    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015] transition-colors">
      <div className="w-[52px] h-[36px] shrink-0 rounded overflow-hidden bg-white/[0.03]">
        {vehicle.thumbnailUrl ? (
          <img src={vehicle.thumbnailUrl} alt={name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car className="w-3 h-3 text-white/10" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-white/70 truncate">{name}</p>
        <p className="text-[10px] text-white/30 font-mono mt-0.5">
          {showDays && `${vehicle.daysOnLot}d on lot`}
          {showDays && showPrice && " · "}
          {showPrice && vehicle.price != null && formatCurrency(vehicle.price)}
        </p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-0.5">
        <span className={cn("text-[13px] font-black tabular-nums", scoreColor(vehicle.opportunityScore))}>
          {vehicle.opportunityScore}
        </span>
        {showPrice && (
          <span className={cn("text-[9px] font-black uppercase tracking-[0.12em]", pricingColor(vehicle.pricingPosition))}>
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
    <div className="flex-1 min-w-0 px-5 py-4 border-r border-white/[0.04] last:border-0">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("w-3.5 h-3.5", accent)} />
        <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/25">{label}</span>
      </div>
      <div className={cn("text-2xl font-black tabular-nums leading-none", accent)}>{value}</div>
      {sub && <p className="text-[10px] text-white/30 mt-1">{sub}</p>}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type ActiveSection = "opportunities" | "market" | "regional" | "insights";

export default function MarketIntelligencePage() {
  const { data, loading, error, refresh } = useOpportunityData();
  const [activeSection, setActiveSection] = useState<ActiveSection>("opportunities");
  const [refreshing, setRefreshing] = useState(false);

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
        <div className="px-6 pt-6 pb-4 border-b border-white/[0.05] flex items-start justify-between">
          <div>
            <PageHeader
              eyebrow="MARKETPLACE"
              title="Market Intelligence"
            />
            <p className="text-[12px] text-white/35 mt-1 max-w-lg">
              What should I sell next, and why? — DealerPilot ranks every vehicle by lead probability, market demand, and competitive position.
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-white/[0.08] text-[11px] text-white/40 hover:text-white/70 hover:border-white/[0.15] transition-all disabled:opacity-40"
          >
            <RefreshCw className={cn("w-3 h-3", (loading || refreshing) && "animate-spin")} />
            Refresh
          </button>
        </div>

        {/* Market Pulse KPI strip */}
        {ins && (
          <div className="flex border-b border-white/[0.05] bg-white/[0.005]">
            <InsightKpi
              icon={Target}
              label="Avg Opportunity"
              value={ins.avgOpportunityScore}
              sub={`across ${ins.totalVehicles} active vehicles`}
              accent="text-green-400"
            />
            <InsightKpi
              icon={Flame}
              label="Hot Vehicles"
              value={ins.hotCount}
              sub="score ≥ 75"
              accent="text-green-400"
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
              accent="text-blue-400"
            />
            <InsightKpi
              icon={Clock}
              label="Avg Days on Lot"
              value={ins.avgDaysOnLot}
              sub="days"
              accent="text-white/50"
            />
          </div>
        )}

        {/* Season context banner */}
        {ins?.seasonContext && (
          <div className="px-6 py-2.5 border-b border-white/[0.04] flex items-center gap-2 bg-white/[0.005]">
            <Calendar className="w-3.5 h-3.5 text-amber-400/60 shrink-0" />
            <span className="text-[11px] text-white/40">{ins.seasonContext}</span>
          </div>
        )}

        {/* Tab strip */}
        <div className="flex border-b border-white/[0.05] px-6 gap-1 bg-white/[0.005]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={cn(
                "px-4 py-3 text-[11px] font-bold tracking-wide border-b-2 -mb-px transition-all",
                activeSection === tab.id
                  ? "border-green-500 text-green-400"
                  : "border-transparent text-white/30 hover:text-white/55",
              )}
            >
              {tab.label.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 px-6 py-6 space-y-8">
          {loading && (
            <div className="flex items-center justify-center h-48 text-white/30 text-sm">
              Computing opportunity scores…
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-48 text-red-400/70 text-sm">
              Failed to load: {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* ── Best Opportunities tab ────────────────────────────────── */}
              {activeSection === "opportunities" && (
                <div className="space-y-8">
                  {/* Hot Vehicles — top opportunity scores */}
                  <Section
                    icon={Flame}
                    eyebrow="HIGH OPPORTUNITY"
                    title="Hot Vehicles"
                    accentColor="text-green-400"
                    count={sections?.hot.length ?? 0}
                  >
                    {sections?.hot.length === 0 ? (
                      <div className="px-5 py-8 text-center text-white/30 text-sm">
                        No vehicles scored yet — scores are computed on startup.
                      </div>
                    ) : (
                      sections?.hot.map((v, i) => (
                        <VehicleRow key={v.vehicleId} vehicle={v} rank={i + 1} />
                      ))
                    )}
                  </Section>

                  {/* Fastest Sellers — high dealer performance score */}
                  <Section
                    icon={Trophy}
                    eyebrow="TRACK RECORD"
                    title="Fastest Sellers"
                    accentColor="text-amber-400"
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
                      <div className="px-5 py-6 text-center text-white/30 text-sm">
                        No performance history yet — data builds as vehicles are published.
                      </div>
                    )}
                  </Section>

                  {/* Highest Opportunity — full ranked list */}
                  <Section
                    icon={BarChart3}
                    eyebrow="ALL ACTIVE VEHICLES"
                    title="Opportunity Rankings"
                    accentColor="text-white/40"
                    count={data.vehicles.length}
                  >
                    {data.vehicles.slice(0, 20).map((v, i) => (
                      <VehicleRow key={v.vehicleId} vehicle={v} rank={i + 1} />
                    ))}
                    {data.vehicles.length > 20 && (
                      <div className="px-5 py-3 text-center text-[11px] text-white/25 border-t border-white/[0.04]">
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
                      count={sections?.cooling.length ?? 0}
                    >
                      {sections?.cooling.map((v) => (
                        <CompactRow key={v.vehicleId} vehicle={v} showDays />
                      ))}
                      {(sections?.cooling.length ?? 0) === 0 && (
                        <div className="px-5 py-6 text-center text-white/30 text-sm">
                          No aging inventory — great turnover rate!
                        </div>
                      )}
                    </Section>

                    {/* Most Competitive Prices */}
                    <Section
                      icon={DollarSign}
                      eyebrow="PRICE COMPETITIVENESS"
                      title="Price Leaders"
                      accentColor="text-blue-400"
                      count={sections?.competitive.length ?? 0}
                    >
                      {sections?.competitive.map((v) => (
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
                      accentColor="text-cyan-400"
                    >
                      <div className="px-5 py-4 space-y-3">
                        {sections.bodyTypeTrend.map((bt) => (
                          <div key={bt.bodyType} className="flex items-center gap-3">
                            <span className="text-[11px] text-white/40 w-28 shrink-0">{bt.bodyType}</span>
                            <div className="flex-1 h-[6px] bg-white/[0.06] rounded-full overflow-hidden">
                              <div
                                className={cn("h-full rounded-full", bt.avgScore >= 80 ? "bg-green-500/70" : bt.avgScore >= 65 ? "bg-amber-400/70" : "bg-white/20")}
                                style={{ width: `${bt.avgScore}%` }}
                              />
                            </div>
                            <span className={cn("text-[12px] font-bold tabular-nums w-8 text-right", scoreColor(bt.avgScore))}>
                              {bt.avgScore}
                            </span>
                            <span className="text-[10px] text-white/25 w-14 text-right font-mono">
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
                      accentColor="text-green-400"
                    >
                      <div className="px-5 py-4 space-y-3">
                        {[
                          { label: "Below Market", count: ins.belowMarketCount, color: "bg-green-500/70", textColor: "text-green-400" },
                          { label: "At Market", count: ins.atMarketCount, color: "bg-white/20", textColor: "text-white/40" },
                          { label: "Above Market", count: ins.aboveMarketCount, color: "bg-red-500/60", textColor: "text-red-400/70" },
                        ].map((row) => {
                          const pct = ins.totalVehicles > 0
                            ? Math.round((row.count / ins.totalVehicles) * 100) : 0;
                          return (
                            <div key={row.label} className="flex items-center gap-3">
                              <span className="text-[11px] text-white/40 w-24 shrink-0">{row.label}</span>
                              <div className="flex-1 h-[6px] bg-white/[0.06] rounded-full overflow-hidden">
                                <div className={cn("h-full rounded-full", row.color)} style={{ width: `${pct}%` }} />
                              </div>
                              <span className={cn("text-[12px] font-bold tabular-nums w-6 text-right", row.textColor)}>{row.count}</span>
                              <span className="text-[10px] text-white/20 w-8 text-right font-mono">{pct}%</span>
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
                    accentColor="text-cyan-400"
                  >
                    {(sections?.byLot.length ?? 0) === 0 ? (
                      <div className="px-5 py-8 text-center text-white/30 text-sm">No lot location data</div>
                    ) : (
                      <div className="px-5 py-4 space-y-4">
                        {sections?.byLot.map((lot) => (
                          <div key={lot.location} className="flex items-center gap-4 py-2 border-b border-white/[0.04] last:border-0">
                            <MapPin className="w-3.5 h-3.5 text-cyan-400/60 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold text-white/70">{lot.location}</p>
                              <p className="text-[10px] text-white/30 font-mono mt-0.5">
                                {lot.count} vehicles · {lot.hotCount} hot
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-0.5">
                              <span className={cn("text-xl font-black tabular-nums", scoreColor(lot.avgOpportunityScore))}>
                                {lot.avgOpportunityScore}
                              </span>
                              <span className="text-[9px] text-white/25 uppercase tracking-wide">avg score</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>

                  {/* Vehicles by lot */}
                  {sections?.byLot.map((lot) => (
                    <Section
                      key={lot.location}
                      icon={MapPin}
                      eyebrow={lot.location.toUpperCase()}
                      title={`Top Opportunities — ${lot.location}`}
                      accentColor="text-cyan-400"
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
                      accentColor="text-violet-400"
                    >
                      <div className="px-5 py-4 space-y-3">
                        {[
                          { label: "Elite (85–100)", count: data.vehicles.filter(v => v.opportunityScore >= 85).length, color: "bg-green-500/80", textColor: "text-green-400" },
                          { label: "Hot (80–84)", count: data.vehicles.filter(v => v.opportunityScore >= 80 && v.opportunityScore < 85).length, color: "bg-green-500/50", textColor: "text-green-400/70" },
                          { label: "Strong (70–79)", count: data.vehicles.filter(v => v.opportunityScore >= 70 && v.opportunityScore < 80).length, color: "bg-amber-400/70", textColor: "text-amber-400" },
                          { label: "Warm (60–69)", count: data.vehicles.filter(v => v.opportunityScore >= 60 && v.opportunityScore < 70).length, color: "bg-yellow-400/50", textColor: "text-yellow-400/70" },
                          { label: "Fair (50–59)", count: data.vehicles.filter(v => v.opportunityScore >= 50 && v.opportunityScore < 60).length, color: "bg-white/20", textColor: "text-white/40" },
                          { label: "Cold (<50)", count: data.vehicles.filter(v => v.opportunityScore < 50).length, color: "bg-red-500/40", textColor: "text-red-400/60" },
                        ].map((row) => {
                          const pct = ins.totalVehicles > 0 ? Math.round((row.count / ins.totalVehicles) * 100) : 0;
                          return (
                            <div key={row.label} className="flex items-center gap-3">
                              <span className="text-[11px] text-white/40 w-28 shrink-0">{row.label}</span>
                              <div className="flex-1 h-[6px] bg-white/[0.06] rounded-full overflow-hidden">
                                <div className={cn("h-full rounded-full", row.color)} style={{ width: `${Math.max(pct, 1)}%` }} />
                              </div>
                              <span className={cn("text-[12px] font-bold tabular-nums w-6 text-right", row.textColor)}>{row.count}</span>
                              <span className="text-[10px] text-white/20 w-8 text-right font-mono">{pct}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </Section>
                  )}

                  {/* AI Explanation — what the engine is answering */}
                  <div className="border border-green-500/15 rounded-xl bg-green-500/[0.03] p-5">
                    <div className="flex items-start gap-3">
                      <Zap className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.22em] text-green-400/60 mb-2">
                          Opportunity Engine v1.0
                        </p>
                        <p className="text-[13px] text-white/60 leading-relaxed">
                          DealerPilot no longer asks <em className="text-white/40">"What cars do I have?"</em>
                        </p>
                        <p className="text-[13px] text-white/80 font-semibold leading-relaxed mt-1">
                          It answers: <em className="text-green-400">"What should I sell next, and why?"</em>
                        </p>
                        <p className="text-[12px] text-white/35 mt-3 leading-relaxed">
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
    </AppLayout>
  );
}
