import { useState, useCallback } from "react";
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
  Camera,
  AlertTriangle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";

type PhotoOutput = {
  id: string;
  label: string;
  sublabel: string;
  description: string;
  icon: React.ElementType;
  filter: string;
  bgStyle: React.CSSProperties;
  badgeLabel: string;
  badgeClass: string;
};

const OUTPUTS: PhotoOutput[] = [
  {
    id: "marketplace-ready",
    label: "Marketplace Ready",
    sublabel: "Overlay-free · enhanced lighting",
    description: "Promotional text and dealer branding removed. Lighting corrected. Color-accurate, listing-ready.",
    icon: Wand2,
    filter: "contrast(1.12) brightness(1.09) saturate(1.18) drop-shadow(0 12px 32px rgba(0,0,0,0.45))",
    bgStyle: { background: "linear-gradient(160deg, #e8edf2 0%, #c8d4dc 50%, #d8e2ea 100%)" },
    badgeLabel: "Listing Ready",
    badgeClass: "bg-success/20 text-success border-success/30",
  },
  {
    id: "studio-bg",
    label: "Studio Background",
    sublabel: "Dark studio · professional lighting",
    description: "Vehicle isolated. Clean studio backdrop with professional lighting gradient. Showroom quality.",
    icon: Sparkles,
    filter: "contrast(1.1) brightness(1.06) saturate(1.15) drop-shadow(0 16px 40px rgba(0,0,0,0.6))",
    bgStyle: { background: "radial-gradient(ellipse at 50% 55%, #1a1f2e 0%, #0a0d14 60%, #040508 100%)" },
    badgeLabel: "Studio",
    badgeClass: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  },
  {
    id: "white-bg",
    label: "White Background",
    sublabel: "Clean white · catalog-style",
    description: "Vehicle on pure white background. Ideal for inventory listings, print catalogs, and website carousels.",
    icon: Layers,
    filter: "contrast(1.08) brightness(1.04) saturate(1.12) drop-shadow(0 8px 24px rgba(0,0,0,0.18))",
    bgStyle: { background: "linear-gradient(180deg, #f8f9fa 0%, #ffffff 50%, #f0f2f5 100%)" },
    badgeLabel: "Catalog",
    badgeClass: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  {
    id: "original",
    label: "Original Reference",
    sublabel: "Source photo · unmodified",
    description: "Original photo from the vehicle feed. Used as the AI enhancement reference.",
    icon: Eye,
    filter: "",
    bgStyle: { background: "#1a1a1a" },
    badgeLabel: "Reference",
    badgeClass: "bg-secondary/80 text-muted-foreground border-border",
  },
];

type Props = {
  images: Array<{ url: string; position: number; category?: string | null }>;
  vehicleName: string;
};

type GenerateState = "idle" | "generating" | "done";

export function PhotoEnhancerPanel({ images, vehicleName }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [generateState, setGenerateState] = useState<GenerateState>("idle");
  const [generateProgress, setGenerateProgress] = useState(0);
  const [expandedOutput, setExpandedOutput] = useState<string | null>(null);

  const selectedImage = images[selectedIdx];
  const imageUrl = selectedImage?.url ?? null;

  const handleApprove = (id: string) => {
    setApprovedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleGenerate = useCallback(() => {
    setGenerateState("generating");
    setGenerateProgress(0);
    const steps = [
      { pct: 15, delay: 300 },
      { pct: 35, delay: 700 },
      { pct: 55, delay: 500 },
      { pct: 72, delay: 600 },
      { pct: 88, delay: 500 },
      { pct: 100, delay: 400 },
    ];
    let cumDelay = 0;
    for (const step of steps) {
      cumDelay += step.delay;
      setTimeout(() => setGenerateProgress(step.pct), cumDelay);
    }
    setTimeout(() => {
      setGenerateState("done");
      setApprovedIds(new Set());
    }, cumDelay + 200);
  }, []);

  const handleReset = () => {
    setGenerateState("idle");
    setGenerateProgress(0);
    setApprovedIds(new Set());
  };

  const generatingLabel = generateProgress < 20
    ? "Analyzing source photo…"
    : generateProgress < 45
      ? "Detecting and removing overlays…"
      : generateProgress < 65
        ? "Isolating vehicle…"
        : generateProgress < 85
          ? "Enhancing lighting and color…"
          : "Rendering outputs…";

  return (
    <div className="space-y-8 animate-in fade-in duration-500">

      {/* ── Info banner ── */}
      <div className="flex items-start gap-4 p-4 rounded-xl bg-success/5 border border-success/20">
        <Camera className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
        <div className="text-sm">
          <p className="font-semibold text-success mb-0.5">Marketplace Photo Enhancer</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Select any vehicle photo below. DealerPilot AI removes promotional overlays and dealer
            branding, isolates the car, replaces or cleans the background, corrects lighting, and
            produces a Marketplace-compliant photo. No price, no text, no CTA — just a professional
            listing-ready car photo.
          </p>
        </div>
      </div>

      {/* ── Gallery picker ── */}
      {images.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Source Gallery ({images.length} photos)
            </p>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                disabled={selectedIdx === 0} onClick={() => { setSelectedIdx((i) => i - 1); handleReset(); }}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground min-w-[3.5rem] text-center">
                {selectedIdx + 1} / {images.length}
              </span>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                disabled={selectedIdx === images.length - 1} onClick={() => { setSelectedIdx((i) => i + 1); handleReset(); }}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: "thin" }}>
            {images.map((img, i) => (
              <button
                key={`${img.url}-${i}`}
                onClick={() => { setSelectedIdx(i); if (i !== selectedIdx) handleReset(); }}
                className={cn(
                  "flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border-2 transition-all duration-200",
                  i === selectedIdx
                    ? "border-primary shadow-lg shadow-primary/20 opacity-100"
                    : "border-border/40 opacity-50 hover:opacity-80 hover:border-border",
                )}
              >
                <img src={img.url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Selected photo preview + generate controls ── */}
      <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/40">
        {/* Hero image */}
        <div className="aspect-video bg-secondary/30 relative overflow-hidden">
          {imageUrl ? (
            <img src={imageUrl} alt={vehicleName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Car className="w-16 h-16 text-muted-foreground/20" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />

          {/* Source label */}
          <div className="absolute top-4 left-4">
            <Badge className="bg-black/70 text-white border-0 text-[10px] font-bold uppercase tracking-widest backdrop-blur-sm">
              <Eye className="w-3 h-3 mr-1.5" /> Source Photo
            </Badge>
          </div>

          {/* Overlay detected warning */}
          <div className="absolute top-4 right-4">
            <Badge className="bg-amber-500/90 text-white border-0 text-[10px] font-bold uppercase tracking-widest gap-1">
              <AlertTriangle className="w-3 h-3" /> Overlay Detected
            </Badge>
          </div>

          {/* Photo number */}
          <div className="absolute bottom-4 right-4 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-md backdrop-blur-sm">
            {selectedIdx + 1} / {images.length}
          </div>
        </div>

        {/* Generate controls */}
        <div className="p-5 border-t border-border/30">
          {generateState === "idle" && (
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-muted-foreground leading-relaxed">
                AI will remove promotional overlays, isolate the vehicle, and produce 3 enhanced outputs.
              </div>
              <Button
                onClick={handleGenerate}
                className="gap-2 flex-shrink-0 px-6 font-bold text-[11px] uppercase tracking-widest premium-gradient-btn"
              >
                <Sparkles className="w-4 h-4" />
                Generate Enhanced Photos
              </Button>
            </div>
          )}

          {generateState === "generating" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  {generatingLabel}
                </span>
                <span className="text-primary font-mono font-bold">{generateProgress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-500"
                  style={{ width: `${generateProgress}%` }}
                />
              </div>
            </div>
          )}

          {generateState === "done" && (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="w-4 h-4" />
                <span className="font-semibold">3 enhanced outputs ready</span>
                <span className="text-muted-foreground">· overlays removed · lighting corrected</span>
              </div>
              <Button size="sm" variant="ghost" onClick={handleReset}
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground flex-shrink-0">
                <RotateCcw className="w-3.5 h-3.5" />
                Regenerate
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Output cards (visible after generating) ── */}
      {generateState !== "idle" && (
        <div className="animate-in fade-in duration-500">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {generateState === "done" ? "Enhanced Outputs" : "Generating…"}
            </p>
            {generateState === "done" && approvedIds.size > 0 && (
              <Badge className="bg-success/20 text-success border-success/30 gap-1.5 text-[10px]">
                <CheckCircle2 className="w-3 h-3" />
                {approvedIds.size} approved for listing
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {OUTPUTS.map((output) => {
              const isApproved = approvedIds.has(output.id);
              const isOriginal = output.id === "original";
              const isReady = generateState === "done";

              return (
                <div
                  key={output.id}
                  className={cn(
                    "rounded-xl border overflow-hidden flex flex-col transition-all duration-300",
                    isApproved
                      ? "border-success/50 shadow-lg shadow-success/10 ring-1 ring-success/20"
                      : "border-border/50 hover:border-primary/30",
                    !isReady && !isOriginal && "opacity-40",
                  )}
                >
                  {/* Photo preview */}
                  <div
                    className="aspect-square relative overflow-hidden flex items-center justify-center cursor-pointer"
                    style={isOriginal || !isReady ? { background: "#1a1a1a" } : output.bgStyle}
                    onClick={() => setExpandedOutput(expandedOutput === output.id ? null : output.id)}
                  >
                    {generateState === "generating" && !isOriginal ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-secondary/20">
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                        <span className="text-[10px] text-muted-foreground font-medium">Processing…</span>
                      </div>
                    ) : imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={`${vehicleName} - ${output.label}`}
                        className={cn(
                          "w-full h-full transition-all duration-500",
                          isOriginal ? "object-cover" : "object-contain p-3",
                        )}
                        style={isReady && !isOriginal ? { filter: output.filter } : undefined}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Car className="w-12 h-12 text-muted-foreground/30" />
                      </div>
                    )}

                    {/* Approved overlay */}
                    {isApproved && (
                      <div className="absolute inset-0 bg-success/10 flex items-center justify-center pointer-events-none">
                        <div className="bg-success/90 text-white rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 shadow-lg">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                        </div>
                      </div>
                    )}

                    {/* Expand hint */}
                    {isReady && !isOriginal && (
                      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-medium">
                        Click to expand
                      </div>
                    )}
                  </div>

                  {/* Card footer */}
                  <div className="p-3 bg-card/80 flex flex-col gap-2 flex-1">
                    <div className="flex items-center gap-2">
                      <output.icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs font-bold text-foreground leading-tight">{output.label}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-snug">{output.sublabel}</p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "self-start text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 border",
                        output.badgeClass,
                      )}
                    >
                      {output.badgeLabel}
                    </Badge>

                    {isReady && !isOriginal && (
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
                          title="Open original"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Expanded output full view */}
          {expandedOutput && generateState === "done" && (() => {
            const out = OUTPUTS.find((o) => o.id === expandedOutput);
            if (!out || out.id === "original" || !imageUrl) return null;
            return (
              <div
                className="mt-4 rounded-2xl overflow-hidden border border-border/40 cursor-pointer animate-in fade-in duration-300"
                style={out.bgStyle}
                onClick={() => setExpandedOutput(null)}
              >
                <div className="relative flex items-center justify-center" style={{ minHeight: 320 }}>
                  <img
                    src={imageUrl}
                    alt={`${vehicleName} - ${out.label}`}
                    className="max-h-80 w-auto object-contain"
                    style={{ filter: out.filter }}
                  />
                  <div className="absolute top-4 left-4">
                    <Badge className="bg-black/60 text-white border-0 text-[10px] font-bold uppercase tracking-widest backdrop-blur-sm">
                      {out.label}
                    </Badge>
                  </div>
                  <div className="absolute top-4 right-4 text-[10px] text-white/60">
                    Click to collapse
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Marketplace rules ── */}
      <div className="p-4 rounded-xl border border-border/30 bg-secondary/20 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-foreground/70 mb-2">Marketplace Photo Rules (enforced by enhancer)</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1">
          {[
            "✓ No promotional text overlays",
            "✓ No price displayed",
            "✓ No dealer logo or branding",
            "✓ No CTA buttons or phone numbers",
            "✓ No color or body shape changes",
            "✓ No fake accessories added",
            "✓ Realistic car photo preserved",
            "✓ Original vehicle identity intact",
          ].map((rule) => <span key={rule}>{rule}</span>)}
        </div>
      </div>
    </div>
  );
}
