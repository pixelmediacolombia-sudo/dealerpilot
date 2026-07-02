import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  ImageOff,
  Sparkles,
  Store,
  AlertTriangle,
  RotateCcw,
  Image as ImageIcon,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { PhotoSetViewer } from "./PhotoSetViewer";

const API_BASE = "/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PhotoJob {
  id: number;
  vehicleId: number;
  status: string;
  totalPhotos: number;
  processedPhotos: number;
  exteriorCount: number;
  interiorCount: number;
  outputSetId: number | null;
  startedAt: string | null;
  completedAt: string | null;
  failedReason: string | null;
  createdAt: string;
  vehicleYear: number | null;
  vehicleMake: string;
  vehicleModel: string;
  vehicleTrim: string | null;
  vehicleVin: string | null;
  vehicleStatus: string;
  vehicleAiStatus: string | null;
  vehicleThumbnailUrl: string | null;
}

interface StudioStats {
  vehicles: {
    ready: number;
    processing: number;
    pending: number;
    failed: number;
    total: number;
  };
  images: { total: number; withAI: number };
  staleCount: number;
  processingMode?: string;
  setup: {
    backgroundConfigured: boolean;
    backgroundSource: "upload" | "env" | null;
    compositingEnabled: boolean;
    readyForProduction: boolean;
  };
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function fetchStats(): Promise<StudioStats> {
  const r = await fetch(`${API_BASE}/photo-studio/stats`);
  if (!r.ok) throw new Error("Failed to fetch stats");
  return r.json() as Promise<StudioStats>;
}

async function fetchJobs(): Promise<{ jobs: PhotoJob[] }> {
  const r = await fetch(`${API_BASE}/photo-studio/jobs?limit=200`);
  if (!r.ok) throw new Error("Failed to fetch jobs");
  return r.json() as Promise<{ jobs: PhotoJob[] }>;
}

async function triggerProcess(vehicleId: number): Promise<void> {
  const r = await fetch(`${API_BASE}/photo-studio/vehicles/${vehicleId}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealerId: 1 }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Processing failed");
  }
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Deduplicate jobs by vehicleId — keep the most recent per vehicle */
function dedupeByVehicle(jobs: PhotoJob[]): PhotoJob[] {
  const seen = new Map<number, PhotoJob>();
  for (const job of jobs) {
    const existing = seen.get(job.vehicleId);
    if (!existing) {
      seen.set(job.vehicleId, job);
    } else {
      // Prefer Completed > Processing > others; otherwise latest createdAt
      const rank = (s: string) =>
        s === "Completed" ? 3 : s === "Processing" ? 2 : s === "Queued" ? 1 : 0;
      if (rank(job.status) > rank(existing.status)) {
        seen.set(job.vehicleId, job);
      }
    }
  }
  return Array.from(seen.values());
}

function vehicleName(job: PhotoJob): string {
  return `${job.vehicleYear ?? ""} ${job.vehicleMake} ${job.vehicleModel}${job.vehicleTrim ? ` ${job.vehicleTrim}` : ""}`.trim();
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── AI Status badge ───────────────────────────────────────────────────────────

const AI_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  Ready: { label: "AI Enhanced", color: "text-green-400 bg-green-400/10 border-green-400/20" },
  Processing: { label: "Processing", color: "text-blue-400 bg-blue-400/10 border-blue-400/20" },
  Queued: { label: "In Queue", color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" },
  Failed: { label: "Needs Retry", color: "text-red-400 bg-red-400/10 border-red-400/20" },
  Pending: { label: "Not Started", color: "text-white/30 bg-white/[0.04] border-white/[0.08]" },
};

function AiStatusBadge({ status }: { status: string }) {
  const cfg = AI_STATUS_CONFIG[status] ?? AI_STATUS_CONFIG["Pending"]!;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border", cfg.color)}>
      {cfg.label}
    </span>
  );
}

// ── Vehicle Card ──────────────────────────────────────────────────────────────

function VehicleCard({
  job,
  onOpenStudio,
  onReprocess,
}: {
  job: PhotoJob;
  onOpenStudio: (vehicleId: number) => void;
  onReprocess: (vehicleId: number) => void;
}) {
  const name = vehicleName(job);
  const isProcessing = job.status === "Processing";
  const isDone = job.status === "Completed";
  const isFailed = job.status === "Failed" || job.status === "Cancelled";
  const aiStatus = job.vehicleAiStatus ?? (isDone ? "Ready" : isProcessing ? "Processing" : isFailed ? "Failed" : "Pending");
  const isMarketplaceReady = aiStatus === "Ready";
  const enhancedCount = isDone ? job.processedPhotos : 0;

  return (
    <div className="group relative bg-card border border-white/[0.06] rounded-2xl overflow-hidden hover:border-white/[0.12] transition-all duration-200">
      {/* Thumbnail */}
      <div className="relative aspect-[16/9] bg-white/[0.03] overflow-hidden">
        {job.vehicleThumbnailUrl ? (
          <img
            src={job.vehicleThumbnailUrl}
            alt={name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-white/10" />
          </div>
        )}

        {/* Marketplace Ready badge overlay */}
        {isMarketplaceReady && (
          <div className="absolute top-3 left-3">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-green-500/90 text-black backdrop-blur-sm">
              <Store className="w-3 h-3" />
              Marketplace Ready
            </span>
          </div>
        )}

        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <span className="text-xs text-white/80 font-medium">Enhancing photos…</span>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Title + AI status */}
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-white text-sm leading-tight">{name}</h3>
            <AiStatusBadge status={aiStatus} />
          </div>
          {job.vehicleVin && (
            <div className="text-[11px] text-white/30 font-mono tracking-wide">{job.vehicleVin}</div>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2.5 text-center">
            <div className="text-sm font-semibold text-white">{job.totalPhotos}</div>
            <div className="text-[10px] text-white/40 mt-0.5">Original</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2.5 text-center">
            <div className={cn("text-sm font-semibold", enhancedCount > 0 ? "text-green-400" : "text-white/30")}>
              {enhancedCount}
            </div>
            <div className="text-[10px] text-white/40 mt-0.5">Enhanced</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2.5 text-center">
            <div className="text-sm font-semibold text-white">
              {enhancedCount > 0 && job.totalPhotos > 0
                ? `${Math.round((enhancedCount / job.totalPhotos) * 100)}%`
                : "—"}
            </div>
            <div className="text-[10px] text-white/40 mt-0.5">Coverage</div>
          </div>
        </div>

        {/* Last processed */}
        {job.completedAt && (
          <div className="flex items-center gap-1.5 text-[11px] text-white/30">
            <Clock className="w-3 h-3" />
            Processed {timeAgo(job.completedAt)}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-0.5">
          {isDone && job.outputSetId !== null ? (
            <Button
              size="sm"
              className="flex-1 h-8 text-xs premium-gradient-btn"
              onClick={() => onOpenStudio(job.vehicleId)}
            >
              <Sparkles className="w-3 h-3 mr-1.5" />
              Open Studio
            </Button>
          ) : isFailed ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() => onReprocess(job.vehicleId)}
            >
              <RotateCcw className="w-3 h-3 mr-1.5" />
              Retry
            </Button>
          ) : isProcessing ? (
            <div className="flex-1 h-8 flex items-center justify-center">
              <span className="text-xs text-blue-400/70">Processing…</span>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() => onReprocess(job.vehicleId)}
            >
              <Sparkles className="w-3 h-3 mr-1.5" />
              Enhance Photos
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ onEnhanceAll, isPending }: { onEnhanceAll: () => void; isPending: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
        <Camera className="w-7 h-7 text-white/20" />
      </div>
      <div>
        <p className="text-white/60 font-medium text-sm">No vehicles processed yet</p>
        <p className="text-white/30 text-xs mt-1">Enhance all your inventory photos with one click</p>
      </div>
      <Button onClick={onEnhanceAll} disabled={isPending} className="premium-gradient-btn">
        {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
        Enhance All Photos
      </Button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AIPhotoStudio() {
  const [openVehicleId, setOpenVehicleId] = useState<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ["photo-studio-stats"],
    queryFn: fetchStats,
    refetchInterval: 8000,
  });

  const { data: allJobs, isLoading } = useQuery({
    queryKey: ["photo-studio-jobs"],
    queryFn: fetchJobs,
    refetchInterval: 3000,
  });

  const reprocessMutation = useMutation({
    mutationFn: triggerProcess,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["photo-studio-jobs"] });
      void qc.invalidateQueries({ queryKey: ["photo-studio-stats"] });
      toast({ title: "Enhancement started", description: "Photos are being processed." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start enhancement", description: err.message, variant: "destructive" });
    },
  });

  const enqueueAllMutation = useMutation({
    mutationFn: enqueueAll,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["photo-studio-jobs"] });
      void qc.invalidateQueries({ queryKey: ["photo-studio-stats"] });
      toast({
        title: "Enhancement queued",
        description: `${data.enqueued} vehicle${data.enqueued !== 1 ? "s" : ""} added to the queue.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to queue enhancement", description: err.message, variant: "destructive" });
    },
  });

  const vehicles = allJobs ? dedupeByVehicle(allJobs.jobs) : [];
  const readyCount = vehicles.filter((v) => v.vehicleAiStatus === "Ready" || (v.status === "Completed" && v.outputSetId !== null)).length;
  const processingCount = vehicles.filter((v) => v.status === "Processing" || v.status === "Queued").length;
  const totalCount = stats?.vehicles.total ?? vehicles.length;

  const kpis = [
    { label: "Total Vehicles", value: totalCount, icon: Camera, color: "text-white" },
    { label: "AI Enhanced", value: readyCount, icon: Sparkles, color: "text-green-400" },
    { label: "In Progress", value: processingCount, icon: Loader2, color: "text-blue-400", spin: processingCount > 0 },
    { label: "Not Started", value: Math.max(0, totalCount - readyCount - processingCount), icon: Clock, color: "text-white/40" },
  ];

  if (openVehicleId !== null) {
    return (
      <PhotoSetViewer
        vehicleId={openVehicleId}
        onClose={() => setOpenVehicleId(null)}
        onReprocess={(id) => { reprocessMutation.mutate(id); setOpenVehicleId(null); }}
      />
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">
        <PageHeader
          eyebrow="AI Photo Studio"
          title="Photo Studio"
          subtitle="Your vehicle media library"
          icon={Camera}
          action={
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => enqueueAllMutation.mutate()}
              disabled={enqueueAllMutation.isPending}
            >
              {enqueueAllMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              )}
              Enhance All
            </Button>
          }
        />
        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div key={kpi.label} className="bg-card border border-white/[0.06] rounded-xl p-4">
                <Icon className={cn("w-4 h-4 mb-2", kpi.color, (kpi as { spin?: boolean }).spin && "animate-spin")} />
                <div className={cn("text-2xl font-bold", kpi.color)}>{kpi.value}</div>
                <div className="text-xs text-white/40 mt-0.5">{kpi.label}</div>
              </div>
            );
          })}
        </div>

        {/* Stale warning */}
        {(stats?.staleCount ?? 0) > 0 && (
          <div className="flex items-center gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.04]">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="flex-1 text-sm">
              <span className="font-medium text-amber-300">{stats!.staleCount} vehicle{stats!.staleCount !== 1 ? "s" : ""}</span>
              <span className="text-amber-400/70 ml-1.5">have new photos since their last enhancement.</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10 shrink-0"
              onClick={async () => {
                try {
                  const r = await fetch(`${API_BASE}/photo-studio/reprocess-stale`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ dealerId: 1 }),
                  });
                  if (!r.ok) throw new Error("Failed");
                  const d = (await r.json()) as { enqueued: number };
                  void qc.invalidateQueries({ queryKey: ["photo-studio-jobs"] });
                  void qc.invalidateQueries({ queryKey: ["photo-studio-stats"] });
                  toast({ title: "Re-enhancement queued", description: `${d.enqueued} vehicle${d.enqueued !== 1 ? "s" : ""} queued.` });
                } catch {
                  toast({ title: "Failed to queue", variant: "destructive" });
                }
              }}
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Re-enhance
            </Button>
          </div>
        )}

        {/* Vehicle grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-white/30" />
          </div>
        ) : vehicles.length === 0 ? (
          <EmptyState
            onEnhanceAll={() => enqueueAllMutation.mutate()}
            isPending={enqueueAllMutation.isPending}
          />
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white/70">
                {vehicles.length} vehicle{vehicles.length !== 1 ? "s" : ""}
              </h2>
              <div className="flex items-center gap-1.5 text-[11px] text-white/30">
                <CheckCircle2 className="w-3 h-3 text-green-400/70" />
                <span className="text-green-400/70">{readyCount} ready</span>
                {processingCount > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-blue-400/70">{processingCount} processing</span>
                  </>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {vehicles.map((job) => (
                <VehicleCard
                  key={job.vehicleId}
                  job={job}
                  onOpenStudio={setOpenVehicleId}
                  onReprocess={(id) => reprocessMutation.mutate(id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
