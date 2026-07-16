import { useState, useMemo } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/shared/layout/AppLayout";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDealerLocation } from "@/context/LocationContext";
import {
  useAssignPublishingJob,
  useCancelPublishingJob,
  useRetryPublishingJob,
  useMarkListingPublished,
  useBulkVehicleAction,
  useBulkSchedulePublishing,
  getListListingWorkspacesQueryKey,
  getListPublishingJobsQueryKey,
  clearPublishingQueue,
  reschedulePublishingJob,
} from "../api/listingsApi";
import { useListings } from "../hooks/useListings";
import { Card, CardContent } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Search,
  Car,
  Sparkles,
  Loader2,
  Gauge,
  CheckCircle2,
  Share,
  AlertTriangle,
  PenTool,
  ImageIcon,
  Wand2,
  Eye,
  UploadCloud,
  X,
  ListChecks,
  Tag,
  Archive,
  CalendarClock,
  MoreHorizontal,
  TrendingUp,
  Star,
  HelpCircle,
  Users,
  ChevronRight,
  LayoutGrid,
  List,
  ArrowUpDown,
  ScanSearch,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { PageHeader, EmptyState, SectionCard } from "@/shared/ui";
import { AutoPublishPlan } from "./AutoPublishPlan";
import { BatchProgressCard } from "./BatchProgressCard";
import { PublishedCard } from "./PublishedCard";
import { MarkPublishedModal } from "./MarkPublishedModal";
import { BatchReviewPanel } from "./BatchReviewPanel";
import { DailyOperatorPanel } from "./DailyOperatorPanel";
import { BatchTodayPanel, type BatchVehicle } from "./BatchTodayPanel";
import { PublishNowModal } from "@/features/publishing/components/PublishNowModal";
import { toast } from "@/hooks/use-toast";

type StrategyStatus = "recommended" | "not_prioritized" | "needs_strategy_review";

const DEALER_ID = 1;
const PRIMARY_TABS = new Set(["ready", "scheduled", "published", "failed", "all"]);
const LEGACY_TAB_MAP: Record<string, string> = {
  generating: "all",
  publishing: "all",
  "needs-update": "published",
  sold: "published",
  "needs-review": "all",
  queue: "all",
};

function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function getStrategyStatus(
  intel: { strategyName: string | null } | undefined,
): StrategyStatus {
  if (!intel?.strategyName) return "needs_strategy_review";
  const s = intel.strategyName.toLowerCase();
  if (s.includes("price review")) return "needs_strategy_review";
  const isHigh =
    s.includes("truck") || s.includes("suv") || s.includes("performance") ||
    s.includes("luxury") || s.includes("fast turn") || s.includes("premium");
  return isHigh ? "recommended" : "not_prioritized";
}

const STRATEGY_STATUS_CONFIG: Record<
  StrategyStatus,
  { label: string; color: string; bg: string; border: string; icon: React.ElementType }
> = {
  recommended: {
    label: "Strategy: High Priority",
    color: "text-rose-400",
    bg: "bg-rose-500/8",
    border: "border-rose-500/20",
    icon: TrendingUp,
  },
  not_prioritized: {
    label: "Ready, not prioritized",
    color: "text-amber-400",
    bg: "bg-amber-500/8",
    border: "border-amber-500/20",
    icon: Star,
  },
  needs_strategy_review: {
    label: "Needs strategy review",
    color: "text-muted-foreground",
    bg: "bg-secondary/30",
    border: "border-border/40",
    icon: HelpCircle,
  },
};

function ratingClass(rating: string | null | undefined) {
  switch (rating) {
    case "Excellent":
      return "bg-success/10 text-success border-success/20";
    case "Good":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "Needs Improvement":
      return "bg-warning/10 text-warning border-warning/20";
    default:
      return "bg-secondary text-muted-foreground border-border";
  }
}

function publishStatusClass(status: string) {
  switch (status) {
    case "Published":
      return "bg-success/80 text-success-foreground border-success/20";
    case "Assigned":
      return "bg-indigo-500/80 text-white border-indigo-500/20";
    case "Opening Facebook":
    case "Filling Form":
      return "bg-violet-500/80 text-white border-violet-500/20";
    case "Ready for Review":
      return "bg-amber-500/80 text-white border-amber-500/20";
    case "Approved":
    case "Queued":
    case "Scheduled":
    case "Publishing":
      return "bg-blue-500/80 text-white border-blue-500/20";
    case "Failed":
    case "Retry":
      return "bg-destructive/80 text-destructive-foreground border-destructive/20";
    case "Needs Review":
      return "bg-warning/80 text-warning-foreground border-warning/20";
    default:
      return "bg-secondary/80 text-secondary-foreground border-secondary/20";
  }
}

function getStatusBadge(w: { publishStatus: string; aiStatus: string }) {
  if (w.publishStatus === "Published") {
    return (
      <Badge className="absolute top-4 right-4 z-10 backdrop-blur-md uppercase text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full text-white bg-success/90 border-0 hover:bg-success/90">
        LIVE
      </Badge>
    );
  }
  if (w.aiStatus === "Generating") {
    return (
      <Badge className="absolute top-4 right-4 z-10 backdrop-blur-md uppercase text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full text-white bg-warning/80 border-0 hover:bg-warning/80 flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" /> GENERATING
      </Badge>
    );
  }
  if (w.publishStatus === "Approved" || w.publishStatus === "Queued") {
    return (
      <Badge className="absolute top-4 right-4 z-10 backdrop-blur-md uppercase text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full text-white bg-primary/90 border-0 hover:bg-primary/90">
        READY
      </Badge>
    );
  }
  return null;
}

function PhotoBadge({
  decision,
  score,
}: {
  decision: string | undefined;
  score: number | undefined;
}) {
  if (!decision || decision === "needs_review") {
    return (
      <Badge className="absolute bottom-4 left-4 z-10 backdrop-blur-md text-[10px] font-bold px-2 py-0.5 rounded-md bg-warning/80 text-warning-foreground border-0 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        Review Photos
      </Badge>
    );
  }
  if (decision === "use_original") {
    return (
      <Badge className="absolute bottom-4 left-4 z-10 backdrop-blur-md text-[10px] font-bold px-2 py-0.5 rounded-md bg-success/80 text-success-foreground border-0 flex items-center gap-1">
        <ImageIcon className="w-3 h-3" />
        {score ?? "—"} · Original
      </Badge>
    );
  }
  if (decision === "use_original_recommend_ai_cover") {
    return (
      <Badge className="absolute bottom-4 left-4 z-10 backdrop-blur-md text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-500/80 text-white border-0 flex items-center gap-1">
        <Eye className="w-3 h-3" />
        {score ?? "—"} · AI Cover Rec
      </Badge>
    );
  }
  if (decision === "generate_ai_creative") {
    return (
      <Badge className="absolute bottom-4 left-4 z-10 backdrop-blur-md text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-500/80 text-white border-0 flex items-center gap-1">
        <Wand2 className="w-3 h-3" />
        AI Creative Needed
      </Badge>
    );
  }
  return null;
}

export function ListingsWorkspace() {
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === "undefined") return "ready";
    const tab = new URLSearchParams(window.location.search).get("tab") ?? "ready";
    return PRIMARY_TABS.has(tab) ? tab : LEGACY_TAB_MAP[tab] ?? "ready";
  });

  const [search, setSearch] = useState("");
  const [queueTab, setQueueTab] = useState<"active" | "needs-review" | "completed" | "failed-history">("active");
  const [batchRefreshKey, setBatchRefreshKey] = useState(0);
  const [markPublishedVehicle, setMarkPublishedVehicle] = useState<{ id: number; label: string } | null>(null);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<number>>(new Set());
  const [showBatchReview, setShowBatchReview] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [sortBy, setSortBy] = useState<"priority" | "photo_count" | "price" | "newest" | "needs_review">("priority");
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [publishNowVehicleId, setPublishNowVehicleId] = useState<number | null>(null);
  const [batchTodayOpen, setBatchTodayOpen] = useState(false);
  const [batchTodayVehicles, setBatchTodayVehicles] = useState<BatchVehicle[]>([]);
  const [photoFilter, setPhotoFilter] = useState<string | null>(null);
  const [clearingQueue, setClearingQueue] = useState(false);
  const [rescheduleValues, setRescheduleValues] = useState<Record<number, string>>({});

  const toggleSelected = (id: number) => {
    setSelectedVehicleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedVehicleIds(new Set(filteredSortedWorkspaces.map((w) => w.vehicleId)));
  const clearSelection = () => setSelectedVehicleIds(new Set());
  const handleTabChange = (tab: string) => { setActiveTab(tab); setSelectedVehicleIds(new Set()); };
  const selectionCount = selectedVehicleIds.size;

  const queryClient = useQueryClient();

  const invalidateWorkspaces = () => {
    queryClient.invalidateQueries({ queryKey: getListListingWorkspacesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListPublishingJobsQueryKey() });
  };

  const handleClearTestQueue = async () => {
    setClearingQueue(true);
    try {
      const data = await clearPublishingQueue(10);
      toast({
        title: "Test queue cleared",
        description: data.cleared > 0
          ? `Cancelled ${data.cleared} job${data.cleared !== 1 ? "s" : ""} older than 10 min.`
          : "No qualifying jobs found (none older than 10 min).",
      });
      queryClient.invalidateQueries({ queryKey: getListPublishingJobsQueryKey() });
    } catch {
      toast({ title: "Clear failed", description: "Could not reach the server.", variant: "destructive" });
    } finally {
      setClearingQueue(false);
    }
  };

  const { selectedLocation } = useDealerLocation();
  const locationFilter = selectedLocation || undefined;

  const {
    workspacesData,
    workspacesLoading,
    jobsData,
    jobsLoading,
    photoScoreByVehicle,
    intelligenceMap,
    recommendations,
  } = useListings({ search, statusFilter: "all", location: locationFilter });

  const assignMutation = useAssignPublishingJob({
    mutation: { onSuccess: () => void invalidateWorkspaces() },
  });
  const cancelMutation = useCancelPublishingJob({
    mutation: { onSuccess: () => void invalidateWorkspaces() },
  });
  const rescheduleMutation = useMutation({
    mutationFn: ({ jobId, scheduledAt }: { jobId: number; scheduledAt: string }) =>
      reschedulePublishingJob(jobId, scheduledAt),
    onSuccess: () => {
      toast({ title: "Schedule updated", description: "The publishing queue was updated." });
      void invalidateWorkspaces();
    },
    onError: (err: Error) =>
      toast({ title: "Schedule update failed", description: err.message, variant: "destructive" }),
  });
  const retryMutation = useRetryPublishingJob({
    mutation: {
      onSuccess: () => {
        toast({ title: "Job queued for retry", description: "The extension will pick it up on the next poll." });
        void invalidateWorkspaces();
      },
      onError: () => toast({ title: "Error", description: "Failed to retry job", variant: "destructive" }),
    },
  });

  const markPublishedMutation = useMarkListingPublished({
    mutation: {
      onSuccess: (_, vars) => {
        toast({ title: "Marked as Published", description: "Listing is now live and being tracked." });
        setMarkPublishedVehicle(null);
        invalidateWorkspaces();
      },
      onError: () => toast({ title: "Error", description: "Failed to mark listing as published", variant: "destructive" }),
    },
  });

  const bulkVehicleAction = useBulkVehicleAction({
    mutation: {
      onSuccess: () => { invalidateWorkspaces(); },
      onError: () => toast({ title: "Error", description: "Action failed", variant: "destructive" }),
    },
  });

  const bulkSchedule = useBulkSchedulePublishing();

  const autoSelectHighPriority = () => {
    const allWorkspaces = workspacesData?.workspaces ?? [];
    const highPriorityIds = allWorkspaces
      .filter((w) => {
        if (w.publishStatus === "Published") return false;
        const intel = intelligenceMap.get(w.vehicleId);
        const strategy = (intel?.strategyName ?? "").toLowerCase();
        const photoEntry = photoScoreByVehicle.get(w.vehicleId);
        const photoScore = photoEntry?.photoScore ?? 0;
        const listingScore = w.listingScore ?? 0;
        const isHighDemand =
          strategy.includes("truck") ||
          strategy.includes("suv") ||
          strategy.includes("performance") ||
          strategy.includes("luxury") ||
          strategy.includes("fast turn") ||
          strategy.includes("premium");
        return isHighDemand && listingScore >= 50 && photoScore >= 55;
      })
      .map((w) => w.vehicleId);
    setSelectedVehicleIds(new Set(highPriorityIds.length > 0 ? highPriorityIds : allWorkspaces.slice(0, 8).map((w) => w.vehicleId)));
  };

  const workspaces = workspacesData?.workspaces ?? [];
  const readyCount = workspaces.filter(
    (w) => w.publishStatus === "Approved" || w.publishStatus === "Queued",
  ).length;
  const publishedWorkspacesCount = workspaces.filter(
    (w) => w.publishStatus === "Published",
  ).length;
  const scheduledWorkspaceCount = workspaces.filter((w) => w.publishStatus === "Scheduled").length;
  const failedCount = workspaces.filter((w) => w.publishStatus === "Failed").length;
  const allCount = workspaces.length;

  const jobs = jobsData?.jobs ?? [];
  const scheduledJobs = jobs
    .filter((j) => j.status === "Scheduled" || Boolean(j.scheduledAt && ["Queued", "Retry"].includes(j.status)))
    .sort((a, b) => new Date(a.scheduledAt ?? a.createdAt).getTime() - new Date(b.scheduledAt ?? b.createdAt).getTime());
  const scheduledJobVehicleIds = new Set(scheduledJobs.map((j) => j.vehicleId));
  const scheduledCount = Math.max(scheduledWorkspaceCount, scheduledJobs.length);
  const ACTIVE_STATUSES = new Set([
    "Queued", "Scheduled", "Retry", "Assigned", "Claimed", "Publishing",
    "Opening Facebook", "Downloading Photos", "Uploading Photos",
    "Waiting For Thumbnails", "Filling Form", "Ready for Review", "Ready For Review",
  ]);
  const displayedJobs = jobs.filter((job) => {
    if (queueTab === "active")         return ACTIVE_STATUSES.has(job.status);
    if (queueTab === "needs-review")   return job.status === "Needs Review";
    if (queueTab === "completed")      return job.status === "Published";
    if (queueTab === "failed-history") return job.status === "Failed" || job.status === "Cancelled";
    return true;
  });
  const activeJobCount        = jobs.filter((j) => ACTIVE_STATUSES.has(j.status)).length;
  const queueNeedsReviewCount = jobs.filter((j) => j.status === "Needs Review").length;

  const filteredWorkspaces = workspaces.filter((w) => {
    if (activeTab === "ready") return w.publishStatus === "Approved" || w.publishStatus === "Queued";
    if (activeTab === "scheduled") return w.publishStatus === "Scheduled" || scheduledJobVehicleIds.has(w.vehicleId);
    if (activeTab === "published") return w.publishStatus === "Published";
    if (activeTab === "failed") return w.publishStatus === "Failed";
    return true;
  });

  const filteredSortedWorkspaces = useMemo(() => {
    let list = [...filteredWorkspaces];
    if (photoFilter) {
      list = list.filter((w) => {
        const entry = photoScoreByVehicle.get(w.vehicleId);
        const score = entry?.photoScore ?? 0;
        const decision = entry?.photoDecision;
        if (photoFilter === "use_original") return decision === "use_original" || score >= 88;
        if (photoFilter === "enhance") return decision === "enhance" || (score >= 60 && score < 88);
        if (photoFilter === "review") return !decision || score < 60;
        return true;
      });
    }
    switch (sortBy) {
      case "photo_count":
        list.sort((a, b) => (b.imageCount ?? 0) - (a.imageCount ?? 0));
        break;
      case "price":
        list.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
        break;
      case "priority":
        list.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
        break;
      case "needs_review":
        list.sort((a) => (a.publishStatus === "Needs Review" ? -1 : 1));
        break;
      default:
        break;
    }
    return list;
  }, [filteredWorkspaces, sortBy, photoFilter, photoScoreByVehicle]);

  const isPublishedTab = activeTab === "published";
  const isCardTab = !isPublishedTab &&
    ["ready", "scheduled", "failed", "all"].includes(activeTab);

  const tabClass =
    "text-[10px] font-bold uppercase tracking-[0.15em] px-3 py-1.5 rounded-none border-0 border-b-2 border-transparent data-[state=active]:border-green-400 data-[state=active]:text-green-400 data-[state=inactive]:text-white/30 data-[state=inactive]:hover:text-white/55 gap-1.5 transition-all bg-transparent data-[state=active]:bg-transparent shadow-none";

  const countBadge = (n: number) =>
    n > 0 ? (
      <span className="text-[9px] font-black tabular-nums opacity-60">{n}</span>
    ) : null;

  const handleMarkPublished = (marketplaceUrl: string) => {
    if (!markPublishedVehicle) return;
    markPublishedMutation.mutate({
      vehicleId: markPublishedVehicle.id,
      data: { marketplaceUrl },
    });
  };

  const handleRenew = (vehicleId: number) => {
    bulkVehicleAction.mutate({ data: { vehicleIds: [vehicleId], action: "mark_ready" } });
    toast({ title: "Queued for renewal", description: "Vehicle moved to Ready to Publish." });
  };

  const handleMarkSold = (vehicleId: number) => {
    bulkVehicleAction.mutate({ data: { vehicleIds: [vehicleId], action: "mark_sold" } });
  };

  const handleUpdateListing = (vehicleId: number) => {
    bulkVehicleAction.mutate({ data: { vehicleIds: [vehicleId], action: "mark_ready" } });
    toast({ title: "Queued for update", description: "Vehicle moved to Ready queue for republishing." });
  };

  const handleRemoveFromMarketplace = (vehicleId: number) => {
    bulkVehicleAction.mutate({ data: { vehicleIds: [vehicleId], action: "mark_sold" } });
    toast({ title: "Marked as sold", description: "Listing flagged for removal." });
  };

  const handleArchive = (vehicleId: number) => {
    bulkVehicleAction.mutate({ data: { vehicleIds: [vehicleId], action: "archive" } });
  };

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-[1600px] mx-auto animate-in fade-in duration-400">
          <PageHeader
            eyebrow="Marketplace"
            module="marketplace"
            title="Publishing Cockpit"
            description={`${allCount} listing workspaces · ${publishedWorkspacesCount} live · ${readyCount} ready`}
            action={
              <Link href="/listings/readiness">
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[11px] text-white/35 hover:text-white/70">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Readiness
                </Button>
              </Link>
            }
            className="mb-0"
          />

          {/* Tab rail */}
          <Tabs value={activeTab} onValueChange={handleTabChange} className="mt-0">
            <TabsList className="bg-transparent border-0 border-b border-white/[0.04] gap-0 flex-nowrap overflow-x-auto whitespace-nowrap w-full rounded-none h-auto px-0 pb-0 justify-start">
              <TabsTrigger value="ready" className={tabClass}>
                Ready {countBadge(readyCount)}
              </TabsTrigger>
              <TabsTrigger value="scheduled" className={tabClass}>
                Schedule {countBadge(scheduledCount)}
              </TabsTrigger>
              <TabsTrigger value="published" className={tabClass}>
                Live {countBadge(publishedWorkspacesCount)}
              </TabsTrigger>
              <TabsTrigger value="failed" className={cn(tabClass, failedCount > 0 && "data-[state=inactive]:text-red-400/60")}>
                Failed {countBadge(failedCount)}
              </TabsTrigger>
              <TabsTrigger value="all" className={tabClass}>
                All {countBadge(allCount)}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-6 mt-6">

          {/* AI Daily Operator Panel */}
          {activeTab !== "published" && (
            <DailyOperatorPanel
              workspaces={workspacesData?.workspaces ?? []}
              recommendations={recommendations as never}
              activeJobs={jobsData?.jobs ?? []}
              onPublish={(vehicleId) => setPublishNowVehicleId(vehicleId)}
              onAddToBatch={(vehicleId) => {
                bulkSchedule.mutate({ data: { vehicleIds: [vehicleId], spacingMinutes: 30 } }, {
                  onSuccess: () => { toast({ title: "Added to batch", description: "Vehicle added to publishing queue." }); invalidateWorkspaces(); },
                });
              }}
              onPublishBatch={(vehicleIds) => {
                const vehicles: BatchVehicle[] = vehicleIds.map((id) => {
                  const ws = workspacesData?.workspaces.find((w) => w.vehicleId === id);
                  return { id, label: ws?.label ?? `Vehicle #${id}` };
                });
                setBatchTodayVehicles(vehicles);
                setBatchTodayOpen(true);
              }}
              publishingId={publishingId}
              isPending={bulkSchedule.isPending}
            />
          )}

          {/* Auto Publish Plan */}
          <AutoPublishPlan
            dealerId={DEALER_ID}
            onBatchCreated={() => setBatchRefreshKey((k) => k + 1)}
          />

          {/* Batch Progress */}
          <BatchProgressCard dealerId={DEALER_ID} refreshKey={batchRefreshKey} location={locationFilter} />

          {/* ── Live tab — engagement-rich cards ── */}
          {isPublishedTab && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-3 py-3 border-b border-white/[0.04]">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/22" />
                  <Input
                    placeholder="VIN, make, model…"
                    className="pl-9 h-8 text-[13px] bg-transparent border-white/[0.08] focus-visible:ring-0 focus-visible:border-green-500/40 text-white/70 placeholder:text-white/18"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              {workspacesLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5 gap-4">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="rounded-lg bg-card border border-border/50 h-[310px] animate-pulse">
                      <div className="h-[150px] bg-secondary/50 rounded-t-lg" />
                      <div className="p-3 space-y-2.5">
                        <div className="h-5 bg-secondary/80 rounded w-2/3" />
                        <div className="h-4 bg-secondary/50 rounded w-1/3" />
                        <div className="h-10 bg-secondary/30 rounded" />
                        <div className="flex gap-2 pt-2">
                          <div className="h-7 bg-secondary/80 rounded w-1/3" />
                          <div className="h-7 bg-secondary/50 rounded w-1/4" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredWorkspaces.length === 0 ? (
                <EmptyState
                  icon={<Share className="w-8 h-8" />}
                  title={
                    activeTab === "published" ? "No live listings" :
                    "No live listings"
                  }
                  description={
                    activeTab === "published"
                      ? "Publish listings from the Ready tab to see them here with engagement tracking."
                      : "Publish listings from the Ready tab to see them here with engagement tracking."
                  }
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5 gap-4">
                  {filteredWorkspaces.map((w) => (
                    <PublishedCard
                      key={w.vehicleId}
                      workspace={w}
                      tab={activeTab}
                      onMarkSold={handleMarkSold}
                      onRenew={handleRenew}
                      onUpdateListing={handleUpdateListing}
                      onRemoveFromMarketplace={handleRemoveFromMarketplace}
                      onArchive={handleArchive}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Ready / Generating / Scheduled / etc — standard workspace cards ── */}
          {isCardTab && (
            <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
              {/* Toolbar */}
              <div className="flex flex-col sm:flex-row gap-3 items-center py-3 border-y border-white/[0.04]">
                <div className="relative flex-1 w-full max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/22" />
                  <Input
                    placeholder="VIN, make, model…"
                    className="pl-9 h-8 text-[13px] bg-transparent border-white/[0.08] focus-visible:ring-0 focus-visible:border-green-500/40 text-white/70 placeholder:text-white/18"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0 ml-auto">
                  {selectionCount > 0 ? (
                    <>
                      <span className="text-[11px] text-green-400 font-bold">{selectionCount} selected</span>
                      <Button size="sm" variant="ghost" onClick={selectAll} className="h-7 text-[11px] px-2 text-white/40 hover:text-white/70">All</Button>
                      <Button size="sm" variant="ghost" onClick={clearSelection} className="h-7 w-7 p-0 text-white/30 hover:text-white/60"><X className="w-3 h-3" /></Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={selectAll} className="h-7 text-[11px] px-2.5 gap-1.5 text-white/30 hover:text-white/60">
                      <ListChecks className="w-3 h-3" /> Select All
                    </Button>
                  )}
                  <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                    <SelectTrigger className="w-[140px] h-7 text-[12px] bg-transparent border-white/[0.08] text-white/45 gap-1">
                      <ArrowUpDown className="w-3 h-3 text-white/22 shrink-0" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="priority">Priority Score</SelectItem>
                      <SelectItem value="photo_count">Photo Count</SelectItem>
                      <SelectItem value="price">Price</SelectItem>
                      <SelectItem value="newest">Newest</SelectItem>
                      <SelectItem value="needs_review">Needs Review First</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center rounded-lg border border-white/[0.07] overflow-hidden shrink-0">
                    <button
                      onClick={() => setViewMode("list")}
                      className={cn("flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold transition-colors", viewMode === "list" ? "bg-green-500/10 text-green-400" : "text-white/25 hover:text-white/50")}
                    ><List className="w-3 h-3" /> List</button>
                    <div className="w-px h-4 bg-white/[0.06]" />
                    <button
                      onClick={() => setViewMode("grid")}
                      className={cn("flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold transition-colors", viewMode === "grid" ? "bg-green-500/10 text-green-400" : "text-white/25 hover:text-white/50")}
                    ><LayoutGrid className="w-3 h-3" /> Grid</button>
                  </div>
                </div>
              </div>

              {activeTab === "scheduled" && (
                <SectionCard className="p-0 overflow-hidden border-border/50">
                  <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.04]">
                    <div>
                      <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <CalendarClock className="w-4 h-4 text-primary" />
                        Scheduled publishing plan
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        These are the vehicles waiting for the extension to publish at the planned time.
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                      {scheduledJobs.length} planned
                    </Badge>
                  </div>
                  {scheduledJobs.length === 0 ? (
                    <EmptyState
                      icon={<CalendarClock className="w-8 h-8" />}
                      title="No scheduled vehicles"
                      description="Scheduled auto-publish jobs will appear here with their planned publish time."
                    />
                  ) : (
                    <Table>
                      <TableHeader className="bg-secondary/30">
                        <TableRow className="hover:bg-transparent border-border/50">
                          <TableHead className="font-medium">Vehicle</TableHead>
                          <TableHead className="font-medium">Planned time</TableHead>
                          <TableHead className="font-medium">Status</TableHead>
                          <TableHead className="font-medium">Mode</TableHead>
                          <TableHead className="font-medium text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {scheduledJobs.map((job) => {
                          const value = rescheduleValues[job.id] ?? toDateTimeLocalValue(job.scheduledAt);
                          return (
                            <TableRow key={job.id} className="border-border/30 hover:bg-secondary/20 transition-colors">
                              <TableCell className="font-medium">
                                <Link
                                  href={`/listings/${job.vehicleId}`}
                                  className="text-foreground hover:text-primary hover:underline transition-colors"
                                >
                                  {job.vehicleLabel || `Vehicle #${job.vehicleId}`}
                                </Link>
                                {job.listingTitle && (
                                  <div className="text-xs text-muted-foreground truncate max-w-[280px] mt-0.5">
                                    {job.listingTitle}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-1.5">
                                  <Input
                                    type="datetime-local"
                                    value={value}
                                    onChange={(e) =>
                                      setRescheduleValues((prev) => ({ ...prev, [job.id]: e.target.value }))
                                    }
                                    className="h-8 w-[190px] text-xs bg-transparent border-white/[0.08]"
                                  />
                                  <span className="text-[10px] text-muted-foreground">
                                    Current: {formatDate(job.scheduledAt)}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={cn("px-2 py-0.5", publishStatusClass(job.status))}>
                                  {job.status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="bg-secondary/50 text-muted-foreground border-border text-[10px] uppercase tracking-wider">
                                  {(job as { mode?: string }).mode ?? "Assisted"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs border-primary/40 text-primary hover:bg-primary/10"
                                    disabled={!value || rescheduleMutation.isPending}
                                    onClick={() => {
                                      const next = new Date(value);
                                      if (Number.isNaN(next.getTime())) {
                                        toast({ title: "Invalid time", description: "Choose a valid publish time.", variant: "destructive" });
                                        return;
                                      }
                                      rescheduleMutation.mutate({ jobId: job.id, scheduledAt: next.toISOString() });
                                    }}
                                  >
                                    {rescheduleMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Change"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                                    disabled={cancelMutation.isPending}
                                    onClick={() =>
                                      cancelMutation.mutate({
                                        id: job.id,
                                        data: { reason: "Cancelled from scheduled plan" },
                                      })
                                    }
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </SectionCard>
              )}

              <div className="text-[10px] text-white/18 font-mono">
                {filteredSortedWorkspaces.length} vehicle{filteredSortedWorkspaces.length !== 1 ? "s" : ""}
              </div>

              {/* Vehicle list / grid */}
              {workspacesLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div
                      key={i}
                      className="rounded-xl bg-card border border-border/50 h-[400px] animate-pulse"
                    >
                      <div className="h-[250px] bg-secondary/50 rounded-t-xl" />
                      <div className="p-6 space-y-3">
                        <div className="h-6 bg-secondary/80 rounded w-3/4" />
                        <div className="h-4 bg-secondary/50 rounded w-1/2" />
                        <div className="pt-4 flex justify-between">
                          <div className="h-8 bg-secondary/80 rounded w-1/3" />
                          <div className="h-8 bg-secondary/50 rounded w-1/4" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredSortedWorkspaces.length === 0 ? (
                <EmptyState
                  icon={<Sparkles className="w-8 h-8" />}
                  title="No workspaces found"
                  description="DealerPilot hasn't identified any listings matching this view."
                />
              ) : viewMode === "list" ? (
                /* ── Compact List View ── */
                <div className="rounded-xl border border-border/40 overflow-hidden">
                  {/* List header */}
                  <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04] text-[9px] font-black uppercase tracking-[0.18em] text-white/18">
                    <div className="w-5 flex-shrink-0">
                      <Checkbox
                        checked={selectionCount === filteredSortedWorkspaces.length && filteredSortedWorkspaces.length > 0}
                        onCheckedChange={(checked) => checked ? selectAll() : clearSelection()}
                      />
                    </div>
                    <div className="w-[72px] flex-shrink-0">Photo</div>
                    <div className="flex-1 min-w-0">Vehicle</div>
                    <div className="w-[90px] text-center flex-shrink-0 hidden lg:block">Score</div>
                    <div className="w-[120px] flex-shrink-0 hidden md:block">Price</div>
                    <div className="w-[150px] flex-shrink-0 hidden xl:block">Strategy</div>
                    <div className="w-[120px] flex-shrink-0 text-right">Action</div>
                  </div>
                  {filteredSortedWorkspaces.map((w) => {
                    const photoEntry = photoScoreByVehicle.get(w.vehicleId);
                    const intel = intelligenceMap.get(w.vehicleId);
                    const strategyStatus = getStrategyStatus(intel);
                    const statusCfg = STRATEGY_STATUS_CONFIG[strategyStatus];
                    const isSelected = selectedVehicleIds.has(w.vehicleId);
                    const isReady = w.publishStatus === "Approved" || w.publishStatus === "Queued";
                    const photoScore = photoEntry?.photoScore;
                    const decision = photoEntry?.photoDecision;
                    const mpPrice = (w.price ?? 0) >= 16000 ? (w.downPayment ?? null) : null;
                    const recLabel = !decision ? null
                      : decision === "use_original" ? "Use Original"
                      : decision === "enhance" ? "Enhance"
                      : "Review";
                    const recColor = !decision ? ""
                      : decision === "use_original" ? "text-success bg-success/10"
                      : decision === "enhance" ? "text-amber-400 bg-amber-500/10"
                      : "text-muted-foreground bg-muted/30";
                    return (
                      <div
                        key={w.vehicleId}
                        className={cn(
                          "flex items-center gap-3 px-4 py-2.5 min-h-[72px] border-b border-white/[0.03] last:border-b-0 transition-colors hover:bg-white/[0.015]",
                          isSelected && "bg-green-500/[0.04] border-l-2 border-l-green-500/40"
                        )}
                      >
                        <div className="w-5 flex-shrink-0">
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleSelected(w.vehicleId)} />
                        </div>
                        {/* Thumbnail */}
                        <div className="relative w-[72px] h-[52px] flex-shrink-0 rounded-lg overflow-hidden bg-secondary/50">
                          {w.primaryImageUrl ? (
                            <img src={w.primaryImageUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Car className="w-5 h-5 text-muted-foreground/30" />
                            </div>
                          )}
                          {(w.imageCount ?? 0) > 0 && (
                            <div className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5 bg-black/70 text-white text-[8px] font-bold px-1 py-0.5 rounded">
                              <ImageIcon className="w-2 h-2" />{w.imageCount}
                            </div>
                          )}
                        </div>
                        {/* Vehicle info */}
                        <div className="flex-1 min-w-0">
                          <Link href={`/listings/${w.vehicleId}`}>
                            <div className="font-semibold text-sm text-foreground hover:text-primary truncate transition-colors cursor-pointer">
                              {w.label}
                            </div>
                          </Link>
                          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                            {w.vin && <span className="font-mono">{w.vin.slice(-6)}</span>}
                            {w.bodyStyle && <><span className="text-border/80">·</span><span>{w.bodyStyle}</span></>}
                            {w.publishStatus && (
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest",
                                w.publishStatus === "Approved" || w.publishStatus === "Queued" ? "bg-success/10 text-success" :
                                w.publishStatus === "Needs Review" ? "bg-red-500/10 text-red-400" :
                                w.publishStatus === "Published" ? "bg-primary/10 text-primary" :
                                "bg-muted text-muted-foreground"
                              )}>
                                {w.publishStatus}
                              </span>
                            )}
                          </div>
                          {recLabel && (
                            <span className={cn("inline-flex items-center text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5", recColor)}>
                              {recLabel}
                            </span>
                          )}
                        </div>
                        {/* AI score */}
                        <div className="w-[90px] flex-shrink-0 text-center hidden lg:block">
                          {photoScore != null ? (
                            <div className={cn(
                              "inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold",
                              photoScore >= 88 ? "bg-success/15 text-success" :
                              photoScore >= 65 ? "bg-amber-500/15 text-amber-400" :
                              "bg-red-500/15 text-red-400"
                            )}>
                              <Gauge className="w-3 h-3" />{photoScore}
                            </div>
                          ) : <span className="text-muted-foreground text-[10px]">—</span>}
                        </div>
                        {/* Prices */}
                        <div className="w-[120px] flex-shrink-0 hidden md:block">
                          <div className={cn("font-bold text-sm", mpPrice && "text-muted-foreground line-through text-xs leading-tight")}>
                            {w.price ? formatCurrency(w.price) : "—"}
                          </div>
                          {mpPrice && (
                            <div className="text-amber-400 text-xs font-bold mt-0.5">
                              {formatCurrency(mpPrice)} down
                            </div>
                          )}
                        </div>
                        {/* Strategy */}
                        <div className="w-[150px] flex-shrink-0 hidden xl:block">
                          {intel?.strategyName ? (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-semibold truncate max-w-full">
                              {intel.strategyName}
                            </span>
                          ) : (
                            <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded inline-block", statusCfg.bg, statusCfg.color)}>
                              {strategyStatus === "needs_strategy_review" ? "Needs Review" : "Not Prioritized"}
                            </span>
                          )}
                          {w.priorityScore > 0 && (
                            <div className={cn("text-[9px] mt-0.5 font-semibold", w.priorityScore >= 70 ? "text-primary" : "text-muted-foreground")}>
                              Priority {w.priorityScore}
                            </div>
                          )}
                        </div>
                        {/* Action */}
                        <div className="w-[140px] flex-shrink-0 flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            className="h-7 px-2 text-[10px] gap-1 bg-success hover:bg-success/90 text-white whitespace-nowrap font-bold uppercase tracking-widest"
                            onClick={(e) => { e.stopPropagation(); setPublishNowVehicleId(w.vehicleId); }}
                          >
                            <UploadCloud className="w-3 h-3" />
                            Publish Now
                          </Button>
                          <Link href={`/listings/${w.vehicleId}`}>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="Review Listing">
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* ── Grid View ── */
                <>
                {/* ── Model group selectors (Ready tab only, when duplicates exist) ── */}
                {activeTab === "ready" && (() => {
                  const groups = new Map<string, typeof filteredSortedWorkspaces>();
                  for (const w of filteredSortedWorkspaces) {
                    const key = `${w.make} ${w.model}`;
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key)!.push(w);
                  }
                  const hasDupes = [...groups.values()].some((g) => g.length > 1);
                  if (!hasDupes) return null;
                  return (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {[...groups.entries()]
                        .filter(([, g]) => g.length > 1)
                        .map(([key, group]) => (
                          <div
                            key={key}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/40 border border-border/40 text-sm"
                          >
                            <Users className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="font-semibold text-foreground">{key}</span>
                            <Badge variant="secondary" className="text-[10px] font-bold px-1.5 py-0">
                              {group.length} ready
                            </Badge>
                            <button
                              onClick={() => {
                                setSelectedVehicleIds((prev) => {
                                  const next = new Set(prev);
                                  group.forEach((v) => next.add(v.vehicleId));
                                  return next;
                                });
                              }}
                              className="text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-0.5 whitespace-nowrap"
                            >
                              Select all {group.length}
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                    </div>
                  );
                })()}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                  {filteredSortedWorkspaces.map((w, i) => {
                    const photoScore = photoScoreByVehicle.get(w.vehicleId);
                    const isReady = activeTab === "ready" || w.publishStatus === "Approved" || w.publishStatus === "Queued";
                    const intel = intelligenceMap.get(w.vehicleId);
                    const strategyStatus = getStrategyStatus(intel);
                    const statusCfg = STRATEGY_STATUS_CONFIG[strategyStatus];
                    const StatusIcon = statusCfg.icon;
                    const isSelected = selectedVehicleIds.has(w.vehicleId);
                    return (
                      <div key={w.vehicleId} className="relative">
                        {/* Checkbox — top-left corner of card */}
                        <div
                          className="absolute top-3 left-3 z-30"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelected(w.vehicleId); }}
                        >
                          <div className={cn(
                            "w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all duration-150 shadow-sm cursor-pointer",
                            isSelected
                              ? "bg-primary border-primary"
                              : "bg-black/40 border-white/60 hover:border-white backdrop-blur-sm"
                          )}>
                            {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-primary-foreground" />}
                          </div>
                        </div>

                        <Link href={`/listings/${w.vehicleId}`}>
                          <Card
                            className={cn(
                              "overflow-hidden hover-lift cursor-pointer group bg-card border-border/40 hover:border-primary/30 transition-all duration-500 h-full flex flex-col relative",
                              isSelected && "ring-2 ring-primary border-primary/50"
                            )}
                            style={{ animationDelay: `${i * 50}ms` }}
                          >
                            <div className="aspect-[16/10] bg-secondary/30 relative overflow-hidden">
                              {w.primaryImageUrl ? (
                                <img
                                  src={w.primaryImageUrl}
                                  alt={w.label}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-secondary/50 to-background">
                                  <Car className="w-12 h-12 text-muted-foreground/20" />
                                </div>
                              )}

                              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-300" />

                              {getStatusBadge(w)}

                              <div className="absolute top-4 left-10 z-10 flex flex-col gap-2">
                                {w.listingScore != null && (
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "backdrop-blur-md px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase border",
                                      ratingClass(w.listingRating),
                                    )}
                                  >
                                    <Gauge className="w-3.5 h-3.5 mr-1.5" />
                                    {w.listingScore} SCORE
                                  </Badge>
                                )}
                              </div>

                              {/* Photo count badge — bottom left */}
                              {(w.imageCount ?? 0) > 0 && (
                                <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-white text-[10px] font-semibold">
                                  <ImageIcon className="w-3 h-3" />
                                  {w.imageCount} photos
                                </div>
                              )}

                              {/* Photo quality badge */}
                              {photoScore && (
                                <PhotoBadge
                                  decision={photoScore.photoDecision}
                                  score={photoScore.photoScore}
                                />
                              )}
                            </div>
                            <CardContent className="p-6 flex-1 flex flex-col">
                              <div className="font-bold text-xl leading-tight mb-2 group-hover:text-primary transition-colors">
                                {w.label}
                              </div>
                              {/* Strategy status — only on ready tab */}
                              {activeTab === "ready" && (
                                <div className={cn(
                                  "inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-md border mb-2 w-fit",
                                  statusCfg.bg, statusCfg.color, statusCfg.border,
                                )}>
                                  <StatusIcon className="w-3 h-3 shrink-0" />
                                  {statusCfg.label}
                                  {intel?.strategyName && (
                                    <span className="opacity-60 font-normal">
                                      · {intel.strategyName}
                                    </span>
                                  )}
                                </div>
                              )}
                              <div className="text-muted-foreground text-sm flex items-center gap-2 mb-6">
                                <span className="truncate">{w.bodyStyle || "Vehicle"}</span>
                                <span className="w-1 h-1 rounded-full bg-border" />
                                <span className="flex items-center gap-1">
                                  <PenTool className="w-3 h-3" /> {w.versionCount} version
                                  {w.versionCount === 1 ? "" : "s"}
                                </span>
                              </div>

                              <div className="mt-auto pt-4 border-t border-border/30 flex items-center justify-between">
                                <div className="font-bold text-xl text-foreground">
                                  {formatCurrency(w.price)}
                                </div>
                                <div className="text-xs font-semibold text-primary/80 group-hover:text-primary flex items-center gap-1 uppercase tracking-widest transition-colors">
                                  View Listing &rarr;
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </Link>

                        {/* Publish Now — overlaid on all cards */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setPublishNowVehicleId(w.vehicleId);
                          }}
                          className="absolute bottom-[72px] right-6 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success/90 hover:bg-success text-white text-xs font-bold uppercase tracking-widest shadow-lg transition-all duration-150 border border-success/50"
                        >
                          <UploadCloud className="w-3.5 h-3.5" />
                          Publish Now
                        </button>
                      </div>
                    );
                  })}
                </div>
                </>
              )}

              {/* ── Floating AI action bar — visible in both list and grid modes ── */}
              {selectionCount > 0 && (
                  <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 duration-300">
                    <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-card/97 border border-primary/20 shadow-2xl shadow-primary/10 backdrop-blur-md">
                      {/* AI label */}
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
                        <span className="text-sm font-semibold text-foreground whitespace-nowrap">
                          DealerPilot selected{" "}
                          <span className="text-primary">{selectionCount}</span>{" "}
                          vehicle{selectionCount !== 1 ? "s" : ""} for review
                        </span>
                      </div>

                      <div className="w-px h-6 bg-border/60" />

                      {/* Publish Selected Now */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 px-4 font-bold text-[11px] uppercase tracking-widest whitespace-nowrap border-success/40 text-success hover:bg-success/10"
                        disabled={bulkSchedule.isPending}
                        onClick={() => {
                          const readyIds = filteredSortedWorkspaces
                            .filter(
                              (w) =>
                                selectedVehicleIds.has(w.vehicleId) &&
                                (w.publishStatus === "Approved" || w.publishStatus === "Queued"),
                            )
                            .map((w) => w.vehicleId);
                          if (readyIds.length === 0) {
                            toast({
                              title: "No ready vehicles selected",
                              description: "Select vehicles with Ready / Queued status to publish now.",
                              variant: "destructive",
                            });
                            return;
                          }
                          bulkSchedule.mutate(
                            { data: { vehicleIds: readyIds, spacingMinutes: 30 } },
                            {
                              onSuccess: (result) => {
                                clearSelection();
                                toast({
                                  title: "Publishing queued",
                                  description: `${result.enqueued} vehicle${result.enqueued !== 1 ? "s" : ""} added to publishing queue.`,
                                });
                              },
                              onError: () =>
                                toast({ title: "Error", description: "Failed to queue vehicles", variant: "destructive" }),
                            },
                          );
                        }}
                      >
                        {bulkSchedule.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UploadCloud className="w-3.5 h-3.5" />
                        )}
                        Publish Selected Now
                      </Button>

                      {/* Primary CTA */}
                      <Button
                        className="gap-2 px-5 font-bold text-[11px] uppercase tracking-widest premium-gradient-btn whitespace-nowrap"
                        onClick={() => setShowBatchReview(true)}
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        Create AI Publishing Batch
                      </Button>

                      <div className="w-px h-6 bg-border/60" />

                      {/* Overflow: manual actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                            title="Manual actions"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            className="gap-2 text-xs"
                            disabled={bulkVehicleAction.isPending}
                            onClick={() => {
                              bulkVehicleAction.mutate(
                                { data: { vehicleIds: [...selectedVehicleIds], action: "mark_ready" } },
                                { onSuccess: () => { clearSelection(); invalidateWorkspaces(); } },
                              );
                            }}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                            Mark Ready
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="gap-2 text-xs"
                            disabled={bulkVehicleAction.isPending}
                            onClick={() => {
                              bulkVehicleAction.mutate(
                                { data: { vehicleIds: [...selectedVehicleIds], action: "mark_sold" } },
                                { onSuccess: () => { clearSelection(); invalidateWorkspaces(); } },
                              );
                            }}
                          >
                            <Tag className="w-3.5 h-3.5 text-amber-400" />
                            Mark Sold
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="gap-2 text-xs text-muted-foreground"
                            disabled={bulkVehicleAction.isPending}
                            onClick={() => {
                              bulkVehicleAction.mutate(
                                { data: { vehicleIds: [...selectedVehicleIds], action: "archive" } },
                                { onSuccess: () => { clearSelection(); invalidateWorkspaces(); } },
                              );
                            }}
                          >
                            <Archive className="w-3.5 h-3.5" />
                            Archive
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {/* Clear */}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        onClick={clearSelection}
                        title="Clear selection"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
            </div>
          )}

          {activeTab === "queue" && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-3">
                <div className="font-medium text-sm shrink-0 text-foreground/80">Job Queue</div>
                <div className="flex gap-0.5 rounded-lg bg-secondary/40 p-1">
                  {(
                    [
                      { value: "active",         label: "Active",       count: activeJobCount   },
                      { value: "needs-review",   label: "Needs Review", count: queueNeedsReviewCount },
                      { value: "completed",      label: "Completed",    count: 0                },
                      { value: "failed-history", label: "History",      count: 0                },
                    ] as { value: "active" | "needs-review" | "completed" | "failed-history"; label: string; count: number }[]
                  ).map(({ value, label, count }) => (
                    <button
                      key={value}
                      onClick={() => setQueueTab(value)}
                      className={cn(
                        "px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap",
                        queueTab === value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                      {count > 0 && (
                        <span className="ml-1.5 bg-primary/20 text-primary rounded-full px-1.5 text-[10px]">
                          {count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <SectionCard className="p-0 overflow-hidden border-border/50">
                {jobsLoading ? (
                  <div className="py-20 flex justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : displayedJobs.length === 0 ? (
                  <EmptyState
                    icon={<Share className="w-8 h-8" />}
                    title={
                      queueTab === "active"         ? "No active jobs" :
                      queueTab === "needs-review"   ? "No jobs need review" :
                      queueTab === "completed"      ? "No published jobs yet" :
                                                      "No failed or cancelled jobs"
                    }
                    description={
                      queueTab === "active"
                        ? "Click Publish Now on any vehicle to start publishing."
                        : "Jobs will appear here as they are processed."
                    }
                  />
                ) : (
                  <Table>
                    <TableHeader className="bg-secondary/30">
                      <TableRow className="hover:bg-transparent border-border/50">
                        <TableHead className="font-medium">Vehicle</TableHead>
                        <TableHead className="font-medium">Listing Title</TableHead>
                        <TableHead className="font-medium">Status</TableHead>
                        <TableHead className="font-medium">Mode</TableHead>
                        <TableHead className="font-medium">Extension</TableHead>
                        <TableHead className="font-medium">Started</TableHead>
                        <TableHead className="font-medium">Retries</TableHead>
                        <TableHead className="font-medium">Priority</TableHead>
                        <TableHead className="font-medium">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedJobs.map((job) => (
                        <TableRow
                          key={job.id}
                          className="border-border/30 hover:bg-secondary/20 transition-colors"
                        >
                          <TableCell className="font-medium">
                            <Link
                              href={`/listings/${job.vehicleId}`}
                              className="text-foreground hover:text-primary hover:underline transition-colors flex items-center gap-2"
                            >
                              {job.vehicleLabel || `Vehicle #${job.vehicleId}`}
                            </Link>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-muted-foreground font-medium">
                            {job.listingTitle || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn("px-2 py-0.5", publishStatusClass(job.status))}
                            >
                              {["Publishing", "Opening Facebook", "Filling Form"].includes(
                                job.status,
                              ) && <Loader2 className="w-3 h-3 mr-1 animate-spin inline" />}
                              {job.status}
                            </Badge>
                            {(job.status === "Failed" || job.status === "Retry") &&
                              job.failedReason && (
                                <div
                                  className="text-xs text-destructive/80 mt-1.5 max-w-[200px] truncate font-medium"
                                  title={job.failedReason}
                                >
                                  {job.failedReason}
                                </div>
                              )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                                (job as { mode?: string }).mode === "Controlled"
                                  ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                                  : "bg-secondary/50 text-muted-foreground border-border",
                              )}
                            >
                              {(job as { mode?: string }).mode ?? "Assisted"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm font-mono">
                            {job.claimedByExtension ? (
                              <span className="bg-secondary px-1.5 py-0.5 rounded">
                                {job.claimedByExtension.substring(0, 8)}...
                              </span>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {job.startedAt ? formatDate(job.startedAt) : "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {Math.max(0, (job.attempts ?? 0) - 1) > 0 ? (
                              <Badge
                                variant="secondary"
                                className="bg-warning/10 text-warning border-0"
                              >
                                {Math.max(0, (job.attempts ?? 0) - 1)}
                              </Badge>
                            ) : (
                              "0"
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="bg-secondary/50 text-foreground border-border"
                            >
                              P{job.priority}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {(job.status === "Queued" || job.status === "Retry") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10"
                                  disabled={assignMutation.isPending}
                                  onClick={() =>
                                    assignMutation.mutate({ id: job.id, data: {} })
                                  }
                                >
                                  {assignMutation.isPending ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    "Assign"
                                  )}
                                </Button>
                              )}
                              {!["Published", "Failed", "Cancelled"].includes(job.status) && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                                  disabled={cancelMutation.isPending}
                                  onClick={() =>
                                    cancelMutation.mutate({ id: job.id, data: {} })
                                  }
                                >
                                  Cancel
                                </Button>
                              )}
                              {(job.status === "Failed" || job.status === "Needs Review") && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                                    disabled={retryMutation.isPending}
                                    onClick={() => retryMutation.mutate({ id: job.id })}
                                  >
                                    {retryMutation.isPending ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <><RefreshCw className="w-3 h-3 mr-1" />Retry</>
                                    )}
                                  </Button>
                                  <a
                                    href={`/vehicles/${job.vehicleId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 h-7 px-2 text-xs text-muted-foreground hover:text-white transition-colors"
                                    title="Open vehicle page for manual review"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    Manual Review
                                  </a>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>
            </div>
          )}

          </div>{/* /space-y-6 */}
        </div>
      </div>

      {/* Mark as Published modal */}
      {markPublishedVehicle && (
        <MarkPublishedModal
          open={!!markPublishedVehicle}
          onClose={() => setMarkPublishedVehicle(null)}
          vehicleLabel={markPublishedVehicle.label}
          onConfirm={handleMarkPublished}
          isLoading={markPublishedMutation.isPending}
        />
      )}

      {/* AI Batch Review Panel */}
      {showBatchReview && selectedVehicleIds.size > 0 && (
        <BatchReviewPanel
          vehicles={filteredWorkspaces.filter((w) =>
            selectedVehicleIds.has(w.vehicleId),
          )}
          photoScoreByVehicle={photoScoreByVehicle}
          intelligenceMap={intelligenceMap}
          onClose={() => setShowBatchReview(false)}
          isApproving={bulkSchedule.isPending}
          onApprove={(readyVehicleIds) => {
            bulkSchedule.mutate(
              { data: { vehicleIds: readyVehicleIds, spacingMinutes: 30 } },
              {
                onSuccess: (result) => {
                  setShowBatchReview(false);
                  clearSelection();
                  invalidateWorkspaces();
                  toast({
                    title: "Publishing batch created",
                    description: `${result.enqueued} vehicle${result.enqueued !== 1 ? "s" : ""} queued for publishing. DealerPilot will publish them in order.`,
                  });
                },
                onError: () =>
                  toast({
                    title: "Error",
                    description: "Failed to create publishing batch",
                    variant: "destructive",
                  }),
              },
            );
          }}
        />
      )}

      <PublishNowModal
        vehicleId={publishNowVehicleId}
        vehicleLabel={workspacesData?.workspaces.find((w) => w.vehicleId === publishNowVehicleId)?.label}
        onClose={() => { setPublishNowVehicleId(null); invalidateWorkspaces(); }}
      />

      <BatchTodayPanel
        isOpen={batchTodayOpen}
        vehicles={batchTodayVehicles}
        onClose={() => { setBatchTodayOpen(false); invalidateWorkspaces(); }}
      />
    </AppLayout>
  );
}
