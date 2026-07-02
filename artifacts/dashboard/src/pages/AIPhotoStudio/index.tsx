import { useState, useRef, useCallback } from "react";
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
  Upload,
  ImageOff,
  ShieldAlert,
  CircleSlash,
  RotateCcw,
  Eye,
  Layers,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { PhotoSetViewer } from "./PhotoSetViewer";

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
  exteriorCount: number;
  interiorCount: number;
  fallbackCount: number;
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

interface ViewSetJob {
  vehicleId: number;
  jobId: number;
  processingTimeMs: number | null;
}

interface SetupInfo {
  backgroundConfigured: boolean;
  backgroundSource: "upload" | "env" | null;
  compositingEnabled: boolean;
  backgroundWidth: number | null;
  backgroundHeight: number | null;
  readyForProduction: boolean;
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
  staleCount: number;
  fal?: {
    imagesProcessed: number;
    estimatedSpendUsd: number;
    lowBalanceWarning: boolean;
    thresholdUsd: number;
    costPerImageUsd: number;
  };
  defaultPack: {
    backgroundUrl: string | null;
    backgroundVersion: string;
    name: string;
    backgroundWidth: number | null;
    backgroundHeight: number | null;
  } | null;
  setup: SetupInfo;
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

async function reprocessStale(): Promise<{ enqueued: number; currentVersion: string }> {
  const r = await fetch(`${API_BASE}/photo-studio/reprocess-stale`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealerId: 1 }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Reprocess failed");
  }
  return r.json() as Promise<{ enqueued: number; currentVersion: string }>;
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

async function uploadBackground(file: File): Promise<{ pack: unknown; setup: SetupInfo }> {
  const fd = new FormData();
  fd.append("background", file);
  const r = await fetch(`${API_BASE}/photo-studio/background`, { method: "POST", body: fd });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Upload failed");
  }
  return r.json() as Promise<{ pack: unknown; setup: SetupInfo }>;
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

function JobCard({
  job,
  onReprocess,
  onViewSet,
}: {
  job: PhotoJob;
  onReprocess: (vehicleId: number) => void;
  onViewSet: (job: ViewSetJob) => void;
}) {
  const title = `${job.vehicleYear ?? ""} ${job.vehicleMake} ${job.vehicleModel}${job.vehicleTrim ? ` ${job.vehicleTrim}` : ""}`.trim();
  const isLive = job.status === "Processing";
  const durationMs =
    job.completedAt && job.startedAt
      ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
      : null;

  const hasSet = job.status === "Completed" && job.outputSetId !== null;

  return (
    <div className="bg-card border border-white/[0.06] rounded-xl p-4 space-y-3 hover:border-white/10 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge status={job.status} />
            {job.fallbackCount > 0 && (
              <span className="text-[11px] text-amber-400/80">
                {job.fallbackCount} fallback{job.fallbackCount !== 1 ? "s" : ""}
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
          {durationMs !== null && <div className="mt-0.5">{(durationMs / 1000).toFixed(1)}s</div>}
        </div>
      </div>

      {isLive && (
        <div className="space-y-1">
          <Progress value={job.progressPercent} className="h-1.5" />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>
              {job.processedPhotos}/{job.totalPhotos} photos
            </span>
            <span>{job.progressPercent}%</span>
          </div>
        </div>
      )}

      {job.status === "Completed" && (
        <div className="space-y-3">
          {/* Breakdown stats */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {job.exteriorCount > 0 && (
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3 text-primary/70" />
                <span className="text-primary/90">{job.exteriorCount}</span> ext
              </span>
            )}
            {job.interiorCount > 0 && (
              <span className="flex items-center gap-1">
                <ImageIcon className="w-3 h-3" />
                {job.interiorCount} int
              </span>
            )}
            {job.modelVersion && (
              <span className="flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                {job.modelVersion}
              </span>
            )}
          </div>

          {/* View set button */}
          {hasSet && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs w-full"
              onClick={() =>
                onViewSet({
                  vehicleId: job.vehicleId,
                  jobId: job.id,
                  processingTimeMs: durationMs,
                })
              }
            >
              <Eye className="w-3 h-3 mr-1.5" />
              Review AI Photos
            </Button>
          )}
        </div>
      )}

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

// ── Setup Gate ───────────────────────────────────────────────────────────────

function SetupGate({
  isBgRemovalReady,
  onUploaded,
}: {
  isBgRemovalReady: boolean;
  onUploaded: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const uploadMutation = useMutation({
    mutationFn: uploadBackground,
    onSuccess: (data) => {
      const s = data.setup;
      toast({
        title: "Background uploaded",
        description: `${s.backgroundWidth ?? "?"}×${s.backgroundHeight ?? "?"} px — compositing is now enabled.`,
      });
      void qc.invalidateQueries({ queryKey: ["photo-studio-stats"] });
      onUploaded();
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select a JPEG, PNG, or WebP image.", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, [toast]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const checklistItems = [
    {
      label: "Alpha Motorsport studio background",
      done: false,
      critical: true,
      note: "Required for compositing",
    },
    {
      label: "Classification",
      done: true,
      critical: false,
      note: "OpenAI GPT-5-mini vision — ready",
    },
    {
      label: "Background removal",
      done: isBgRemovalReady,
      critical: false,
      note: isBgRemovalReady ? "fal.ai BRIA RMBG 2.0 — ready" : "Optional — add FAL_KEY to enable",
    },
    {
      label: "Enhancement & ordering",
      done: true,
      critical: false,
      note: "Sharp.js — ready",
    },
  ];

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-4 p-6 border-b border-amber-500/15">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0 mt-0.5">
          <ShieldAlert className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-base font-semibold text-white">AI Studio Setup Required</h2>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/25 uppercase tracking-wide">
              Not Production-Ready
            </span>
          </div>
          <p className="text-sm text-amber-200/60">
            Waiting for Alpha Motorsport Studio Background.{" "}
            <span className="text-amber-200/40">
              Classification, background removal, and enhancement will still run.
              Compositing is disabled until the background is uploaded.
            </span>
          </p>
        </div>
      </div>

      <div className="p-6 grid md:grid-cols-2 gap-6">
        {/* Left: Checklist */}
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-4">
            Pipeline Setup Checklist
          </div>
          {checklistItems.map((item) => (
            <div
              key={item.label}
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border",
                item.done
                  ? "bg-green-500/[0.04] border-green-500/15"
                  : item.critical
                    ? "bg-amber-500/[0.06] border-amber-500/20"
                    : "bg-white/[0.02] border-white/[0.06]",
              )}
            >
              <div className="mt-0.5 shrink-0">
                {item.done ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                ) : item.critical ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                ) : (
                  <CircleSlash className="w-4 h-4 text-muted-foreground/50" />
                )}
              </div>
              <div className="min-w-0">
                <div
                  className={cn(
                    "text-sm font-medium",
                    item.done
                      ? "text-green-300"
                      : item.critical
                        ? "text-amber-200"
                        : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </div>
                <div className="text-[11px] text-muted-foreground/60 mt-0.5">{item.note}</div>
              </div>
            </div>
          ))}

          {/* Compositing disabled callout */}
          <div className="flex items-center gap-2.5 p-3 rounded-lg border border-red-500/20 bg-red-500/[0.04] mt-2">
            <ImageOff className="w-4 h-4 text-red-400 shrink-0" />
            <span className="text-xs text-red-300/80">
              Compositing is <span className="font-semibold text-red-300">disabled</span> — vehicles will be
              processed without a studio background.
            </span>
          </div>
        </div>

        {/* Right: Upload area */}
        <div className="space-y-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Upload Studio Background
          </div>

          {/* Preview or drop zone */}
          <div
            className={cn(
              "relative rounded-xl border-2 border-dashed transition-all cursor-pointer overflow-hidden",
              dragOver
                ? "border-amber-400/60 bg-amber-500/10"
                : preview
                  ? "border-white/20 bg-transparent"
                  : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.03]",
            )}
            style={{ minHeight: 180 }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {preview ? (
              <>
                <img
                  src={preview}
                  alt="Background preview"
                  className="w-full h-44 object-cover rounded-xl"
                />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity rounded-xl">
                  <span className="text-xs text-white font-medium">Click to change</span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center select-none">
                <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-3">
                  <Upload className="w-5 h-5 text-muted-foreground/60" />
                </div>
                <div className="text-sm font-medium text-muted-foreground">
                  Drop background image here
                </div>
                <div className="text-[11px] text-muted-foreground/50 mt-1">
                  JPEG, PNG or WebP · up to 30 MB
                </div>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/tiff"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />

          <Button
            className="w-full"
            disabled={!selectedFile || uploadMutation.isPending}
            onClick={() => { if (selectedFile) uploadMutation.mutate(selectedFile); }}
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing &amp; saving…
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                {selectedFile ? `Upload ${selectedFile.name}` : "Select an image first"}
              </>
            )}
          </Button>

          <p className="text-[11px] text-muted-foreground/50 text-center leading-relaxed">
            Sharp will read the image dimensions, auto-generate the logo safe zone and vehicle
            placement mask, and save the background to the Alpha Motorsport Studio Pack.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Setup Complete Banner ────────────────────────────────────────────────────

function SetupComplete({
  pack,
}: {
  pack: NonNullable<StudioStats["defaultPack"]>;
}) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border border-green-500/20 bg-green-500/[0.04]">
      <div className="w-8 h-8 rounded-lg bg-green-500/15 border border-green-500/25 flex items-center justify-center shrink-0">
        <CheckCircle2 className="w-4 h-4 text-green-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-green-300">Studio background configured</div>
        <div className="text-[11px] text-muted-foreground/60 mt-0.5">
          {pack.name} · {pack.backgroundWidth && pack.backgroundHeight
            ? `${pack.backgroundWidth}×${pack.backgroundHeight} px · `
            : ""}
          v{pack.backgroundVersion} · Compositing enabled
        </div>
      </div>
      {pack.backgroundUrl && (
        <img
          src={pack.backgroundUrl}
          alt="Studio background thumbnail"
          className="h-10 w-16 object-cover rounded-md border border-white/10 shrink-0"
        />
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function AIPhotoStudio() {
  const [activeTab, setActiveTab] = useState("all");
  const [viewSetJob, setViewSetJob] = useState<ViewSetJob | null>(null);
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

  const reprocessStaleMutation = useMutation({
    mutationFn: reprocessStale,
    onSuccess: (data) => {
      toast({
        title: "Reprocess queued",
        description: data.enqueued > 0
          ? `${data.enqueued} vehicle${data.enqueued !== 1 ? "s" : ""} queued for background update (Stages 1–2 skipped — no extra API cost)`
          : "All vehicles are already up-to-date",
      });
      void qc.invalidateQueries({ queryKey: ["photo-studio-jobs"] });
      void qc.invalidateQueries({ queryKey: ["photo-studio-stats"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
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
  const setup = stats?.setup;
  const isBgConfigured = setup?.backgroundConfigured ?? false;
  const isBgRemovalReady = stats?.providers.backgroundRemoval?.startsWith("fal.ai") ?? false;
  const staleCount = stats?.staleCount ?? 0;

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
              {!isBgConfigured && !statsLoading && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 uppercase tracking-wide">
                  Setup Required
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground ml-11">
              Automated background removal, studio compositing, and intelligent photo ordering.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isBgConfigured && !statsLoading && (
              <div className="text-xs text-amber-400/70 text-right max-w-[160px] leading-tight">
                Upload background to enable compositing
              </div>
            )}
            <Button
              onClick={() => enqueueAllMutation.mutate()}
              disabled={enqueueAllMutation.isPending || (!isBgConfigured && !statsLoading)}
              title={
                !isBgConfigured
                  ? "Upload the studio background before processing"
                  : "Enqueue all vehicles for AI photo processing"
              }
              className={cn(!isBgConfigured && !statsLoading && "opacity-50 cursor-not-allowed")}
            >
              {enqueueAllMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Process All Vehicles
            </Button>
          </div>
        </div>

        {/* Setup gate / completion banner */}
        {statsLoading ? null : isBgConfigured ? (
          stats?.defaultPack ? (
            <SetupComplete pack={stats.defaultPack} />
          ) : null
        ) : (
          <SetupGate
            isBgRemovalReady={isBgRemovalReady}
            onUploaded={() => void qc.invalidateQueries({ queryKey: ["photo-studio-stats"] })}
          />
        )}

        {/* FAL_KEY banner (only show after bg is configured, so it's not buried under the gate) */}
        {isBgConfigured && !isBgRemovalReady && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-sm">
            <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-yellow-300">Background removal not configured</span>
              <span className="text-yellow-400/80 ml-2">
                Add{" "}
                <code className="font-mono text-xs bg-yellow-500/20 px-1 rounded">FAL_KEY</code> to
                enable BRIA RMBG 2.0. Photos will be classified and ordered without background
                removal.
              </span>
            </div>
          </div>
        )}

        {/* Stale background banner — shown when Ready vehicles have old composite versions */}
        {isBgConfigured && staleCount > 0 && (
          <div className="flex items-center gap-4 p-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.06]">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
              <RotateCcw className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-amber-300">
                {staleCount} vehicle{staleCount !== 1 ? "s" : ""} need background update
              </div>
              <div className="text-xs text-amber-400/70 mt-0.5">
                Studio background changed. Exterior photos will be re-composited with the new background.
                Classification and background removal are skipped — no extra API cost.
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200 shrink-0"
              onClick={() => reprocessStaleMutation.mutate()}
              disabled={reprocessStaleMutation.isPending}
            >
              {reprocessStaleMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              )}
              Reprocess {staleCount} Vehicle{staleCount !== 1 ? "s" : ""}
            </Button>
          </div>
        )}

        {/* FAL.ai low-balance warning — cumulative spend estimate (no balance API available) */}
        {isBgRemovalReady && stats?.fal?.lowBalanceWarning && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-medium text-amber-300">FAL.ai balance may be running low</span>
              <span className="text-amber-400/80 ml-2">
                Estimated spend: <span className="font-mono text-amber-300">${stats.fal.estimatedSpendUsd.toFixed(2)}</span>
                {" "}({stats.fal.imagesProcessed.toLocaleString()} images × ${stats.fal.costPerImageUsd}/image).
                Threshold: ${stats.fal.thresholdUsd}. Top up your FAL.ai account to avoid interruptions.
              </span>
            </div>
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

        {/* Provider pills */}
        {stats?.providers && (
          <div className="flex flex-wrap gap-3">
            {Object.entries(stats.providers).map(([key, value]) => {
              const isDisabled = (value as string).toLowerCase().startsWith("disabled");
              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs",
                    isDisabled
                      ? "bg-red-500/[0.04] border-red-500/15"
                      : "bg-white/[0.03] border-white/[0.06]",
                  )}
                >
                  {isDisabled ? (
                    <ImageOff className="w-3 h-3 text-red-400/70" />
                  ) : (
                    <Zap className="w-3 h-3 text-primary" />
                  )}
                  <span className={cn("capitalize", isDisabled ? "text-red-400/60" : "text-muted-foreground")}>
                    {key.replace(/([A-Z])/g, " $1").trim()}:
                  </span>
                  <span className={cn("font-medium", isDisabled ? "text-red-400/80" : "text-white/80")}>
                    {value as string}
                  </span>
                </div>
              );
            })}
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
                        ? isBgConfigured
                          ? 'No jobs yet. Click "Process All Vehicles" to start.'
                          : "Upload the studio background to begin processing."
                        : `No ${tab} jobs.`}
                    </div>
                    {tab === "all" && isBgConfigured && (
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
                        onViewSet={setViewSetJob}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>

      {/* Photo set viewer — full-screen overlay */}
      {viewSetJob && (
        <PhotoSetViewer
          vehicleId={viewSetJob.vehicleId}
          jobId={viewSetJob.jobId}
          processingTimeMs={viewSetJob.processingTimeMs}
          onClose={() => setViewSetJob(null)}
        />
      )}
    </AppLayout>
  );
}
