import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Car, Clock, ImageIcon, ChevronDown, ChevronUp } from "lucide-react";

type Image = { url: string; position: number; category?: string | null };

type Props = {
  images: Image[];
  vehicleId: number;
  vehicleName: string;
};

export function PhotoAuditPanel({ images, vehicleName }: Props) {
  const [showAll, setShowAll] = useState(false);

  const sorted = [...images].sort((a, b) => a.position - b.position);
  const visible = showAll ? sorted : sorted.slice(0, 12);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* Coming-soon notice */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-border/40 bg-muted/20">
        <Clock className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-[11px] font-bold text-foreground/80 uppercase tracking-widest">
            AI Photo Review — Coming Soon
          </p>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
            Real photo scoring requires a computer vision model. Once integrated,
            DealerPilot will automatically evaluate angle, lighting, sharpness, and
            promotional overlays for every photo.
          </p>
        </div>
      </div>

      {/* Count + vehicle label */}
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

      {/* Photo grid */}
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
