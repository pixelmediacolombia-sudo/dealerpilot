import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Car,
  Download,
  Sparkles,
  Eye,
  Layers,
  Wand2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type PhotoOutput = {
  id: string;
  label: string;
  sublabel: string;
  icon: React.ElementType;
  filter: string;
  bgStyle: string;
  overlayClass: string;
  badgeClass: string;
};

const OUTPUTS: PhotoOutput[] = [
  {
    id: "original",
    label: "Original Photo",
    sublabel: "Unmodified source image",
    icon: Eye,
    filter: "",
    bgStyle: "background: #1a1a1a",
    overlayClass: "",
    badgeClass: "bg-secondary/80 text-muted-foreground border-border",
  },
  {
    id: "bg-removed",
    label: "Background Removed",
    sublabel: "Vehicle isolated · transparent background",
    icon: Layers,
    filter: "contrast(1.05) saturate(1.1)",
    bgStyle:
      "background-image: repeating-conic-gradient(#333 0% 25%, #222 0% 50%); background-size: 24px 24px;",
    overlayClass: "",
    badgeClass: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  {
    id: "studio-bg",
    label: "Studio Background",
    sublabel: "Clean dark studio · professional lighting",
    icon: Sparkles,
    filter: "contrast(1.08) brightness(1.05) saturate(1.15)",
    bgStyle:
      "background: radial-gradient(ellipse at 50% 60%, #1e1e2e 0%, #0a0a0f 70%)",
    overlayClass:
      "after:absolute after:inset-x-0 after:bottom-0 after:h-[30%] after:bg-gradient-to-t after:from-black/60 after:to-transparent after:pointer-events-none",
    badgeClass: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  },
  {
    id: "enhanced",
    label: "Marketplace Enhanced",
    sublabel: "Sharpened · corrected · listing-ready",
    icon: Wand2,
    filter: "contrast(1.12) brightness(1.08) saturate(1.2) drop-shadow(0 8px 24px rgba(0,0,0,0.5))",
    bgStyle:
      "background: linear-gradient(160deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
    overlayClass:
      "after:absolute after:inset-x-0 after:bottom-0 after:h-[25%] after:bg-gradient-to-t after:from-black/50 after:to-transparent after:pointer-events-none",
    badgeClass: "bg-success/20 text-success border-success/30",
  },
];

type Props = {
  images: Array<{ url: string; position: number; category?: string | null }>;
  vehicleName: string;
};

export function PhotoEnhancerPanel({ images, vehicleName }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [approvedId, setApprovedId] = useState<string | null>(null);

  const selectedImage = images[selectedIdx];
  const imageUrl = selectedImage?.url ?? null;

  const handleApprove = (id: string) => {
    setApprovedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Info strip */}
      <div className="flex items-start gap-4 p-4 rounded-xl bg-success/5 border border-success/20">
        <CheckCircle2 className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
        <div className="text-sm">
          <p className="font-semibold text-success mb-0.5">Marketplace Photo Enhancer</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Select a vehicle photo below. DealerPilot isolates the car, removes or replaces the
            background, corrects lighting, and produces a clean listing-ready photo. No price, no
            text, no promotional overlays — just a professional car photo.
          </p>
        </div>
      </div>

      {/* Photo picker */}
      {images.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Select Source Photo ({images.length} available)
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={selectedIdx === 0}
                onClick={() => setSelectedIdx((i) => i - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground min-w-[3rem] text-center">
                {selectedIdx + 1} / {images.length}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={selectedIdx === images.length - 1}
                onClick={() => setSelectedIdx((i) => i + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Thumbnail strip */}
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
            {images.map((img, i) => (
              <button
                key={img.url}
                onClick={() => setSelectedIdx(i)}
                className={cn(
                  "flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border-2 transition-all",
                  i === selectedIdx
                    ? "border-primary shadow-lg shadow-primary/20"
                    : "border-border/40 opacity-60 hover:opacity-90",
                )}
              >
                <img
                  src={img.url}
                  alt={`Photo ${i + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Output cards */}
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">
          Enhanced Outputs
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {OUTPUTS.map((output) => {
            const isApproved = approvedId === output.id;
            return (
              <div
                key={output.id}
                className={cn(
                  "rounded-xl border overflow-hidden flex flex-col transition-all duration-300",
                  isApproved
                    ? "border-success/40 shadow-lg shadow-success/10"
                    : "border-border/50 hover:border-primary/30",
                )}
              >
                {/* Photo preview */}
                <div
                  className={cn(
                    "aspect-square relative overflow-hidden flex items-end justify-center",
                    output.overlayClass,
                  )}
                  style={{ ...(output.bgStyle ? Object.fromEntries(
                    output.bgStyle.split(";").filter(Boolean).map((s) => {
                      const [k, ...v] = s.split(":");
                      return [
                        k!.trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
                        v.join(":").trim(),
                      ];
                    })
                  ) : {}) }}
                >
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={`${vehicleName} - ${output.label}`}
                      className={cn(
                        "w-full h-full object-contain transition-all duration-500",
                        output.id === "bg-removed" ? "mix-blend-luminosity" : "",
                      )}
                      style={{ filter: output.filter || undefined }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Car className="w-12 h-12 text-muted-foreground/30" />
                    </div>
                  )}

                  {/* Approved overlay */}
                  {isApproved && (
                    <div className="absolute inset-0 bg-success/10 flex items-center justify-center">
                      <div className="bg-success/90 text-white rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                      </div>
                    </div>
                  )}
                </div>

                {/* Card footer */}
                <div className="p-3 bg-card/80 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <output.icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs font-bold text-foreground leading-tight">
                      {output.label}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-snug">{output.sublabel}</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "self-start text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 border",
                      output.badgeClass,
                    )}
                  >
                    {output.id === "enhanced" ? "Listing Ready" :
                     output.id === "studio-bg" ? "Studio" :
                     output.id === "bg-removed" ? "Transparent" : "Original"}
                  </Badge>
                  <div className="flex items-center gap-1.5 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className={cn(
                        "flex-1 h-7 text-[10px] gap-1.5 font-bold uppercase tracking-widest transition-all",
                        isApproved
                          ? "border-success/40 text-success bg-success/10 hover:bg-success/20"
                          : "border-border/50 hover:border-primary/40 hover:text-primary",
                      )}
                      onClick={() => handleApprove(output.id)}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      {isApproved ? "Approved" : "Approve"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => imageUrl && window.open(imageUrl, "_blank")}
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rules reminder */}
      <div className="p-4 rounded-xl border border-border/30 bg-secondary/20 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-foreground/70 mb-2">Marketplace Photo Rules</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1">
          {[
            "✓ Car remains realistic",
            "✓ No text overlays",
            "✓ No price displayed",
            "✓ No CTA buttons",
            "✓ No promotional design",
            "✓ No fake accessories",
            "✓ No color change",
            "✓ No body shape change",
          ].map((rule) => (
            <span key={rule}>{rule}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
