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

// ── API calls ─────────────────────────────────────────────────────────────────

async function fetchJobs(): Promise<{ jobs: PhotoJob[] }> {
  const r = await fetch(`${API_BASE}/photo-studio/jobs?limit=200`);
  if (!r.ok) throw new Error("Failed to fetch jobs");
  return r.json() as Promise<{ jobs: PhotoJob[] }>;
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

// ── Processed Vehicle Card ────────────────────────────────────────────────────

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
  const isProcessing = job.status === "Processing";
  const isDone = job.status === "Completed";
  const isFailed = job.status === "Failed" || job.status === "Cancelled";
  const aiStatus = job.vehicleAiStatus ?? (isDone ? "Ready" : isProcessing ? "Processing" : isFailed ? "Failed" : "Pending");
  const isMarketplaceReady = aiStatus === "Ready";
  const enhancedCount = isDone ? job.processedPhotos : 0;

  return (
    <div className="group relative bg-card border border-white/[0.06] rounded-2xl overflow-hidden hover:border-white/[0.12] transition-all duration-200">
      <div className="relative aspect-[16/9] bg-white/[0.03] overflow-hidden">
        {job.vehicleThumbnailUrl ? (
          <img src={job.vehicleThumbnailUrl} alt={name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-white/10" />
          </div>
        )}
        {isMarketplaceReady && (
          <div className="absolute top-3 left-3">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-green-500/90 text-black backdrop-blur-sm">
              <Store className="w-3 h-3" />Marketplace Ready
            </span>
          </div>
        )}
        {isProcessing && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <span className="text-xs text-white/80 font-medium">Enhancing photos…</span>
            </div>
          </div>
        )}
      </div>
      <div className="p-4 space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-white text-sm leading-tight">{name}</h3>
            <AiStatusBadge status={aiStatus} />
          </div>
          {job.vehicleTrim && (
            <div className="text-[11px] text-white/40">{job.vehicleTrim}</div>
          )}
        </div>
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
                ? `${Math.round((enhancedCount / job.totalPhotos) * 100)}%` : "—"}
            </div>
            <div className="text-[10px] text-white/40 mt-0.5">Complete</div>
          </div>
        </div>
        {job.completedAt && (
          <div className="flex items-center gap-1.5 text-[11px] text-white/30">
            <Clock className="w-3 h-3" />Processed {timeAgo(job.completedAt)}
          </div>
        )}
        <div className="flex items-center gap-2 pt-0.5">
          {isDone && job.outputSetId !== null ? (
            <Button size="sm" className="flex-1 h-8 text-xs premium-gradient-btn"
              onClick={() => onOpenStudio(job.vehicleId)}>
              <Sparkles className="w-3 h-3 mr-1.5" />Open Studio
            </Button>
          ) : isFailed ? (
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs"
              onClick={() => onReprocess(job.vehicleId)}>
              <RotateCcw className="w-3 h-3 mr-1.5" />Retry
            </Button>
          ) : isProcessing ? (
            <div className="flex-1 h-8 flex items-center justify-center">
              <span className="text-xs text-blue-400/70">Processing…</span>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs"
              onClick={() => onReprocess(job.vehicleId)}>
              <Sparkles className="w-3 h-3 mr-1.5" />Enhance Photos
            </Button>
          )}
        </div>
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

  const reprocessMutation = useMutation({
    mutationFn: triggerProcess,
    onMutate: (vehicleId) => {
      setPendingIds((prev) => new Set(prev).add(vehicleId));
    },
    onSuccess: (_data, vehicleId) => {
      setPendingIds((prev) => { const s = new Set(prev); s.delete(vehicleId); return s; });
      void qc.invalidateQueries({ queryKey: ["photo-studio-jobs"] });
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

  const kpis = [
    { label: "Processed", value: processedVehicles.length, icon: Camera, color: "text-white" },
    { label: "AI Enhanced", value: readyCount, icon: Sparkles, color: "text-green-400" },
    { label: "In Progress", value: processingCount, icon: Loader2, color: "text-blue-400", spin: processingCount > 0 },
    { label: "Needs Attention", value: failedCount, icon: Clock, color: failedCount > 0 ? "text-red-400" : "text-white/40" },
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
        {(allJobs?.jobs ?? []).some((j) => j.status === "Failed") && (
          <div className="flex items-center gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.04]">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="flex-1 text-sm text-amber-300/80">
              Some vehicles failed to process. Use the inventory below to retry them.
            </div>
          </div>
        )}

        {/* Processed vehicles grid (only shown if any exist) */}
        {!isLoading && processedVehicles.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white/70">
                {processedVehicles.length} processed vehicle{processedVehicles.length !== 1 ? "s" : ""}
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
