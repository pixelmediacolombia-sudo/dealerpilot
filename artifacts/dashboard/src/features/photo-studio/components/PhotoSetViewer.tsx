import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  X,
  CheckCircle2,
  Store,
  ArrowLeftRight,
  Loader2,
  ImageOff,
  Sparkles,
  RotateCcw,
  Download,
  LayoutGrid,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

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
  qualityFlags: string | null;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function parseQualityFlags(img: PhotoSetImage): Record<string, unknown> {
  if (!img.qualityFlags) return {};
  try {
    return JSON.parse(img.qualityFlags) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function qualityGateResult(img: PhotoSetImage): string {
  const flags = parseQualityFlags(img);
  return String(flags["qualityGateResult"] ?? flags["qualityImprovementClass"] ?? "");
}

function isEnhanced(img: PhotoSetImage): boolean {
  const result = qualityGateResult(img);
  return img.usedFallback !== 1 &&
    aiOutputUrl(img) !== img.originalUrl &&
    (result === "Strong Improvement" || result === "Moderate Improvement");
}

function FallbackImage({
  src,
  fallbackSrc,
  alt,
  className,
  loading,
}: {
  src: string;
  fallbackSrc?: string | null;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrentSrc(src);
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <ImageOff className="w-5 h-5" />
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      loading={loading}
      onError={() => {
        if (fallbackSrc && fallbackSrc !== currentSrc) {
          setCurrentSrc(fallbackSrc);
          return;
        }
        setFailed(true);
      }}
    />
  );
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = "enhanced" | "original" | "compare" | "report";

// ── Gallery Grid ──────────────────────────────────────────────────────────────

function GalleryGrid({ images, urlFn, label }: { images: PhotoSetImage[]; urlFn: (img: PhotoSetImage) => string; label?: string }) {
  const [selected, setSelected] = useState<number | null>(null);

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <ImageIcon className="w-8 h-8 mb-2" />
        <p className="text-sm">No photos available</p>
      </div>
    );
  }

  const selectedIdx = selected ?? 0;
  const selectedImg = images[selectedIdx];

  return (
    <div className="space-y-4">
      {/* Large preview */}
      <div className="relative rounded-xl overflow-hidden bg-muted border border-border" style={{ aspectRatio: "16/9" }}>
        <FallbackImage
          src={urlFn(selectedImg!)}
          fallbackSrc={selectedImg?.originalUrl}
          alt={selectedImg?.classification ?? label ?? "photo"}
          className="w-full h-full object-contain"
        />
        {label && (
          <div className="absolute top-3 left-3">
            <span className="text-[11px] font-medium px-2 py-1 rounded-lg bg-black/60 text-foreground backdrop-blur-sm">
              {label}
            </span>
          </div>
        )}
        {/* Nav arrows */}
        {images.length > 1 && (
          <>
            <button
              className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm border border-border flex items-center justify-center hover:bg-black/80 transition-colors disabled:opacity-30"
              onClick={() => setSelected(Math.max(0, selectedIdx - 1))}
              disabled={selectedIdx === 0}
            >
              <ChevronLeft className="w-4 h-4 text-foreground" />
            </button>
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm border border-border flex items-center justify-center hover:bg-black/80 transition-colors disabled:opacity-30"
              onClick={() => setSelected(Math.min(images.length - 1, selectedIdx + 1))}
              disabled={selectedIdx === images.length - 1}
            >
              <ChevronRight className="w-4 h-4 text-foreground" />
            </button>
          </>
        )}
        <div className="absolute bottom-3 right-3 text-[11px] text-muted-foreground bg-black/40 backdrop-blur-sm px-2 py-0.5 rounded-full">
          {selectedIdx + 1} / {images.length}
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {images.map((img, i) => (
          <button
            key={img.id}
            onClick={() => setSelected(i)}
            className={cn(
              "relative shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition",
              i === selectedIdx ? "border-primary" : "border-border opacity-50 hover:opacity-80",
            )}
          >
            <FallbackImage
              src={urlFn(img)}
              fallbackSrc={img.originalUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Before / After Comparison ─────────────────────────────────────────────────

function BeforeAfterView({ images }: { images: PhotoSetImage[] }) {
  const exterior = images.filter((i) => i.isExterior === 1);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const img = exterior[selectedIdx];

  if (exterior.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <ArrowLeftRight className="w-8 h-8 mb-2" />
        <p className="text-sm">No exterior photos to compare</p>
      </div>
    );
  }

  const enhanced = img ? isEnhanced(img) : false;

  return (
    <div className="space-y-4">
      {/* Photo selector */}
      {exterior.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {exterior.map((ph, i) => (
            <button
              key={ph.id}
              onClick={() => setSelectedIdx(i)}
              className={cn(
                "relative shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition",
                i === selectedIdx ? "border-primary" : "border-border opacity-50 hover:opacity-80",
              )}
            >
              <FallbackImage src={ph.originalUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {/* Side by side */}
      {img && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-muted-foreground  tracking-wide pl-1">Original</div>
            <div className="rounded-xl overflow-hidden border border-border" style={{ aspectRatio: "4/3" }}>
              <FallbackImage src={img.originalUrl} alt="Original" className="w-full h-full object-cover" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 pl-1">
              <div className="text-[11px] font-medium text-muted-foreground  tracking-wide">AI Enhanced</div>
              {enhanced && <span className="text-xs text-success">✓ Improved</span>}
            </div>
            <div className={cn("rounded-xl overflow-hidden border", enhanced ? "border-success/20" : "border-border")} style={{ aspectRatio: "4/3" }}>
              <FallbackImage
                src={aiOutputUrl(img)}
                fallbackSrc={img.originalUrl}
                alt="Enhanced"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      )}

      {img?.classification && (
        <div className="text-[11px] text-muted-foreground text-center">
          Classified as: <span className="text-muted-foreground">{img.classification}</span>
          {img.classificationConfidence !== null && img.classificationConfidence !== undefined && (
            <span className="ml-2 text-muted-foreground">
              {Math.round((img.classificationConfidence) * 100)}% confidence
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Quality Report ────────────────────────────────────────────────────────────

function QualityReport({ data }: { data: PhotoSetResponse }) {
  const { summary, set, isActiveForMarketplace } = data;
  if (!summary || !set) return null;

  const enhancedPct = set.totalPhotos > 0
    ? Math.round((set.processedPhotos / set.totalPhotos) * 100)
    : 0;

  const items = [
    {
      label: "Total Photos",
      value: summary.total,
      status: summary.total >= 10 ? "good" : summary.total >= 5 ? "warn" : "bad",
      note: summary.total >= 10 ? "Excellent" : summary.total >= 5 ? "Acceptable" : "Add more photos",
    },
    {
      label: "Exterior Shots",
      value: summary.exteriorCount,
      status: summary.exteriorCount >= 6 ? "good" : summary.exteriorCount >= 3 ? "warn" : "bad",
      note: summary.exteriorCount >= 6 ? "Great coverage" : "Recommend 6+",
    },
    {
      label: "Interior Shots",
      value: summary.interiorCount,
      status: summary.interiorCount >= 3 ? "good" : summary.interiorCount >= 1 ? "warn" : "bad",
      note: summary.interiorCount >= 3 ? "Good" : "Recommend 3+",
    },
    {
      label: "AI Enhanced",
      value: `${enhancedPct}%`,
      status: enhancedPct >= 80 ? "good" : enhancedPct >= 50 ? "warn" : "bad",
      note: `${set.processedPhotos} of ${set.totalPhotos} photos`,
    },
    {
      label: "Marketplace Status",
      value: isActiveForMarketplace ? "Active" : "Not Active",
      status: isActiveForMarketplace ? "good" : "warn",
      note: isActiveForMarketplace ? "Listed on Facebook Marketplace" : "Not yet listed",
    },
  ];

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label} className={cn(
          "flex items-center gap-4 p-3.5 rounded-xl border",
          item.status === "good" ? "bg-success/[0.04] border-success/15"
            : item.status === "warn" ? "bg-warning/[0.04] border-warning/15"
            : "bg-destructive/[0.04] border-destructive/15"
        )}>
          <div className={cn(
            "w-2 h-2 rounded-full shrink-0",
            item.status === "good" ? "bg-success"
              : item.status === "warn" ? "bg-warning"
              : "bg-destructive"
          )} />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-foreground">{item.label}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{item.note}</div>
          </div>
          <div className={cn(
            "text-sm font-semibold shrink-0",
            item.status === "good" ? "text-success"
              : item.status === "warn" ? "text-warning"
              : "text-destructive"
          )}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main PhotoSetViewer ────────────────────────────────────────────────────────

export function PhotoSetViewer({
  vehicleId,
  onClose,
  onReprocess,
}: {
  vehicleId: number;
  onClose: () => void;
  onReprocess: (vehicleId: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("enhanced");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["photo-set", vehicleId],
    queryFn: () => fetchPhotoSet(vehicleId),
  });

  const vehicleName = data
    ? `${data.vehicle.year ?? ""} ${data.vehicle.make} ${data.vehicle.model}${data.vehicle.trim ? ` ${data.vehicle.trim}` : ""}`.trim()
    : "Loading…";

  const exteriorImages = (data?.images ?? []).filter((i) => i.isExterior === 1);
  const allImages = data?.images ?? [];

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "enhanced", label: "Enhanced", icon: Sparkles },
    { id: "original", label: "Original", icon: ImageIcon },
    { id: "compare", label: "Before & After", icon: ArrowLeftRight },
    { id: "report", label: "Quality Report", icon: CheckCircle2 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-border bg-card/50 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-foreground truncate">{vehicleName}</h2>
            {data?.vehicle.vin && (
              <span className="text-[11px] text-muted-foreground font-mono shrink-0">{data.vehicle.vin}</span>
            )}
            {data?.isActiveForMarketplace && (
              <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/20 shrink-0">
                <Store className="w-3 h-3" />
                Marketplace Ready
              </span>
            )}
          </div>
          {data?.summary && (
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
              <span><span className="text-muted-foreground font-medium">{data.summary.exteriorCount}</span> exterior</span>
              <span><span className="text-muted-foreground font-medium">{data.summary.interiorCount}</span> interior</span>
              <span><span className="text-muted-foreground font-medium">{data.set?.processedPhotos ?? 0}</span> enhanced</span>
            </div>
          )}
        </div>
        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onReprocess(vehicleId)}
          >
            <RotateCcw className="w-3 h-3 mr-1.5" />
            Reprocess
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-border bg-card/30 shrink-0">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                tab === t.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 text-sm text-destructive py-20 justify-center">
            <ImageOff className="w-4 h-4" />
            Failed to load photos.
          </div>
        )}

        {data && !data.set && (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <LayoutGrid className="w-8 h-8 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">No enhanced photos yet.</p>
            <Button size="sm" variant="outline" onClick={() => onReprocess(vehicleId)}>
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Enhance Photos
            </Button>
          </div>
        )}

        {data && data.set && (
          <div className="max-w-4xl mx-auto p-6">
            {tab === "enhanced" && (
              <GalleryGrid
                images={allImages}
                urlFn={aiOutputUrl}
                label="AI Enhanced"
              />
            )}
            {tab === "original" && (
              <GalleryGrid
                images={allImages}
                urlFn={(img) => img.originalUrl}
                label="Original"
              />
            )}
            {tab === "compare" && <BeforeAfterView images={allImages} />}
            {tab === "report" && <QualityReport data={data} />}
          </div>
        )}
      </div>

      {/* Footer action bar */}
      {data?.set && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-card/30 shrink-0">
          <div className="text-[11px] text-muted-foreground">
            {allImages.length} photo{allImages.length !== 1 ? "s" : ""} · {exteriorImages.length} exterior enhanced
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled>
            <Download className="w-3 h-3 mr-1.5" />
            Export
          </Button>
        </div>
      )}
    </div>
  );
}
