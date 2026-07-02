import { useState, useMemo } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListListingWorkspaces,
  useListPublishingJobs,
  useAssignPublishingJob,
  useCancelPublishingJob,
  useRetryPublishingJob,
  useListVehiclePhotoScores,
  useMarkListingPublished,
  useBulkVehicleAction,
  useBulkSchedulePublishing,
  useListMarketplaceRecommendations,
  getListListingWorkspacesQueryKey,
  getListPublishingJobsQueryKey,
  getListVehiclePhotoScoresQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState, SectionCard } from "@/components/shared";
import { AutoPublishPlan } from "./AutoPublishPlan";
import { BatchProgressCard } from "./BatchProgressCard";
import { PublishedCard } from "./PublishedCard";
import { MarkPublishedModal } from "./MarkPublishedModal";
import { BatchReviewPanel } from "./BatchReviewPanel";
import { DailyOperatorPanel } from "./DailyOperatorPanel";
import { BatchTodayPanel, type BatchVehicle } from "./BatchTodayPanel";
import { PublishNowModal } from "@/components/PublishNowModal";
import { toast } from "@/hooks/use-toast";

const DEALER_ID = 1;

type StrategyStatus = "recommended" | "not_prioritized" | "needs_strategy_review";

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
    const tab = new URLSearchParams(window.location.search).get("tab");
    return tab || "ready";
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [jobStatusFilter, setJobStatusFilter] = useState<string>("all");
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
      const res = await fetch("/api/publishing/jobs/clear-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ olderThanMinutes: 10 }),
      });
      const data = (await res.json()) as { cleared: number };
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

  const { data: workspacesData, isLoading: workspacesLoading } = useListListingWorkspaces({
    q: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const { data: jobsData, isLoading: jobsLoading } = useListPublishingJobs(
    { status: jobStatusFilter === "all" ? undefined : jobStatusFilter },
    { query: { refetchInterval: 5000 } as never },
  );

  const assignMutation = useAssignPublishingJob({
    mutation: { onSuccess: () => void invalidateWorkspaces() },
  });
  const cancelMutation = useCancelPublishingJob({
    mutation: { onSuccess: () => void invalidateWorkspaces() },
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

  const { data: photoScoresData } = useListVehiclePhotoScores(
    { dealerId: DEALER_ID },
    { query: { queryKey: getListVehiclePhotoScoresQueryKey({ dealerId: DEALER_ID }) } },
  );

  const photoScoreByVehicle = new Map(
    (photoScoresData?.scores ?? []).map((s) => [s.vehicleId, s]),
  );

  const { data: intelligenceData } = useListMarketplaceRecommendations();

  const intelligenceMap = useMemo(() => {
    const m = new Map<number, {
      strategyName: string | null;
      recommendedDownPayment: number | null;
      reason: string | null;
      supportingSignals?: string[] | null;
      expectedImpact?: string | null;
      actionCta?: string | null;
    }>();
    for (const rec of intelligenceData?.recommendations ?? []) {
      m.set(rec.vehicleId, {
        strategyName: rec.strategyName ?? null,
        recommendedDownPayment: rec.recommendedDownPayment ?? null,
        reason: rec.reason ?? null,
        supportingSignals: rec.supportingSignals ?? null,
        expectedImpact: rec.expectedImpact ?? null,
        actionCta: rec.actionCta ?? null,
      });
    }
    return m;
  }, [intelligenceData]);

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
  const generatingCount = workspaces.filter((w) => w.aiStatus === "Generating").length;
  const readyCount = workspaces.filter(
    (w) => w.publishStatus === "Approved" || w.publishStatus === "Queued",
  ).length;
  const publishedWorkspacesCount = workspaces.filter(
    (w) => w.publishStatus === "Published" && w.vehicleStatus !== "Sold/Removed" && w.vehicleStatus !== "Price Changed",
  ).length;
  const scheduledCount = workspaces.filter((w) => w.publishStatus === "Scheduled").length;
  const publishingCount = workspaces.filter((w) => w.publishStatus === "Publishing").length;
  const needsReviewCount = workspaces.filter(
    (w) => w.publishStatus === "Needs Review",
  ).length;
  const failedCount = workspaces.filter((w) => w.publishStatus === "Failed").length;
  const needsUpdateCount = workspaces.filter(
    (w) => w.publishStatus === "Published" && w.vehicleStatus === "Price Changed",
  ).length;
  const soldCount = workspaces.filter(
    (w) => w.publishStatus === "Published" && w.vehicleStatus === "Sold/Removed",
  ).length;
  const allCount = workspaces.length;

  const jobs = jobsData?.jobs ?? [];
  const queuedJobs = jobs.filter((j) => j.status === "Queued" || j.status === "Scheduled").length;

  const filteredWorkspaces = workspaces.filter((w) => {
    if (activeTab === "ready") return w.publishStatus === "Approved" || w.publishStatus === "Queued";
    if (activeTab === "generating") return w.aiStatus === "Generating";
    if (activeTab === "scheduled") return w.publishStatus === "Scheduled";
    if (activeTab === "publishing") return w.publishStatus === "Publishing";
    if (activeTab === "published")
      return w.publishStatus === "Published" && w.vehicleStatus !== "Sold/Removed" && w.vehicleStatus !== "Price Changed";
    if (activeTab === "needs-review") return w.publishStatus === "Needs Review";
    if (activeTab === "failed") return w.publishStatus === "Failed";
    if (activeTab === "needs-update")
      return w.publishStatus === "Published" && w.vehicleStatus === "Price Changed";
    if (activeTab === "sold")
      return w.publishStatus === "Published" && w.vehicleStatus === "Sold/Removed";
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

  const isPublishedTab = ["published", "needs-update", "sold"].includes(activeTab);
  const isCardTab = !isPublishedTab &&
    ["ready", "generating", "scheduled", "publishing", "needs-review", "failed", "all"].includes(activeTab);

  const tabClass =
    "rounded-full px-4 data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:border-primary/30 border border-transparent flex gap-2 transition-all text-sm";

  const countBadge = (n: number) =>
    n > 0 ? (
      <Badge
        variant="secondary"
        className="bg-background/50 text-foreground border-0 px-1.5 py-0"
      >
        {n}
      </Badge>
    ) : null;

  const handleMarkPublished = (marketplaceUrl?: string) => {
    if (!markPublishedVehicle) return;
    markPublishedMutation.mutate({
      vehicleId: markPublishedVehicle.id,
      data: marketplaceUrl ? { marketplaceUrl } : {},
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
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
          <PageHeader
            eyebrow="AI Listing Generator"
            title="Marketplace AI"
            description={
              <div className="flex flex-col gap-3">
                <span className="text-muted-foreground text-sm">
                  DealerPilot is managing {allCount} AI listing workspaces.
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="bg-success/10 text-success border-success/20">
                    {publishedWorkspacesCount} Live
                  </Badge>
                  <Badge variant="secondary" className="bg-secondary/50 text-secondary-foreground border-white/5">
                    {readyCount} Ready
                  </Badge>
                  <Badge variant="secondary" className="bg-secondary/50 text-secondary-foreground border-white/5">
                    {generatingCount} Generating
                  </Badge>
                  {scheduledCount > 0 && (
                    <Badge variant="secondary" className="bg-purple-500/10 text-purple-400 border-purple-500/20">
                      {scheduledCount} Scheduled
                    </Badge>
                  )}
                  {publishingCount > 0 && (
                    <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                      {publishingCount} Publishing
                    </Badge>
                  )}
                  {needsUpdateCount > 0 && (
                    <Badge variant="secondary" className="bg-amber-500/10 text-amber-400 border-amber-500/20">
                      {needsUpdateCount} Needs Update
                    </Badge>
                  )}
                  {soldCount > 0 && (
                    <Badge variant="secondary" className="bg-destructive/10 text-destructive border-destructive/20">
                      {soldCount} Sold
                    </Badge>
                  )}
                  {needsReviewCount > 0 && (
                    <Badge variant="secondary" className="bg-warning/10 text-warning border-warning/20">
                      {needsReviewCount} Needs Review
                    </Badge>
                  )}
                  {failedCount > 0 && (
                    <Badge variant="secondary" className="bg-destructive/10 text-destructive border-destructive/20">
                      {failedCount} Failed
                    </Badge>
                  )}
                </div>
              </div>
            }
            action={
              <div className="flex flex-col gap-3 items-end">
                <Link href="/listings/readiness">
                  <Button variant="outline" size="sm" className="gap-2 border-border/50 text-muted-foreground hover:text-primary hover:border-primary/40">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Production Readiness
                  </Button>
                </Link>
                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-auto">
                  <TabsList className="bg-transparent border-0 gap-1.5 flex-wrap justify-end">
                    <TabsTrigger value="ready" className={tabClass}>
                      Ready {countBadge(readyCount)}
                    </TabsTrigger>
                    <TabsTrigger value="generating" className={tabClass}>
                      Generating {countBadge(generatingCount)}
                    </TabsTrigger>
                    <TabsTrigger value="scheduled" className={tabClass}>
                      Scheduled {countBadge(scheduledCount)}
                    </TabsTrigger>
                    <TabsTrigger value="publishing" className={tabClass}>
                      Publishing {countBadge(publishingCount)}
                    </TabsTrigger>
                    <TabsTrigger value="published" className={tabClass}>
                      Published {countBadge(publishedWorkspacesCount)}
                    </TabsTrigger>
                    <TabsTrigger value="needs-update" className={cn(tabClass, needsUpdateCount > 0 && "data-[state=inactive]:text-amber-400/80")}>
                      Needs Update {countBadge(needsUpdateCount)}
                    </TabsTrigger>
                    <TabsTrigger value="sold" className={tabClass}>
                      Sold {countBadge(soldCount)}
                    </TabsTrigger>
                    <TabsTrigger value="needs-review" className={tabClass}>
                      Needs Review {countBadge(needsReviewCount)}
                    </TabsTrigger>
                    <TabsTrigger value="failed" className={tabClass}>
                      Failed {countBadge(failedCount)}
                    </TabsTrigger>
                    <TabsTrigger value="queue" className={tabClass}>
                      Queue {countBadge(queuedJobs)}
                    </TabsTrigger>
                    <TabsTrigger value="all" className={tabClass}>
                      All {countBadge(allCount)}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            }
          />

          {/* AI Daily Operator Panel */}
          {activeTab !== "published" && activeTab !== "needs-update" && activeTab !== "sold" && activeTab !== "queue" && (
            <DailyOperatorPanel
              workspaces={workspacesData?.workspaces ?? []}
              recommendations={(intelligenceData?.recommendations ?? []) as never}
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
          <BatchProgressCard dealerId={DEALER_ID} refreshKey={batchRefreshKey} />

          {/* ── Published / Needs Update / Sold tabs — engagement-rich cards ── */}
          {isPublishedTab && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              <div className="glass-panel p-4 rounded-xl flex flex-col sm:flex-row gap-4 items-center border border-border/50 z-10 sticky top-0">
                <div className="relative flex-1 w-full max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search VIN, make, model..."
                    className="pl-9 bg-background/50 border-border/50 focus-visible:ring-primary/30"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              {workspacesLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="rounded-xl bg-card border border-border/50 h-[380px] animate-pulse">
                      <div className="h-[200px] bg-secondary/50 rounded-t-xl" />
                      <div className="p-4 space-y-3">
                        <div className="h-5 bg-secondary/80 rounded w-2/3" />
                        <div className="h-4 bg-secondary/50 rounded w-1/3" />
                        <div className="h-12 bg-secondary/30 rounded" />
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
                    activeTab === "needs-update" ? "All listings are up to date" :
                    "No sold listings"
                  }
                  description={
                    activeTab === "published"
                      ? "Publish listings from the Ready tab to see them here with engagement tracking."
                      : activeTab === "needs-update"
                        ? "When a vehicle's price changes in your XML feed, published listings will appear here."
                        : "Mark sold vehicles here to remove their listings from Marketplace."
                  }
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
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
              {/* Toolbar row 1: search + selection + view toggle + sort */}
              <div className="glass-panel p-4 rounded-xl flex flex-col sm:flex-row gap-3 items-center border border-border/50 z-10 sticky top-0">
                <div className="relative flex-1 w-full max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search VIN, make, model..."
                    className="pl-9 bg-background/50 border-border/50 focus-visible:ring-primary/30"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                {/* Selection controls */}
                {selectionCount > 0 ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge className="bg-primary/20 text-primary border-primary/30 gap-1.5">
                      <ListChecks className="w-3 h-3" />
                      {selectionCount} selected
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={selectAll} className="h-7 text-xs px-2 gap-1">
                      All {filteredSortedWorkspaces.length}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={clearSelection} className="h-7 text-xs px-2">
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={selectAll}
                    className="h-7 text-xs px-2.5 gap-1.5 text-muted-foreground hover:text-foreground flex-shrink-0"
                  >
                    <ListChecks className="w-3.5 h-3.5" />
                    Select All
                  </Button>
                )}

                {/* Sort */}
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                  <SelectTrigger className="w-full sm:w-[160px] bg-background/50 border-border/50 gap-1.5">
                    <ArrowUpDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
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

                {/* View toggle */}
                <div className="flex items-center rounded-lg border border-border/50 overflow-hidden flex-shrink-0">
                  <button
                    onClick={() => setViewMode("list")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors",
                      viewMode === "list" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <List className="w-3.5 h-3.5" />
                    List
                  </button>
                  <div className="w-px h-5 bg-border/60" />
                  <button
                    onClick={() => setViewMode("grid")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors",
                      viewMode === "grid" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    Grid
                  </button>
                </div>
              </div>

              {/* Toolbar row 2: vehicle count */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {filteredSortedWorkspaces.length} vehicle{filteredSortedWorkspaces.length !== 1 ? "s" : ""}
                </span>
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
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30 border-b border-border/30 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    <div className="w-5 flex-shrink-0">
                      <Checkbox
                        checked={selectionCount === filteredSortedWorkspaces.length && filteredSortedWorkspaces.length > 0}
                        onCheckedChange={(checked) => checked ? selectAll() : clearSelection()}
                      />
                    </div>
                    <div className="w-[72px] flex-shrink-0">Photo</div>
                    <div className="flex-1 min-w-0">Vehicle</div>
                    <div className="w-[90px] text-center flex-shrink-0 hidden lg:block">AI Score</div>
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
                          "flex items-center gap-3 px-4 py-2 min-h-[80px] border-b border-border/20 last:border-b-0 transition-colors hover:bg-muted/10",
                          isSelected && "bg-primary/5 border-l-2 border-l-primary"
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
              <div className="glass-panel p-4 rounded-xl flex items-center justify-between gap-3 border border-border/50">
                <div className="font-medium px-2 shrink-0">Job Queue</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearTestQueue}
                  disabled={clearingQueue}
                  className="text-destructive border-destructive/40 hover:bg-destructive/10 shrink-0"
                >
                  {clearingQueue ? "Clearing…" : "Clear Test Queue"}
                </Button>
                <Select value={jobStatusFilter} onValueChange={setJobStatusFilter}>
                  <SelectTrigger className="w-full sm:w-[200px] bg-background/50 border-border/50">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="Queued">Queued</SelectItem>
                    <SelectItem value="Scheduled">Scheduled</SelectItem>
                    <SelectItem value="Assigned">Assigned</SelectItem>
                    <SelectItem value="Publishing">Publishing</SelectItem>
                    <SelectItem value="Opening Facebook">Opening Facebook</SelectItem>
                    <SelectItem value="Filling Form">Filling Form</SelectItem>
                    <SelectItem value="Ready for Review">Ready for Review</SelectItem>
                    <SelectItem value="Published">Published</SelectItem>
                    <SelectItem value="Retry">Retry</SelectItem>
                    <SelectItem value="Failed">Failed</SelectItem>
                    <SelectItem value="Needs Review">Needs Review</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <SectionCard className="p-0 overflow-hidden border-border/50">
                {jobsLoading ? (
                  <div className="py-20 flex justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : jobs.length === 0 ? (
                  <EmptyState
                    icon={<Share className="w-8 h-8" />}
                    title="No publishing jobs"
                    description="Queue a generated listing from its detail page to add it here."
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
                      {jobs.map((job) => (
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
                              {![
                                "Published",
                                "Failed",
                                "Queued",
                                "Retry",
                                "Scheduled",
                              ].includes(job.status) && (
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
                              {job.status === "Failed" && (
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
