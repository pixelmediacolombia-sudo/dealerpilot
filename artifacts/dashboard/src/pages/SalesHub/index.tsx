import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  CarFront,
  Sparkles,
  MessageSquare,
  ArrowRight,
  TrendingUp,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Activity,
  Server, Database, Rss, Puzzle, Facebook, Store, Bot, Settings,
  Clock, Play, UploadCloud, Loader2, Zap, Target, ChevronDown, ChevronUp,
} from "lucide-react";
import { format } from "date-fns";

import { AppLayout } from "@/components/layout/AppLayout";
import { StatusPulse } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import {
  useGetDealer,
  useListDealers,
  getGetDealerQueryKey,
  useGetVehicleStats,
  useListListingWorkspaces,
  useListPublishingJobs,
  useListCreativeStudio,
  useGetLeads,
  useGetConnectionStatus,
  useListFeedRuns,
  getListFeedRunsQueryKey,
  useListCreativeJobs,
  useListMarketplaceRecommendations,
  useBulkSchedulePublishing,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { toast } from "@/hooks/use-toast";

// ── Strategy-name color helpers ────────────────────────────────────────────────
function strategyColor(name: string | null | undefined) {
  if (!name) return { bg: "bg-primary/10", text: "text-primary", border: "border-primary/20" };
  const n = name.toLowerCase();
  if (n.includes("truck")) return { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/25" };
  if (n.includes("luxury")) return { bg: "bg-violet-500/15", text: "text-violet-400", border: "border-violet-500/25" };
  if (n.includes("suv")) return { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/25" };
  if (n.includes("fast turn")) return { bg: "bg-green-500/15", text: "text-green-400", border: "border-green-500/25" };
  if (n.includes("price review")) return { bg: "bg-destructive/15", text: "text-destructive", border: "border-destructive/25" };
  return { bg: "bg-primary/10", text: "text-primary", border: "border-primary/20" };
}

// ── Today's AI Picks Card ──────────────────────────────────────────────────────
type TodayPick = {
  vehicleId: number;
  label: string;
  strategyName: string | null;
  price: number | null;
  recommendedDownPayment: number | null;
  recommendedPriceStrategy: string;
  reason: string | null;
};

function TodayPickCard({
  pick,
  onPublish,
  isPublishing,
}: {
  pick: TodayPick;
  onPublish: (id: number) => void;
  isPublishing: boolean;
}) {
  const [showReason, setShowReason] = useState(false);
  const colors = strategyColor(pick.strategyName);
  const isDownPayment = pick.recommendedPriceStrategy === "down_payment" && pick.recommendedDownPayment != null;
  const displayPrice = isDownPayment
    ? `${formatCurrency(pick.recommendedDownPayment!)} down`
    : pick.price != null ? formatCurrency(pick.price) : null;

  return (
    <div className="glass-panel rounded-xl border border-white/5 p-4 flex flex-col gap-3 hover:border-primary/20 transition-colors">
      {/* Top row: strategy + vehicle */}
      <div className="flex items-start gap-2">
        {pick.strategyName && (
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border flex-shrink-0 mt-0.5", colors.bg, colors.text, colors.border)}>
            {pick.strategyName}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-white truncate">{pick.label}</div>
          {displayPrice && (
            <div className="text-xs mt-0.5 flex items-center gap-1.5 flex-wrap">
              {isDownPayment ? (
                <>
                  <span className="text-muted-foreground line-through opacity-50">{formatCurrency(pick.price!)}</span>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold">
                    Marketplace: {displayPrice}
                  </span>
                </>
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-success/10 border border-success/20 text-success text-[10px] font-bold">
                  Full price · {displayPrice}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Reason (collapsible) */}
      {pick.reason && (
        <div>
          <button
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowReason((v) => !v)}
          >
            {showReason ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showReason ? "Hide reason" : "Why this vehicle?"}
          </button>
          {showReason && (
            <p className="mt-1.5 text-xs text-white/70 leading-relaxed pl-4 border-l border-white/10">
              {pick.reason}
            </p>
          )}
        </div>
      )}

      {/* Action */}
      <div className="flex items-center gap-2 mt-auto">
        <Button
          size="sm"
          className="flex-1 h-8 gap-1.5 bg-success hover:bg-success/90 text-white text-xs font-semibold"
          disabled={isPublishing}
          onClick={() => onPublish(pick.vehicleId)}
        >
          {isPublishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <UploadCloud className="w-3 h-3" />}
          Post to Marketplace
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function SalesHub() {
  const [, setLocation] = useLocation();
  const [publishingId, setPublishingId] = useState<number | null>(null);

  // Dealer
  const { data: dealersData, isLoading: isLoadingDealers } = useListDealers();
  const dealerId = dealersData?.dealers?.[0]?.id;
  const { data: dealer, isLoading: isLoadingDealer } = useGetDealer(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getGetDealerQueryKey(dealerId!) },
  });

  // Core data
  const { data: vehicleStats, isLoading: isLoadingStats } = useGetVehicleStats();
  const { data: creativeStudio, isLoading: isLoadingCreative } = useListCreativeStudio();
  const { data: leads, isLoading: isLoadingLeads } = useGetLeads();
  const { data: connections, isLoading: isLoadingConnections } = useGetConnectionStatus();
  const { data: feedRuns } = useListFeedRuns(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getListFeedRunsQueryKey(dealerId!) },
  });
  const { data: creativeJobs } = useListCreativeJobs();
  const { data: publishingJobs } = useListPublishingJobs();
  const { data: workspacesData } = useListListingWorkspaces();

  // Strategy engine recommendations for today's picks
  const { data: recsData } = useListMarketplaceRecommendations();

  // Publish mutation
  const bulkSchedule = useBulkSchedulePublishing({
    mutation: {
      onSuccess: (result, vars) => {
        setPublishingId(null);
        toast({
          title: "Publishing queued",
          description: `${result.enqueued} vehicle${result.enqueued !== 1 ? "s" : ""} added to the publishing queue.`,
        });
      },
      onError: () => {
        setPublishingId(null);
        toast({ title: "Error", description: "Failed to queue vehicle for publishing.", variant: "destructive" });
      },
    },
  });

  const handlePublishToday = (vehicleId: number) => {
    setPublishingId(vehicleId);
    bulkSchedule.mutate({ data: { vehicleIds: [vehicleId], spacingMinutes: 30 } });
  };

  const isLoading = isLoadingDealers || isLoadingDealer || isLoadingStats ||
                    isLoadingCreative || isLoadingLeads || isLoadingConnections;

  // Derived
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const vehiclesReady = vehicleStats?.readyToPublish || 0;
  const newVehicles = vehicleStats?.new || 0;
  const pendingLeads = leads?.leads.filter(l => l.status === "new").length || 0;
  const priceChanges = vehicleStats?.priceChanged || 0;
  const renewalCount = workspacesData?.workspaces?.filter(w => w.publishStatus === "Approved").length || 0;
  const aiActivityTotal = (vehicleStats?.published || 0) +
    (creativeStudio?.vehicles.reduce((acc, v) => acc + (v.versionCount || 0), 0) || 0) +
    (leads?.leads.length || 0);
  const estimatedMinutes = (vehiclesReady * 0.75 + pendingLeads * 1.5 + newVehicles * 0.5).toFixed(0);

  // Today's top 3 picks from Strategy Engine
  const todayPicks = useMemo((): TodayPick[] => {
    const recs = recsData?.recommendations ?? [];
    return recs
      .slice(0, 3)
      .map((r) => {
        // Parse v2 explanation for reason
        let strategyName: string | null = null;
        let reason: string | null = null;
        try {
          const parsed = JSON.parse(r.explanation ?? "");
          if (parsed?.v === 2) {
            strategyName = parsed.strategyName ?? null;
            reason = parsed.reason ?? null;
          }
        } catch {
          reason = r.explanation ?? null;
        }
        return {
          vehicleId: r.vehicleId,
          label: `${r.year ?? ""} ${r.make} ${r.model}`.trim(),
          strategyName: strategyName ?? (r as { strategyName?: string | null }).strategyName ?? null,
          price: r.price ?? null,
          recommendedDownPayment: r.recommendedDownPayment ?? null,
          recommendedPriceStrategy: r.recommendedPriceStrategy,
          reason,
        };
      });
  }, [recsData]);

  // Live Activity Feed
  const activityItems = useMemo(() => {
    type ActivityItem = { id: string; type: string; label: string; date: Date; color: string };
    const items: ActivityItem[] = [];

    feedRuns?.feedRuns?.forEach(run => {
      if (run.finishedAt) {
        items.push({
          id: `feed-${run.id}`,
          type: "feed",
          label: `Inventory Sync · ${run.vehiclesNew} new vehicles`,
          date: new Date(run.finishedAt),
          color: "bg-primary",
        });
      }
    });

    creativeJobs?.jobs?.forEach(job => {
      if (job.completedAt) {
        items.push({
          id: `creative-${job.id}`,
          type: "creative",
          label: `Creative Generated · ${job.vehicleLabel || "Vehicle"}`,
          date: new Date(job.completedAt),
          color: "bg-accent",
        });
      }
    });

    publishingJobs?.jobs?.forEach(job => {
      if (job.completedAt) {
        items.push({
          id: `publishing-${job.id}`,
          type: "publishing",
          label: `Listing Published · ${job.vehicleLabel || "Vehicle"}`,
          date: new Date(job.completedAt),
          color: "bg-success",
        });
      }
    });

    leads?.leads?.forEach(lead => {
      items.push({
        id: `lead-${lead.id}`,
        type: "lead",
        label: "Buyer Message",
        date: new Date(lead.createdAt),
        color: "bg-warning",
      });
    });

    return items.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 12);
  }, [feedRuns, creativeJobs, publishingJobs, leads]);

  const getServiceColor = (serviceStatus?: string) => {
    switch (serviceStatus?.toLowerCase()) {
      case "connected":
      case "online": return "success";
      case "offline":
      case "error": return "destructive";
      case "not_synced":
      case "warning": return "warning";
      case "coming_soon": return "info";
      default: return "muted";
    }
  };

  // Pipeline Counts
  const pipelineCounts = {
    inventory: vehicleStats?.total || 0,
    analysis: vehicleStats?.active || 0,
    creative: creativeStudio?.vehicles.filter(v => v.creativeStatus === "Generating").length || 0,
    listing: workspacesData?.workspaces.length || 0,
    publishing: publishingJobs?.jobs.filter(j => j.status === "Publishing").length || 0,
    live: vehicleStats?.published || 0,
  };

  return (
    <AppLayout>
      <div className="p-6 md:p-10 max-w-[1400px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">

        {/* System Pulse Header */}
        <div className="flex justify-end pb-4 mb-6 border-b border-white/5 shrink-0">
          <div className="flex flex-col items-end gap-2">
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
              <Activity className="w-3 h-3" /> System Pulse
            </h3>
            <div className="flex items-center gap-3">
              {[
                { key: "xmlFeed", icon: Rss, name: "Feed" },
                { key: "chromeExtension", icon: Puzzle, name: "Extension" },
                { key: "marketplace", icon: Store, name: "Marketplace" },
                { key: "openai", icon: Bot, name: "AI" },
              ].map((svc) => (
                <div key={svc.key} className="flex items-center gap-1.5 bg-black/20 px-2 py-1.5 rounded border border-white/5" title={svc.name}>
                  <svc.icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <StatusPulse status={getServiceColor(connections?.[svc.key as keyof typeof connections]?.status)} />
                </div>
              ))}
              <Button variant="ghost" size="icon" className="h-7 w-7 bg-white/5 hover:bg-white/10 ml-2" onClick={() => setLocation("/settings")}>
                <Settings className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col xl:flex-row gap-8 flex-1 min-h-0">

          {/* LEFT COLUMN */}
          <div className="flex-1 flex flex-col gap-8 overflow-y-auto pr-2 pb-10">

            {/* ── 0. AI Daily Plan ── */}
            <div className="glass-panel p-6 rounded-2xl border border-primary/15 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-primary/5 via-transparent to-transparent -z-10" />

              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-[10px] font-bold text-primary uppercase tracking-widest flex items-center gap-1.5 mb-1">
                    <Zap className="w-3 h-3" /> DealerPilot AI
                  </div>
                  <h2 className="text-lg font-bold text-white">Recommended Actions Today</h2>
                </div>
                <Badge className="text-[9px] font-bold uppercase tracking-widest bg-amber-500/10 text-amber-400 border-amber-500/20 gap-1 flex-shrink-0">
                  <Target className="w-2.5 h-2.5" /> Estimated Strategy
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                Based on your real inventory + DealerPilot Strategy Engine rules.
                Confidence scores reflect vehicle attributes and price positioning — not real Marketplace engagement yet.
              </p>

              {todayPicks.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground text-sm">
                  Loading recommendations…
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {todayPicks.map((pick) => (
                    <TodayPickCard
                      key={pick.vehicleId}
                      pick={pick}
                      onPublish={handlePublishToday}
                      isPublishing={publishingId === pick.vehicleId && bulkSchedule.isPending}
                    />
                  ))}
                </div>
              )}

              <p className="text-[10px] text-muted-foreground/60 mt-3 text-right">
                Posting creates a real publishing job · visible in Marketplace AI → Queue
              </p>
            </div>

            {/* ── 1. Morning Brief Hero ── */}
            <div className="glass-panel p-8 rounded-2xl border border-white/5 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-50 -z-10" />

              <div className="flex flex-col gap-6">
                <div>
                  <div className="text-sm font-medium text-primary uppercase tracking-wider mb-2">
                    DealerPilot — {greeting}
                  </div>
                  <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-1">
                    {dealer?.name || "Alpha Motorsport"}
                  </h1>
                  <p className="text-xl text-muted-foreground">
                    DealerPilot completed <span className="text-white font-medium">{aiActivityTotal}</span> overnight actions.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-success flex-shrink-0" />
                    <span className="text-white">Publish <strong className="font-bold">{vehiclesReady}</strong> Marketplace listings</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-warning flex-shrink-0" />
                    <span className="text-white">Renew <strong className="font-bold">{renewalCount}</strong> expired ads</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-destructive flex-shrink-0" />
                    <span className="text-white">Reply to <strong className="font-bold">{pendingLeads}</strong> Marketplace buyers</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-success flex-shrink-0" />
                    <span className="text-white">Review creatives for <strong className="font-bold">{newVehicles}</strong> new vehicles</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Clock className="w-4 h-4" />
                  Estimated work: ~{estimatedMinutes} minutes
                </div>

                <Button
                  className="w-full premium-gradient-btn h-14 text-lg font-medium mt-2 gap-2"
                  onClick={() => setLocation("/listings")}
                >
                  <Play className="w-5 h-5 fill-current" /> Start AI Workflow <ArrowRight className="w-5 h-5 ml-1" />
                </Button>
              </div>
            </div>

            {/* ── 2. Mission Cards ── */}
            <div className="flex flex-col gap-4">

              <div className="glass-panel p-5 rounded-xl border border-white/5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between group hover:border-success/30 transition-colors">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-success">Mission · Real Data</span>
                  <h3 className="text-lg font-semibold text-white">Publish {vehiclesReady} Vehicles</h3>
                  <p className="text-sm text-muted-foreground">Estimated · {(vehiclesReady * 0.75).toFixed(0)} min | Priority: High</p>
                </div>
                <Button className="w-full sm:w-auto bg-success hover:bg-success/90 text-white gap-2" onClick={() => setLocation("/publishing")}>
                  Start Publishing <ArrowRight className="w-4 h-4" />
                </Button>
              </div>

              <div className="glass-panel p-5 rounded-xl border border-white/5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between group hover:border-destructive/30 transition-colors">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-destructive">Mission · Real Data</span>
                  <h3 className="text-lg font-semibold text-white">Reply to {pendingLeads} Buyers</h3>
                  <p className="text-sm text-muted-foreground">Estimated · {(pendingLeads * 1.5).toFixed(0)} min | Priority: High</p>
                </div>
                <Button className="w-full sm:w-auto bg-destructive hover:bg-destructive/90 text-white gap-2" onClick={() => setLocation("/sales-ai")}>
                  Review Replies <ArrowRight className="w-4 h-4" />
                </Button>
              </div>

              <div className="glass-panel p-5 rounded-xl border border-white/5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between group hover:border-warning/30 transition-colors">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-warning">Mission · Real Data</span>
                  <h3 className="text-lg font-semibold text-white">Update Inventory ({priceChanges} changes)</h3>
                  <p className="text-sm text-muted-foreground">Estimated · 1 min | Priority: Low</p>
                </div>
                <Button className="w-full sm:w-auto bg-warning hover:bg-warning/90 text-black font-medium gap-2" onClick={() => setLocation("/inventory")}>
                  Review Changes <ArrowRight className="w-4 h-4" />
                </Button>
              </div>

            </div>

            {/* ── 3. AI Workflow Pipeline ── */}
            <div className="glass-panel p-6 rounded-2xl border border-white/5 mt-4">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider">AI Workflow Pipeline</h3>
                <Badge className="text-[9px] bg-primary/10 text-primary border-primary/20 uppercase tracking-widest">Real Data</Badge>
              </div>

              <div className="flex items-center justify-between relative">
                <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-gradient-to-r from-primary/20 via-accent/20 to-success/20 -translate-y-1/2 -z-10 hidden sm:block" />

                {[
                  { label: "Inventory", count: pipelineCounts.inventory },
                  { label: "AI Analysis", count: pipelineCounts.analysis },
                  { label: "Creative", count: pipelineCounts.creative },
                  { label: "Listing", count: pipelineCounts.listing },
                  { label: "Publishing", count: pipelineCounts.publishing },
                  { label: "Facebook Live", count: pipelineCounts.live },
                ].map((stage) => (
                  <div key={stage.label} className="flex flex-col items-center gap-3 bg-card/80 px-2 sm:px-4 py-2 rounded-lg">
                    <span className="text-xs sm:text-sm font-medium text-muted-foreground whitespace-nowrap">{stage.label}</span>
                    <div className="bg-white/10 text-white px-3 py-1 rounded-full text-sm font-bold min-w-[3rem] text-center border border-white/5">
                      {stage.count}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN - Live Activity Feed */}
          <div className="w-full xl:w-80 shrink-0 flex flex-col gap-4 sticky top-6 self-start max-h-[calc(100vh-120px)]">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                </span>
                DealerPilot Live
              </h2>
              <Badge className="text-[9px] bg-primary/10 text-primary/70 border-primary/20 uppercase tracking-widest">Real Data</Badge>
            </div>

            <div className="glass-panel rounded-2xl border border-white/5 flex-1 overflow-y-auto p-1">
              <div className="flex flex-col">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="p-4 border-b border-white/5 flex gap-3">
                      <Skeleton className="w-2 h-2 rounded-full mt-1.5 shrink-0" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-3 w-12" />
                        <Skeleton className="h-4 w-full" />
                      </div>
                    </div>
                  ))
                ) : activityItems.length > 0 ? (
                  activityItems.map((item, index) => (
                    <div key={item.id} className="p-4 border-b border-white/5 last:border-0 flex gap-3 group hover:bg-white/[0.02] transition-colors relative">
                      {index === 0 && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary rounded-r" />}
                      <span className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", item.color)} />
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-xs text-muted-foreground font-mono">{format(item.date, "HH:mm")}</span>
                        <span className="text-sm text-white/90 truncate">{item.label}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    No recent activity
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
