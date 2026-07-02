import { useQuery } from "@tanstack/react-query";
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Store,
  ArrowLeftRight,
  Tag,
  Loader2,
  ImageOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PhotoSetImage {
  id: number;
  setId: number;
  vehicleId: number;
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

interface PhotoSetSummary {
  total: number;
  exteriorCount: number;
  interiorCount: number;
  miscCount: number;
  fallbackCount: number;
  compositedCount: number;
}

interface PhotoSetResponse {
  set: {
    id: number;
    vehicleId: number;
    version: number;
    status: string;
    totalPhotos: number;
    processedPhotos: number;
    processingTimeMs: number | null;
    studioVersion: string | null;
    completedAt: string | null;
  } | null;
  images: PhotoSetImage[];
  summary: PhotoSetSummary | null;
  vehicle: {
    id: number;
    year: number | null;
    make: string;
    model: string;
    trim: string | null;
    vin: string;
    aiPhotoStatus: string | null;
  };
  isActiveForMarketplace: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const API_BASE = "/api";

async function fetchPhotoSet(vehicleId: number): Promise<PhotoSetResponse> {
  const r = await fetch(`${API_BASE}/photo-studio/sets/${vehicleId}`);
  if (!r.ok) throw new Error("Failed to fetch photo set");
  return r.json() as Promise<PhotoSetResponse>;
}

function aiOutputUrl(img: PhotoSetImage): string {
  if (img.compositedUrl && img.compositedUrl !== img.originalUrl) return img.compositedUrl;
  if (img.processedUrl && img.processedUrl !== img.originalUrl) return img.processedUrl;
  if (img.backgroundRemovedUrl && img.backgroundRemovedUrl !== img.originalUrl)
    return img.backgroundRemovedUrl;
  return img.originalUrl;
}

function isFallback(img: PhotoSetImage): boolean {
  return img.usedFallback === 1 || aiOutputUrl(img) === img.originalUrl;
}

// ── Image Tile ─────────────────────────────────────────────────────────────────

function ImageTile({
  src,
  label,
  sublabel,
  fallback,
  isFallbackSrc,
}: {
  src: string;
  label: string;
  sublabel?: string;
  fallback?: boolean;
  isFallbackSrc?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "relative aspect-[4/3] rounded-lg overflow-hidden bg-white/[0.03] border",
          fallback ? "border-amber-500/30" : "border-white/[0.08]",
        )}
      >
        <img src={src} alt={label} className="w-full h-full object-cover" loading="lazy" />
        {isFallbackSrc && (
          <div className="absolute top-2 right-2">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/80 text-black">
              Fallback
            </span>
          </div>
        )}
      </div>
      <div>
        <div className="text-[11px] font-medium text-white/70">{label}</div>
        {sublabel && <div className="text-[10px] text-white/40">{sublabel}</div>}
      </div>
    </div>
  );
}

// ── Exterior card (before / after side by side) ────────────────────────────────

function ExteriorCard({ img }: { img: PhotoSetImage }) {
  const aiUrl = aiOutputUrl(img);
  const fallbackUsed = isFallback(img);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/20 uppercase tracking-wide">
          Exterior
        </span>
        {img.classification && (
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Tag className="w-3 h-3" />
            {img.classification}
          </span>
        )}
        {img.classificationConfidence !== null && img.classificationConfidence !== undefined && (
          <span className="text-[10px] text-muted-foreground/60 ml-auto">
            {Math.round((img.classificationConfidence ?? 0) * 100)}% confidence
          </span>
        )}
        {fallbackUsed && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 ml-auto">
            Fallback — original used
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ImageTile src={img.originalUrl} label="Original" sublabel="Source photo" />
        <ImageTile
          src={aiUrl}
          label="AI Output"
          sublabel={
            img.compositedUrl && img.compositedUrl !== img.originalUrl
              ? "AI enhanced"
              : img.backgroundRemovedUrl && img.backgroundRemovedUrl !== img.originalUrl
                ? "Background removed"
                : "Fallback — unchanged"
          }
          isFallbackSrc={fallbackUsed}
        />
      </div>

      {img.removalProvider && img.removalTimeMs && (
        <div className="text-[10px] text-muted-foreground/50">
          {img.removalProvider} · {(img.removalTimeMs / 1000).toFixed(1)}s · pos #{img.position}
        </div>
      )}
    </div>
  );
}

// ── Interior / Misc card ───────────────────────────────────────────────────────

function InteriorCard({ img }: { img: PhotoSetImage }) {
  const isMisc = img.classification === "Miscellaneous" || !img.classification;
  return (
    <div className="rounded-xl border border-white/[0.04] bg-card/50 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide border",
            isMisc
              ? "bg-white/[0.04] text-white/30 border-white/[0.06]"
              : "bg-white/[0.06] text-white/50 border-white/[0.08]",
          )}
        >
          {isMisc ? "Miscellaneous" : "Interior"}
        </span>
        {img.classification && (
          <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
            <Tag className="w-3 h-3" />
            {img.classification}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground/40">
          {isMisc ? "Not processed" : "Preserved — enhanced only"}
        </span>
      </div>
      <div className="aspect-[4/3] rounded-lg overflow-hidden bg-white/[0.02] border border-white/[0.04]">
        <img
          src={img.processedUrl ?? img.originalUrl}
          alt={img.classification ?? "photo"}
          className={cn("w-full h-full object-cover", isMisc && "opacity-50")}
          loading="lazy"
        />
      </div>
    </div>
  );
}

// ── Summary pill row ──────────────────────────────────────────────────────────

function SummaryPills({ summary }: { summary: PhotoSetSummary }) {
  const pills = [
    { label: "Exterior", value: summary.exteriorCount, color: "text-primary" },
    { label: "Interior", value: summary.interiorCount, color: "text-white/60" },
    { label: "Misc", value: summary.miscCount, color: "text-white/40" },
    {
      label: "Composited",
      value: summary.compositedCount,
      color: "text-green-400",
      hide: summary.compositedCount === 0,
    },
    {
      label: "Fallback",
      value: summary.fallbackCount,
      color: "text-amber-400",
      hide: summary.fallbackCount === 0,
    },
  ];

  return (
    <div className="flex flex-wrap gap-3">
      {pills
        .filter((p) => !p.hide)
        .map((p) => (
          <span key={p.label} className="text-[12px]">
            <span className={cn("font-semibold", p.color)}>{p.value}</span>
            <span className="text-muted-foreground ml-1">{p.label}</span>
          </span>
        ))}
    </div>
  );
}

// ── Main PhotoSetViewer ────────────────────────────────────────────────────────

export function PhotoSetViewer({
  vehicleId,
  jobId,
  processingTimeMs,
  onClose,
}: {
  vehicleId: number;
  jobId: number;
  processingTimeMs: number | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["photo-set", vehicleId],
    queryFn: () => fetchPhotoSet(vehicleId),
  });

  const vehicleName = data
    ? `${data.vehicle.year ?? ""} ${data.vehicle.make} ${data.vehicle.model}${data.vehicle.trim ? ` ${data.vehicle.trim}` : ""}`.trim()
    : "Loading…";

  const exteriorImages = (data?.images ?? []).filter((i) => i.isExterior === 1);
  const otherImages = (data?.images ?? []).filter((i) => i.isExterior !== 1);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-white/[0.06] bg-card/50 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-white truncate">{vehicleName}</h2>
            <span className="text-[11px] text-muted-foreground shrink-0">Job #{jobId}</span>
            {processingTimeMs !== null && processingTimeMs !== undefined && (
              <span className="text-[11px] text-muted-foreground shrink-0">
                {(processingTimeMs / 1000).toFixed(1)}s
              </span>
            )}
            {data?.isActiveForMarketplace && (
              <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20 uppercase tracking-wide shrink-0">
                <Store className="w-3 h-3" />
                Active in Marketplace Payload
              </span>
            )}
            {data && !data.isActiveForMarketplace && (
              <span className="text-[10px] text-muted-foreground/50 shrink-0">
                Not yet active in marketplace
              </span>
            )}
          </div>
          {data?.summary && (
            <div className="mt-1.5">
              <SummaryPills summary={data.summary} />
            </div>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="shrink-0 h-8 w-8 p-0">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 text-sm text-red-400 py-10 justify-center">
            <ImageOff className="w-4 h-4" />
            Failed to load photo set.
          </div>
        )}

        {data && !data.set && (
          <div className="text-center py-20 text-muted-foreground text-sm">
            No photo set found for this vehicle.
          </div>
        )}

        {data && data.set && (
          <div className="max-w-6xl mx-auto space-y-8">
            {/* Exterior section — before/after */}
            {exteriorImages.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <ArrowLeftRight className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold text-white">
                    Exterior Photos — Before &amp; After
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    ({exteriorImages.length} photo{exteriorImages.length !== 1 ? "s" : ""})
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  {exteriorImages.map((img) => (
                    <ExteriorCard key={img.id} img={img} />
                  ))}
                </div>
              </section>
            )}

            {/* Interior / Misc section */}
            {otherImages.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle2 className="w-4 h-4 text-white/40" />
                  <h3 className="text-sm font-semibold text-white/60">
                    Interior &amp; Other Photos
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    ({otherImages.length} photo{otherImages.length !== 1 ? "s" : ""} — preserved unchanged)
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                  {otherImages.map((img) => (
                    <InteriorCard key={img.id} img={img} />
                  ))}
                </div>
              </section>
            )}

            {/* Fallback warning */}
            {(data.summary?.fallbackCount ?? 0) > 0 && (
              <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.04]">
                <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <span className="font-medium text-amber-300">
                    {data.summary!.fallbackCount} photo
                    {data.summary!.fallbackCount !== 1 ? "s" : ""} used original
                  </span>
                  <span className="text-amber-400/70 ml-2">
                    FAL.ai background removal was unavailable for these images. Original photos will
                    be used in the marketplace payload.
                  </span>
                </div>
              </div>
            )}

            {/* Set metadata */}
            <div className="text-[11px] text-muted-foreground/40 pb-2">
              Set #{data.set.id} · v{data.set.version} · Studio {data.set.studioVersion ?? "v1"} ·
              VIN {data.vehicle.vin}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
