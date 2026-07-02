import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  Cpu,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  AlertTriangle,
  Zap,
  Image as ImageIcon,
  Settings2,
  ChevronRight,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const API_BASE = "/api";

// ── Types ────────────────────────────────────────────────────────────────────

interface PhotoJob {
  id: number;
  vehicleId: number;
  status: string;
  attempts: number;
  totalPhotos: number;
  processedPhotos: number;
  failedPhotos: number;
  currentStage: string | null;
  progressPercent: number;
  outputSetId: number | null;
  modelVersion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedReason: string | null;
  createdAt: string;
  vehicleYear: number | null;
  vehicleMake: string;
  vehicleModel: string;
  vehicleTrim: string | null;
  vehicleStatus: string;
  vehicleAiStatus: string | null;
}

interface StudioStats {
  jobs: {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  vehicles: {
    ready: number;
    processing: number;
    pending: number;
    failed: number;
    total: number;
  };
  images: { total: number; withAI: number };
  defaultPack: { backgroundUrl: string | null; backgroundVersion: string; name: string } | null;
  providers: {
    backgroundRemoval: string;
    classification: string;
    compositing: string;
  };
}

// ── API calls ────────────────────────────────────────────────────────────────

async function fetchStats(): Promise<StudioStats> {
  const r = await fetch(`${API_BASE}/photo-studio/stats`);
  if (!r.ok) throw new Error("Failed to fetch stats");
  return r.json() as Promise<StudioStats>;
}

async function fetchJobs(status?: string): Promise<{ jobs: PhotoJob[] }> {
  const url = status
    ? `${API_BASE}/photo-studio/jobs?status=${encodeURIComponent(status)}&limit=100`
    : `${API_BASE}/photo-studio/jobs?limit=100`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Failed to fetch jobs");
  return r.json() as Promise<{ jobs: PhotoJob[] }>;
}

async function enqueueAll(): Promise<{ enqueued: number; skipped: number }> {
  const r = await fetch(`${API_BASE}/photo-studio/enqueue-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealerId: 1 }),
  });
  if (!r.ok) throw new Error("Failed to enqueue");
  return r.json() as Promise<{ enqueued: number; skipped: number }>;
}

// ── Sub-components ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> = {
  Queued: { label: "Queued", color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20", icon: Clock },
  Processing: { label: "Processing", color: "text-blue-400 bg-blue-400/10 border-blue-400/20", icon: Loader2 },
  Completed: { label: "Completed", color: "text-green-400 bg-green-400/10 border-green-400/20", icon: CheckCircle2 },
  Failed: { label: "Failed", color: "text-red-400 bg-red-400/10 border-red-400/20", icon: XCircle },
  Cancelled: { label: "Cancelled", color: "text-muted-foreground bg-white/5 border-white/10", icon: XCircle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["Queued"]!;
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border",
        cfg.color,
      )}
    >
      <Icon className={cn("w-3 h-3", status === "Processing" && "animate-spin")} />
      {cfg.label}
    </span>
  );
}

function JobCard({ job, onReprocess }: { job: PhotoJob; onReprocess: (vehicleId: number) => void }) {
  const title = `${job.vehicleYear ?? ""} ${job.vehicleMake} ${job.vehicleModel}${job.vehicleTrim ? ` ${job.vehicleTrim}` : ""}`.trim();
  const isLive = job.status === "Processing";
  const durationMs = job.completedAt && job.startedAt
    ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
    : null;

  return (
    <div className="bg-card border border-white/[0.06] rounded-xl p-4 space-y-3 hover:border-white/10 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge status={job.status} />
            {job.failedPhotos > 0 && (
              <span className="text-[11px] text-yellow-400/80">
                {job.failedPhotos} fallback{job.failedPhotos !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="font-medium text-sm text-white truncate">{title}</div>
          {job.currentStage && isLive && (
            <div className="text-[11px] text-primary mt-0.5">{job.currentStage}…</div>
          )}
          {job.failedReason && (
            <div className="text-[11px] text-red-400 mt-0.5 truncate" title={job.failedReason}>
              {job.failedReason}
            </div>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground text-right shrink-0">
          <div>Job #{job.id}</div>
          {durationMs !== null && (
            <div className="mt-0.5">{(durationMs / 1000).toFixed(1)}s</div>
          )}
        </div>
      </div>

      {/* Progress bar for active jobs */}
      {isLive && (
        <div className="space-y-1">
          <Progress value={job.progressPercent} className="h-1.5" />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{job.processedPhotos}/{job.totalPhotos} photos</span>
            <span>{job.progressPercent}%</span>
          </div>
        </div>
      )}

      {/* Completed: photo count + model info */}
      {job.status === "Completed" && (
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <ImageIcon className="w-3 h-3" />
            {job.processedPhotos} photos processed
          </span>
          {job.modelVersion && (
            <span className="flex items-center gap-1">
              <Cpu className="w-3 h-3" />
              {job.modelVersion}
            </span>
          )}
        </div>
      )}

      {/* Re-process button for failed jobs */}
      {(job.status === "Failed" || job.status === "Cancelled") && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onReprocess(job.vehicleId)}
        >
          <RefreshCw className="w-3 h-3 mr-1.5" />
          Re-process
        </Button>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function AIPhotoStudio() {
  const [activeTab, setActiveTab] = useState("all");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["photo-studio-stats"],
    queryFn: fetchStats,
    refetchInterval: 4000,
  });

  const { data: allJobs, isLoading: jobsLoading } = useQuery({
    queryKey: ["photo-studio-jobs", activeTab],
    queryFn: () =>
      fetchJobs(
        activeTab === "all" ? undefined : activeTab.charAt(0).toUpperCase() + activeTab.slice(1),
      ),
    refetchInterval: activeTab === "processing" || activeTab === "all" ? 2500 : false,
  });

  const enqueueAllMutation = useMutation({
    mutationFn: enqueueAll,
    onSuccess: (data) => {
      toast({
        title: "Processing queued",
        description: `${data.enqueued} vehicles enqueued, ${data.skipped} skipped`,
      });
      void qc.invalidateQueries({ queryKey: ["photo-studio-jobs"] });
      void qc.invalidateQueries({ queryKey: ["photo-studio-stats"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to enqueue vehicles", variant: "destructive" });
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: (vehicleId: number) =>
      fetch(`${API_BASE}/photo-studio/vehicles/${vehicleId}/process`, { method: "POST" }).then(
        (r) => r.json(),
      ),
    onSuccess: () => {
      toast({ title: "Re-processing queued" });
      void qc.invalidateQueries({ queryKey: ["photo-studio-jobs"] });
      void qc.invalidateQueries({ queryKey: ["photo-studio-stats"] });
    },
  });

  const jobs = allJobs?.jobs ?? [];
  const isBackgroundRemovalConfigured = stats?.providers.backgroundRemoval?.startsWith("fal.ai");
  const isStudioBackgroundConfigured = !!stats?.defaultPack?.backgroundUrl;

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Camera className="w-4 h-4 text-primary" />
              </div>
              <h1 className="text-xl font-semibold text-white tracking-tight">AI Photo Studio</h1>
            </div>
            <p className="text-sm text-muted-foreground ml-11">
              Automated background removal, studio compositing, and intelligent photo ordering.
            </p>
          </div>
          <Button
            onClick={() => enqueueAllMutation.mutate()}
            disabled={enqueueAllMutation.isPending}
            className="shrink-0"
          >
            {enqueueAllMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            Process All Vehicles
          </Button>
        </div>

        {/* Configuration alerts */}
        {(!isBackgroundRemovalConfigured || !isStudioBackgroundConfigured) && (
          <div className="space-y-2">
            {!isBackgroundRemovalConfigured && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-sm">
                <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium text-yellow-300">Background removal not configured</span>
                  <span className="text-yellow-400/80 ml-2">
                    Add <code className="font-mono text-xs bg-yellow-500/20 px-1 rounded">FAL_KEY</code> to
                    enable BRIA RMBG 2.0 background removal. Photos will be classified and ordered without
                    background removal.
                  </span>
                </div>
              </div>
            )}
            {!isStudioBackgroundConfigured && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
                <Settings2 className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium text-blue-300">No studio background configured</span>
                  <span className="text-blue-400/80 ml-2">
                    Set <code className="font-mono text-xs bg-blue-500/20 px-1 rounded">AI_STUDIO_BACKGROUND</code> to
                    a background image URL to enable compositing.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: "Vehicles Ready",
              value: stats?.vehicles.ready ?? 0,
              sub: `of ${stats?.vehicles.total ?? 0} total`,
              icon: CheckCircle2,
              color: "text-green-400",
            },
            {
              label: "Processing",
              value: (stats?.jobs.queued ?? 0) + (stats?.jobs.processing ?? 0),
              sub: stats?.jobs.processing ? `${stats.jobs.processing} active` : "idle",
              icon: Loader2,
              color: "text-blue-400",
              animate: (stats?.jobs.processing ?? 0) > 0,
            },
            {
              label: "Photos Processed",
              value: stats?.images.withAI ?? 0,
              sub: `of ${stats?.images.total ?? 0} total`,
              icon: ImageIcon,
              color: "text-primary",
            },
            {
              label: "Failed Jobs",
              value: stats?.jobs.failed ?? 0,
              sub: "need retry",
              icon: XCircle,
              color: "text-red-400",
            },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-white/[0.06] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  {s.label}
                </span>
                <s.icon
                  className={cn("w-4 h-4", s.color, "animate" in s && s.animate && "animate-spin")}
                />
              </div>
              <div className="text-2xl font-bold text-white tabular-nums">{s.value}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Provider info */}
        {stats?.providers && (
          <div className="flex flex-wrap gap-3">
            {Object.entries(stats.providers).map(([key, value]) => (
              <div
                key={key}
                className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border border-white/[0.06] rounded-lg text-xs"
              >
                <Zap className="w-3 h-3 text-primary" />
                <span className="text-muted-foreground capitalize">
                  {key.replace(/([A-Z])/g, " $1").trim()}:
                </span>
                <span className="text-white/80 font-medium">{value as string}</span>
              </div>
            ))}
          </div>
        )}

        {/* Job queue */}
        <div>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex items-center justify-between mb-4">
              <TabsList className="bg-white/[0.04] border border-white/[0.06]">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="processing">
                  Active
                  {(stats?.jobs.queued ?? 0) + (stats?.jobs.processing ?? 0) > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] rounded-full font-medium">
                      {(stats?.jobs.queued ?? 0) + (stats?.jobs.processing ?? 0)}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="completed">Completed</TabsTrigger>
                <TabsTrigger value="failed">
                  Failed
                  {(stats?.jobs.failed ?? 0) > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] rounded-full font-medium">
                      {stats?.jobs.failed}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
              <span className="text-xs text-muted-foreground">
                {jobs.length} job{jobs.length !== 1 ? "s" : ""}
              </span>
            </div>

            {["all", "processing", "completed", "failed"].map((tab) => (
              <TabsContent key={tab} value={tab} className="mt-0">
                {jobsLoading ? (
                  <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Loading jobs…
                  </div>
                ) : jobs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Camera className="w-10 h-10 text-muted-foreground/30 mb-3" />
                    <div className="text-sm text-muted-foreground">
                      {tab === "all"
                        ? 'No jobs yet. Click "Process All Vehicles" to start.'
                        : `No ${tab} jobs.`}
                    </div>
                    {tab === "all" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={() => enqueueAllMutation.mutate()}
                        disabled={enqueueAllMutation.isPending}
                      >
                        <Play className="w-3.5 h-3.5 mr-1.5" />
                        Process All Vehicles
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {jobs.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        onReprocess={(vid) => reprocessMutation.mutate(vid)}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
