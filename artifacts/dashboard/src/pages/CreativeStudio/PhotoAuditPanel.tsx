import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Car,
  ImageIcon,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Wand2,
  Loader2,
  Store,
} from "lucide-react";
import { Link } from "wouter";

type Image = { url: string; position: number; category?: string | null };

type PhotoSetData = {
  set: {
    id: number;
    status: string;
    totalPhotos: number;
    processedPhotos: number;
  } | null;
  summary: {
    exteriorCount: number;
    interiorCount: number;
    fallbackCount: number;
    compositedCount: number;
  } | null;
  vehicle: { aiPhotoStatus: string | null };
  isActiveForMarketplace: boolean;
};

type Props = {
  images: Image[];
  vehicleId: number;
  vehicleName: string;
};

export function PhotoAuditPanel({ images, vehicleId, vehicleName }: Props) {
  const [showAll, setShowAll] = useState(false);

  const sorted = [...images].sort((a, b) => a.position - b.position);
  const visible = showAll ? sorted : sorted.slice(0, 12);

  const { data: psData, isLoading } = useQuery<PhotoSetData>({
    queryKey: ["vehicle-photo-set", vehicleId],
    queryFn: async () => {
      const r = await fetch(`/api/photo-studio/sets/${vehicleId}`);
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<PhotoSetData>;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.set?.status;
      const aiStatus = query.state.data?.vehicle?.aiPhotoStatus;
      if (status === "Processing") return 3000;
      if (!status && (aiStatus === "Processing" || aiStatus === "Queued")) return 3000;
      return false;
    },
  });

  const set = psData?.set;
  const aiStatus = psData?.vehicle?.aiPhotoStatus;
  const summary = psData?.summary;
  const isReady = set?.status === "Ready";
  const isNeedsReview = set?.status === "Needs Review";
  const isFailed = set?.status === "Failed";
  const isProcessing = set?.status === "Processing" || aiStatus === "Processing";
  const isQueued = !set && aiStatus === "Queued";

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ── AI Photo Studio status banner ─────────────────────────────────── */}
      <div className={cn(
        "flex items-start gap-3 p-4 rounded-xl border",
        isReady
          ? "border-green-500/20 bg-green-500/[0.04]"
          : isNeedsReview
            ? "border-amber-500/20 bg-amber-500/[0.04]"
            : isFailed
              ? "border-destructive/20 bg-destructive/[0.04]"
              : "border-border/40 bg-muted/20",
      )}>
        <div className="mt-0.5 flex-shrink-0">
          {isLoading && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
          {!isLoading && isReady && <CheckCircle2 className="w-4 h-4 text-green-400" />}
          {!isLoading && isNeedsReview && <AlertTriangle className="w-4 h-4 text-amber-400" />}
          {!isLoading && isFailed && <AlertTriangle className="w-4 h-4 text-destructive" />}
          {!isLoading && (isProcessing || isQueued) && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
          {!isLoading && !set && !isProcessing && !isQueued && <Wand2 className="w-4 h-4 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-foreground/80 uppercase tracking-widest">
            AI Photo Studio
          </p>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
            {isLoading
              ? "Checking AI photo status…"
              : isReady
                ? `AI Photos Ready — ${summary?.compositedCount ?? 0} exterior shots composited.`
                : isNeedsReview
                  ? "Processed with warnings — some shots may need manual review."
                  : isFailed
                    ? "Processing failed. Retry from the vehicle detail page."
                    : isProcessing
                      ? `Generating AI photos… ${set ? `${set.processedPhotos} / ${set.totalPhotos}` : ""}`
                      : isQueued
                        ? "Queued for AI processing…"
                        : "AI photos not yet generated for this vehicle."
            }
          </p>
          {(isReady || isNeedsReview) && (
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {summary && (
                <span className="text-[10px] text-muted-foreground">
                  {summary.exteriorCount} exterior · {summary.interiorCount} interior
                </span>
              )}
              <div className={cn(
                "flex items-center gap-1 text-[10px] font-medium",
                psData?.isActiveForMarketplace ? "text-green-400" : "text-muted-foreground",
              )}>
                <Store className="w-3 h-3" />
                {psData?.isActiveForMarketplace ? "AI photos active in Marketplace" : "Original photos in Marketplace"}
              </div>
            </div>
          )}
          <Link
            href={`/inventory/${vehicleId}`}
            className="inline-block mt-2 text-[10px] font-semibold text-primary hover:underline"
          >
            {isReady ? "View Before / After →" : "Open Vehicle Detail →"}
          </Link>
        </div>
      </div>

      {/* ── Count + vehicle label ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5" />
          {images.length} photo{images.length !== 1 ? "s" : ""}
        </span>
        <span className="text-border/60">·</span>
        <span className="truncate">{vehicleName}</span>
        {images.length > 0 && (
          <Badge className="ml-auto flex-shrink-0 bg-muted/50 text-muted-foreground border-border/40 text-[9px] uppercase tracking-widest">
            Cover: Photo #1
          </Badge>
        )}
      </div>

      {/* ── Photo grid ───────────────────────────────────────────────────── */}
      {images.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Car className="w-12 h-12 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">No photos available for this vehicle.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {visible.map((img) => (
              <div
                key={img.position}
                className={cn(
                  "rounded-lg overflow-hidden border bg-card/50",
                  img.position === 0
                    ? "border-amber-400/30 ring-1 ring-amber-400/20"
                    : "border-border/40",
                )}
              >
                <div className="aspect-[4/3] bg-secondary/40 relative overflow-hidden">
                  {img.url ? (
                    <img
                      src={img.url}
                      alt={`Photo ${img.position + 1}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Car className="w-5 h-5 text-muted-foreground/20" />
                    </div>
                  )}
                  {img.position === 0 && (
                    <div className="absolute top-1.5 left-1.5">
                      <span className="bg-amber-400/90 text-black text-[7px] font-black px-1.5 py-0.5 rounded uppercase">
                        Cover
                      </span>
                    </div>
                  )}
                </div>
                <div className="px-2 py-1.5 space-y-0.5">
                  <div className="text-[9px] font-bold text-foreground/70">#{img.position + 1}</div>
                  {img.category && (
                    <div className="text-[8px] text-muted-foreground/60 truncate capitalize">
                      {img.category}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {images.length > 12 && (
            <button
              className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] font-bold text-muted-foreground hover:text-foreground uppercase tracking-widest border border-border/30 rounded-lg hover:border-border/60 transition-colors"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? (
                <><ChevronUp className="w-3 h-3" /> Show less</>
              ) : (
                <><ChevronDown className="w-3 h-3" /> Show all {images.length} photos</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
