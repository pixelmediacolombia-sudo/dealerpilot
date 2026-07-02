import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared";
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
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function aiOutputUrl(img: PhotoSetImage): string {
  if (img.compositedUrl && img.compositedUrl !== img.originalUrl) return img.compositedUrl;
  if (img.processedUrl && img.processedUrl !== img.originalUrl) return img.processedUrl;
  if (img.backgroundRemovedUrl && img.backgroundRemovedUrl !== img.originalUrl)
    return img.backgroundRemovedUrl;
  return img.originalUrl;
}

export const PHOTO_SET_QUERY_KEY = (vehicleId: number) => ["vehicle-photo-set", vehicleId] as const;

export async function fetchPhotoSet(vehicleId: number): Promise<PhotoSetData> {
  const r = await fetch(`/api/photo-studio/sets/${vehicleId}`);
  if (!r.ok) throw new Error("Failed to fetch photo set");
  return r.json() as Promise<PhotoSetData>;
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
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<PhotoSetData>({
    queryKey: PHOTO_SET_QUERY_KEY(vehicleId),
    queryFn: () => fetchPhotoSet(vehicleId),
    refetchInterval: (query) => {
      const status = query.state.data?.set?.status;
      const aiStatus = query.state.data?.vehicle?.aiPhotoStatus;
      if (status === "Processing") return 3000;
      if (!status && (aiStatus === "Processing" || aiStatus === "Queued")) return 3000;
      return false;
    },
  });

  const processMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/photo-studio/vehicles/${vehicleId}/process`, { method: "POST" });
      if (!r.ok) throw new Error("Failed to trigger processing");
      return r.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PHOTO_SET_QUERY_KEY(vehicleId) });
    },
  });

  const set = data?.set;
  const aiStatus = data?.vehicle?.aiPhotoStatus;
  const summary = data?.summary;
  const exteriorImages = (data?.images ?? []).filter((i) => i.isExterior === 1);

  const isReady = set?.status === "Ready";
  const isNeedsReview = set?.status === "Needs Review";
  const isFailed = set?.status === "Failed";
  const isProcessing = set?.status === "Processing" || aiStatus === "Processing";
  const isQueued =
    !set && (aiStatus === "Queued" || processMutation.isPending);
  const isNotProcessed =
    !set && !isProcessing && !isQueued && !processMutation.isPending;

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
            {set && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Progress</span>
                  <span>
                    {set.processedPhotos} / {set.totalPhotos} photos
                  </span>
                </div>
                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{
                      width: `${set.totalPhotos > 0 ? Math.round((set.processedPhotos / set.totalPhotos) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Ready or Needs Review ── */}
        {!isLoading && (isReady || isNeedsReview) && (
          <div className="space-y-4">
            {/* Status */}
            <div className="flex items-center justify-between">
              <div
                className={cn(
                  "flex items-center gap-1.5 text-sm font-medium",
                  isReady ? "text-green-400" : "text-amber-400",
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
                  {summary.exteriorCount} ext · {summary.interiorCount} int
                  {summary.fallbackCount > 0 && (
                    <span className="text-amber-400"> · {summary.fallbackCount} fallback</span>
                  )}
                </span>
              )}
            </div>

            {/* Original / AI Enhanced toggle */}
            <div className="flex p-1 bg-white/[0.04] border border-white/[0.08] rounded-lg">
              <button
                onClick={() => onPhotoModeChange("original")}
                className={cn(
                  "flex-1 py-1.5 text-[11px] font-semibold rounded-md transition-all",
                  photoMode === "original"
                    ? "bg-white/10 text-white shadow-sm"
                    : "text-muted-foreground hover:text-white/70",
                )}
              >
                Original
              </button>
              <button
                onClick={() => onPhotoModeChange("ai")}
                className={cn(
                  "flex-1 py-1.5 text-[11px] font-semibold rounded-md transition-all flex items-center justify-center gap-1",
                  photoMode === "ai"
                    ? "bg-primary/20 text-primary shadow-sm border border-primary/20"
                    : "text-muted-foreground hover:text-white/70",
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
                  ? "bg-green-500/[0.06] border-green-500/20 text-green-400"
                  : "bg-white/[0.03] border-white/[0.06] text-muted-foreground",
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
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-white transition-colors w-full mb-2"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span className="font-medium">Before / After</span>
                  <span className="ml-auto text-[10px] opacity-50">
                    {showBeforeAfter ? "▲ hide" : "▼ show"}
                  </span>
                </button>

                {showBeforeAfter && (
                  <div className="space-y-2.5 max-h-96 overflow-y-auto pr-0.5">
                    {exteriorImages.slice(0, 4).map((img) => (
                      <div
                        key={img.id}
                        className="rounded-lg border border-white/[0.06] bg-card/40 p-2.5 space-y-2"
                      >
                        <div className="flex items-center gap-1.5 flex-wrap min-h-[16px]">
                          {img.classification && (
                            <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
                              <Tag className="w-2.5 h-2.5" />
                              {img.classification}
                            </span>
                          )}
                          {img.removalTimeMs != null && (
                            <span className="text-[9px] text-muted-foreground/30 ml-auto flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {(img.removalTimeMs / 1000).toFixed(1)}s
                            </span>
                          )}
                          {img.usedFallback === 1 && (
                            <span className="text-[9px] px-1 py-0 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
                              Fallback
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <div className="aspect-[4/3] rounded-md overflow-hidden bg-white/[0.03] border border-white/[0.06]">
                              <img
                                src={img.originalUrl}
                                alt="Original"
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </div>
                            <p className="text-[9px] text-muted-foreground/40 text-center mt-0.5">
                              Original
                            </p>
                          </div>
                          <div>
                            <div
                              className={cn(
                                "aspect-[4/3] rounded-md overflow-hidden border",
                                img.usedFallback === 1
                                  ? "border-amber-500/30"
                                  : "border-primary/20 bg-primary/[0.03]",
                              )}
                            >
                              <img
                                src={aiOutputUrl(img)}
                                alt="AI Enhanced"
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </div>
                            <p className="text-[9px] text-muted-foreground/40 text-center mt-0.5">
                              AI Enhanced
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {exteriorImages.length > 4 && (
                      <p className="text-[10px] text-muted-foreground/40 text-center py-1">
                        +{exteriorImages.length - 4} more exterior shots
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Re-process */}
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-1.5 text-[11px] text-muted-foreground hover:text-white border border-white/[0.06] hover:border-white/[0.12]"
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
