import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDealerLocation } from "@/context/LocationContext";
import {
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Sparkles,
  Store,
  AlertTriangle,
  RotateCcw,
  Image as ImageIcon,
  Search,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { AppLayout } from "@/shared/layout/AppLayout";
import { PageHeader } from "@/shared/ui";
import { Button } from "@/shared/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { PhotoSetViewer } from "../components/PhotoSetViewer";

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
  noImprovementCount: number;
  lowImprovementCount: number;
  fallbackCount: number;
}

interface InventoryVehicle {
  id: number;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  vin: string;
  primaryImageUrl: string | null;
  imageCount: number;
  status: string;
  price: number | null;
  mileage: number | null;
}

interface PhotoStudioStats {
  vehicles?: {
    ready?: number | string;
    processing?: number | string;
    failed?: number | string;
  };
  providers?: {
    enhancement?: string;
    restoration?: {
      provider?: string;
      model?: string;
      promptVersion?: string;
      enabled?: boolean;
    };
  };
}

type PhotoProcessingMode = "fidelity-first" | "balanced" | "strong-restoration";

interface ProcessArgs {
  vehicleId: number;
  processingMode: PhotoProcessingMode;
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function fetchJobs(): Promise<{ jobs: PhotoJob[] }> {
  const r = await fetch(`${API_BASE}/photo-studio/jobs?limit=200`);
  if (!r.ok) throw new Error("Failed to fetch jobs");
  return r.json() as Promise<{ jobs: PhotoJob[] }>;
}

async function fetchStats(): Promise<PhotoStudioStats> {
  const r = await fetch(`${API_BASE}/photo-studio/stats`);
  if (!r.ok) throw new Error("Failed to fetch photo studio stats");
  return r.json() as Promise<PhotoStudioStats>;
}

async function fetchInventory(location?: string): Promise<{ vehicles: InventoryVehicle[] }> {
  const params = new URLSearchParams({ sort: "newest" });
  if (location) params.set("location", location);
  const r = await fetch(`${API_BASE}/vehicles?${params.toString()}`);
  if (!r.ok) throw new Error("Failed to fetch inventory");
  return r.json() as Promise<{ vehicles: InventoryVehicle[] }>;
}

async function triggerProcess({ vehicleId, processingMode }: ProcessArgs, confirmCost = false): Promise<void> {
  const r = await fetch(`${API_BASE}/photo-studio/vehicles/${vehicleId}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealerId: 1, processingMode, confirmCost }),
  });
  if (r.status === 409) {
    const body = (await r.json().catch(() => ({}))) as {
      requiresConfirmation?: boolean;
      message?: string;
      estimate?: { photosNeedingRestoration?: number; totalPhotos?: number; estimatedCostUsd?: number };
      error?: string;
    };
    if (body.requiresConfirmation) {
      const estimate = body.estimate;
      const message = body.message ??
        `${estimate?.photosNeedingRestoration ?? "Some"} of ${estimate?.totalPhotos ?? "the"} photos need AI restoration. Estimated cost: $${estimate?.estimatedCostUsd ?? "unknown"}.`;
      if (window.confirm(message)) {
        return triggerProcess({ vehicleId, processingMode }, true);
      }
      throw new Error("Enhancement cancelled before OpenAI spend.");
    }
    throw new Error(body.error ?? "Processing failed");
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Processing failed");
  }
}

async function enqueueAll(location?: string): Promise<{ enqueued: number; skipped: number }> {
  const r = await fetch(`${API_BASE}/photo-studio/enqueue-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealerId: 1, ...(location ? { location } : {}) }),
  });
  if (!r.ok) throw new Error("Failed to enqueue");
  return r.json() as Promise<{ enqueued: number; skipped: number }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dedupeByVehicle(jobs: PhotoJob[]): PhotoJob[] {
  const seen = new Map<number, PhotoJob>();
  for (const job of jobs) {
    const existing = seen.get(job.vehicleId);
    if (!existing) {
      seen.set(job.vehicleId, job);
    } else {
      const rank = (s: string) =>
        s === "Completed" ? 3 : s === "Processing" ? 2 : s === "Queued" ? 1 : 0;
      if (rank(job.status) > rank(existing.status)) seen.set(job.vehicleId, job);
    }
  }
  return Array.from(seen.values());
}

function vName(year: number | null, make: string, model: string, trim: string | null) {
  return `${year ?? ""} ${make} ${model}${trim ? ` ${trim}` : ""}`.trim();
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function toCount(value: number | string | undefined): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) ? Number(parsed) : 0;
}

// ── AI Status badge ───────────────────────────────────────────────────────────

const AI_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  Ready:      { label: "AI Enhanced",  color: "text-success bg-success/10 border-success/20" },
  Processing: { label: "Processing",   color: "text-primary bg-primary/10 border-primary/20" },
  Queued:     { label: "In Queue",     color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" },
  Failed:     { label: "Needs Attention",  color: "text-destructive bg-destructive/10 border-destructive/20" },
  Pending:    { label: "Ready to Enhance",  color: "text-muted-foreground bg-muted border-border" },
};

function AiStatusBadge({ status }: { status: string }) {
  const cfg = AI_STATUS_CONFIG[status] ?? AI_STATUS_CONFIG["Pending"]!;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border", cfg.color)}>
      {cfg.label}
    </span>
  );
}

// ── Processing Queue Row ──────────────────────────────────────────────────────

function VehicleCard({
  job,
  onOpenStudio,
  onReprocess,
}: {
  job: PhotoJob;
  onOpenStudio: (vehicleId: number) => void;
  onReprocess: (vehicleId: number) => void;
}) {
  const name = vName(job.vehicleYear, job.vehicleMake, job.vehicleModel, job.vehicleTrim);
  const isProcessing = job.status === "Processing" || job.status === "Queued";
  const isDone = job.status === "Completed";
  const isFailed = job.status === "Failed" || job.status === "Cancelled";
  const aiStatus = job.vehicleAiStatus ?? (isDone ? "Ready" : isProcessing ? "Processing" : isFailed ? "Failed" : "Pending");
  const enhancedCount = isDone ? job.processedPhotos : 0;
  const pct = enhancedCount > 0 && job.totalPhotos > 0
    ? Math.round((enhancedCount / job.totalPhotos) * 100)
    : 0;

  return (
    <div className={cn(
      "flex items-center gap-5 px-5 py-3.5 border-b border-border last:border-0 transition-colors hover:bg-muted",
      isFailed && "border-l-2 border-l-red-500/30",
      isProcessing && "border-l-2 border-l-blue-500/30",
      isDone && aiStatus === "Ready" && "border-l-2 border-l-amber-500/25",
    )}>
      {/* Thumbnail */}
      <div className="w-[72px] h-[52px] shrink-0 rounded-lg overflow-hidden bg-muted border border-border relative">
        {job.vehicleThumbnailUrl ? (
          <img src={job.vehicleThumbnailUrl} alt={name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
        {isProcessing && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
          </div>
        )}
      </div>

      {/* Vehicle info */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-foreground truncate">{name}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-muted-foreground font-mono">{job.totalPhotos} orig</span>
          {enhancedCount > 0 && (
            <span className="text-xs text-warning/70 font-mono">{enhancedCount} enhanced</span>
          )}
          {/* Improvement quality indicator — only shown for completed jobs with delta data */}
          {isDone && job.noImprovementCount > 0 && (
            <span className="text-[11px] font-semibold  tracking-wide text-orange-400/70 border border-orange-500/20 rounded px-1.5 py-0.5">
              {job.noImprovementCount} no change
            </span>
          )}
          {isDone && job.noImprovementCount === 0 && job.lowImprovementCount > 0 && (
            <span className="text-[11px] font-semibold  tracking-wide text-yellow-400/50 border border-yellow-500/15 rounded px-1.5 py-0.5">
              {job.lowImprovementCount} low
            </span>
          )}
          {job.completedAt && (
            <span className="text-xs text-muted-foreground font-mono">{timeAgo(job.completedAt)}</span>
          )}
        </div>
        {/* Progress bar — amber = enhanced, orange = low/no improvement */}
        {job.totalPhotos > 0 && (
          <div className="mt-1.5 h-[2px] w-32 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition",
                isDone && job.noImprovementCount > job.totalPhotos * 0.5 ? "bg-orange-400" :
                isDone ? "bg-warning" :
                isProcessing ? "bg-primary" : "bg-muted",
              )}
              style={{ width: isProcessing ? "60%" : `${pct}%` }}
            />
          </div>
        )}
      </div>

      {/* Status */}
      <div className="shrink-0 hidden md:block">
        <AiStatusBadge status={aiStatus} />
      </div>

      {/* Action */}
      <div className="shrink-0">
        {isDone && job.outputSetId !== null ? (
          <Button size="sm" className="h-7 text-[11px] px-3 premium-gradient-btn"
            onClick={() => onOpenStudio(job.vehicleId)}>
            <Sparkles className="w-3 h-3 mr-1" />Open Studio
          </Button>
        ) : isFailed ? (
          <Button variant="ghost" size="sm" className="h-7 text-[11px] px-3 text-destructive/70 hover:text-destructive"
            onClick={() => onReprocess(job.vehicleId)}>
            <RotateCcw className="w-3 h-3 mr-1" />Retry
          </Button>
        ) : isProcessing ? (
          <span className="text-[11px] text-primary/60 font-mono">
            {job.status === "Queued" ? "In queue…" : "Processing…"}
          </span>
        ) : (
          <Button variant="ghost" size="sm" className="h-7 text-[11px] px-3 text-muted-foreground hover:text-warning"
            onClick={() => onReprocess(job.vehicleId)}>
            <Sparkles className="w-3 h-3 mr-1" />Enhance
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Inventory Browser ─────────────────────────────────────────────────────────

function InventoryBrowser({
  jobsByVehicleId,
  onEnhance,
  onOpenStudio,
  pendingVehicleIds,
}: {
  jobsByVehicleId: Map<number, PhotoJob>;
  onEnhance: (vehicleId: number) => void;
  onOpenStudio: (vehicleId: number) => void;
  pendingVehicleIds: Set<number>;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(true);
  const { selectedLocation } = useDealerLocation();

  const { data, isLoading } = useQuery({
    queryKey: ["inventory-for-studio", selectedLocation],
    queryFn: () => fetchInventory(selectedLocation),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const all = data?.vehicles ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (v) =>
        `${v.year ?? ""} ${v.make} ${v.model} ${v.trim ?? ""} ${v.vin}`.toLowerCase().includes(q),
    );
  }, [data?.vehicles, search]);

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Section header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <Search className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Select a Vehicle to Enhance</span>
          {data && (
            <span className="text-xs text-muted-foreground">{data.vehicles.length} vehicles in inventory</span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Search bar */}
          <div className="px-5 py-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by year, make, model, VIN…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 focus:bg-muted transition-colors"
              />
            </div>
          </div>

          {/* Vehicle list */}
          <div className="max-h-[420px] overflow-y-auto divide-y divide-white/[0.04]">
            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isLoading && filtered.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">No vehicles found</div>
            )}

            {filtered.map((vehicle) => {
              const job = jobsByVehicleId.get(vehicle.id);
              const name = vName(vehicle.year, vehicle.make, vehicle.model, vehicle.trim);
              const isEnhanced = job?.status === "Completed" && job.outputSetId !== null;
              const isActive = job?.status === "Processing" || job?.status === "Queued";
              const isPending = pendingVehicleIds.has(vehicle.id);

              return (
                <div
                  key={vehicle.id}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted transition-colors"
                >
                  {/* Thumbnail */}
                  <div className="w-14 h-10 rounded-lg overflow-hidden bg-muted border border-border shrink-0">
                    {vehicle.primaryImageUrl ? (
                      <img
                        src={vehicle.primaryImageUrl}
                        alt={name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-muted-foreground">{vehicle.imageCount} photo{vehicle.imageCount !== 1 ? "s" : ""}</span>
                    </div>
                  </div>

                  {/* Status + action */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isEnhanced ? (
                      <>
                        <span className="text-[11px] text-success font-medium">✓ Enhanced</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => onOpenStudio(vehicle.id)}
                        >
                          Open Studio
                        </Button>
                      </>
                    ) : isActive ? (
                      <span className="flex items-center gap-1.5 text-[11px] text-primary">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {job?.status === "Queued" ? "In queue…" : "Processing…"}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        className="h-7 text-xs premium-gradient-btn"
                        disabled={isPending}
                        onClick={() => onEnhance(vehicle.id)}
                      >
                        {isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3 mr-1" />
                            Enhance
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AIPhotoStudio() {
  const [openVehicleId, setOpenVehicleId] = useState<number | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [processingMode, setProcessingMode] = useState<PhotoProcessingMode>("fidelity-first");
  const { toast } = useToast();
  const qc = useQueryClient();
  const { selectedLocation } = useDealerLocation();

  const { data: allJobs, isLoading } = useQuery({
    queryKey: ["photo-studio-jobs"],
    queryFn: fetchJobs,
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const hasActive = jobs.some((j) => j.status === "Processing" || j.status === "Queued");
      return hasActive ? 5000 : 30000;
    },
  });
  const { data: stats } = useQuery({
    queryKey: ["photo-studio-stats"],
    queryFn: fetchStats,
    refetchInterval: 30000,
  });

  const reprocessMutation = useMutation({
    mutationFn: (args: ProcessArgs) => triggerProcess(args),
    onMutate: ({ vehicleId }) => {
      setPendingIds((prev) => new Set(prev).add(vehicleId));
    },
    onSuccess: (_data, { vehicleId }) => {
      setPendingIds((prev) => { const s = new Set(prev); s.delete(vehicleId); return s; });
      void qc.invalidateQueries({ queryKey: ["photo-studio-jobs"] });
      void qc.invalidateQueries({ queryKey: ["photo-studio-stats"] });
      toast({ title: "Enhancement started", description: "Photos are being processed." });
    },
    onError: (err: Error, { vehicleId }) => {
      setPendingIds((prev) => { const s = new Set(prev); s.delete(vehicleId); return s; });
      toast({ title: "Failed to start enhancement", description: err.message, variant: "destructive" });
    },
  });

  const enqueueAllMutation = useMutation({
    mutationFn: () => enqueueAll(selectedLocation),
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

  const processedVehicles = allJobs ? dedupeByVehicle(allJobs.jobs) : [];
  const jobsByVehicleId = useMemo(() => {
    const map = new Map<number, PhotoJob>();
    for (const j of processedVehicles) map.set(j.vehicleId, j);
    return map;
  }, [processedVehicles]);

  const readyCount = processedVehicles.filter(
    (v) => v.vehicleAiStatus === "Ready" || (v.status === "Completed" && v.outputSetId !== null),
  ).length;
  const processingCount = processedVehicles.filter(
    (v) => v.status === "Processing" || v.status === "Queued",
  ).length;
  const failedCount = processedVehicles.filter(
    (v) => v.status === "Failed" || v.status === "Cancelled",
  ).length;
  const statsReadyCount = toCount(stats?.vehicles?.ready);
  const statsProcessingCount = toCount(stats?.vehicles?.processing);
  const statsFailedCount = toCount(stats?.vehicles?.failed);
  const displayReadyCount = statsReadyCount || readyCount;
  const displayProcessingCount = statsProcessingCount || processingCount;
  const displayFailedCount = statsFailedCount || failedCount;

  const kpis = [
    { label: "Enhanced", value: displayReadyCount, icon: Sparkles, color: "text-warning" },
    { label: "In Progress", value: displayProcessingCount, icon: Loader2, color: displayProcessingCount > 0 ? "text-primary" : "text-muted-foreground", spin: displayProcessingCount > 0 },
    { label: "Needs Attention", value: displayFailedCount, icon: Clock, color: displayFailedCount > 0 ? "text-destructive" : "text-muted-foreground" },
  ];

  if (openVehicleId !== null) {
    return (
      <PhotoSetViewer
        vehicleId={openVehicleId}
        onClose={() => setOpenVehicleId(null)}
        onReprocess={(id) => { reprocessMutation.mutate({ vehicleId: id, processingMode }); setOpenVehicleId(null); }}
      />
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">
        <PageHeader
          eyebrow="AI Photo Studio"
          module="photo-studio"
          title="AI Photo Studio"
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
        <div className="grid grid-cols-3 gap-3">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div key={kpi.label} className="bg-card border border-border rounded-xl p-4">
                <Icon className={cn("w-4 h-4 mb-2", kpi.color, (kpi as { spin?: boolean }).spin && "animate-spin")} />
                <div className={cn("text-2xl font-bold", kpi.color)}>{kpi.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{kpi.label}</div>
              </div>
            );
          })}
        </div>

        {stats?.providers?.enhancement && (
          <div className={cn(
            "flex items-center justify-between gap-4 rounded-xl border p-4",
            stats.providers.restoration?.enabled
              ? "border-success/20 bg-success/[0.04]"
              : "border-warning/20 bg-warning/[0.04]",
          )}>
            <div className="flex items-center gap-3 min-w-0">
              <Sparkles className={cn(
                "w-4 h-4 shrink-0",
                stats.providers.restoration?.enabled ? "text-success" : "text-warning",
              )} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground truncate">
                  Enhancement engine: {stats.providers.enhancement}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  Prompt {stats.providers.restoration?.promptVersion ?? "unknown"}
                </div>
              </div>
            </div>
            <div className={cn(
              "text-xs font-semibold  tracking-wide",
              stats.providers.restoration?.enabled ? "text-success" : "text-warning",
            )}>
              {stats.providers.restoration?.enabled ? "GPT Image Active" : "Fallback Active"}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/40 p-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">Processing mode</div>
            <div className="text-[11px] text-muted-foreground">
              Cost is confirmed before OpenAI restoration starts.
            </div>
          </div>
          <div className="flex rounded-lg border border-border bg-muted p-1">
            {([
              ["fidelity-first", "Fidelity First"],
              ["balanced", "Balanced"],
              ["strong-restoration", "Strong Restoration"],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setProcessingMode(mode)}
                className={cn(
                  "px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors",
                  processingMode === mode
                    ? "bg-primary/20 text-primary border border-primary/25"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Stale warning */}
        {(allJobs?.jobs ?? []).some((j) => j.status === "Failed") && (
          <div className="flex items-center gap-3 p-4 rounded-xl border border-warning/20 bg-warning/[0.04]">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
            <div className="flex-1 text-sm text-warning/80">
              Some vehicles failed to process. Use the inventory below to retry them.
            </div>
          </div>
        )}

        {/* Processing queue */}
        {!isLoading && processedVehicles.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">Processing Queue</p>
              <div className="flex-1 h-px bg-muted" />
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="text-warning/70">{readyCount} ready</span>
                {processingCount > 0 && <span className="text-primary/70">{processingCount} active</span>}
                {failedCount > 0 && <span className="text-destructive/50">{failedCount} failed</span>}
              </div>
            </div>
            {/* Queue header */}
            <div className="flex items-center gap-5 px-5 py-2 text-[11px] font-semibold  tracking-wide text-muted-foreground border border-border rounded-t-xl">
              <div className="w-[72px] shrink-0">Frame</div>
              <div className="flex-1 min-w-0">Vehicle</div>
              <div className="shrink-0 hidden md:block w-28">Status</div>
              <div className="shrink-0 w-24 text-right">Action</div>
            </div>
            <div className="border border-t-0 border-border bg-muted rounded-b-xl overflow-hidden">
              {processedVehicles.map((job) => (
                <VehicleCard
                  key={job.vehicleId}
                  job={job}
                  onOpenStudio={setOpenVehicleId}
                  onReprocess={(id) => reprocessMutation.mutate({ vehicleId: id, processingMode })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Always-visible inventory browser */}
        <InventoryBrowser
          jobsByVehicleId={jobsByVehicleId}
          onEnhance={(id) => reprocessMutation.mutate({ vehicleId: id, processingMode })}
          onOpenStudio={setOpenVehicleId}
          pendingVehicleIds={pendingIds}
        />
      </div>
    </AppLayout>
  );
}
