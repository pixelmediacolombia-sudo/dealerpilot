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

function scoreColor(score: number | null) {
  if (score == null) return { pill: "bg-white/[0.06] border-white/10 text-white/25", label: "" };
  if (score >= 80) return { pill: "bg-green-500/15 border-green-500/25 text-green-400", label: "HOT" };
  if (score >= 70) return { pill: "bg-amber-500/15 border-amber-500/25 text-amber-400", label: "WARM" };
  return { pill: "bg-white/[0.06] border-white/10 text-white/35", label: "WATCH" };
}

function langBadgeClass(lang: string) {
  if (lang === "Spanish-first") return "bg-orange-500/15 text-orange-400 border-orange-500/25";
  if (lang === "Bilingual") return "bg-teal-500/15 text-teal-400 border-teal-500/25";
  return "bg-white/[0.05] text-white/30 border-white/10";
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
  const sc = scoreColor(rec.opportunityScore);
  const hasSegment = rec.primarySegment && rec.primarySegment !== "General";

  return (
    <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] hover:border-white/[0.09] transition-all overflow-hidden group">
      <div className="flex items-center gap-4 p-4">

        {/* Rank + score */}
        <div className="flex flex-col items-center gap-1 shrink-0 w-10">
          <div className="w-8 h-8 rounded-xl bg-blue-500/[0.08] border border-blue-500/[0.15] flex items-center justify-center">
            <span className="text-[12px] font-black text-blue-400/60">{index + 1}</span>
          </div>
          {rec.opportunityScore != null && (
            <span className={cn("text-[9px] font-black px-1.5 py-0 rounded border", sc.pill)}>
              {rec.opportunityScore}
            </span>
          )}
        </div>

        {/* Photo */}
        <div className="w-[72px] h-[56px] rounded-xl overflow-hidden bg-white/[0.03] border border-white/[0.04] shrink-0">
          {rec.primaryImageUrl ? (
            <img src={rec.primaryImageUrl} alt={rec.label} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Car className="w-4 h-4 text-white/10" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {rec.opportunityScore != null && (
              <span className={cn("text-[9px] font-black px-2 py-0.5 rounded border uppercase tracking-widest shrink-0", sc.pill)}>
                {sc.label}
              </span>
            )}
            {hasSegment && (
              <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-widest shrink-0", langBadgeClass(rec.suggestedLanguage))}>
                {rec.primarySegment}
              </span>
            )}
            <span className="font-bold text-[14px] text-white/85 truncate">{rec.label}</span>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            {rec.priceMode === "DOWN_PAYMENT" && rec.marketplacePrice != null ? (
              <span className="text-amber-400 font-semibold">{formatCurrency(rec.marketplacePrice)} down</span>
            ) : rec.actualPrice != null ? (
              <span className="text-emerald-400 font-semibold">{formatCurrency(rec.actualPrice)}</span>
            ) : null}
            {rec.imageCount > 0 && (
              <span className="flex items-center gap-1 text-white/22">
                <ImageIcon className="w-3 h-3" />{rec.imageCount}
              </span>
            )}
            {rec.adAngle && (
              <span className="text-white/25 truncate hidden lg:block italic">· "{rec.adAngle}"</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-white/15 hover:text-white/40 transition-colors p-1"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-[12px] font-bold px-4 shadow-lg shadow-blue-500/15 rounded-lg"
            disabled={isPublishing}
            onClick={() => onPublish(rec.vehicleId)}
          >
            {isPublishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <UploadCloud className="w-3 h-3" />}
            Publish
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-white/20 hover:text-white/50 hover:bg-white/[0.04] rounded-lg">
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

      {/* Expanded detail */}
      {expanded && (
        <div className="px-5 pb-4 pt-0 border-t border-white/[0.04] space-y-3">
          {/* Why this vehicle */}
          {rec.reasons.length > 0 && (
            <div className="pt-3">
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/20 mb-2">Why This Vehicle</p>
              <ul className="space-y-1">
                {rec.reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-1 h-1 rounded-full bg-blue-400/40 shrink-0 mt-1.5" />
                    <span className="text-[11px] text-white/50">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Buyer segment */}
          {hasSegment && (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold text-white/70">{rec.primarySegment} Buyers</span>
                  {rec.secondarySegment && (
                    <span className="text-[10px] text-white/25">· also {rec.secondarySegment}</span>
                  )}
                </div>
                <span className={cn("shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded border uppercase tracking-wide", langBadgeClass(rec.suggestedLanguage))}>
                  {rec.suggestedLanguage}
                </span>
              </div>
              {rec.whyThisAudience && (
                <p className="text-[10px] text-white/30 leading-relaxed">{rec.whyThisAudience}</p>
              )}
              {rec.adAngle && (
                <p className="text-[10px] text-white/45 italic">"{rec.adAngle}"</p>
              )}
            </div>
          )}
        </div>
      )}
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
      <div className="h-full flex overflow-hidden">

        {/* ── MAIN COLUMN ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-8 max-w-[900px]">

          {/* ── MISSION HEADER ─────────────────────────────────────────────── */}
          <div className="mb-8 pt-1">
            <p className="text-[9px] font-black text-blue-400/32 uppercase tracking-[0.28em] mb-5">
              Command · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
            <div className="flex items-end gap-6 mb-0">
              <div className="flex-1">
                <h1 className="text-[52px] font-black text-white tracking-tight leading-[0.9] mb-3">
                  {isLoading ? (
                    <span className="text-white/12">Loading…</span>
                  ) : plan ? (
                    <>
                      <span className="text-blue-400">{plan.recommendedToday.length}</span>
                      {" "}Move{plan.recommendedToday.length !== 1 ? "s" : ""}{"\n"}Today
                    </>
                  ) : (
                    "All Clear"
                  )}
                </h1>
                <p className="text-[16px] text-white/28 leading-relaxed font-normal max-w-lg">
                  {isLoading ? "" : plan?.summary ?? `${dealer?.name ?? "Alpha Motorsport"} — no action required right now.`}
                </p>
              </div>
              <Button
                className="shrink-0 h-11 gap-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-[14px] px-7 shadow-xl shadow-blue-500/20 rounded-xl mb-0.5"
                disabled={!plan?.recommendedToday[0] || isLoading}
                onClick={() => plan?.recommendedToday[0] && setPublishNowVehicleId(plan.recommendedToday[0].vehicleId)}
              >
                <UploadCloud className="w-4 h-4" />
                Publish Next Best
              </Button>
            </div>
          </div>

          {/* ── Metric strip ─────────────────────────────────────────────── */}
          <div className="flex items-stretch border-y border-white/[0.04] mb-8 -mx-8 px-8">
            {[
              { value: isLoading ? "—" : String(vehicleStats?.readyToPublish ?? plan?.recommendedToday.length ?? 0), label: "Ready", accent: "text-blue-400", path: "/listings" },
              { value: isLoading ? "—" : String(listingsLive), label: "Live", accent: listingsLive > 0 ? "text-green-400" : "text-white/15", path: "/listings?tab=published" },
              { value: isLoading ? "—" : String(pendingLeads), label: "Buyers", accent: pendingLeads > 0 ? "text-violet-400" : "text-white/15", path: "/sales-ai" },
              { value: "0", label: "Appts", accent: "text-white/15", path: "/sales-ai" },
              { value: isLoading ? "—" : String(issueCount), label: "Issues", accent: issueCount > 0 ? "text-red-400" : "text-white/15", path: "/listings?tab=failed" },
            ].map((m) => (
              <button
                key={m.label}
                onClick={() => setLocation(m.path)}
                className="flex-1 py-5 px-4 text-left hover:bg-white/[0.02] transition-colors border-r border-white/[0.04] last:border-r-0 first:pl-0 last:pr-0"
              >
                <div className={cn("text-[40px] font-black leading-none mb-1.5 tracking-tighter", m.accent)}>{m.value}</div>
                <div className="text-[9px] font-bold text-white/18 uppercase tracking-[0.18em]">{m.label}</div>
              </button>
            ))}
          </div>

          {/* ── Command queue ──────────────────────────────────────────────── */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-5">
              <p className="text-[9px] font-black text-white/18 uppercase tracking-[0.22em]">Command Queue</p>
              {plan && <span className="text-[9px] font-bold text-blue-400/38 font-mono">{plan.recommendedToday.length} vehicles</span>}
              <div className="flex-1 h-px bg-white/[0.04]" />
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-[84px] rounded-2xl bg-white/[0.015] animate-pulse" />)}
              </div>
            ) : !plan || plan.recommendedToday.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.04] bg-white/[0.01] p-12 text-center">
                <CheckCircle2 className="w-7 h-7 text-emerald-400/22 mx-auto mb-3" />
                <p className="text-[14px] font-semibold text-white/30">Queue is clear</p>
                <p className="text-[11px] text-white/18 mt-1.5">
                  {queuedCount > 0 ? `${queuedCount} vehicle${queuedCount !== 1 ? "s" : ""} already publishing` : "No vehicles require action right now"}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
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

            {plan && plan.duplicateGroups.length > 0 && (
              <div className="mt-5"><CommandCenterDuplicates groups={plan.duplicateGroups} /></div>
            )}

            {plan && plan.holdToday.length > 0 && (
              <div className="mt-5">
                <button className="flex items-center gap-2 w-full mb-3" onClick={() => setShowHold(v => !v)}>
                  <p className="text-[9px] font-black text-white/18 uppercase tracking-[0.22em]">Hold Today · {plan.holdToday.length}</p>
                  <div className="flex-1 h-px bg-white/[0.04]" />
                  {showHold ? <ChevronUp className="w-3 h-3 text-white/18" /> : <ChevronDown className="w-3 h-3 text-white/18" />}
                </button>
                {showHold && (
                  <div className="space-y-1.5">
                    {plan.holdToday.slice(0, 8).map(rec => <HoldCard key={rec.vehicleId} rec={rec} />)}
                  </div>
                )}
              </div>
            )}
          </div>

          </div>
        </div>

        {/* ── RIGHT: System Timeline ────────────────────────────────────────── */}
        <div className="w-[260px] shrink-0 border-l border-white/[0.04] flex flex-col h-full">
          <div className="px-5 pt-5 pb-3.5 border-b border-white/[0.04] shrink-0">
            <div className="flex items-center gap-2">
              <span className="relative flex h-[6px] w-[6px] shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-40" />
                <span className="relative inline-flex rounded-full h-[6px] w-[6px] bg-blue-400" />
              </span>
              <p className="text-[9px] font-black text-white/22 uppercase tracking-[0.22em]">System Timeline</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {activityItems.length === 0 ? (
              <div className="p-8 text-center text-white/15 text-[12px]">No recent activity</div>
            ) : (
              <div className="flex flex-col">
                {activityItems.map((item, idx) => (
                  <div key={item.id} className="px-5 py-3 border-b border-white/[0.03] hover:bg-white/[0.015] transition-colors relative">
                    {idx === 0 && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-blue-500 via-blue-500/30 to-transparent" />}
                    <div className="flex items-start gap-2.5">
                      <span className={cn("w-[5px] h-[5px] rounded-full mt-[5px] shrink-0 opacity-70", item.color)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-white/60 leading-snug">{item.label}</p>
                        <p className="text-[10px] text-white/20 truncate mt-0.5">{item.sub}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[9px] text-white/12 font-mono">{format(item.date, "HH:mm")}</p>
                          {item.action && item.actionPath && (
                            <button
                              className="text-[9px] text-blue-400/40 hover:text-blue-400 font-bold uppercase tracking-wider transition-colors"
                              onClick={() => setLocation(item.actionPath!)}
                            >
                              {item.action} →
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
