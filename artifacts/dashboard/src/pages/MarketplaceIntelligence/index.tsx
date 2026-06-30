import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetMarketplaceDashboard,
  useGetMarketplaceDashboardHealth,
  useListMarketplaceRecommendations,
  useBulkSchedulePublishing,
} from "@workspace/api-client-react";
import { SectionCard, PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import {
  TrendingUp,
  MessageSquare,
  Flame,
  BarChart3,
  Clock,
  Camera,
  Star,
  AlertTriangle,
  Lightbulb,
  CalendarCheck,
  Zap,
  ChevronDown,
  ChevronUp,
  Target,
  ArrowRight,
  UploadCloud,
  Plus,
  Sparkles,
  Loader2,
  CalendarClock,
  Info,
  Wifi,
  WifiOff,
  Database,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Copy,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "recommendations", label: "Strategic Recommendations", icon: Lightbulb },
  { key: "downpayment", label: "Down Payment", icon: TrendingUp },
  { key: "posting", label: "Posting Time", icon: Clock },
  { key: "creative", label: "Creative Performance", icon: Camera },
  { key: "weak", label: "Weak Listings", icon: AlertTriangle },
  { key: "nextbatch", label: "Next Batch", icon: CalendarCheck },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Strategy name → color scheme
function strategyColor(name: string | null | undefined): { bg: string; text: string; border: string } {
  if (!name) return { bg: "bg-white/5", text: "text-muted-foreground", border: "border-white/10" };
  const n = name.toLowerCase();
  if (n.includes("truck")) return { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/25" };
  if (n.includes("luxury")) return { bg: "bg-violet-500/15", text: "text-violet-400", border: "border-violet-500/25" };
  if (n.includes("premium suv")) return { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/25" };
  if (n.includes("fast turn")) return { bg: "bg-green-500/15", text: "text-green-400", border: "border-green-500/25" };
  if (n.includes("serious buyer")) return { bg: "bg-primary/15", text: "text-primary", border: "border-primary/25" };
  if (n.includes("price review")) return { bg: "bg-destructive/15", text: "text-destructive", border: "border-destructive/25" };
  if (n.includes("performance")) return { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/25" };
  if (n.includes("high-value")) return { bg: "bg-violet-500/15", text: "text-violet-400", border: "border-violet-500/25" };
  return { bg: "bg-primary/15", text: "text-primary", border: "border-primary/25" };
}

function qualityBadge(q: string | null | undefined) {
  if (q === "hot") return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">🔥 Hot</Badge>;
  if (q === "warm") return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">🌡 Warm</Badge>;
  return <Badge className="bg-white/5 text-muted-foreground border-white/10 text-xs">❄ Cold</Badge>;
}

function photoBadge(strat: string) {
  if (strat === "ai_creative")
    return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">AI Creative</Badge>;
  if (strat === "mixed")
    return <Badge className="bg-teal-500/20 text-teal-400 border-teal-500/30 text-xs">Mixed</Badge>;
  return <Badge className="bg-white/5 text-muted-foreground border-white/10 text-xs">Original</Badge>;
}

function strategyBadge(strat: string) {
  if (strat === "down_payment")
    return <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">Down Payment</Badge>;
  if (strat === "price_review")
    return <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-xs">Price Review</Badge>;
  return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">Full Price</Badge>;
}

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-success" : score >= 60 ? "bg-yellow-400" : "bg-muted-foreground";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
      </div>
      <span className={cn("text-xs font-medium w-7 text-right", score >= 80 ? "text-success" : score >= 60 ? "text-yellow-400" : "text-muted-foreground")}>
        {score}%
      </span>
    </div>
  );
}

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.round((score / max) * 100);
  const color = pct >= 70 ? "bg-success" : pct >= 40 ? "bg-yellow-400" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-6 text-right">{score}</span>
    </div>
  );
}

// Rich v2 recommendation card
type Rec = {
  vehicleId: number;
  year: number | null;
  make: string;
  model: string;
  price: number | null;
  bodyStyle: string | null;
  recommendedPriceStrategy: string;
  recommendedDownPayment: number | null;
  recommendedPhotoStrategy: string;
  recommendedDayLabel: string | null;
  recommendedTimeLabel: string | null;
  confidenceScore: number;
  expectedLeadQuality: string | null;
  strategyName: string | null;
  reason: string | null;
  supportingSignals: string[];
  expectedImpact: string | null;
  actionCta: string | null;
};

function StrategyCard({
  rec,
  onPublishNow,
  onAddToBatch,
  isPublishingThis,
}: {
  rec: Rec;
  onPublishNow: (id: number) => void;
  onAddToBatch: (id: number) => void;
  isPublishingThis: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const colors = strategyColor(rec.strategyName);
  const hasV2 = Boolean(rec.strategyName);

  return (
    <div className={cn(
      "rounded-xl border transition-all",
      "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.10]",
    )}>
      {/* Header row */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Strategy name badge */}
        <div className="shrink-0">
          {hasV2 ? (
            <span className={cn("inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border", colors.bg, colors.text, colors.border)}>
              {rec.strategyName}
            </span>
          ) : (
            strategyBadge(rec.recommendedPriceStrategy)
          )}
        </div>

        {/* Vehicle */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white truncate">
            {rec.year} {rec.make} {rec.model}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            {rec.price != null && <span>{formatCurrency(rec.price)}</span>}
            {rec.bodyStyle && <span>· {rec.bodyStyle}</span>}
            {rec.recommendedDownPayment != null && (
              <span className="text-primary font-medium">· {formatCurrency(rec.recommendedDownPayment)} down</span>
            )}
          </div>
        </div>

        {/* Right-side badges */}
        <div className="flex items-center gap-3 shrink-0">
          {qualityBadge(rec.expectedLeadQuality)}
          {photoBadge(rec.recommendedPhotoStrategy)}
          <div className="w-24 hidden sm:block">
            <ConfidenceBar score={rec.confidenceScore} />
          </div>
        </div>

        {/* Action buttons — stop propagation so they don't toggle expand */}
        <div
          className="flex items-center gap-1.5 shrink-0 ml-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs gap-1 border-success/35 text-success hover:bg-success/10 whitespace-nowrap"
            disabled={isPublishingThis}
            onClick={() => onPublishNow(rec.vehicleId)}
          >
            {isPublishingThis ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <UploadCloud className="w-3 h-3" />
            )}
            Publish Now
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs gap-1 border-primary/35 text-primary hover:bg-primary/10 whitespace-nowrap"
            onClick={() => onAddToBatch(rec.vehicleId)}
          >
            <Plus className="w-3 h-3" />
            Add to Batch
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => toast({ title: "Schedule", description: "Open Marketplace AI → select vehicle → schedule publishing." })}
          >
            <CalendarClock className="w-3 h-3" />
            Schedule
          </Button>
        </div>

        {expanded
          ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        }
      </div>

      {/* Expanded v2 detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/[0.05] pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Reason */}
            {rec.reason && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Why this strategy</div>
                <p className="text-sm text-white/80 leading-relaxed">{rec.reason}</p>
              </div>
            )}

            {/* Supporting signals */}
            {rec.supportingSignals && rec.supportingSignals.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Supporting Signals</div>
                <div className="flex flex-wrap gap-1.5">
                  {rec.supportingSignals.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-xs text-white/70">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Expected impact */}
            {rec.expectedImpact && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/15 flex items-start gap-2.5">
                <Target className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-primary mb-1">Expected Impact</div>
                  <div className="text-xs text-white/80">{rec.expectedImpact}</div>
                </div>
              </div>
            )}

            {/* Action CTA */}
            {rec.actionCta && (
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-start gap-2.5">
                <ArrowRight className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-success mb-1">Action</div>
                  <div className="text-xs text-white/80">{rec.actionCta}</div>
                </div>
              </div>
            )}
          </div>

          {/* Posting timing */}
          {(rec.recommendedDayLabel || rec.recommendedTimeLabel) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              Best post time: <span className="text-white font-medium">{rec.recommendedDayLabel} at {rec.recommendedTimeLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── KPI source badge ────────────────────────────────────────────────────────

type KpiSource = "live_data" | "historical" | "ai_prediction" | "estimated" | "no_data";

const SOURCE_META: Record<KpiSource, { label: string; color: string; bg: string; border: string; icon: React.ElementType }> = {
  live_data: { label: "Live Data", color: "text-success", bg: "bg-success/10", border: "border-success/20", icon: Activity },
  historical: { label: "Historical", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", icon: Clock },
  ai_prediction: { label: "AI Prediction", color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20", icon: Sparkles },
  estimated: { label: "Estimated", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", icon: Zap },
  no_data: { label: "No Data", color: "text-muted-foreground", bg: "bg-secondary/30", border: "border-border/30", icon: XCircle },
};

function KpiCard({
  label,
  icon: Icon,
  iconColor,
  displayValue,
  source,
  note,
  hasMock,
}: {
  label: string;
  icon: React.ElementType;
  iconColor: string;
  value: number | null;
  displayValue: string;
  source: KpiSource;
  note: string;
  hasMock: boolean;
}) {
  const src = SOURCE_META[source];
  const SrcIcon = src.icon;
  const isNoData = source === "no_data";

  return (
    <Card className="bg-white/[0.02] border-white/[0.06] relative overflow-hidden">
      {hasMock && (
        <div className="absolute top-0 right-0 w-0 h-0 border-t-[28px] border-l-[28px] border-t-amber-500/60 border-l-transparent" title="Contains model data" />
      )}
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className={cn("p-2 rounded-lg bg-white/[0.04]", iconColor)}>
            <Icon className="w-4 h-4" />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-muted-foreground/50 hover:text-muted-foreground transition-colors mt-0.5">
                <Info className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
              <p>{note || "No calculation note available."}</p>
              {hasMock && (
                <p className="mt-1.5 text-amber-400 flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3" />
                  Seeded model data present. This metric excludes it.
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className={cn("text-2xl font-bold mb-1", isNoData ? "text-muted-foreground/50 text-base" : "text-white")}>
          {displayValue}
        </div>
        <div className="text-xs text-muted-foreground mb-2">{label}</div>

        <div className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border",
          src.bg, src.color, src.border,
        )}>
          <SrcIcon className="w-2.5 h-2.5" />
          {src.label}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Dashboard Health Panel ───────────────────────────────────────────────────

import type { MarketplaceDashboardHealthResponse } from "@workspace/api-client-react";

function DashboardHealthPanel({
  health,
  isLoading,
  hasMockData,
}: {
  health: MarketplaceDashboardHealthResponse | null;
  isLoading: boolean;
  hasMockData: boolean;
}) {
  const [open, setOpen] = useState(false);

  const statusDot = (connected: boolean) => (
    <span className={cn("w-2 h-2 rounded-full inline-block shrink-0", connected ? "bg-success" : "bg-destructive/70")} />
  );

  const fmt = (iso: string | null) => {
    if (!iso) return "Never";
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className={cn(
      "rounded-xl border transition-all",
      hasMockData
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-border/40 bg-white/[0.02]",
    )}>
      {/* Header row — always visible */}
      <button
        className="w-full flex items-center justify-between px-5 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2.5">
          <Database className={cn("w-4 h-4", hasMockData ? "text-amber-400" : "text-primary")} />
          <span className="text-sm font-semibold text-foreground">Dashboard Health</span>
          {hasMockData && (
            <Badge variant="outline" className="text-[10px] font-bold px-2 py-0 bg-amber-500/10 text-amber-400 border-amber-500/25 gap-1">
              <ShieldAlert className="w-2.5 h-2.5" />
              Mock data in analytics
            </Badge>
          )}
          {!hasMockData && !isLoading && (
            <Badge variant="outline" className="text-[10px] font-bold px-2 py-0 bg-success/10 text-success border-success/25 gap-1">
              <CheckCircle2 className="w-2.5 h-2.5" />
              All metrics real
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {!isLoading && health && (
            <>
              <span className="flex items-center gap-1.5">
                {statusDot(health.inventoryCount > 0)}
                {health.inventoryCount} vehicles
              </span>
              <span className="flex items-center gap-1.5">
                {statusDot(health.marketplaceListingCount > 0)}
                {health.marketplaceListingCount} listings
              </span>
              <span className="flex items-center gap-1.5">
                {statusDot(health.conversationsCount > 0)}
                {health.conversationsCount} conversations
              </span>
            </>
          )}
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="px-5 pb-5 border-t border-border/30 pt-4">
          {isLoading || !health ? (
            <div className="text-muted-foreground text-sm">Loading health data…</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {/* Data sources */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Data Sources</div>
                {(["Inventory XML Feed", "Marketplace Listings", "Messenger Conversations", "CRM Leads"] as const).map((src) => {
                  const connected = health.dataSourcesConnected.includes(src);
                  return (
                    <div key={src} className="flex items-center gap-2 text-xs">
                      {statusDot(connected)}
                      <span className={connected ? "text-foreground" : "text-muted-foreground/50"}>{src}</span>
                    </div>
                  );
                })}
              </div>

              {/* Inventory */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Inventory</div>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Vehicles imported</span><span className="font-semibold">{health.inventoryCount}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Marketplace listings</span><span className="font-semibold">{health.marketplaceListingCount}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Published</span><span className="font-semibold text-success">{health.publishedListingCount}</span></div>
                </div>
              </div>

              {/* Leads & CRM */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Leads & CRM</div>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Conversations</span><span className="font-semibold">{health.conversationsCount}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Total leads</span><span className="font-semibold">{health.realLeadsCount}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Hot leads</span><span className="font-semibold text-orange-400">{health.hotLeadsCount}</span></div>
                </div>
              </div>

              {/* Data integrity */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Data Integrity</div>
                <div className="text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Mock analytics records</span>
                    <span className={cn("font-semibold", health.mockRecordCount > 0 ? "text-amber-400" : "text-success")}>
                      {health.mockRecordCount > 0 ? `${health.mockRecordCount} (excluded from KPIs)` : "None"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Duplicate perf. records</span>
                    <span className={cn("font-semibold", health.duplicateRecordsDetected > 0 ? "text-amber-400" : "text-success")}>
                      {health.duplicateRecordsDetected > 0 ? health.duplicateRecordsDetected : "None"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Last sync</span>
                    <span className="font-semibold flex items-center gap-1">
                      <RefreshCw className="w-2.5 h-2.5 text-muted-foreground" />
                      {fmt(health.lastSyncAt ?? null)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function MarketplaceIntelligence() {
  const [activeTab, setActiveTab] = useState<TabKey>("recommendations");
  const [publishingId, setPublishingId] = useState<number | null>(null);

  const { data: dash, isLoading: dashLoading } = useGetMarketplaceDashboard();
  const { data: health, isLoading: healthLoading } = useGetMarketplaceDashboardHealth();
  const { data: recsData, isLoading: recsLoading } = useListMarketplaceRecommendations();

  const bulkSchedule = useBulkSchedulePublishing({
    mutation: {
      onSuccess: (result, vars) => {
        setPublishingId(null);
        toast({
          title: "Publishing queued",
          description: `${result.enqueued} vehicle${result.enqueued !== 1 ? "s" : ""} added to the publishing queue. Open Marketplace AI → Queue to track progress.`,
        });
      },
      onError: () => {
        setPublishingId(null);
        toast({ title: "Error", description: "Failed to queue vehicle for publishing.", variant: "destructive" });
      },
    },
  });

  const handlePublishNow = (vehicleId: number) => {
    setPublishingId(vehicleId);
    bulkSchedule.mutate({ data: { vehicleIds: [vehicleId], spacingMinutes: 30 } });
  };

  const handleAddToBatch = (vehicleId: number) => {
    bulkSchedule.mutate(
      { data: { vehicleIds: [vehicleId], spacingMinutes: 30 } },
      {
        onSuccess: (result) => {
          toast({
            title: "Added to batch",
            description: `Vehicle added to publishing queue. ${result.skipped > 0 ? "Already queued." : ""}`,
          });
        },
      },
    );
  };

  const handlePublishAllRecommended = () => {
    const topIds = recs.filter((r) => {
      const s = (r.strategyName ?? "").toLowerCase();
      return s.includes("truck") || s.includes("suv") || s.includes("performance") ||
             s.includes("luxury") || s.includes("fast turn") || s.includes("premium");
    }).slice(0, 10).map((r) => r.vehicleId);

    if (topIds.length === 0) {
      toast({ title: "No high-priority vehicles", description: "No vehicles matched high-demand strategies." });
      return;
    }
    bulkSchedule.mutate(
      { data: { vehicleIds: topIds, spacingMinutes: 30 } },
      {
        onSuccess: (result) => {
          toast({
            title: "Publishing batch created",
            description: `${result.enqueued} recommended vehicle${result.enqueued !== 1 ? "s" : ""} queued. ${result.skipped > 0 ? `${result.skipped} already queued.` : ""}`,
          });
        },
      },
    );
  };

  const isLoading = dashLoading || recsLoading;
  const summary = dash?.summary;
  const recs = (recsData?.recommendations ?? []) as Rec[];
  const engineVersion = (recsData as { strategyEngineVersion?: string } | undefined)?.strategyEngineVersion;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <PageHeader
              icon={<BarChart3 className="w-5 h-5 text-primary" />}
              eyebrow="MARKETPLACE INTELLIGENCE"
              title="Marketplace Intelligence"
              subtitle="DealerPilot learns from every listing, conversation, and lead to sharpen your strategy."
            />
            {engineVersion === "v2" && (
              <div className="shrink-0 mt-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/15 border border-primary/25 text-primary text-xs font-semibold">
                  <Zap className="w-3 h-3" />
                  Strategy Engine v2
                </span>
              </div>
            )}
          </div>

          {/* KPI Summary — real data only, each card declares its source */}
          <TooltipProvider>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Total Listings Tracked */}
              <KpiCard
                label="Listings Tracked"
                icon={BarChart3}
                iconColor="text-primary"
                value={isLoading ? null : summary?.totalListings ?? 0}
                displayValue={isLoading ? "—" : String(summary?.totalListings ?? 0)}
                source={(summary?.totalListingsSource ?? "live_data") as KpiSource}
                note={summary?.totalListingsNote ?? "Count of unique Marketplace listings in the database."}
                hasMock={false}
              />
              {/* Avg Outcome Score */}
              <KpiCard
                label="Outcome Score"
                icon={Star}
                iconColor="text-yellow-400"
                value={isLoading ? null : summary?.avgOutcomeScore ?? null}
                displayValue={
                  isLoading ? "—"
                  : summary?.avgOutcomeScore != null
                    ? `${summary.avgOutcomeScore}/100`
                    : "Insufficient data"
                }
                source={(summary?.avgOutcomeScoreSource ?? "no_data") as KpiSource}
                note={summary?.avgOutcomeScoreNote ?? ""}
                hasMock={summary?.hasMockPerformanceData ?? false}
              />
              {/* Total Conversations */}
              <KpiCard
                label="Conversations"
                icon={MessageSquare}
                iconColor="text-blue-400"
                value={isLoading ? null : summary?.totalConversations ?? null}
                displayValue={
                  isLoading ? "—"
                  : summary?.totalConversations != null
                    ? String(summary.totalConversations)
                    : "No data yet"
                }
                source={(summary?.totalConversationsSource ?? "no_data") as KpiSource}
                note={summary?.totalConversationsNote ?? ""}
                hasMock={false}
              />
              {/* Hot Leads */}
              <KpiCard
                label="Hot Leads"
                icon={Flame}
                iconColor="text-orange-400"
                value={isLoading ? null : summary?.totalHotLeads ?? null}
                displayValue={
                  isLoading ? "—"
                  : summary?.totalHotLeads != null
                    ? String(summary.totalHotLeads)
                    : "Learning"
                }
                source={(summary?.totalHotLeadsSource ?? "no_data") as KpiSource}
                note={summary?.totalHotLeadsNote ?? ""}
                hasMock={false}
              />
            </div>
          </TooltipProvider>

          {/* Dashboard Health Panel */}
          <DashboardHealthPanel health={health ?? null} isLoading={healthLoading} hasMockData={summary?.hasMockPerformanceData ?? false} />

          {/* Tabs */}
          <div className="flex gap-1 bg-white/[0.03] p-1 rounded-lg border border-white/[0.06] flex-wrap">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all",
                  activeTab === key
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-white/70",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* ── Strategic Recommendations (v2 cards) ── */}
          {activeTab === "recommendations" && (
            <SectionCard
              icon={<Lightbulb className="w-4 h-4 text-primary" />}
              title="Strategic Recommendations"
              action={
                <div className="flex items-center gap-3">
                  {engineVersion === "v2" && (
                    <span className="text-[10px] text-primary/60 font-medium hidden sm:block">
                      Click any card to expand · Strategy Engine v2
                    </span>
                  )}
                  <Button
                    size="sm"
                    className="gap-2 premium-gradient-btn text-[11px] font-bold uppercase tracking-widest"
                    onClick={handlePublishAllRecommended}
                    disabled={bulkSchedule.isPending}
                  >
                    {bulkSchedule.isPending && publishingId === null ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    Publish Recommended Vehicles
                  </Button>
                </div>
              }
            >
              {recsLoading ? (
                <div className="text-muted-foreground text-sm py-8 text-center">Loading recommendations…</div>
              ) : recs.length === 0 ? (
                <div className="text-muted-foreground text-sm py-8 text-center">
                  No recommendations yet. Run the seed endpoint to generate data.
                </div>
              ) : (
                <div className="space-y-2">
                  {recs.map((rec) => (
                    <StrategyCard
                      key={rec.vehicleId}
                      rec={rec}
                      onPublishNow={handlePublishNow}
                      onAddToBatch={handleAddToBatch}
                      isPublishingThis={publishingId === rec.vehicleId && bulkSchedule.isPending}
                    />
                  ))}
                </div>
              )}
            </SectionCard>
          )}

          {/* ── Down Payment Performance ── */}
          {activeTab === "downpayment" && (
            <div className="space-y-4">
              {dashLoading ? (
                <div className="text-muted-foreground text-sm py-8 text-center">Loading…</div>
              ) : (dash?.downPaymentPerformance ?? []).length === 0 ? (
                <div className="text-muted-foreground text-sm py-8 text-center">No down payment performance data yet.</div>
              ) : (
                (dash?.downPaymentPerformance ?? []).map((typeGroup) => (
                  <SectionCard
                    key={typeGroup.vehicleType}
                    icon={<TrendingUp className="w-4 h-4 text-primary" />}
                    title={`${typeGroup.vehicleType} — Best Down: ${formatCurrency(typeGroup.bestDownPayment)}`}
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground border-b border-white/5">
                            <th className="pb-2 pr-4 font-medium">Published Down</th>
                            <th className="pb-2 pr-4 font-medium">Listings</th>
                            <th className="pb-2 pr-4 font-medium">Hot Leads</th>
                            <th className="pb-2 font-medium">Outcome Score</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.03]">
                          {typeGroup.variants.map((v) => (
                            <tr key={v.publishedDownPayment} className={cn(v.publishedDownPayment === typeGroup.bestDownPayment && "bg-primary/5")}>
                              <td className="py-2.5 pr-4">
                                <span className={cn("font-medium", v.publishedDownPayment === typeGroup.bestDownPayment ? "text-primary" : "text-white")}>
                                  {formatCurrency(v.publishedDownPayment)}
                                </span>
                                {v.publishedDownPayment === typeGroup.bestDownPayment && (
                                  <Badge className="ml-2 bg-primary/20 text-primary border-primary/30 text-[10px] py-0">Best</Badge>
                                )}
                              </td>
                              <td className="py-2.5 pr-4 text-muted-foreground">{v.totalListings}</td>
                              <td className="py-2.5 pr-4">
                                <span className="text-orange-400 font-medium">{v.hotLeads}</span>
                              </td>
                              <td className="py-2.5 w-40">
                                <ScoreBar score={v.avgOutcomeScore} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </SectionCard>
                ))
              )}
            </div>
          )}

          {/* ── Posting Time Performance ── */}
          {activeTab === "posting" && (
            <SectionCard icon={<Clock className="w-4 h-4 text-primary" />} title="Best Posting Days">
              {dashLoading ? (
                <div className="text-muted-foreground text-sm py-8 text-center">Loading…</div>
              ) : (
                <div className="space-y-3">
                  {(dash?.postingTimePerformance ?? []).map((slot, i) => (
                    <div key={slot.dayOfWeek} className="flex items-center gap-4">
                      <div className="w-24 text-sm text-right text-muted-foreground shrink-0">{slot.dayLabel}</div>
                      <div className="flex-1 relative h-7 bg-white/[0.03] rounded overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded transition-all",
                            i === 0 ? "bg-primary/50" : i === 1 ? "bg-primary/35" : "bg-white/[0.08]",
                          )}
                          style={{ width: `${slot.avgOutcomeScore}%` }}
                        />
                        <div className="absolute inset-0 flex items-center px-3 gap-4">
                          <span className="text-xs font-medium text-white">{slot.avgOutcomeScore} avg score</span>
                          <span className="text-xs text-muted-foreground">{slot.totalHotLeads} hot leads · {slot.totalConversations} convos · {slot.totalListings} listings</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="mt-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-muted-foreground">
                    <Zap className="w-3.5 h-3.5 text-primary inline mr-1.5" />
                    Best posting time: <span className="text-white font-medium">
                      {dash?.nextBatchRecommendation.recommendedDayLabel} at {dash?.nextBatchRecommendation.recommendedTimeLabel}
                    </span> — based on {summary?.totalListings} tracked listings.
                  </div>
                </div>
              )}
            </SectionCard>
          )}

          {/* ── Creative Performance ── */}
          {activeTab === "creative" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                {(["original", "ai_creative", "mixed"] as const).map((strat) => {
                  const perf = dash?.creativePerformance?.[strat];
                  if (!perf) return null;
                  const labels: Record<string, string> = { original: "Original Photos", ai_creative: "AI Creative", mixed: "Mixed" };
                  return (
                    <Card key={strat} className="bg-white/[0.02] border-white/[0.06]">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Camera className="w-4 h-4 text-primary" />
                          {labels[strat]}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <div className="text-2xl font-bold text-white">{perf.avgOutcomeScore}</div>
                          <div className="text-xs text-muted-foreground">Avg Outcome Score</div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <div className="text-sm font-medium text-white">{perf.totalListings}</div>
                            <div className="text-[10px] text-muted-foreground">Listings</div>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-orange-400">{perf.hotLeads}</div>
                            <div className="text-[10px] text-muted-foreground">Hot Leads</div>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">{perf.conversationsCount}</div>
                            <div className="text-[10px] text-muted-foreground">Convos</div>
                          </div>
                        </div>
                        <ScoreBar score={perf.avgOutcomeScore} />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <SectionCard icon={<BarChart3 className="w-4 h-4 text-primary" />} title="Performance by Vehicle Type">
                {dashLoading ? (
                  <div className="text-muted-foreground text-sm py-4 text-center">Loading…</div>
                ) : (
                  <div className="space-y-2">
                    {(dash?.vehicleTypePerformance ?? []).map((vt) => (
                      <div key={vt.vehicleType} className="flex items-center gap-4">
                        <div className="w-24 text-sm text-muted-foreground shrink-0">{vt.vehicleType}</div>
                        <div className="flex-1 relative h-7 bg-white/[0.03] rounded overflow-hidden">
                          <div
                            className="h-full bg-primary/30 rounded"
                            style={{ width: `${vt.avgOutcomeScore}%` }}
                          />
                          <div className="absolute inset-0 flex items-center px-3 gap-4">
                            <span className="text-xs font-medium text-white">{vt.avgOutcomeScore} score</span>
                            <span className="text-xs text-muted-foreground">
                              {vt.totalHotLeads} hot · {vt.totalConversations} convos · {vt.totalListings} listings
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {/* ── Weak Listings ── */}
          {activeTab === "weak" && (
            <div className="space-y-4">
              <SectionCard icon={<AlertTriangle className="w-4 h-4 text-destructive" />} title="Low Outcome — Needs Renewal">
                {dashLoading ? (
                  <div className="text-muted-foreground text-sm py-4 text-center">Loading…</div>
                ) : (dash?.weakListings ?? []).length === 0 ? (
                  <div className="text-muted-foreground text-sm py-4 text-center">No weak listings found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground border-b border-white/5">
                          <th className="pb-2 pr-4 font-medium">Vehicle</th>
                          <th className="pb-2 pr-4 font-medium">Conversations</th>
                          <th className="pb-2 pr-4 font-medium">Days Live</th>
                          <th className="pb-2 font-medium">Outcome Score</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.03]">
                        {(dash?.weakListings ?? []).map((w) => (
                          <tr key={w.vehicleId}>
                            <td className="py-2.5 pr-4 font-medium text-white">{w.year} {w.make} {w.model}</td>
                            <td className="py-2.5 pr-4 text-muted-foreground">{w.conversationsCount}</td>
                            <td className="py-2.5 pr-4 text-muted-foreground">{w.daysSincePublished}d</td>
                            <td className="py-2.5 w-40">
                              <ScoreBar score={w.outcomeScore} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>

              <SectionCard icon={<MessageSquare className="w-4 h-4 text-yellow-400" />} title="High Views, Low Lead Quality">
                {(dash?.highViewsLowQuality ?? []).length === 0 ? (
                  <div className="text-muted-foreground text-sm py-4 text-center">No high-view / low-quality listings.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground border-b border-white/5">
                          <th className="pb-2 pr-4 font-medium">Vehicle</th>
                          <th className="pb-2 pr-4 font-medium">Conversations</th>
                          <th className="pb-2 font-medium">Outcome Score</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.03]">
                        {(dash?.highViewsLowQuality ?? []).map((w) => (
                          <tr key={`hv-${w.vehicleId}`}>
                            <td className="py-2.5 pr-4 font-medium text-white">{w.year} {w.make} {w.model}</td>
                            <td className="py-2.5 pr-4 text-blue-400">{w.conversationsCount}</td>
                            <td className="py-2.5 w-40">
                              <ScoreBar score={w.outcomeScore} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {/* ── Next Batch ── */}
          {activeTab === "nextbatch" && (
            <div className="space-y-4">
              {dash?.nextBatchRecommendation && (
                <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 flex items-center gap-4">
                  <div className="p-3 rounded-lg bg-primary/20">
                    <CalendarCheck className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="text-white font-semibold">
                      Post on {dash.nextBatchRecommendation.recommendedDayLabel} at {dash.nextBatchRecommendation.recommendedTimeLabel}
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      Based on {summary?.totalListings} tracked listings — estimated {dash.nextBatchRecommendation.estimatedHotLeads} hot leads expected
                    </div>
                  </div>
                  <Badge className="bg-primary/20 text-primary border-primary/30">
                    {dash.nextBatchRecommendation.recommendedDayLabel}s at {dash.nextBatchRecommendation.recommendedTimeLabel}
                  </Badge>
                </div>
              )}

              <SectionCard icon={<Zap className="w-4 h-4 text-primary" />} title="Recommended Vehicles for Next Batch">
                {dashLoading ? (
                  <div className="text-muted-foreground text-sm py-8 text-center">Loading…</div>
                ) : (dash?.nextBatchRecommendation?.vehicles ?? []).length === 0 ? (
                  <div className="text-muted-foreground text-sm py-8 text-center">No vehicle recommendations available yet.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {(dash?.nextBatchRecommendation?.vehicles ?? []).map((v) => (
                      <div
                        key={v.vehicleId}
                        className="flex items-center gap-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-white">
                            {v.year} {v.make} {v.model}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {v.vehicleType} · {v.price != null ? formatCurrency(v.price) : "—"}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {strategyBadge(v.recommendedPriceStrategy)}
                          {v.recommendedDownPayment != null && (
                            <span className="text-xs text-muted-foreground">{formatCurrency(v.recommendedDownPayment)} down</span>
                          )}
                          {qualityBadge(v.expectedLeadQuality)}
                          <div className="w-20">
                            <ConfidenceBar score={v.confidenceScore} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
