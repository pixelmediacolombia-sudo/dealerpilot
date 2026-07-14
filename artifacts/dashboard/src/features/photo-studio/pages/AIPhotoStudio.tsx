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
  Ready:      { label: "AI Enhanced",  color: "text-green-400 bg-green-400/10 border-green-400/20" },
  Processing: { label: "Processing",   color: "text-blue-400 bg-blue-400/10 border-blue-400/20" },
  Queued:     { label: "In Queue",     color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" },
  Failed:     { label: "Needs Attention",  color: "text-red-400 bg-red-400/10 border-red-400/20" },
  Pending:    { label: "Ready to Enhance",  color: "text-white/30 bg-white/[0.04] border-white/[0.08]" },
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
      "flex items-center gap-5 px-5 py-3.5 border-b border-white/[0.04] last:border-0 transition-colors hover:bg-white/[0.015]",
      isFailed && "border-l-2 border-l-red-500/30",
      isProcessing && "border-l-2 border-l-blue-500/30",
      isDone && aiStatus === "Ready" && "border-l-2 border-l-amber-500/25",
    )}>
      {/* Thumbnail */}
      <div className="w-[72px] h-[52px] shrink-0 rounded-lg overflow-hidden bg-white/[0.03] border border-white/[0.05] relative">
        {job.vehicleThumbnailUrl ? (
          <img src={job.vehicleThumbnailUrl} alt={name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-4 h-4 text-white/10" />
          </div>
        )}
        {isProcessing && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
          </div>
        )}
      </div>

      {/* Vehicle info */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-white/75 truncate">{name}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[10px] text-white/30 font-mono">{job.totalPhotos} orig</span>
          {enhancedCount > 0 && (
            <span className="text-[10px] text-amber-400/70 font-mono">{enhancedCount} enhanced</span>
          )}
          {/* Improvement quality indicator — only shown for completed jobs with delta data */}
          {isDone && job.noImprovementCount > 0 && (
            <span className="text-[9px] font-black uppercase tracking-[0.18em] text-orange-400/70 border border-orange-500/20 rounded px-1.5 py-0.5">
              {job.noImprovementCount} no change
            </span>
          )}
          {isDone && job.noImprovementCount === 0 && job.lowImprovementCount > 0 && (
            <span className="text-[9px] font-black uppercase tracking-[0.18em] text-yellow-400/50 border border-yellow-500/15 rounded px-1.5 py-0.5">
              {job.lowImprovementCount} low
            </span>
          )}
          {job.completedAt && (
            <span className="text-[10px] text-white/18 font-mono">{timeAgo(job.completedAt)}</span>
          )}
        </div>
        {/* Progress bar — amber = enhanced, orange = low/no improvement */}
        {job.totalPhotos > 0 && (
          <div className="mt-1.5 h-[2px] w-32 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                isDone && job.noImprovementCount > job.totalPhotos * 0.5 ? "bg-orange-400" :
                isDone ? "bg-amber-400" :
                isProcessing ? "bg-blue-400" : "bg-white/10",
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
          <Button variant="ghost" size="sm" className="h-7 text-[11px] px-3 text-red-400/70 hover:text-red-400"
            onClick={() => onReprocess(job.vehicleId)}>
            <RotateCcw className="w-3 h-3 mr-1" />Retry
          </Button>
        ) : isProcessing ? (
          <span className="text-[11px] text-blue-400/60 font-mono">
            {job.status === "Queued" ? "In queue…" : "Processing…"}
          </span>
        ) : (
          <Button variant="ghost" size="sm" className="h-7 text-[11px] px-3 text-white/30 hover:text-amber-400"
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
    <div className="border border-white/[0.06] rounded-2xl overflow-hidden">
      {/* Section header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <Search className="w-4 h-4 text-white/40" />
          <span className="text-sm font-semibold text-white/80">Select a Vehicle to Enhance</span>
          {data && (
            <span className="text-xs text-white/30">{data.vehicles.length} vehicles in inventory</span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-white/30" />
        ) : (
          <ChevronDown className="w-4 h-4 text-white/30" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06]">
          {/* Search bar */}
          <div className="px-5 py-3 border-b border-white/[0.04]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
              <input
                type="text"
                placeholder="Search by year, make, model, VIN…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/40 focus:bg-white/[0.06] transition-colors"
              />
            </div>
          </div>

          {/* Vehicle list */}
          <div className="max-h-[420px] overflow-y-auto divide-y divide-white/[0.04]">
            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-white/30" />
              </div>
            )}

            {!isLoading && filtered.length === 0 && (
              <div className="py-8 text-center text-sm text-white/30">No vehicles found</div>
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
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.02] transition-colors"
                >
                  {/* Thumbnail */}
                  <div className="w-14 h-10 rounded-lg overflow-hidden bg-white/[0.04] border border-white/[0.06] shrink-0">
                    {vehicle.primaryImageUrl ? (
                      <img
                        src={vehicle.primaryImageUrl}
                        alt={name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="w-4 h-4 text-white/15" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-white/30">{vehicle.imageCount} photo{vehicle.imageCount !== 1 ? "s" : ""}</span>
                    </div>
                  </div>

                  {/* Status + action */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isEnhanced ? (
                      <>
                        <span className="text-[11px] text-green-400 font-medium">✓ Enhanced</span>
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
                      <span className="flex items-center gap-1.5 text-[11px] text-blue-400">
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
    mutationFn: triggerProcess,
    onMutate: (vehicleId) => {
      setPendingIds((prev) => new Set(prev).add(vehicleId));
    },
    onSuccess: (_data, vehicleId) => {
      setPendingIds((prev) => { const s = new Set(prev); s.delete(vehicleId); return s; });
      void qc.invalidateQueries({ queryKey: ["photo-studio-jobs"] });
      void qc.invalidateQueries({ queryKey: ["photo-studio-stats"] });
      toast({ title: "Enhancement started", description: "Photos are being processed." });
    },
    onError: (err: Error, vehicleId) => {
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
    { label: "Enhanced", value: displayReadyCount, icon: Sparkles, color: "text-amber-400" },
    { label: "In Progress", value: displayProcessingCount, icon: Loader2, color: displayProcessingCount > 0 ? "text-blue-400" : "text-white/30", spin: displayProcessingCount > 0 },
    { label: "Needs Attention", value: displayFailedCount, icon: Clock, color: displayFailedCount > 0 ? "text-red-400" : "text-white/30" },
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
              <div key={kpi.label} className="bg-card border border-white/[0.06] rounded-xl p-4">
                <Icon className={cn("w-4 h-4 mb-2", kpi.color, (kpi as { spin?: boolean }).spin && "animate-spin")} />
                <div className={cn("text-2xl font-bold", kpi.color)}>{kpi.value}</div>
                <div className="text-xs text-white/40 mt-0.5">{kpi.label}</div>
              </div>
            );
          })}
        </div>

        {/* Stale warning */}
        {(allJobs?.jobs ?? []).some((j) => j.status === "Failed") && (
          <div className="flex items-center gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.04]">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="flex-1 text-sm text-amber-300/80">
              Some vehicles failed to process. Use the inventory below to retry them.
            </div>
          </div>
        )}

        {/* Processing queue */}
        {!isLoading && processedVehicles.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <p className="text-[9px] font-black text-white/18 uppercase tracking-[0.22em]">Processing Queue</p>
              <div className="flex-1 h-px bg-white/[0.04]" />
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <span className="text-amber-400/70">{readyCount} ready</span>
                {processingCount > 0 && <span className="text-blue-400/70">{processingCount} active</span>}
                {failedCount > 0 && <span className="text-red-400/50">{failedCount} failed</span>}
              </div>
            </div>
            {/* Queue header */}
            <div className="flex items-center gap-5 px-5 py-2 text-[9px] font-black uppercase tracking-[0.18em] text-white/18 border border-white/[0.05] rounded-t-xl">
              <div className="w-[72px] shrink-0">Frame</div>
              <div className="flex-1 min-w-0">Vehicle</div>
              <div className="shrink-0 hidden md:block w-28">Status</div>
              <div className="shrink-0 w-24 text-right">Action</div>
            </div>
            <div className="border border-t-0 border-white/[0.05] bg-white/[0.005] rounded-b-xl overflow-hidden">
              {processedVehicles.map((job) => (
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

        {/* Always-visible inventory browser */}
        <InventoryBrowser
          jobsByVehicleId={jobsByVehicleId}
          onEnhance={(id) => reprocessMutation.mutate(id)}
          onOpenStudio={setOpenVehicleId}
          pendingVehicleIds={pendingIds}
        />
      </div>
    </AppLayout>
  );
}
