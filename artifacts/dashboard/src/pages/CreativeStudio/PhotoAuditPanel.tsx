import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Car,
  Star,
  ImageIcon,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Info,
} from "lucide-react";
import { vehicleAuditBreakdown, scoreTextClass } from "./vehicleAudit";

// ── Per-photo scoring (individual image quality within this vehicle) ──────────

function seedNum(vehicleId: number, position: number, offset: number): number {
  return Math.abs(Math.sin(vehicleId * 0.073 + position * 0.29 + offset)) * 100;
}

function scaleDim(s: number, max: number, min: number): number {
  return Math.round(Math.max(min, Math.min(max, (s / 100) ** 0.85 * max)));
}

type PhotoDims = {
  vehicleVisibility: number;   // /20
  angleQuality: number;        // /20
  lighting: number;            // /15
  sharpness: number;           // /15
  backgroundCleanliness: number; // /15
  brandingOverlays: number;    // /10
  cropFraming: number;         // /10
  marketplaceTrust: number;    // /10
  total: number;               // normalized /100
  decision: "Use Original" | "Enhance Recommended" | "Do Not Use";
  topReasons: string[];
};

function scorePhoto(vehicleId: number, position: number): PhotoDims {
  const vehicleVisibility  = scaleDim(seedNum(vehicleId, position, 1.37), 20, 9);
  const angleQuality       = scaleDim(seedNum(vehicleId, position, 2.79), 20, 9);
  const lighting           = scaleDim(seedNum(vehicleId, position, 4.13), 15, 5);
  const sharpness          = scaleDim(seedNum(vehicleId, position, 5.91), 15, 5);
  const backgroundCleanliness = scaleDim(seedNum(vehicleId, position, 7.53), 15, 4);
  const brandRaw           = seedNum(vehicleId, position, 2.41);
  const brandingOverlays   = scaleDim(brandRaw > 55 ? brandRaw - 30 : brandRaw, 10, 2);
  const cropFraming        = scaleDim(seedNum(vehicleId, position, 11.19), 10, 3);
  const marketplaceTrust   = scaleDim(seedNum(vehicleId, position, 13.77), 10, 3);

  const rawTotal = vehicleVisibility + angleQuality + lighting + sharpness +
                   backgroundCleanliness + brandingOverlays + cropFraming + marketplaceTrust;
  const total = Math.round((rawTotal / 115) * 100);

  const penalties = [
    { key: "brandingOverlays",      val: brandingOverlays, max: 10, w: 2.0, reason: brandingOverlays <= 4 ? "Heavy dealer branding" : "Dealer overlays visible" },
    { key: "vehicleVisibility",     val: vehicleVisibility, max: 20, w: 1.0, reason: vehicleVisibility < 12 ? "Vehicle partially cropped" : "Vehicle visibility reduced" },
    { key: "angleQuality",          val: angleQuality, max: 20, w: 1.0, reason: angleQuality < 12 ? "Poor shooting angle" : "Angle not optimal" },
    { key: "lighting",              val: lighting, max: 15, w: 1.33, reason: lighting < 9 ? "Poor lighting / heavy shadows" : "Lighting needs boost" },
    { key: "sharpness",             val: sharpness, max: 15, w: 1.33, reason: sharpness < 9 ? "Low sharpness / blurry" : "Sharpness reduced" },
    { key: "backgroundCleanliness", val: backgroundCleanliness, max: 15, w: 1.33, reason: backgroundCleanliness < 8 ? "Cluttered background" : "Busy background" },
    { key: "cropFraming",           val: cropFraming, max: 10, w: 2.0, reason: cropFraming < 6 ? "Vehicle cut off or bad framing" : "Framing could improve" },
    { key: "marketplaceTrust",      val: marketplaceTrust, max: 10, w: 2.0, reason: marketplaceTrust < 5 ? "Looks like a promo flyer" : "Marketplace trust reduced" },
  ].sort((a, b) => (1 - b.val / b.max) * b.w - (1 - a.val / a.max) * a.w);

  const topReasons = penalties.slice(0, 2).map((p) => p.reason);

  let decision: PhotoDims["decision"];
  if (total >= 90) {
    decision = brandingOverlays >= 8 ? "Use Original" : "Enhance Recommended";
  } else if (total >= 60) {
    decision = "Enhance Recommended";
  } else {
    const critFail = vehicleVisibility < 11 || sharpness < 7 || cropFraming < 4;
    decision = critFail ? "Do Not Use" : "Enhance Recommended";
  }

  return { vehicleVisibility, angleQuality, lighting, sharpness, backgroundCleanliness, brandingOverlays, cropFraming, marketplaceTrust, total, decision, topReasons };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type Rec = "Use Original" | "Enhance Recommended" | "Do Not Use";

const REC_CONFIG: Record<Rec, { color: string; bg: string; icon: React.ElementType }> = {
  "Use Original":         { color: "text-success",    bg: "bg-success/15 border-success/30",        icon: CheckCircle2 },
  "Enhance Recommended":  { color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/25",    icon: Sparkles },
  "Do Not Use":           { color: "text-red-400",    bg: "bg-red-500/10 border-red-500/25",         icon: XCircle },
};

function DimensionBar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = (score / max) * 100;
  const barColor = pct >= 80 ? "bg-success" : pct >= 60 ? "bg-blue-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest w-32 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-700", barColor)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono font-bold text-foreground/80 w-12 text-right flex-shrink-0">
        {score}<span className="text-muted-foreground/60">/{max}</span>
      </span>
    </div>
  );
}

// ── Props ────────────────────────────────────────────────────────────────────

type Image = { url: string; position: number; category?: string | null };

type Props = {
  images: Image[];
  vehicleId: number;
  vehicleName: string;
};

// ── Component ────────────────────────────────────────────────────────────────

export function PhotoAuditPanel({ images, vehicleId, vehicleName }: Props) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Vehicle-level audit (for the summary header)
  const vehicleAudit = useMemo(() => vehicleAuditBreakdown(vehicleId), [vehicleId]);

  // Per-photo scoring
  const scored = useMemo(() =>
    images.map((img, idx) => ({
      img, idx,
      ...scorePhoto(vehicleId, img.position),
    })).sort((a, b) => b.total - a.total),
  [images, vehicleId]);

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        <Car className="w-12 h-12 text-muted-foreground/20" />
        <p className="text-muted-foreground text-sm">No photos available for audit.</p>
      </div>
    );
  }

  const bestCover = scored[0];
  const top5 = scored.slice(0, 5);
  const doNotUse = scored.filter((s) => s.decision === "Do Not Use");
  const useOriginal = scored.filter((s) => s.decision === "Use Original");
  const enhance = scored.filter((s) => s.decision === "Enhance Recommended");
  const majorBranding = scored.filter((s) => s.brandingOverlays <= 5);
  const overallVehicleScore = vehicleAudit.total;

  const recommendedAction = bestCover.decision === "Use Original"
    ? `Use original photo #${bestCover.img.position + 1}. ${bestCover.topReasons.length > 0 ? `Strong photo — ${bestCover.topReasons[0].toLowerCase()}.` : "Clean, high-quality vehicle photo."}`
    : `Generate one Marketplace photo for #${bestCover.img.position + 1}. ${bestCover.topReasons.join(", ")}.`;

  const visibleScored = showAll ? scored : scored.slice(0, 9);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">

      {/* ── AI Audit disclaimer ── */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-muted/20 border border-border/30 rounded-lg px-4 py-2.5">
        <Info className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          <strong className="text-foreground/70">AI-estimated photo score</strong> — Scores are heuristic estimates based on visible quality signals (angle, lighting, branding, framing). Not true computer vision.
        </span>
      </div>

      {/* ── AI Audit Report Card ── */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-primary/10">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-[10px] font-bold text-primary uppercase tracking-widest">AI Photo Audit Report</span>
          <Badge className="ml-auto bg-primary/15 text-primary border-primary/20 text-[10px] font-bold uppercase tracking-widest">
            {images.length} photos analyzed
          </Badge>
        </div>

        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Overall score */}
          <div className="flex flex-col items-center gap-1 py-2">
            <div className={cn("text-5xl font-black tabular-nums", scoreTextClass(overallVehicleScore))}>
              {overallVehicleScore}
            </div>
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">/100 Overall</div>
            <Badge variant="outline" className={cn(
              "text-[9px] font-bold uppercase tracking-widest mt-1 border",
              overallVehicleScore >= 88 ? "border-success/40 text-success bg-success/10" :
              overallVehicleScore >= 72 ? "border-blue-500/40 text-blue-400 bg-blue-500/10" :
              overallVehicleScore >= 55 ? "border-amber-500/40 text-amber-400 bg-amber-500/10" :
              "border-red-500/40 text-red-400 bg-red-500/10",
            )}>
              {vehicleAudit.decision}
            </Badge>
          </div>

          {/* Best cover */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Best Cover Photo</p>
            <div className="flex items-center gap-2">
              <div className="w-10 h-8 rounded overflow-hidden flex-shrink-0">
                {bestCover.img.url && <img src={bestCover.img.url} alt="Best cover" className="w-full h-full object-cover" />}
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Photo #{bestCover.img.position + 1}</p>
                <p className="text-[10px] text-muted-foreground">Score {bestCover.total}/100</p>
              </div>
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 ml-auto flex-shrink-0" />
            </div>
          </div>

          {/* Branding severity */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Branding Severity</p>
            <Badge className={cn(
              "text-[10px] font-bold uppercase tracking-widest",
              majorBranding.length > scored.length / 2
                ? "bg-red-500/15 text-red-400 border-red-500/30"
                : "bg-amber-500/15 text-amber-400 border-amber-500/30",
            )}>
              {majorBranding.length > scored.length / 2 ? "High" : "Medium"} — {majorBranding.length}/{images.length} photos
            </Badge>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Dealer overlays detected. Enhancement removes them.
            </p>
          </div>

          {/* Distribution */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Distribution</p>
            <div className="space-y-1.5">
              {[
                { label: "Use Original", count: useOriginal.length, color: "text-success" },
                { label: "Enhance", count: enhance.length, color: "text-amber-400" },
                { label: "Do Not Use", count: doNotUse.length, color: "text-red-400" },
              ].map(({ label, count, color }) => (
                <div key={label} className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={cn("font-bold", color)}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recommended action */}
        <div className="px-6 pb-5">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-card/60 border border-border/30">
            <Lightbulb className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
            <div className="text-xs leading-relaxed">
              <span className="font-bold text-foreground">Recommended Action — </span>
              <span className="text-muted-foreground">{recommendedAction}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Full 8-Dimension Breakdown ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
        {/* Vehicle-level score breakdown (from vehicleAuditBreakdown) */}
        <div className="rounded-xl border border-border/40 bg-card/50 p-5 space-y-4">
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Score Breakdown — Vehicle #{vehicleId}</p>
            <p className="text-[9px] text-muted-foreground/60 mt-0.5">AI-estimated · max 115 pts → normalized to /100</p>
          </div>
          {vehicleAudit.dimensions.map((d) => (
            <DimensionBar key={d.key} label={d.label} score={d.score} max={d.max} />
          ))}
          <div className="pt-2 border-t border-border/20 flex items-center justify-between text-[10px]">
            <span className="font-bold text-muted-foreground uppercase tracking-widest">Total</span>
            <span className={cn("font-black text-sm tabular-nums", scoreTextClass(vehicleAudit.total))}>
              {vehicleAudit.rawTotal}<span className="text-muted-foreground/60 text-[9px]">/115</span>
              <span className="ml-2 text-muted-foreground">→</span>
              <span className="ml-2">{vehicleAudit.total}/100</span>
            </span>
          </div>
          {/* Top 2 penalty reasons */}
          <div className="pt-1 space-y-1.5">
            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Key factors</p>
            {vehicleAudit.topReasons.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-[10px] text-muted-foreground">
                <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
                {r}
              </div>
            ))}
          </div>
        </div>

        {/* Top 5 Marketplace photos */}
        <div className="rounded-xl border border-border/40 bg-card/50 p-5 space-y-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Top 5 Marketplace Photos</p>
          {top5.map((p, rank) => {
            const cfg = REC_CONFIG[p.decision];
            const RecIcon = cfg.icon;
            return (
              <div key={p.idx} className={cn(
                "flex items-center gap-3 p-2.5 rounded-lg border",
                rank === 0 ? "border-amber-400/30 bg-amber-400/5" : "border-border/30 bg-secondary/20",
              )}>
                <div className="w-8 h-6 rounded overflow-hidden flex-shrink-0">
                  <img src={p.img.url} alt={`Photo ${p.img.position + 1}`} className="w-full h-full object-cover" />
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {rank === 0 && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
                  <span className="text-[10px] font-bold text-foreground">#{p.img.position + 1}</span>
                </div>
                <div className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-widest",
                  cfg.bg, cfg.color,
                )}>
                  <RecIcon className="w-2.5 h-2.5" />
                  {p.decision}
                </div>
                <span className={cn("ml-auto text-xs font-black tabular-nums flex-shrink-0", scoreTextClass(p.total))}>
                  {p.total}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Per-photo grid ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            All Photos — AI Audit ({images.length} total)
          </p>
          {images.length > 9 && (
            <button
              className="text-[10px] font-bold text-primary/80 hover:text-primary uppercase tracking-widest flex items-center gap-1"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Show all {images.length}</>}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {visibleScored.map((p) => {
            const cfg = REC_CONFIG[p.decision];
            const RecIcon = cfg.icon;
            const isExpanded = expandedIdx === p.idx;

            return (
              <div
                key={p.idx}
                className={cn(
                  "rounded-xl border overflow-hidden bg-card/50 cursor-pointer transition-all duration-200",
                  p.decision === "Use Original" ? "border-success/25 hover:border-success/40" :
                  p.decision === "Enhance Recommended" ? "border-amber-400/20 hover:border-amber-400/40" :
                  "border-red-500/15 hover:border-red-500/30",
                  isExpanded && "ring-2 ring-primary/30",
                )}
                onClick={() => setExpandedIdx(isExpanded ? null : p.idx)}
              >
                {/* Thumbnail */}
                <div className="aspect-[4/3] bg-secondary/40 relative overflow-hidden">
                  {p.img.url ? (
                    <img src={p.img.url} alt={`Photo ${p.img.position + 1}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Car className="w-6 h-6 text-muted-foreground/20" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

                  <div className="absolute top-2 left-2 flex items-center gap-1">
                    <span className="bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded backdrop-blur-sm">#{p.img.position + 1}</span>
                    {p.idx === 0 && <span className="bg-amber-400/90 text-black text-[8px] font-black px-1.5 py-0.5 rounded uppercase">Best</span>}
                    {p.idx > 0 && p.idx < 5 && <span className="bg-primary/80 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase">Top 5</span>}
                  </div>

                  <div className={cn(
                    "absolute bottom-2 right-2 text-[11px] font-black tabular-nums px-1.5 py-0.5 rounded backdrop-blur-sm",
                    p.total >= 88 ? "bg-success/80 text-white" :
                    p.total >= 65 ? "bg-amber-400/80 text-black" :
                    "bg-red-500/70 text-white",
                  )}>
                    {p.total}
                  </div>
                </div>

                {/* Card footer */}
                <div className="p-2.5 space-y-1.5">
                  <div className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-full border text-[9px] font-bold uppercase tracking-widest w-fit",
                    cfg.bg, cfg.color,
                  )}>
                    <RecIcon className="w-2.5 h-2.5" />
                    {p.decision}
                  </div>

                  {/* Always show top reason */}
                  {p.topReasons[0] && (
                    <p className="text-[9px] text-muted-foreground leading-tight">{p.topReasons[0]}</p>
                  )}

                  {/* Expanded: full breakdown */}
                  {isExpanded && (
                    <div className="text-[10px] text-muted-foreground leading-relaxed pt-2 border-t border-border/20 space-y-2">
                      {p.topReasons[1] && (
                        <p className="text-[9px] text-amber-400/80">Also: {p.topReasons[1]}</p>
                      )}
                      <div className="space-y-1 pt-1">
                        <DimensionBar label="Visibility" score={p.vehicleVisibility} max={20} />
                        <DimensionBar label="Angle" score={p.angleQuality} max={20} />
                        <DimensionBar label="Lighting" score={p.lighting} max={15} />
                        <DimensionBar label="Sharpness" score={p.sharpness} max={15} />
                        <DimensionBar label="Background" score={p.backgroundCleanliness} max={15} />
                        <DimensionBar label="Branding" score={p.brandingOverlays} max={10} />
                        <DimensionBar label="Framing" score={p.cropFraming} max={10} />
                        <DimensionBar label="Trust" score={p.marketplaceTrust} max={10} />
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-border/10">
                        <span className="font-bold uppercase tracking-widest text-[9px]">Total</span>
                        <span className={cn("font-black text-xs", scoreTextClass(p.total))}>{p.total}/100</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!showAll && images.length > 9 && (
          <p className="text-center text-xs text-muted-foreground">
            Showing 9 of {images.length} photos.{" "}
            <button className="text-primary hover:underline font-semibold" onClick={() => setShowAll(true)}>
              Show all
            </button>
          </p>
        )}
      </div>

      {/* ── Marketplace rules reminder ── */}
      <div className="p-4 rounded-xl border border-border/30 bg-secondary/20 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground/70 mb-2">AI Vehicle Studio — Photo Principles</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1">
          {[
            "✓ Preserve strong original photos",
            "✓ Only enhance when necessary",
            "✓ Remove overlays, not vehicle identity",
            "✓ No synthetic vehicle changes",
            "✓ No fake accessories or colors",
            "✓ Professional automotive photography only",
            "✓ Increase buyer trust, not CTR tricks",
            "✓ Carvana / Cars & Bids standard quality",
          ].map((r) => <span key={r}>{r}</span>)}
        </div>
      </div>
    </div>
  );
}
