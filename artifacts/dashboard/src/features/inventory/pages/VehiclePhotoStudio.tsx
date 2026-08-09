import { useState, type SyntheticEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { SectionCard } from "@/shared/ui";
import { cn } from "@/lib/utils";
import {
  Wand2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Store,
  ArrowLeftRight,
  Tag,
  RefreshCw,
  Clock,
  Sparkles,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PhotoSetImage {
  id: number;
  originalUrl: string;
  processedUrl: string | null;
  backgroundRemovedUrl: string | null;
  compositedUrl: string | null;
  classification: string | null;
  isExterior: number | null;
  position: number;
  processingStatus: string;
  usedFallback: number;
  classificationConfidence: number | null;
  removalProvider: string | null;
  removalTimeMs: number | null;
}

export interface PhotoSetData {
  set: {
    id: number;
    status: string;
    totalPhotos: number;
    processedPhotos: number;
    processingTimeMs: number | null;
    studioVersion: string | null;
    version: number;
  } | null;
  images: PhotoSetImage[];
  summary: {
    total: number;
    exteriorCount: number;
    interiorCount: number;
    miscCount: number;
    fallbackCount: number;
    compositedCount: number;
  } | null;
  vehicle: {
    id: number;
    aiPhotoStatus: string | null;
  };
  isActiveForMarketplace: boolean;
  activeJob: {
    id: number;
    status: string;
    totalPhotos: number;
    processedPhotos: number;
    failedPhotos: number;
    currentStage: string | null;
    progressPercent: number;
  } | null;
}

type PhotoProcessingMode = "fidelity-first" | "balanced" | "strong-restoration";
type PhotoDirectorMode = "economy" | "balanced" | "premium";

interface PhotoDirectorPlan {
  sourceSetId: number | null;
  totalPhotosAnalyzed: number;
  selectedPhotoIds: number[];
  heroPhotoId: number | null;
  duplicateRejectedCount: number;
  publishAsIsCount: number;
  localEnhancementCount: number;
  paidAiRestorationCount: number;
  paidAiRestorationPhotoIds: number[];
  localEnhancementPhotoIds: number[];
  estimatedCostUsd: number;
  defaultCostCapUsd: number;
  photos: Array<{
    id: number;
    order: number | null;
    photoType: string;
    treatmentLabel: string;
    qualityScore: number;
  }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function aiOutputUrl(img: PhotoSetImage): string {
  if (img.processedUrl && img.processedUrl !== img.originalUrl) return img.processedUrl;
  if (img.compositedUrl && img.compositedUrl !== img.originalUrl) return img.compositedUrl;
  if (img.backgroundRemovedUrl && img.backgroundRemovedUrl !== img.originalUrl)
    return img.backgroundRemovedUrl;
  return img.originalUrl;
}

function fallBackToOriginal(event: SyntheticEvent<HTMLImageElement>, originalUrl: string): void {
  const image = event.currentTarget;
  if (image.dataset.fallbackApplied === "true") return;
  image.dataset.fallbackApplied = "true";
  image.src = originalUrl;
}

export const PHOTO_SET_QUERY_KEY = (vehicleId: number) => ["vehicle-photo-set", vehicleId] as const;

export async function fetchPhotoSet(vehicleId: number): Promise<PhotoSetData> {
  const r = await fetch(`/api/photo-studio/sets/${vehicleId}`);
  if (!r.ok) throw new Error("Failed to fetch photo set");
  return r.json() as Promise<PhotoSetData>;
}

async function fetchPhotoDirectorPlan(vehicleId: number, mode: PhotoDirectorMode): Promise<PhotoDirectorPlan> {
  const params = new URLSearchParams({ selectionMode: mode, maxPhotos: "10" });
  const r = await fetch(`/api/photo-studio/vehicles/${vehicleId}/selection-plan?${params.toString()}`);
  if (!r.ok) throw new Error("Failed to fetch Photo Director plan");
  const body = (await r.json()) as { plan: PhotoDirectorPlan };
  return body.plan;
}

// ── VehiclePhotoStudio panel ───────────────────────────────────────────────────

export function VehiclePhotoStudio({
  vehicleId,
  photoMode,
  onPhotoModeChange,
}: {
  vehicleId: number;
  photoMode: "original" | "ai";
  onPhotoModeChange: (mode: "original" | "ai") => void;
}) {
  const [showBeforeAfter, setShowBeforeAfter] = useState(false);
  const [processingMode, setProcessingMode] = useState<PhotoProcessingMode>("fidelity-first");
  const [photoDirectorMode, setPhotoDirectorMode] = useState<PhotoDirectorMode>("balanced");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<PhotoSetData>({
    queryKey: PHOTO_SET_QUERY_KEY(vehicleId),
    queryFn: () => fetchPhotoSet(vehicleId),
    refetchInterval: (query) => {
      const activeJob = query.state.data?.activeJob;
      if (activeJob?.status === "Queued" || activeJob?.status === "Processing") return 3000;
      const status = query.state.data?.set?.status;
      const aiStatus = query.state.data?.vehicle?.aiPhotoStatus;
      if (status === "Processing") return 3000;
      if (!status && (aiStatus === "Processing" || aiStatus === "Queued")) return 3000;
      return false;
    },
  });

  const { data: directorPlan } = useQuery<PhotoDirectorPlan>({
    queryKey: ["vehicle-photo-director-plan", vehicleId, photoDirectorMode],
    queryFn: () => fetchPhotoDirectorPlan(vehicleId, photoDirectorMode),
    staleTime: 30_000,
  });

  const processMutation = useMutation({
    mutationFn: async () => {
      const start = (confirmCost = false) =>
        fetch(`/api/photo-studio/vehicles/${vehicleId}/process`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            processingMode,
            confirmCost,
            selectionMode: photoDirectorMode,
            sourceSetId: directorPlan?.sourceSetId ?? undefined,
            selectedPhotoIds: directorPlan?.selectedPhotoIds ?? undefined,
            paidAiRestorationPhotoIds: directorPlan?.paidAiRestorationPhotoIds ?? undefined,
            localEnhancementPhotoIds: directorPlan?.localEnhancementPhotoIds ?? undefined,
            maxCostUsd: directorPlan?.defaultCostCapUsd ?? undefined,
          }),
        });
      const r = await start();
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
            const confirmed = await start(true);
            if (!confirmed.ok) throw new Error("Failed to trigger processing");
            return confirmed.json();
          }
          throw new Error("Enhancement cancelled before OpenAI spend.");
        }
        throw new Error(body.error ?? "Failed to trigger processing");
      }
      if (!r.ok) throw new Error("Failed to trigger processing");
      return r.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PHOTO_SET_QUERY_KEY(vehicleId) });
      void queryClient.invalidateQueries({ queryKey: ["vehicle-photo-director-plan", vehicleId] });
    },
  });

  const set = data?.set;
  const activeJob = data?.activeJob;
  const hasActiveJob = activeJob?.status === "Queued" || activeJob?.status === "Processing";
  const aiStatus = data?.vehicle?.aiPhotoStatus;
  const summary = data?.summary;
  const exteriorImages = (data?.images ?? []).filter((i) => i.isExterior === 1);

  const isReady = set?.status === "Ready";
  const isNeedsReview = set?.status === "Needs Review";
  const isFailed = set?.status === "Failed";
  const isProcessing = set?.status === "Processing" || aiStatus === "Processing" || activeJob?.status === "Processing";
  const isQueued =
    activeJob?.status === "Queued" || (!set && (aiStatus === "Queued" || processMutation.isPending));
  const isNotProcessed =
    !set && !isProcessing && !isQueued && !processMutation.isPending;
  const progressTotal = activeJob?.totalPhotos || set?.totalPhotos || summary?.total || 0;
  const progressDone = activeJob?.processedPhotos ?? set?.processedPhotos ?? 0;
  const progressPercent = activeJob?.progressPercent ??
    (progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0);
  const modeSelector = (
    <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted p-1">
      {([
        ["fidelity-first", "Fidelity"],
        ["balanced", "Balanced"],
        ["strong-restoration", "Strong"],
      ] as const).map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          onClick={() => setProcessingMode(mode)}
          className={cn(
            "py-1.5 text-xs font-semibold rounded-md transition-colors",
            processingMode === mode
              ? "bg-primary/20 text-primary border border-primary/25"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
  const directorModeSelector = (
    <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted p-1">
      {([
        ["economy", "Economy"],
        ["balanced", "Balanced"],
        ["premium", "Premium"],
      ] as const).map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          onClick={() => setPhotoDirectorMode(mode)}
          className={cn(
            "py-1.5 text-xs font-semibold rounded-md transition-colors",
            photoDirectorMode === mode
              ? "bg-success/15 text-success border border-success/20"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
  const directorSummary = directorPlan ? (
    <div className="rounded-lg border border-success/15 bg-success/[0.04] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-success">Photo Director</span>
        <span className="text-xs text-muted-foreground">
          ${directorPlan.estimatedCostUsd.toFixed(2)} est.
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span>{directorPlan.totalPhotosAnalyzed} analyzed</span>
        <span>{directorPlan.selectedPhotoIds.length} selected</span>
        <span>{directorPlan.publishAsIsCount} as-is</span>
        <span>{directorPlan.localEnhancementCount} local</span>
        <span>{directorPlan.paidAiRestorationCount} paid AI</span>
        <span>{directorPlan.duplicateRejectedCount} duplicates</span>
      </div>
      {directorPlan.heroPhotoId && (
        <div className="text-xs text-success/80">
          Recommended Cover Photo #{directorPlan.heroPhotoId}
        </div>
      )}
    </div>
  ) : null;

  return (
    <SectionCard
      title="AI Photo Studio"
      icon={<Sparkles className="w-4 h-4 text-primary" />}
    >
      <div className="space-y-4">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* ── Not processed ── */}
        {!isLoading && isNotProcessed && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Generate professional studio photos for this vehicle using the Alpha Motorsport
              background.
            </p>
            {directorModeSelector}
            {directorSummary}
            {modeSelector}
            <Button
              className="w-full gap-2 premium-gradient-btn"
              onClick={() => processMutation.mutate()}
              disabled={processMutation.isPending}
            >
              <Wand2 className="w-4 h-4" /> Generate AI Photos
            </Button>
          </div>
        )}

        {/* ── Queued / Processing ── */}
        {!isLoading && (isQueued || isProcessing) && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-primary font-medium">
                {isQueued ? "Queued for AI processing…" : "Generating AI photos…"}
              </span>
            </div>
            {(set || activeJob) && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{activeJob?.currentStage ?? "Progress"}</span>
                  <span>
                    {progressDone} / {progressTotal} photos
                  </span>
                </div>
                <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition duration-500"
                    style={{
                      width: `${progressPercent}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Ready or Needs Review ── */}
        {!isLoading && !hasActiveJob && (isReady || isNeedsReview) && (
          <div className="space-y-4">
            {/* Status */}
            <div className="flex items-center justify-between">
              <div
                className={cn(
                  "flex items-center gap-1.5 text-sm font-medium",
                  isReady ? "text-success" : "text-warning",
                )}
              >
                {isReady ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" /> AI Photos Ready
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4" /> Needs Review
                  </>
                )}
              </div>
              {summary && (
                <span className="text-[11px] text-muted-foreground">
                  {summary.exteriorCount} exterior · {summary.interiorCount} interior
                </span>
              )}
            </div>

            {/* Original / AI Enhanced toggle */}
            <div className="flex p-1 bg-muted border border-border rounded-lg">
              <button
                onClick={() => onPhotoModeChange("original")}
                className={cn(
                  "flex-1 py-1.5 text-[11px] font-semibold rounded-md transition",
                  photoMode === "original"
                    ? "bg-muted text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Original
              </button>
              <button
                onClick={() => onPhotoModeChange("ai")}
                className={cn(
                  "flex-1 py-1.5 text-[11px] font-semibold rounded-md transition flex items-center justify-center gap-1",
                  photoMode === "ai"
                    ? "bg-primary/20 text-primary shadow-sm border border-primary/20"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Sparkles className="w-3 h-3" /> AI Enhanced
              </button>
            </div>

            {/* Marketplace badge */}
            <div
              className={cn(
                "flex items-center gap-2 p-3 rounded-lg border text-xs font-medium",
                data?.isActiveForMarketplace
                  ? "bg-success/[0.06] border-success/20 text-success"
                  : "bg-muted border-border text-muted-foreground",
              )}
            >
              <Store className="w-3.5 h-3.5 flex-shrink-0" />
              {data?.isActiveForMarketplace ? (
                <>Using AI Photos for Marketplace ✓</>
              ) : (
                <>Using Original Photos — AI not yet active</>
              )}
            </div>

            {/* Before / After comparison */}
            {exteriorImages.length > 0 && (
              <div>
                <button
                  onClick={() => setShowBeforeAfter((v) => !v)}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full mb-2"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span className="font-medium">Before / After</span>
                  <span className="ml-auto text-xs opacity-50">
                    {showBeforeAfter ? "▲ hide" : "▼ show"}
                  </span>
                </button>

                {showBeforeAfter && (
                  <div className="space-y-2.5 max-h-96 overflow-y-auto pr-0.5">
                    {exteriorImages.slice(0, 4).map((img) => (
                      <div
                        key={img.id}
                        className="rounded-lg border border-border bg-card/40 p-2.5 space-y-2"
                      >
                        <div className="flex items-center gap-1.5 flex-wrap min-h-[16px]">
                          {img.classification && (
                            <span className="text-xs text-muted-foreground/60 flex items-center gap-0.5">
                              <Tag className="w-2.5 h-2.5" />
                              {img.classification}
                            </span>
                          )}
                          {img.removalTimeMs != null && (
                            <span className="text-[11px] text-muted-foreground/30 ml-auto flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {(img.removalTimeMs / 1000).toFixed(1)}s
                            </span>
                          )}
                          {img.usedFallback === 1 && (
                            <span className="text-[11px] px-1 py-0 rounded bg-warning/15 text-warning border border-warning/20">
                              Fallback
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <div className="aspect-[4/3] rounded-md overflow-hidden bg-muted border border-border">
                              <img
                                src={img.originalUrl}
                                alt="Original"
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </div>
                            <p className="text-[11px] text-muted-foreground/40 text-center mt-0.5">
                              Original
                            </p>
                          </div>
                          <div>
                            <div
                              className={cn(
                                "aspect-[4/3] rounded-md overflow-hidden border",
                                img.usedFallback === 1
                                  ? "border-warning/30"
                                  : "border-primary/20 bg-primary/[0.03]",
                              )}
                            >
                              <img
                                src={aiOutputUrl(img)}
                                alt="AI Enhanced"
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={(event) => fallBackToOriginal(event, img.originalUrl)}
                              />
                            </div>
                            <p className="text-[11px] text-muted-foreground/40 text-center mt-0.5">
                              AI Enhanced
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {exteriorImages.length > 4 && (
                      <p className="text-xs text-muted-foreground/40 text-center py-1">
                        +{exteriorImages.length - 4} more exterior shots
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Re-process */}
            {directorModeSelector}
            {directorSummary}
            {modeSelector}
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-1.5 text-[11px] text-muted-foreground hover:text-foreground border border-border hover:border-border"
              onClick={() => processMutation.mutate()}
              disabled={processMutation.isPending}
            >
              <RefreshCw className={cn("w-3 h-3", processMutation.isPending && "animate-spin")} />
              {processMutation.isPending ? "Queuing…" : "Re-process"}
            </Button>
          </div>
        )}

        {/* ── Failed ── */}
        {!isLoading && isFailed && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4" />
              Processing failed
            </div>
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => processMutation.mutate()}
              disabled={processMutation.isPending}
            >
              <RefreshCw className="w-4 h-4" /> Retry
            </Button>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
