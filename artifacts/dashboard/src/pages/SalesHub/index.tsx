import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useGetDealer,
  useListDealers,
  getGetDealerQueryKey,
  useGetVehicleStats,
  useListListingWorkspaces,
  useListPublishingJobs,
  useListCreativeJobs,
  useGetLeads,
  useListFeedRuns,
  getListFeedRunsQueryKey,
  useListMarketplaceRecommendations,
  useBulkSchedulePublishing,
} from "@workspace/api-client-react";
import { useDealerLocation } from "@/context/LocationContext";
import { cn } from "@/lib/utils";
import { PublishNowModal } from "@/components/PublishNowModal";
import { formatCurrency } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import {
  buildDailyMarketplacePlan,
  type DailyVehicleRec,
  type DailyMarketplacePlan,
  type DuplicateGroup,
} from "@/lib/dailyPlan";
import {
  UploadCloud,
  Loader2,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Car,
  ImageIcon,
  Clock,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Target,
  Zap,
  Eye,
  MessageSquare,
} from "lucide-react";

// ─── Duplicate Groups (capped at 5, sorted by size) ─────────────────────────

const CC_DUPE_VISIBLE = 5;

function CommandCenterDuplicates({ groups }: { groups: DuplicateGroup[] }) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...groups].sort((a, b) => b.count - a.count);
  const visible = showAll ? sorted : sorted.slice(0, CC_DUPE_VISIBLE);
  const hidden = sorted.length - CC_DUPE_VISIBLE;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
        Duplicate Groups · {groups.length} model{groups.length !== 1 ? "s" : ""} — hold to avoid self-competition
      </p>
      {visible.map((g) => (
        <div key={g.key} className="glass-panel rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-amber-400">{g.make} {g.model} — {g.count} ready</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{g.winReason}</p>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <span className="text-[10px] text-amber-400 font-semibold">Publish: </span>
                <span className="text-[10px] text-white">{g.publishFirst.label}</span>
                {g.holdOthers.slice(0, 2).map((h) => (
                  <span key={h.vehicleId} className="text-[10px] text-muted-foreground">· Hold: {h.label}</span>
                ))}
                {g.holdOthers.length > 2 && (
                  <span className="text-[10px] text-muted-foreground">· +{g.holdOthers.length - 2} more</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
      {!showAll && hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-center text-[10px] text-muted-foreground hover:text-amber-400 py-1 transition-colors"
        >
          + {hidden} more group{hidden !== 1 ? "s" : ""} — click to show all
        </button>
      )}
    </div>
  );
}

// ─── Vehicle Recommendation Card ─────────────────────────────────────────────

function strategyColor(name: string | null | undefined) {
  if (!name) return { bg: "bg-primary/10", text: "text-primary", border: "border-primary/20" };
  const n = name.toLowerCase();
  if (n.includes("truck")) return { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/25" };
  if (n.includes("luxury")) return { bg: "bg-violet-500/15", text: "text-violet-400", border: "border-violet-500/25" };
  if (n.includes("suv") || n.includes("premium")) return { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/25" };
  if (n.includes("fast turn")) return { bg: "bg-green-500/15", text: "text-green-400", border: "border-green-500/25" };
  if (n.includes("price review")) return { bg: "bg-destructive/15", text: "text-destructive", border: "border-destructive/25" };
  return { bg: "bg-primary/10", text: "text-primary", border: "border-primary/20" };
}

function OpportunityCard({
  rec,
  index,
  onPublish,
  onAddToBatch,
  onViewStrategy,
  isPublishing,
}: {
  rec: DailyVehicleRec;
  index: number;
  onPublish: (id: number) => void;
  onAddToBatch: (id: number) => void;
  onViewStrategy: () => void;
  isPublishing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const colors = strategyColor(rec.strategyName);

  return (
    <div className="glass-panel rounded-xl border border-white/[0.06] hover:border-primary/20 transition-colors overflow-hidden">
      <div className="flex gap-4 p-4">
        {/* Photo */}
        <div className="w-24 h-20 rounded-lg overflow-hidden bg-secondary/40 flex-shrink-0 relative">
          {rec.primaryImageUrl ? (
            <img src={rec.primaryImageUrl} alt={rec.label} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Car className="w-5 h-5 text-muted-foreground/30" />
            </div>
          )}
          <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-primary/90 flex items-center justify-center">
            <span className="text-[9px] font-black text-white">{index + 1}</span>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 mb-1.5 flex-wrap">
            {rec.strategyName && (
              <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border flex-shrink-0", colors.bg, colors.text, colors.border)}>
                {rec.strategyName}
              </span>
            )}
            <span className="font-bold text-sm text-white truncate">{rec.label}</span>
          </div>

          {/* Price row */}
          <div className="flex items-center gap-2 mb-2 flex-wrap text-xs">
            {rec.priceMode === "DOWN_PAYMENT" && rec.marketplacePrice != null ? (
              <>
                <span className="text-muted-foreground/60 line-through">{formatCurrency(rec.actualPrice!)}</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-bold">
                  Marketplace: {formatCurrency(rec.marketplacePrice)} down
                </span>
              </>
            ) : rec.actualPrice != null ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 border border-success/20 text-success font-bold">
                {formatCurrency(rec.actualPrice)} · Full price
              </span>
            ) : null}
            <span className="flex items-center gap-1 text-muted-foreground">
              <ImageIcon className="w-3 h-3" /> {rec.imageCount} photos
            </span>
          </div>

          {/* Reason bullets — skip any that duplicate the strategy badge */}
          {rec.reasons.length > 0 && (
            <ul className="space-y-0.5 mb-2">
              {rec.reasons
                .filter((r) => r.trim() !== rec.strategyName?.trim())
                .slice(0, 2)
                .map((r, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-primary/60 mt-1.5 flex-shrink-0" />
                    {r}
                  </li>
                ))}
            </ul>
          )}

          {/* Expand button for more signals */}
          {(rec.reasons.length > 2 || rec.supportingSignals.length > 0 || rec.expectedImpact) && (
            <button
              className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1 mb-2"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "Less detail" : "Why this vehicle?"}
            </button>
          )}

          {expanded && (
            <div className="pl-2 border-l border-white/10 space-y-2 mb-2">
              {rec.reasons.slice(2).map((r, i) => (
                <p key={i} className="text-xs text-muted-foreground">{r}</p>
              ))}
              {rec.supportingSignals.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {rec.supportingSignals.map((s, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/60">{s}</span>
                  ))}
                </div>
              )}
              {rec.expectedImpact && (
                <div className="flex items-start gap-1.5 p-2 rounded-lg bg-primary/5 border border-primary/15">
                  <Target className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-white/70">{rec.expectedImpact}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action column */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-success hover:bg-success/90 text-white text-xs font-semibold whitespace-nowrap"
            disabled={isPublishing}
            onClick={() => onPublish(rec.vehicleId)}
          >
            {isPublishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <UploadCloud className="w-3 h-3" />}
            Post to Marketplace
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => onAddToBatch(rec.vehicleId)}>Add to Batch</DropdownMenuItem>
              <DropdownMenuItem onClick={onViewStrategy}>Review Strategy</DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(`/creative-studio/${rec.vehicleId}`, "_self")}>Open Vehicle</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

// ─── Hold Card ────────────────────────────────────────────────────────────────

function HoldCard({ rec }: { rec: DailyVehicleRec }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-white/[0.04] bg-white/[0.015]">
      <div className="w-8 h-8 rounded-md overflow-hidden bg-secondary/40 flex-shrink-0">
        {rec.primaryImageUrl ? (
          <img src={rec.primaryImageUrl} alt={rec.label} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car className="w-3.5 h-3.5 text-muted-foreground/30" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white/70 truncate">{rec.label}</p>
        {rec.holdReason && <p className="text-[10px] text-muted-foreground/60 truncate">{rec.holdReason}</p>}
      </div>
      {rec.priceMode === "DOWN_PAYMENT" && rec.marketplacePrice != null ? (
        <span className="text-[10px] text-amber-400 flex-shrink-0">{formatCurrency(rec.marketplacePrice)} down</span>
      ) : rec.actualPrice != null ? (
        <span className="text-[10px] text-muted-foreground flex-shrink-0">{formatCurrency(rec.actualPrice)}</span>
      ) : null}
    </div>
  );
}

// ─── Command Center ───────────────────────────────────────────────────────────

export function SalesHub() {
  const [, setLocation] = useLocation();
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [publishNowVehicleId, setPublishNowVehicleId] = useState<number | null>(null);
  const [showHold, setShowHold] = useState(false);

  // Dealer
  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers?.[0]?.id;
  const { data: dealer } = useGetDealer(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getGetDealerQueryKey(dealerId!) },
  });

  const { selectedLocation } = useDealerLocation();

  // Data fetches
  const { data: vehicleStats } = useGetVehicleStats({ location: selectedLocation });
  const { data: workspacesData, isLoading: workspacesLoading } = useListListingWorkspaces({ location: selectedLocation });
  const { data: recsData, isLoading: recsLoading } = useListMarketplaceRecommendations({ location: selectedLocation });
  const { data: jobsData } = useListPublishingJobs({ location: selectedLocation });
  const { data: creativeJobs } = useListCreativeJobs();
  const { data: leads } = useGetLeads();
  const { data: feedRuns } = useListFeedRuns(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getListFeedRunsQueryKey(dealerId!) },
  });

  // Publish mutation
  const bulkSchedule = useBulkSchedulePublishing({
    mutation: {
      onSuccess: (result) => {
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

  const handlePublish = (vehicleId: number) => {
    setPublishNowVehicleId(vehicleId);
  };

  const handleAddToBatch = (vehicleId: number) => {
    bulkSchedule.mutate({ data: { vehicleIds: [vehicleId], spacingMinutes: 30 } }, {
      onSuccess: () => toast({ title: "Added to batch", description: "Vehicle added to publishing queue." }),
    });
  };

  // Build daily plan
  const plan = useMemo((): DailyMarketplacePlan | null => {
    if (!workspacesData?.workspaces || !recsData?.recommendations || !jobsData?.jobs) return null;
    return buildDailyMarketplacePlan(
      workspacesData.workspaces,
      recsData.recommendations as never,
      jobsData.jobs,
    );
  }, [workspacesData, recsData, jobsData]);

  const isLoading = workspacesLoading || recsLoading;

  // Derived counts
  const pendingLeads = leads?.leads.filter(l => l.status === "new").length ?? 0;
  const priceChanges = vehicleStats?.priceChanged ?? 0;
  const queuedCount = (jobsData?.jobs ?? []).filter(j => ["Queued","Scheduled","Publishing","Assigned"].includes(j.status)).length;
  const listingsLive = (workspacesData?.workspaces ?? []).filter(
    w => w.publishStatus === "published" || w.publishStatus === "published_with_changes"
  ).length;
  const failedJobs = (jobsData?.jobs ?? []).filter(j => j.status === "Failed").length;
  const issueCount = failedJobs + (priceChanges > 0 ? 1 : 0);

  // Greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Activity items
  const activityItems = useMemo(() => {
    type Item = { id: string; label: string; sub: string; date: Date; color: string; action?: string; actionPath?: string };
    const items: Item[] = [];

    feedRuns?.feedRuns?.forEach(run => {
      if (run.finishedAt) {
        items.push({
          id: `feed-${run.id}`,
          label: `Inventory synced`,
          sub: `${run.vehiclesNew ?? 0} new · ${run.vehiclesUpdated ?? 0} updated · ${run.vehiclesRemoved ?? 0} removed`,
          date: new Date(run.finishedAt),
          color: "bg-primary",
          action: "View Inventory",
          actionPath: "/inventory",
        });
      }
    });

    creativeJobs?.jobs?.forEach(job => {
      if (job.completedAt) {
        items.push({
          id: `creative-${job.id}`,
          label: `Creative generated`,
          sub: job.vehicleLabel ?? "Vehicle",
          date: new Date(job.completedAt),
          color: "bg-accent",
        });
      }
    });

    jobsData?.jobs?.forEach(job => {
      if (job.completedAt && job.status === "Published") {
        items.push({
          id: `pub-${job.id}`,
          label: `Listing published`,
          sub: job.vehicleLabel ?? "Vehicle",
          date: new Date(job.completedAt),
          color: "bg-success",
          action: "View Queue",
          actionPath: "/listings?tab=publishing",
        });
      }
      if (job.status === "Failed") {
        items.push({
          id: `fail-${job.id}`,
          label: `Publish failed`,
          sub: `${job.vehicleLabel ?? "Vehicle"} — ${job.failedReason ?? "unknown reason"}`,
          date: new Date(job.updatedAt ?? job.createdAt),
          color: "bg-destructive",
          action: "Retry",
          actionPath: "/listings?tab=failed",
        });
      }
    });

    leads?.leads?.slice(0, 5).forEach(lead => {
      items.push({
        id: `lead-${lead.id}`,
        label: `Buyer message received`,
        sub: lead.status === "new" ? "Awaiting reply" : `Status: ${lead.status}`,
        date: new Date(lead.createdAt),
        color: "bg-warning",
        action: "Reply",
        actionPath: "/sales-ai",
      });
    });

    return items.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 15);
  }, [feedRuns, creativeJobs, jobsData, leads]);

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 md:p-8 max-w-[1400px] mx-auto animate-in fade-in slide-in-from-bottom-2 duration-400">

          {/* ── MISSION HEADER ──────────────────────────────────────────────── */}
          <div className="mb-6">
            <p className="text-[10px] font-bold text-blue-400/50 uppercase tracking-[0.2em] mb-3">Command Center</p>
            <div className="flex items-start justify-between gap-4 mb-2">
              <div>
                <p className="text-sm text-white/35 mb-1">{greeting}, Operator.</p>
                <h1 className="text-[26px] font-bold text-white tracking-tight leading-tight">
                  {isLoading ? "Loading opportunities…" : plan?.summary ?? `${dealer?.name ?? "Alpha Motorsport"}`}
                </h1>
              </div>
              <Button
                className="shrink-0 h-9 gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-[13px] px-4 mt-1"
                disabled={!plan?.recommendedToday[0] || isLoading}
                onClick={() => plan?.recommendedToday[0] && setPublishNowVehicleId(plan.recommendedToday[0].vehicleId)}
              >
                <UploadCloud className="w-3.5 h-3.5" />
                Publish Next Best
              </Button>
            </div>
          </div>

          {/* ── MISSION CARDS ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-8">
            {(() => {
              const vReady = vehicleStats?.readyToPublish ?? plan?.recommendedToday.length ?? 0;
              const hasReady = !isLoading && vReady > 0;
              return (
                <button
                  onClick={() => setLocation("/listings")}
                  className={cn("glass-panel rounded-xl border p-4 text-left transition-all", hasReady ? "border-blue-500/25 hover:border-blue-500/40" : "border-white/[0.06] hover:border-white/10")}
                >
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-3", hasReady ? "bg-blue-500/10" : "bg-white/[0.03]")}>
                    <Car className={cn("w-4 h-4", hasReady ? "text-blue-400" : "text-white/20")} />
                  </div>
                  <div className={cn("text-[26px] font-bold leading-none mb-1", hasReady ? "text-blue-400" : "text-white/30")}>
                    {isLoading ? "—" : vReady}
                  </div>
                  <div className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">Vehicles Ready</div>
                </button>
              );
            })()}

            {(() => {
              const hasLive = !isLoading && listingsLive > 0;
              return (
                <button
                  onClick={() => setLocation("/listings?tab=published")}
                  className={cn("glass-panel rounded-xl border p-4 text-left transition-all", hasLive ? "border-green-500/25 hover:border-green-500/40" : "border-white/[0.06] hover:border-white/10")}
                >
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-3", hasLive ? "bg-green-500/10" : "bg-white/[0.03]")}>
                    <UploadCloud className={cn("w-4 h-4", hasLive ? "text-green-400" : "text-white/20")} />
                  </div>
                  <div className={cn("text-[26px] font-bold leading-none mb-1", hasLive ? "text-green-400" : "text-white/30")}>
                    {isLoading ? "—" : listingsLive}
                  </div>
                  <div className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">Listings Live</div>
                </button>
              );
            })()}

            <button
              onClick={() => setLocation("/sales-ai")}
              className={cn(
                "glass-panel rounded-xl border p-4 text-left transition-all",
                pendingLeads > 0
                  ? "border-violet-500/25 hover:border-violet-500/40"
                  : "border-white/[0.06] hover:border-violet-500/15",
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center mb-3",
                pendingLeads > 0 ? "bg-violet-500/15" : "bg-white/[0.04]",
              )}>
                <MessageSquare className={cn("w-4 h-4", pendingLeads > 0 ? "text-violet-400" : "text-white/25")} />
              </div>
              <div className={cn("text-[26px] font-bold leading-none mb-1", pendingLeads > 0 ? "text-violet-400" : "text-white/50")}>
                {pendingLeads}
              </div>
              <div className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">Buyers Waiting</div>
            </button>

            <button
              onClick={() => setLocation("/sales-ai")}
              className="glass-panel rounded-xl border border-white/[0.06] hover:border-amber-500/15 p-4 text-left transition-all"
            >
              <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center mb-3">
                <Clock className="w-4 h-4 text-white/25" />
              </div>
              <div className="text-[26px] font-bold text-white/40 leading-none mb-1">0</div>
              <div className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">Appointments</div>
            </button>

            <button
              onClick={() => setLocation("/listings?tab=failed")}
              className={cn(
                "glass-panel rounded-xl border p-4 text-left transition-all",
                issueCount > 0
                  ? "border-red-500/25 hover:border-red-500/40"
                  : "border-white/[0.06] hover:border-white/10",
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center mb-3",
                issueCount > 0 ? "bg-red-500/10" : "bg-white/[0.04]",
              )}>
                <AlertTriangle className={cn("w-4 h-4", issueCount > 0 ? "text-red-400" : "text-white/25")} />
              </div>
              <div className={cn("text-[26px] font-bold leading-none mb-1", issueCount > 0 ? "text-red-400" : "text-white/40")}>
                {issueCount}
              </div>
              <div className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">Issues</div>
            </button>
          </div>

          <div className="h-px bg-white/[0.04] mb-2" />

          <div className="flex flex-col xl:flex-row gap-8">

            {/* LEFT: Today's Picks */}
            <div className="flex-1 flex flex-col gap-6 min-w-0">

              {/* TODAY'S OPPORTUNITIES */}
              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
                </div>
              ) : !plan || plan.recommendedToday.length === 0 ? (
                <div className="glass-panel rounded-xl border border-border/30 p-8 text-center space-y-3">
                  <CheckCircle2 className="w-10 h-10 text-success/50 mx-auto" />
                  <div>
                    <p className="font-semibold text-white">No vehicles recommended right now.</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {queuedCount > 0
                        ? `${queuedCount} vehicle${queuedCount !== 1 ? "s" : ""} already queued for publishing.`
                        : "All ready vehicles are either queued or need review."}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setLocation("/listings?tab=publishing")}>
                    Review Marketplace Queue <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      Today's Opportunities · {plan.recommendedToday.length} vehicles
                    </p>
                    <div className="flex-1 h-px bg-white/5" />
                  </div>
                  {plan.recommendedToday.map((rec, i) => (
                    <OpportunityCard
                      key={rec.vehicleId}
                      rec={rec}
                      index={i}
                      onPublish={handlePublish}
                      onAddToBatch={handleAddToBatch}
                      onViewStrategy={() => setLocation("/marketplace-intelligence")}
                      isPublishing={false}
                    />
                  ))}
                </div>
              )}

              {/* DUPLICATE GROUPS — top 5 only, sorted by count */}
              {plan && plan.duplicateGroups.length > 0 && (
                <CommandCenterDuplicates groups={plan.duplicateGroups} />
              )}

              {/* HOLD VEHICLES */}
              {plan && plan.holdToday.length > 0 && (
                <div className="space-y-2">
                  <button
                    className="flex items-center gap-2 w-full"
                    onClick={() => setShowHold(v => !v)}
                  >
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      Hold Today · {plan.holdToday.length} vehicles
                    </p>
                    <div className="flex-1 h-px bg-white/5" />
                    {showHold ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                  </button>
                  {showHold && (
                    <div className="space-y-1.5">
                      {plan.holdToday.slice(0, 8).map(rec => <HoldCard key={rec.vehicleId} rec={rec} />)}
                    </div>
                  )}
                </div>
              )}


            </div>

            {/* RIGHT: DealerPilot Live */}
            <div className="w-full xl:w-72 shrink-0 flex flex-col gap-4 sticky top-6 self-start max-h-[calc(100vh-100px)]">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                  </span>
                  DealerPilot Live
                </h2>
                <Badge className="text-[9px] bg-primary/10 text-primary/70 border-primary/20 uppercase tracking-widest">Real Data</Badge>
              </div>

              <div className="glass-panel rounded-2xl border border-white/5 flex-1 overflow-y-auto">
                {activityItems.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No recent activity</div>
                ) : (
                  <div className="flex flex-col divide-y divide-white/[0.04]">
                    {activityItems.map((item, idx) => (
                      <div key={item.id} className="p-3 flex gap-3 hover:bg-white/[0.02] transition-colors relative">
                        {idx === 0 && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary rounded-r" />}
                        <span className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", item.color)} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white/90 leading-tight">{item.label}</p>
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{item.sub}</p>
                          <p className="text-[9px] text-muted-foreground/50 mt-0.5 font-mono">{format(item.date, "HH:mm")}</p>
                          {item.action && item.actionPath && (
                            <button
                              className="text-[9px] text-primary hover:text-primary/80 font-bold uppercase tracking-widest mt-0.5"
                              onClick={() => setLocation(item.actionPath!)}
                            >
                              {item.action} →
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
      <PublishNowModal
        vehicleId={publishNowVehicleId}
        onClose={() => setPublishNowVehicleId(null)}
      />
    </AppLayout>
  );
}
