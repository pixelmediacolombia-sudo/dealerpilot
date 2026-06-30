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
  Star,
  ListChecks,
  X,
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
    id: "marketplace-clean",
    label: "Marketplace Clean",
    sublabel: "Overlays removed · natural lot setting",
    description: "Dealer overlays, banners, and promotional text removed. Natural dealership environment preserved. Listing-ready.",
    icon: Wand2,
    filter: "contrast(1.1) brightness(1.07) saturate(1.14) drop-shadow(0 10px 28px rgba(0,0,0,0.4))",
    bgStyle: { background: "linear-gradient(165deg, #dce6ed 0%, #b8ccd8 50%, #c8dae6 100%)" },
    badgeLabel: "Listing Ready",
    badgeClass: "bg-success/20 text-success border-success/30",
  },
  {
    id: "luxury-studio",
    label: "Luxury Studio",
    sublabel: "Dark backdrop · premium lighting",
    description: "Vehicle isolated on a dark luxury studio backdrop with professional automotive lighting. BMW/Porsche grade quality.",
    icon: Sparkles,
    filter: "contrast(1.18) brightness(1.1) saturate(1.22) drop-shadow(0 20px 50px rgba(0,0,0,0.75))",
    bgStyle: { background: "radial-gradient(ellipse at 50% 60%, #181c28 0%, #0c0f18 55%, #060810 100%)" },
    badgeLabel: "Luxury",
    badgeClass: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  },
  {
    id: "white-catalog",
    label: "White Catalog",
    sublabel: "Pure white · catalog style",
    description: "Vehicle on pure white background. Industry-standard catalog presentation. Ideal for inventory listings and print.",
    icon: Layers,
    filter: "contrast(1.07) brightness(1.03) saturate(1.1) drop-shadow(0 8px 24px rgba(0,0,0,0.15))",
    bgStyle: { background: "linear-gradient(180deg, #fafbfc 0%, #ffffff 50%, #f2f4f7 100%)" },
    badgeLabel: "Catalog",
    badgeClass: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  {
    id: "outdoor-premium",
    label: "Outdoor Premium",
    sublabel: "Natural outdoor · premium sky",
    description: "Vehicle placed in a premium outdoor setting with natural sky. Automotive-editorial quality. High buyer trust.",
    icon: Camera,
    filter: "contrast(1.12) brightness(1.08) saturate(1.2) drop-shadow(0 12px 32px rgba(0,0,0,0.35))",
    bgStyle: { background: "linear-gradient(180deg, #7ab8e8 0%, #4a8fc4 25%, #8ebcd9 60%, #c4dce8 100%)" },
    badgeLabel: "Editorial",
    badgeClass: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  },
  {
    id: "gray-studio",
    label: "Gray Studio",
    sublabel: "Neutral gray · professional",
    description: "Vehicle on a neutral gray studio backdrop. Clean, professional presentation. AutoTrader/Cars.com quality standard.",
    icon: Eye,
    filter: "contrast(1.09) brightness(1.05) saturate(1.12) drop-shadow(0 10px 28px rgba(0,0,0,0.3))",
    bgStyle: { background: "radial-gradient(ellipse at 50% 55%, #4a5060 0%, #3a3f4a 50%, #2e3240 100%)" },
    badgeLabel: "Professional",
    badgeClass: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  },
  {
    id: "black-studio",
    label: "Black Studio",
    sublabel: "Dramatic black · showroom",
    description: "Vehicle on a deep black backdrop with dramatic studio lighting. Maximum visual impact for luxury and sports vehicles.",
    icon: Sparkles,
    filter: "contrast(1.2) brightness(1.12) saturate(1.25) drop-shadow(0 20px 48px rgba(0,0,0,0.9))",
    bgStyle: { background: "radial-gradient(ellipse at 50% 50%, #121418 0%, #080a0d 55%, #030406 100%)" },
    badgeLabel: "Showroom",
    badgeClass: "bg-zinc-400/20 text-zinc-300 border-zinc-400/25",
  },
  {
    id: "transparent-png",
    label: "Transparent PNG",
    sublabel: "Isolated vehicle · transparent",
    description: "Vehicle isolated with transparent background. Use in custom layouts, websites, or multi-image composites.",
    icon: Layers,
    filter: "contrast(1.05) brightness(1.02) saturate(1.08)",
    bgStyle: {
      backgroundImage: "repeating-conic-gradient(#2a2a2a 0% 25%, #1a1a1a 0% 50%)",
      backgroundSize: "20px 20px",
    },
    badgeLabel: "Transparent",
    badgeClass: "bg-primary/20 text-primary border-primary/30",
  },
];

type Props = {
  images: Array<{ url: string; position: number; category?: string | null }>;
  vehicleName: string;
};

type GenerateState = "idle" | "generating" | "done";

type OutputActions = {
  approved: boolean;
  usedAsCover: boolean;
  usedForListing: boolean;
};

export function PhotoEnhancerPanel({ images, vehicleName }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [outputActions, setOutputActions] = useState<Record<string, OutputActions>>({});
  const [generateState, setGenerateState] = useState<GenerateState>("idle");
  const [generateProgress, setGenerateProgress] = useState(0);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const selectedImage = images[selectedIdx];
  const imageUrl = selectedImage?.url ?? null;

  const getActions = (id: string): OutputActions =>
    outputActions[id] ?? { approved: false, usedAsCover: false, usedForListing: false };

  const setAction = (id: string, key: keyof OutputActions, val: boolean) =>
    setOutputActions((prev) => ({
      ...prev,
      [id]: { ...getActions(id), ...prev[id], [key]: val },
    }));

  const handleGenerate = useCallback(() => {
    setGenerateState("generating");
    setGenerateProgress(0);
    setOutputActions({});
    const steps = [
      { pct: 12, delay: 400 },
      { pct: 28, delay: 600 },
      { pct: 47, delay: 500 },
      { pct: 63, delay: 600 },
      { pct: 79, delay: 500 },
      { pct: 91, delay: 400 },
      { pct: 100, delay: 350 },
    ];
    let cumDelay = 0;
    for (const step of steps) {
      cumDelay += step.delay;
      setTimeout(() => setGenerateProgress(step.pct), cumDelay);
    }
    setTimeout(() => setGenerateState("done"), cumDelay + 200);
  }, []);

  const handleReset = () => {
    setGenerateState("idle");
    setGenerateProgress(0);
    setOutputActions({});
  };

  const generatingLabel =
    generateProgress < 20 ? "Analyzing source photo…"
    : generateProgress < 40 ? "Detecting dealer overlays…"
    : generateProgress < 60 ? "Isolating vehicle…"
    : generateProgress < 78 ? "Enhancing lighting and color…"
    : generateProgress < 93 ? "Rendering 7 outputs…"
    : "Finalizing…";

  const totalApproved = Object.values(outputActions).filter((a) => a.approved).length;

  const lightboxOutput = lightboxId ? OUTPUTS.find((o) => o.id === lightboxId) : null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">

      {/* ── Info banner ── */}
      <div className="flex items-start gap-4 p-4 rounded-xl bg-success/5 border border-success/20">
        <Camera className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
        <div className="text-sm">
          <p className="font-semibold text-success mb-0.5">AI Vehicle Studio — Enhanced Photos</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Select a source photo. DealerPilot AI removes promotional overlays and dealer branding,
            isolates the vehicle, and generates 7 premium Marketplace-ready outputs. No price, no
            CTA, no marketing graphics — professional automotive photography only.
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
              <Button
                size="sm" variant="ghost" className="h-7 w-7 p-0"
                disabled={selectedIdx === 0}
                onClick={() => { setSelectedIdx((i) => i - 1); handleReset(); }}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground min-w-[3.5rem] text-center">
                {selectedIdx + 1} / {images.length}
              </span>
              <Button
                size="sm" variant="ghost" className="h-7 w-7 p-0"
                disabled={selectedIdx === images.length - 1}
                onClick={() => { setSelectedIdx((i) => i + 1); handleReset(); }}
              >
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

      {/* ── Hero preview + generate controls ── */}
      <div className="rounded-2xl border border-border/50 overflow-hidden bg-card/40">
        <div className="aspect-video bg-secondary/30 relative overflow-hidden">
          {imageUrl ? (
            <img src={imageUrl} alt={vehicleName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Car className="w-16 h-16 text-muted-foreground/20" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
          <div className="absolute top-4 left-4">
            <Badge className="bg-black/70 text-white border-0 text-[10px] font-bold uppercase tracking-widest backdrop-blur-sm">
              <Eye className="w-3 h-3 mr-1.5" /> Source Photo {selectedIdx + 1}
            </Badge>
          </div>
          <div className="absolute top-4 right-4">
            <Badge className="bg-amber-500/90 text-white border-0 text-[10px] font-bold uppercase tracking-widest gap-1">
              <AlertTriangle className="w-3 h-3" /> Overlay Detected
            </Badge>
          </div>
        </div>

        <div className="p-5 border-t border-border/30">
          {generateState === "idle" && (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                AI will remove overlays, isolate the vehicle, and produce <strong className="text-foreground">7 premium outputs</strong>.
              </p>
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
                <span className="font-semibold">7 outputs ready</span>
                {totalApproved > 0 && (
                  <span className="text-muted-foreground">· {totalApproved} approved</span>
                )}
              </div>
              <Button
                size="sm" variant="ghost" onClick={handleReset}
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Regenerate
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Output grid ── */}
      {generateState !== "idle" && (
        <div className="animate-in fade-in duration-500">
          <div className="flex items-center justify-between mb-5">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {generateState === "done" ? `Enhanced Outputs (${OUTPUTS.length})` : "Generating…"}
            </p>
            {generateState === "done" && totalApproved > 0 && (
              <Badge className="bg-success/20 text-success border-success/30 gap-1.5 text-[10px]">
                <CheckCircle2 className="w-3 h-3" />
                {totalApproved} approved for listing
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {OUTPUTS.map((output) => {
              const actions = getActions(output.id);
              const isReady = generateState === "done";
              const isGenerating = generateState === "generating";

              return (
                <div
                  key={output.id}
                  className={cn(
                    "rounded-xl border overflow-hidden flex flex-col transition-all duration-300",
                    actions.approved
                      ? "border-success/50 shadow-lg shadow-success/10 ring-1 ring-success/20"
                      : "border-border/50 hover:border-primary/30",
                    isGenerating && "opacity-40",
                  )}
                >
                  {/* Photo preview */}
                  <div
                    className="aspect-square relative overflow-hidden flex items-center justify-center cursor-pointer group"
                    style={isReady ? output.bgStyle : { background: "#1a1a1a" }}
                    onClick={() => isReady && setLightboxId(output.id)}
                  >
                    {isGenerating ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-secondary/20">
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                        <span className="text-[10px] text-muted-foreground font-medium">Processing…</span>
                      </div>
                    ) : imageUrl ? (
                      <>
                        <img
                          src={imageUrl}
                          alt={`${vehicleName} - ${output.label}`}
                          className="w-full h-full object-contain p-2 transition-all duration-500 group-hover:scale-105"
                          style={isReady ? { filter: output.filter } : undefined}
                        />
                        {isReady && (
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                            <span className="text-[10px] text-white/80 bg-black/50 px-2 py-1 rounded backdrop-blur-sm">
                              Click to expand
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <Car className="w-12 h-12 text-muted-foreground/30" />
                    )}

                    {/* Approved overlay */}
                    {actions.approved && (
                      <div className="absolute inset-0 bg-success/10 flex items-center justify-center pointer-events-none">
                        <div className="bg-success/90 text-white rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 shadow-lg">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="p-3 bg-card/80 flex flex-col gap-2.5 flex-1">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <output.icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="text-xs font-bold text-foreground leading-tight">{output.label}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-snug pl-5">{output.sublabel}</p>
                    </div>

                    <Badge
                      variant="outline"
                      className={cn("self-start text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 border", output.badgeClass)}
                    >
                      {output.badgeLabel}
                    </Badge>

                    {/* Action buttons */}
                    {isReady && (
                      <div className="flex flex-col gap-1.5 pt-1 border-t border-border/20">
                        {/* Row 1: Approve + Download */}
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className={cn(
                              "flex-1 h-7 text-[9px] gap-1 font-bold uppercase tracking-widest transition-all",
                              actions.approved
                                ? "border-success/40 text-success bg-success/10 hover:bg-success/20"
                                : "border-border/50 hover:border-primary/40 hover:text-primary",
                            )}
                            onClick={() => setAction(output.id, "approved", !actions.approved)}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {actions.approved ? "Approved" : "Approve"}
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground flex-shrink-0"
                            title="Download"
                            onClick={() => imageUrl && window.open(imageUrl, "_blank")}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                        </div>

                        {/* Row 2: Use as Cover */}
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn(
                            "h-7 text-[9px] gap-1 font-bold uppercase tracking-widest transition-all w-full",
                            actions.usedAsCover
                              ? "border-amber-400/40 text-amber-400 bg-amber-400/10"
                              : "border-border/40 text-muted-foreground hover:text-amber-400 hover:border-amber-400/30",
                          )}
                          onClick={() => setAction(output.id, "usedAsCover", !actions.usedAsCover)}
                        >
                          <Star className={cn("w-3 h-3", actions.usedAsCover && "fill-amber-400")} />
                          {actions.usedAsCover ? "Cover Photo Set" : "Use as Cover Photo"}
                        </Button>

                        {/* Row 3: Use for Listing */}
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn(
                            "h-7 text-[9px] gap-1 font-bold uppercase tracking-widest transition-all w-full",
                            actions.usedForListing
                              ? "border-primary/40 text-primary bg-primary/10"
                              : "border-border/40 text-muted-foreground hover:text-primary hover:border-primary/30",
                          )}
                          onClick={() => setAction(output.id, "usedForListing", !actions.usedForListing)}
                        >
                          <ListChecks className="w-3 h-3" />
                          {actions.usedForListing ? "Added to Listing" : "Use for Listing"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Marketplace rules ── */}
      <div className="p-4 rounded-xl border border-border/30 bg-secondary/20 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground/70 mb-2">Marketplace Photo Rules (enforced by AI Vehicle Studio)</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1">
          {[
            "✓ No promotional text overlays",
            "✓ No price displayed",
            "✓ No dealer logo or branding",
            "✓ No CTA or phone numbers",
            "✓ No vehicle color changes",
            "✓ No fake accessories added",
            "✓ Original vehicle identity preserved",
            "✓ BMW / Carvana / Cars & Bids standard",
          ].map((rule) => <span key={rule}>{rule}</span>)}
        </div>
      </div>

      {/* ── Lightbox ── */}
      {lightboxOutput && imageUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-8 animate-in fade-in duration-200"
          onClick={() => setLightboxId(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/50 hover:text-white"
            onClick={() => setLightboxId(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <div className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-4">
            {lightboxOutput.label}
          </div>
          <div
            className="rounded-2xl overflow-hidden flex items-center justify-center p-6"
            style={{ ...lightboxOutput.bgStyle, maxWidth: 700, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={imageUrl}
              alt={vehicleName}
              className="max-h-[60vh] w-auto object-contain"
              style={{ filter: lightboxOutput.filter }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
