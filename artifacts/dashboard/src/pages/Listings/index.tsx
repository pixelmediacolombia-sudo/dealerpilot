import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListListingWorkspaces,
  useListPublishingJobs,
  useAssignPublishingJob,
  useCancelPublishingJob,
  useListVehiclePhotoScores,
  getListVehiclePhotoScoresQueryKey,
  getListPublishingJobsQueryKey,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState, SectionCard } from "@/components/shared";
import { AutoPublishPlan } from "./AutoPublishPlan";
import { BatchProgressCard } from "./BatchProgressCard";

const DEALER_ID = 1;

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

  const { data: workspacesData, isLoading: workspacesLoading } = useListListingWorkspaces({
    q: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const { data: jobsData, isLoading: jobsLoading } = useListPublishingJobs(
    { status: jobStatusFilter === "all" ? undefined : jobStatusFilter },
    { query: { refetchInterval: 5000 } as never },
  );

  const queryClient = useQueryClient();
  const invalidateJobs = () =>
    queryClient.invalidateQueries({ queryKey: getListPublishingJobsQueryKey() });

  const assignMutation = useAssignPublishingJob({
    mutation: { onSuccess: () => void invalidateJobs() },
  });
  const cancelMutation = useCancelPublishingJob({
    mutation: { onSuccess: () => void invalidateJobs() },
  });

  const { data: photoScoresData } = useListVehiclePhotoScores(
    { dealerId: DEALER_ID },
    { query: { queryKey: getListVehiclePhotoScoresQueryKey({ dealerId: DEALER_ID }) } },
  );

  const photoScoreByVehicle = new Map(
    (photoScoresData?.scores ?? []).map((s) => [s.vehicleId, s]),
  );

  const workspaces = workspacesData?.workspaces ?? [];
  const generatingCount = workspaces.filter((w) => w.aiStatus === "Generating").length;
  const readyCount = workspaces.filter(
    (w) => w.publishStatus === "Approved" || w.publishStatus === "Queued",
  ).length;
  const publishedWorkspacesCount = workspaces.filter(
    (w) => w.publishStatus === "Published",
  ).length;
  const scheduledCount = workspaces.filter((w) => w.publishStatus === "Scheduled").length;
  const publishingCount = workspaces.filter((w) => w.publishStatus === "Publishing").length;
  const needsReviewCount = workspaces.filter(
    (w) => w.publishStatus === "Needs Review",
  ).length;
  const failedCount = workspaces.filter((w) => w.publishStatus === "Failed").length;
  const allCount = workspaces.length;

  const jobs = jobsData?.jobs ?? [];
  const queuedJobs = jobs.filter((j) => j.status === "Queued" || j.status === "Scheduled").length;

  const filteredWorkspaces = workspaces.filter((w) => {
    if (activeTab === "ready") return w.publishStatus === "Approved" || w.publishStatus === "Queued";
    if (activeTab === "generating") return w.aiStatus === "Generating";
    if (activeTab === "scheduled") return w.publishStatus === "Scheduled";
    if (activeTab === "publishing") return w.publishStatus === "Publishing";
    if (activeTab === "published") return w.publishStatus === "Published";
    if (activeTab === "needs-review") return w.publishStatus === "Needs Review";
    if (activeTab === "failed") return w.publishStatus === "Failed";
    return true;
  });

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

  const isCardTab = ["ready", "generating", "scheduled", "publishing", "published", "needs-review", "failed", "all"].includes(
    activeTab,
  );

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
                  <Badge
                    variant="secondary"
                    className="bg-secondary/50 text-secondary-foreground border-white/5"
                  >
                    {publishedWorkspacesCount} Published
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-secondary/50 text-secondary-foreground border-white/5"
                  >
                    {generatingCount} Generating
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-secondary/50 text-secondary-foreground border-white/5"
                  >
                    {readyCount} Ready
                  </Badge>
                  {scheduledCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-purple-500/10 text-purple-400 border-purple-500/20"
                    >
                      {scheduledCount} Scheduled
                    </Badge>
                  )}
                  {publishingCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-blue-500/10 text-blue-400 border-blue-500/20"
                    >
                      {publishingCount} Publishing
                    </Badge>
                  )}
                  {needsReviewCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-warning/10 text-warning border-warning/20"
                    >
                      {needsReviewCount} Needs Review
                    </Badge>
                  )}
                  {failedCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-destructive/10 text-destructive border-destructive/20"
                    >
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
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
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

          {/* Auto Publish Plan */}
          <AutoPublishPlan
            dealerId={DEALER_ID}
            onBatchCreated={() => setBatchRefreshKey((k) => k + 1)}
          />

          {/* Batch Progress */}
          <BatchProgressCard dealerId={DEALER_ID} refreshKey={batchRefreshKey} />

          {isCardTab && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              {/* Filters */}
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
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-[200px] bg-background/50 border-border/50">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="AI Generated">AI Generated</SelectItem>
                    <SelectItem value="Approved">Approved</SelectItem>
                    <SelectItem value="Queued">Queued</SelectItem>
                    <SelectItem value="Scheduled">Scheduled</SelectItem>
                    <SelectItem value="Publishing">Publishing</SelectItem>
                    <SelectItem value="Published">Published</SelectItem>
                    <SelectItem value="Needs Review">Needs Review</SelectItem>
                    <SelectItem value="Failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Grid */}
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
              ) : filteredWorkspaces.length === 0 ? (
                <EmptyState
                  icon={<Sparkles className="w-8 h-8" />}
                  title="No workspaces found"
                  description="DealerPilot hasn't identified any listings matching this view."
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                  {filteredWorkspaces.map((w, i) => {
                    const photoScore = photoScoreByVehicle.get(w.vehicleId);
                    return (
                      <Link key={w.vehicleId} href={`/listings/${w.vehicleId}`}>
                        <Card
                          className="overflow-hidden hover-lift cursor-pointer group bg-card border-border/40 hover:border-primary/30 transition-all duration-500 h-full flex flex-col relative"
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

                            <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
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
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "queue" && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              <div className="glass-panel p-4 rounded-xl flex items-center justify-between border border-border/50">
                <div className="font-medium px-2">Job Queue</div>
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
    </AppLayout>
  );
}
