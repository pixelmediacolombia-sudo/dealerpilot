import { useState } from "react";
import { Link, useParams } from "wouter";
import { AppLayout } from "@/shared/layout/AppLayout";
import {
  useGetCreativeVehicleDetail,
  getGetCreativeVehicleDetailQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { formatCurrency, formatMileage } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PhotoAuditPanel } from "./PhotoAuditPanel";
import {
  ArrowLeft,
  Car,
  ImageIcon,
  Clock,
  ChevronDown,
  ChevronUp,
  Star,
  ArrowRight,
} from "lucide-react";
import { EmptyState } from "@/shared/ui";

type Img = { url: string; position: number; category?: string | null };

export function CreativeDetail() {
  const params = useParams();
  const id = Number(params.id);

  const { data, isLoading } = useGetCreativeVehicleDetail(id, {
    query: {
      queryKey: getGetCreativeVehicleDetailQueryKey(id),
      enabled: !Number.isNaN(id),
      refetchInterval: 10000,
    },
  });

  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState<number | null>(null);
  const [showGallery, setShowGallery] = useState(false);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <p className="text-xs font-bold text-muted-foreground  tracking-wide">
              Loading vehicle…
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!data) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center p-8">
          <EmptyState
            icon={Car}
            title="Vehicle not found"
            description="DealerPilot could not locate this vehicle."
            action={
              <Link href="/creative-studio">
                <Button>Back to AI Vehicle Studio</Button>
              </Link>
            }
          />
        </div>
      </AppLayout>
    );
  }

  const { vehicle, images } = data;
  const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

  // Photos sorted by feed position (position 0 = cover/primary photo from dealer)
  const sortedPhotos: Img[] = [...(images ?? [])].sort((a, b) => a.position - b.position);
  const coverPhoto = sortedPhotos[0] ?? null;

  const activePhoto: Img | null =
    selectedPhotoIdx !== null
      ? (sortedPhotos.find((p) => p.position === selectedPhotoIdx) ?? coverPhoto)
      : coverPhoto;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="animate-in fade-in duration-500">

          {/* ── Sticky header ── */}
          <div className="sticky top-0 z-20 border-b border-border/30 bg-background/95 backdrop-blur-md">
            <div className="px-8 py-3 max-w-7xl mx-auto flex items-center gap-4">
              <Link href="/creative-studio">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 h-7 text-xs font-bold  tracking-wide text-muted-foreground hover:text-foreground -ml-2"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> AI Vehicle Studio
                </Button>
              </Link>
              <div className="w-px h-4 bg-border/40" />
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm text-foreground truncate">{vehicleName}</span>
                <span className="text-muted-foreground text-xs ml-2">{formatCurrency(vehicle.price)}</span>
                <span className="text-muted-foreground/60 text-xs ml-2">
                  · {sortedPhotos.length} photos · VIN {vehicle.vin.slice(-8)}
                </span>
              </div>
              <Badge className="text-[11px] font-bold  tracking-wide border bg-muted/40 text-muted-foreground border-border/40 gap-1 flex-shrink-0">
                <Clock className="w-2.5 h-2.5" /> Pending AI Review
              </Badge>
            </div>
          </div>

          <div className="p-8 max-w-7xl mx-auto space-y-8">

            {/* ── Main panel: photo viewer + info ── */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">

              {/* Left: photo viewer */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-muted-foreground  tracking-wide">
                    Vehicle Photos
                  </p>
                  {activePhoto && activePhoto.position === 0 && (
                    <Badge className="text-[11px] font-bold bg-warning/20 text-warning border-warning/30 gap-1">
                      <Star className="w-2.5 h-2.5 fill-amber-400" /> Cover Photo
                    </Badge>
                  )}
                </div>

                {/* Main photo */}
                <div className="aspect-[4/3] bg-secondary/30 rounded-xl overflow-hidden relative">
                  {activePhoto?.url ? (
                    <img
                      src={activePhoto.url}
                      alt={vehicleName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Car className="w-12 h-12 text-muted-foreground/20" />
                    </div>
                  )}
                  {activePhoto && (
                    <div className="absolute top-3 left-3 flex items-center gap-1.5">
                      <span className="bg-black/70 text-foreground text-[11px] font-bold px-2 py-1 rounded backdrop-blur-sm">
                        Photo #{activePhoto.position + 1}
                      </span>
                      {activePhoto.category && (
                        <span className="bg-black/60 text-foreground text-[11px] px-1.5 py-0.5 rounded backdrop-blur-sm capitalize">
                          {activePhoto.category}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="absolute bottom-3 right-3">
                    <Badge className="bg-black/60 text-foreground border-border text-[11px]  tracking-wide backdrop-blur-sm">
                      <Clock className="w-2.5 h-2.5 mr-1" /> Pending AI Review
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground/50 text-center">
                  Source photo from XML feed · {sortedPhotos.length} total
                </p>

                {/* Navigation arrows (prev / next) */}
                {sortedPhotos.length > 1 && activePhoto && (
                  <div className="flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1 text-muted-foreground"
                      disabled={activePhoto.position === 0}
                      onClick={() => {
                        const idx = sortedPhotos.findIndex((p) => p.position === activePhoto.position);
                        if (idx > 0) setSelectedPhotoIdx(sortedPhotos[idx - 1].position);
                      }}
                    >
                      <ArrowLeft className="w-3 h-3" /> Prev
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {sortedPhotos.findIndex((p) => p.position === activePhoto.position) + 1} / {sortedPhotos.length}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1 text-muted-foreground"
                      disabled={activePhoto.position === sortedPhotos[sortedPhotos.length - 1]?.position}
                      onClick={() => {
                        const idx = sortedPhotos.findIndex((p) => p.position === activePhoto.position);
                        if (idx < sortedPhotos.length - 1) setSelectedPhotoIdx(sortedPhotos[idx + 1].position);
                      }}
                    >
                      Next <ArrowRight className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Right: vehicle info + AI review placeholder */}
              <div className="space-y-4">

                {/* Vehicle info */}
                <div className="rounded-xl border border-border/40 bg-card/50 overflow-hidden">
                  <div className="px-5 py-4 border-b border-border/30">
                    <p className="text-xs font-bold text-muted-foreground  tracking-wide">Vehicle</p>
                  </div>
                  <div className="p-5 space-y-3">
                    <div>
                      <p className="font-bold text-foreground text-lg leading-tight">{vehicleName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{vehicle.trim ?? ""}</p>
                    </div>
                    <div className="space-y-2 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">VIN</span>
                        <span className="font-mono font-bold text-foreground/80">{vehicle.vin.slice(-8)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Price</span>
                        <span className="font-bold text-foreground">{formatCurrency(vehicle.price)}</span>
                      </div>
                      {vehicle.mileage != null && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Mileage</span>
                          <span className="font-bold text-foreground">{formatMileage(vehicle.mileage)}</span>
                        </div>
                      )}
                      {vehicle.exteriorColor && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Color</span>
                          <span className="font-bold text-foreground">{vehicle.exteriorColor}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Photos</span>
                        <span className="font-bold text-foreground flex items-center gap-1">
                          <ImageIcon className="w-3 h-3" /> {sortedPhotos.length}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* AI Photo Review placeholder */}
                <div className="rounded-xl border border-border/40 bg-card/50 overflow-hidden">
                  <div className="px-5 py-4 border-b border-border/30 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs font-bold text-muted-foreground  tracking-wide">AI Photo Review</span>
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="text-center py-6 space-y-3">
                      <div className="w-12 h-12 rounded-full bg-muted/30 border border-border/40 flex items-center justify-center mx-auto">
                        <Clock className="w-5 h-5 text-muted-foreground/50" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-foreground/70">Coming Soon</p>
                        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed max-w-[220px] mx-auto">
                          Real photo scoring requires computer vision. DealerPilot will evaluate angle,
                          lighting, sharpness, and overlays once the AI model is connected.
                        </p>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-border/20 space-y-2 text-[11px]">
                      {[
                        "Vehicle visibility & angle",
                        "Lighting & exposure quality",
                        "Sharpness & focus",
                        "Promotional overlays detection",
                        "Background cleanliness",
                        "Marketplace trust score",
                      ].map((item) => (
                        <div key={item} className="flex items-center gap-2 text-muted-foreground/60">
                          <div className="w-3 h-3 rounded-full border border-border/60 flex-shrink-0" />
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Horizontal photo strip ── */}
            {sortedPhotos.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-muted-foreground  tracking-wide">
                    All Photos ({sortedPhotos.length} total)
                  </p>
                  <p className="text-xs text-muted-foreground/60">Click to preview · position from feed</p>
                </div>

                <div className="flex gap-2.5 overflow-x-auto pb-3" style={{ scrollbarWidth: "thin" }}>
                  {sortedPhotos.map((p) => {
                    const isActive = activePhoto?.position === p.position;
                    const isCover = p.position === 0;
                    return (
                      <button
                        key={p.position}
                        onClick={() => setSelectedPhotoIdx(p.position)}
                        className={cn(
                          "flex-shrink-0 w-24 rounded-lg overflow-hidden border-2 transition duration-200 text-left",
                          isActive
                            ? "border-primary shadow-lg shadow-primary/20 ring-1 ring-primary/30"
                            : "border-border/40 hover:border-border opacity-70 hover:opacity-100",
                        )}
                      >
                        <div className="aspect-[4/3] relative overflow-hidden bg-secondary/40">
                          {p.url ? (
                            <img src={p.url} alt={`Photo ${p.position + 1}`} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Car className="w-4 h-4 text-muted-foreground/20" />
                            </div>
                          )}
                          {isCover && (
                            <div className="absolute top-1 left-1">
                              <span className="bg-warning/90 text-black text-[7px] font-semibold px-1 rounded">
                                Cover
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="px-1.5 py-1 bg-card/80 space-y-0.5">
                          <div className="text-[11px] font-bold text-foreground/70">#{p.position + 1}</div>
                          <div className="text-[7px] text-muted-foreground/50  tracking-wide">
                            {p.category ?? "photo"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Collapsible full gallery ── */}
            <div className="rounded-xl border border-border/30 overflow-hidden">
              <button
                onClick={() => setShowGallery((v) => !v)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/10 transition-colors"
              >
                <ImageIcon className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-bold  tracking-wide text-muted-foreground flex-1 text-left">
                  Full Photo Gallery — {sortedPhotos.length} photos
                </span>
                <span className="text-[11px] text-muted-foreground/60 mr-2">
                  {showGallery ? "Collapse" : "Expand"}
                </span>
                {showGallery
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                }
              </button>
              {showGallery && (
                <div className="px-5 pb-6 pt-2 border-t border-border/20 animate-in fade-in duration-300">
                  <PhotoAuditPanel
                    images={images ?? []}
                    vehicleId={vehicle.id}
                    vehicleName={vehicleName}
                  />
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </AppLayout>
  );
}
