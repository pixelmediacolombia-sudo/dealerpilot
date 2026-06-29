import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListListingWorkspaces, useListPublishingJobs } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Search, Car, Sparkles, Loader2, Gauge, FileText, CheckCircle2, Share, Clock, Send, AlertTriangle, PenTool } from "lucide-react";
import { PageHeader, KpiCard, EmptyState, SectionCard } from "@/components/shared";

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

function aiStatusClass(status: string) {
  switch (status) {
    case "Generating":
      return "bg-warning/80 text-warning-foreground border-warning/20";
    case "AI Generated":
      return "bg-accent/80 text-accent-foreground border-accent/20";
    default:
      return "bg-secondary/80 text-secondary-foreground border-secondary/20";
  }
}

function publishStatusClass(status: string) {
  switch (status) {
    case "Published":
      return "bg-success/80 text-success-foreground border-success/20";
    case "Approved":
    case "Queued":
    case "Publishing":
      return "bg-blue-500/80 text-white border-blue-500/20";
    case "Failed":
    case "Retry":
      return "bg-destructive/80 text-destructive-foreground border-destructive/20";
    default:
      return "bg-secondary/80 text-secondary-foreground border-secondary/20";
  }
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

  const { data: workspacesData, isLoading: workspacesLoading } = useListListingWorkspaces({
    q: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const { data: jobsData, isLoading: jobsLoading } = useListPublishingJobs(
    {
      status: jobStatusFilter === "all" ? undefined : jobStatusFilter,
    },
    { query: { refetchInterval: 5000 } as never },
  );

  const workspaces = workspacesData?.workspaces ?? [];
  const generatingCount = workspaces.filter((w) => w.aiStatus === "Generating").length;
  const readyCount = workspaces.filter(
    (w) => w.publishStatus === "Approved" || w.publishStatus === "Queued",
  ).length;
  const publishedWorkspacesCount = workspaces.filter((w) => w.publishStatus === "Published").length;
  const allCount = workspaces.length;

  const jobs = jobsData?.jobs ?? [];
  const queuedJobs = jobs.filter((j) => j.status === "Queued").length;
  const publishingJobs = jobs.filter((j) => j.status === "Publishing").length;
  const failedJobs = jobs.filter((j) => j.status === "Failed" || j.status === "Retry").length;

  const filteredWorkspaces = workspaces.filter((w) => {
    if (activeTab === "ready") return w.publishStatus === "Approved" || w.publishStatus === "Queued";
    if (activeTab === "generating") return w.aiStatus === "Generating";
    if (activeTab === "published") return w.publishStatus === "Published";
    return true; // "all" tab
  });

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
          <PageHeader 
            eyebrow="AI Listing Generator"
            title="Marketplace AI" 
            description="DealerPilot AI handles generating optimized descriptions and coordinating your multi-platform strategy."
            action={
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
                <TabsList className="bg-secondary/50 border border-border/50">
                  <TabsTrigger value="ready" className="rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex gap-2">
                    Ready {readyCount > 0 && <Badge variant="secondary" className="bg-black/20 text-white border-0 px-1.5 py-0">{readyCount}</Badge>}
                  </TabsTrigger>
                  <TabsTrigger value="generating" className="rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex gap-2">
                    Generating {generatingCount > 0 && <Badge variant="secondary" className="bg-black/20 text-white border-0 px-1.5 py-0">{generatingCount}</Badge>}
                  </TabsTrigger>
                  <TabsTrigger value="published" className="rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex gap-2">
                    Published {publishedWorkspacesCount > 0 && <Badge variant="secondary" className="bg-black/20 text-white border-0 px-1.5 py-0">{publishedWorkspacesCount}</Badge>}
                  </TabsTrigger>
                  <TabsTrigger value="queue" className="rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex gap-2">
                    Queue {queuedJobs > 0 && <Badge variant="secondary" className="bg-black/20 text-white border-0 px-1.5 py-0">{queuedJobs}</Badge>}
                  </TabsTrigger>
                  <TabsTrigger value="all" className="rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex gap-2">
                    All {allCount > 0 && <Badge variant="secondary" className="bg-black/20 text-white border-0 px-1.5 py-0">{allCount}</Badge>}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            }
          />

          {["ready", "generating", "published", "all"].includes(activeTab) && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              {/* Stats Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard 
                  title="Total Workspaces"
                  value={allCount}
                  icon={<Car className="w-4 h-4 text-muted-foreground" />}
                  isLoading={workspacesLoading}
                />
                <KpiCard 
                  title="Actively Generating"
                  value={generatingCount}
                  icon={<Sparkles className="w-4 h-4 text-primary" />}
                  isLoading={workspacesLoading}
                />
                <KpiCard 
                  title="AI Ready to Publish"
                  value={readyCount}
                  icon={<FileText className="w-4 h-4 text-blue-400" />}
                  isLoading={workspacesLoading}
                />
                <KpiCard 
                  title="DealerPilot Live"
                  value={publishedWorkspacesCount}
                  icon={<CheckCircle2 className="w-4 h-4 text-success" />}
                  isLoading={workspacesLoading}
                />
              </div>

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
                    <SelectItem value="Published">Published</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Grid */}
              {workspacesLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {[1,2,3,4,5,6,7,8].map(i => (
                    <div key={i} className="rounded-xl bg-card border border-border/50 h-[340px] animate-pulse">
                      <div className="h-[200px] bg-secondary/50 rounded-t-xl" />
                      <div className="p-5 space-y-3">
                        <div className="h-5 bg-secondary/80 rounded w-3/4" />
                        <div className="h-4 bg-secondary/50 rounded w-1/2" />
                        <div className="pt-2 flex justify-between">
                          <div className="h-6 bg-secondary/80 rounded w-1/3" />
                          <div className="h-6 bg-secondary/50 rounded w-1/4" />
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {filteredWorkspaces.map((w, i) => (
                    <Link key={w.vehicleId} href={`/listings/${w.vehicleId}`}>
                      <Card className="overflow-hidden hover-lift cursor-pointer group bg-card border-border/40 hover:border-primary/30 transition-all duration-500 h-full flex flex-col" style={{ animationDelay: `${i * 50}ms` }}>
                        <div className="aspect-[4/3] bg-secondary/30 relative overflow-hidden">
                          {w.primaryImageUrl ? (
                            <img
                              src={w.primaryImageUrl}
                              alt={w.label}
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-secondary/50 to-background">
                              <Car className="w-12 h-12 text-muted-foreground/20" />
                            </div>
                          )}
                          
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-300" />
                          
                          <div className="absolute top-3 left-3 right-3 flex justify-between items-start z-10">
                            <Badge variant="outline" className={cn("backdrop-blur-sm px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase border", aiStatusClass(w.aiStatus))}>
                              <Sparkles className="w-3 h-3 mr-1.5" />
                              {w.aiStatus}
                            </Badge>
                            
                            {w.publishStatus !== "Not Queued" && (
                              <Badge variant="outline" className={cn("backdrop-blur-sm px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase border", publishStatusClass(w.publishStatus))}>
                                {w.publishStatus}
                              </Badge>
                            )}
                          </div>
                          
                          <div className="absolute bottom-3 left-3 right-3 z-10">
                            <div className="font-bold text-xl text-white drop-shadow-md">{formatCurrency(w.price)}</div>
                          </div>
                        </div>
                        <CardContent className="p-5 flex-1 flex flex-col">
                          <div className="font-bold text-lg leading-tight mb-1 group-hover:text-primary transition-colors">{w.label}</div>
                          <div className="text-muted-foreground text-sm flex items-center gap-2 mb-5">
                            <span className="truncate">{w.bodyStyle || "Vehicle"}</span>
                            <span className="w-1 h-1 rounded-full bg-border" />
                            <span className="flex items-center gap-1"><PenTool className="w-3 h-3" /> {w.versionCount} version{w.versionCount === 1 ? "" : "s"}</span>
                          </div>
                          
                          <div className="mt-auto pt-4 border-t border-border/50 flex items-center justify-between">
                            <div className="text-sm font-medium text-muted-foreground">Listing Score</div>
                            {w.listingScore != null ? (
                              <Badge variant="outline" className={cn("px-2 py-0.5 text-xs", ratingClass(w.listingRating))}>
                                <Gauge className="w-3.5 h-3.5 mr-1" />
                                {w.listingScore}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md">Not scored</span>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "queue" && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              {/* Stats Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard 
                  title="Queued"
                  value={queuedJobs}
                  icon={<Clock className="w-4 h-4 text-warning" />}
                  isLoading={jobsLoading}
                />
                <KpiCard 
                  title="Publishing Now"
                  value={publishingJobs}
                  icon={<Send className="w-4 h-4 text-blue-400" />}
                  isLoading={jobsLoading}
                />
                <KpiCard 
                  title="Successfully Published"
                  value={jobs.filter((j) => j.status === "Published").length}
                  icon={<CheckCircle2 className="w-4 h-4 text-success" />}
                  isLoading={jobsLoading}
                />
                <KpiCard 
                  title="Needs Attention"
                  value={failedJobs}
                  icon={<AlertTriangle className="w-4 h-4 text-destructive" />}
                  trend={failedJobs > 0 ? { value: failedJobs, isPositive: false } : undefined}
                  isLoading={jobsLoading}
                />
              </div>

              {/* Filter */}
              <div className="glass-panel p-4 rounded-xl flex items-center justify-between border border-border/50">
                <div className="font-medium px-2">Job Queue</div>
                <Select value={jobStatusFilter} onValueChange={setJobStatusFilter}>
                  <SelectTrigger className="w-full sm:w-[200px] bg-background/50 border-border/50">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="Queued">Queued</SelectItem>
                    <SelectItem value="Publishing">Publishing</SelectItem>
                    <SelectItem value="Published">Published</SelectItem>
                    <SelectItem value="Retry">Retry</SelectItem>
                    <SelectItem value="Failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Table */}
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
                        <TableHead className="font-medium">Extension</TableHead>
                        <TableHead className="font-medium">Started</TableHead>
                        <TableHead className="font-medium">Retries</TableHead>
                        <TableHead className="font-medium">Priority</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobs.map((job) => (
                        <TableRow key={job.id} className="border-border/30 hover:bg-secondary/20 transition-colors">
                          <TableCell className="font-medium">
                            <Link href={`/listings/${job.vehicleId}`} className="text-foreground hover:text-primary hover:underline transition-colors flex items-center gap-2">
                              {job.vehicleLabel || `Vehicle #${job.vehicleId}`}
                            </Link>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-muted-foreground font-medium">
                            {job.listingTitle || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("px-2 py-0.5", publishStatusClass(job.status))}>
                              {job.status === "Publishing" && <Loader2 className="w-3 h-3 mr-1 animate-spin inline" />}
                              {job.status}
                            </Badge>
                            {(job.status === "Failed" || job.status === "Retry") && job.failedReason && (
                              <div className="text-xs text-destructive/80 mt-1.5 max-w-[200px] truncate font-medium" title={job.failedReason}>
                                {job.failedReason}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm font-mono">
                            {job.claimedByExtension ? <span className="bg-secondary px-1.5 py-0.5 rounded">{job.claimedByExtension.substring(0,8)}...</span> : "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {job.startedAt ? formatDate(job.startedAt) : "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {Math.max(0, (job.attempts ?? 0) - 1) > 0 ? (
                              <Badge variant="secondary" className="bg-warning/10 text-warning border-0">{Math.max(0, (job.attempts ?? 0) - 1)}</Badge>
                            ) : "0"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-secondary/50 text-foreground border-border">
                              P{job.priority}
                            </Badge>
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
