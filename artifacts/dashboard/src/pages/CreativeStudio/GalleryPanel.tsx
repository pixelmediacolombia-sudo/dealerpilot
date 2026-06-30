import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Car,
  Star,
  Download,
  CheckCircle2,
  ImageIcon,
  ZoomIn,
  X,
} from "lucide-react";

type Image = { url: string; position: number; category?: string | null };

type Props = {
  images: Image[];
  vehicleName: string;
  bestCoverPosition?: number;
  top5Positions?: number[];
};

export function GalleryPanel({
  images,
  vehicleName,
  bestCoverPosition,
  top5Positions = [],
}: Props) {
  const [coverIdx, setCoverIdx] = useState<number | null>(bestCoverPosition ?? null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <Car className="w-12 h-12 text-muted-foreground/20" />
        <p className="text-muted-foreground text-sm">No photos available in the XML feed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Original XML Gallery
          </p>
          <Badge className="bg-secondary/60 text-muted-foreground border-border/40 text-[10px]">
            <ImageIcon className="w-3 h-3 mr-1" />
            {images.length} photos
          </Badge>
        </div>
        {coverIdx !== null && (
          <Badge className="bg-success/15 text-success border-success/30 text-[10px] font-bold uppercase tracking-widest gap-1.5">
            <Star className="w-3 h-3 fill-success" />
            Cover: Photo #{coverIdx + 1}
          </Badge>
        )}
      </div>

      {/* Gallery grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {images.map((img, i) => {
          const isSelected = coverIdx === img.position;
          const isBestAI = img.position === bestCoverPosition;
          const isTop5 = top5Positions.includes(img.position);

          return (
            <div
              key={`${img.url}-${i}`}
              className={cn(
                "group rounded-xl overflow-hidden border relative transition-all duration-200 cursor-pointer bg-secondary/30",
                isSelected
                  ? "border-success/60 ring-2 ring-success/20 shadow-lg shadow-success/10"
                  : "border-border/40 hover:border-border/80",
              )}
            >
              {/* Image */}
              <div
                className="aspect-[4/3] relative overflow-hidden"
                onClick={() => setLightboxUrl(img.url)}
              >
                {img.url ? (
                  <img
                    src={img.url}
                    alt={`${vehicleName} - photo ${img.position + 1}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Car className="w-8 h-8 text-muted-foreground/20" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-70 group-hover:opacity-90 transition-opacity" />

                {/* Position */}
                <div className="absolute top-2 left-2 bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded backdrop-blur-sm">
                  #{img.position + 1}
                </div>

                {/* AI badges */}
                {isBestAI && (
                  <div className="absolute top-2 right-2 bg-amber-400/90 text-black text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wide">
                    AI Best
                  </div>
                )}
                {!isBestAI && isTop5 && (
                  <div className="absolute top-2 right-2 bg-primary/80 text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">
                    Top 5
                  </div>
                )}

                {/* Cover checkmark */}
                {isSelected && (
                  <div className="absolute bottom-2 right-2">
                    <CheckCircle2 className="w-5 h-5 text-success drop-shadow-md" />
                  </div>
                )}

                {/* Zoom hint */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <ZoomIn className="w-7 h-7 text-white drop-shadow-lg" />
                </div>
              </div>

              {/* Card actions */}
              <div className="p-2 flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant={isSelected ? "default" : "outline"}
                  className={cn(
                    "flex-1 h-7 text-[9px] gap-1 font-bold uppercase tracking-widest transition-all",
                    isSelected
                      ? "bg-success/20 text-success border-success/30 hover:bg-success/30"
                      : "border-border/50 hover:border-primary/40 hover:text-primary",
                  )}
                  onClick={() => setCoverIdx(isSelected ? null : img.position)}
                >
                  <Star className={cn("w-2.5 h-2.5", isSelected && "fill-success")} />
                  {isSelected ? "Cover" : "Set Cover"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground flex-shrink-0"
                  onClick={() => window.open(img.url, "_blank")}
                  title="Download original"
                >
                  <Download className="w-3 h-3" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Cover info */}
      {coverIdx !== null && (
        <div className="p-4 rounded-xl border border-success/20 bg-success/5 flex items-center gap-3">
          <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
          <p className="text-sm text-success font-semibold">
            Photo #{coverIdx + 1} selected as cover.
          </p>
          <p className="text-xs text-muted-foreground ml-1">
            This photo will be used as the primary image for Marketplace listings.
          </p>
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-8 animate-in fade-in duration-200"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/60 hover:text-white"
            onClick={() => setLightboxUrl(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxUrl}
            alt={vehicleName}
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
