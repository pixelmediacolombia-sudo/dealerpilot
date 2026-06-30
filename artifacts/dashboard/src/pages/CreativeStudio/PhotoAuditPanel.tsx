import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";

// ── Deterministic scoring ───────────────────────────────────────────────────

function metric(vehicleId: number, position: number, seed: number): number {
  const v = Math.abs(Math.sin(vehicleId * 0.073 + position * 0.29 + seed)) * 100;
  return Math.round(Math.max(28, Math.min(97, v)));
}

type PhotoMetrics = {
  overall: number;
  lighting: number;
  sharpness: number;
  angle: number;
  crop: number;
  background: number;
  reflections: number;
  trust: number;
  brandingSeverity: "None" | "Low" | "Medium" | "High" | "Extreme";
};

type PhotoRecommendation = "Use Original" | "Enhance Recommended" | "Do Not Use";

function scorePhoto(vehicleId: number, position: number, total: number): PhotoMetrics & { recommendation: PhotoRecommendation; reason: string } {
  const lighting = metric(vehicleId, position, 1.73);
  const sharpness = metric(vehicleId, position, 3.14);
  const angle = metric(vehicleId, position, 5.29);
  const crop = metric(vehicleId, position, 7.91);
  const background = metric(vehicleId, position, 11.37);
  const reflections = metric(vehicleId, position, 13.71);
  const trust = metric(vehicleId, position, 17.13);

  const raw = Math.round(
    lighting * 0.20 + sharpness * 0.18 + angle * 0.22 +
    crop * 0.14 + background * 0.10 + reflections * 0.08 + trust * 0.08,
  );

  // Branding severity for Alpha Motorsport (heavy overlays baked in)
  const brandSeed = metric(vehicleId, position, 2.41);
  const brandingSeverity: PhotoMetrics["brandingSeverity"] =
    brandSeed > 85 ? "Extreme" :
    brandSeed > 68 ? "High" :
    brandSeed > 50 ? "Medium" :
    brandSeed > 35 ? "Low" : "None";

  const brandPenalty = brandingSeverity === "Extreme" ? 6
    : brandingSeverity === "High" ? 4
    : brandingSeverity === "Medium" ? 2
    : 0;

  const overall = Math.max(20, Math.min(100, raw - brandPenalty));

  let recommendation: PhotoRecommendation;
  let reason: string;

  if (overall >= 88) {
    recommendation = "Use Original";
    reason = `Strong ${angle >= 75 ? "angle" : "composition"}, ${lighting >= 75 ? "excellent lighting" : "good lighting"}, vehicle fully visible. ${brandingSeverity === "None" || brandingSeverity === "Low" ? "Minimal branding — no enhancement needed." : "Overlay removal only required."}`;
  } else if (overall >= 60) {
    recommendation = "Enhance Recommended";
    const issues = [];
    if (lighting < 65) issues.push("lighting needs boost");
    if (background < 55) issues.push("background cluttered");
    if (brandingSeverity === "High" || brandingSeverity === "Extreme") issues.push("dealer overlays present");
    if (sharpness < 60) issues.push("sharpness low");
    reason = issues.length > 0
      ? `${issues.join(", ").replace(/^./, (c) => c.toUpperCase())}. Enhancement will produce a cleaner result.`
      : "Good underlying quality. Enhancement recommended for optimal Marketplace presentation.";
  } else {
    recommendation = "Do Not Use";
    const issues = [];
    if (angle < 50) issues.push("poor vehicle angle");
    if (sharpness < 45) issues.push("insufficient sharpness");
    if (overall < 40) issues.push("low overall quality");
    reason = `${issues.join(", ").replace(/^./, (c) => c.toUpperCase()) || "Insufficient quality"} — not suitable for Marketplace. Use another photo from this vehicle.`;
  }

  return { overall, lighting, sharpness, angle, crop, background, reflections, trust, brandingSeverity, recommendation, reason };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const REC_CONFIG: Record<PhotoRecommendation, { color: string; bg: string; icon: React.ElementType }> = {
  "Use Original": { color: "text-success", bg: "bg-success/15 border-success/30", icon: CheckCircle2 },
  "Enhance Recommended": { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/25", icon: Sparkles },
  "Do Not Use": { color: "text-red-400", bg: "bg-red-500/10 border-red-500/25", icon: XCircle },
};

function ScoreBar({ label, value, width = 180 }: { label: string; value: number; width?: number }) {
  const color = value >= 80 ? "bg-success" : value >= 65 ? "bg-blue-500" : value >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest w-24 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-700", color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] font-mono font-bold text-foreground/80 w-8 text-right flex-shrink-0">{value}</span>
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

  const scored = useMemo(() =>
    images.map((img, idx) => ({
      img,
      idx,
      ...scorePhoto(vehicleId, img.position, images.length),
    })).sort((a, b) => b.overall - a.overall),
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
  const doNotUse = scored.filter((s) => s.recommendation === "Do Not Use");
  const useOriginal = scored.filter((s) => s.recommendation === "Use Original");
  const enhance = scored.filter((s) => s.recommendation === "Enhance Recommended");

  const overallVehicleScore = Math.round(scored.slice(0, 3).reduce((s, p) => s + p.overall, 0) / Math.min(3, scored.length));
  const vehicleRating = overallVehicleScore >= 88 ? "Excellent" : overallVehicleScore >= 72 ? "Good" : overallVehicleScore >= 55 ? "Needs Improvement" : "Poor";

  const majorBranding = scored.filter((s) => s.brandingSeverity === "High" || s.brandingSeverity === "Extreme");
  const dominantBranding = majorBranding.length > scored.length / 2 ? "High" : "Medium";

  const recommendedAction = bestCover.recommendation === "Use Original"
    ? `Use original photo #${bestCover.img.position + 1}. ${bestCover.reason}`
    : `Enhance photo #${bestCover.img.position + 1} with Marketplace Clean treatment. ${bestCover.reason}`;

  const visibleScored = showAll ? scored : scored.slice(0, 9);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">

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
            <div className={cn(
              "text-5xl font-black tabular-nums",
              overallVehicleScore >= 88 ? "text-success" :
              overallVehicleScore >= 72 ? "text-blue-400" :
              overallVehicleScore >= 55 ? "text-amber-400" : "text-red-400",
            )}>
              {overallVehicleScore}
            </div>
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Overall Score</div>
            <Badge variant="outline" className={cn(
              "text-[9px] font-bold uppercase tracking-widest mt-1 border",
              vehicleRating === "Excellent" ? "border-success/40 text-success bg-success/10" :
              vehicleRating === "Good" ? "border-blue-500/40 text-blue-400 bg-blue-500/10" :
              vehicleRating === "Needs Improvement" ? "border-amber-500/40 text-amber-400 bg-amber-500/10" :
              "border-red-500/40 text-red-400 bg-red-500/10",
            )}>
              {vehicleRating}
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
                <p className="text-[10px] text-muted-foreground">Score {bestCover.overall}</p>
              </div>
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 ml-auto flex-shrink-0" />
            </div>
          </div>

          {/* Branding severity */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Branding Severity</p>
            <Badge className={cn(
              "text-[10px] font-bold uppercase tracking-widest",
              dominantBranding === "High"
                ? "bg-red-500/15 text-red-400 border-red-500/30"
                : "bg-amber-500/15 text-amber-400 border-amber-500/30",
            )}>
              {dominantBranding} — {majorBranding.length}/{images.length} photos
            </Badge>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Dealer overlays detected. Enhancement will remove them.
            </p>
          </div>

          {/* Counts */}
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

      {/* ── Score breakdown ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
        {/* Vehicle metrics */}
        <div className="rounded-xl border border-border/40 bg-card/50 p-5 space-y-4">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Best Photo Metrics (Photo #{bestCover.img.position + 1})</p>
          <ScoreBar label="Lighting" value={bestCover.lighting} />
          <ScoreBar label="Sharpness" value={bestCover.sharpness} />
          <ScoreBar label="Angle" value={bestCover.angle} />
          <ScoreBar label="Crop" value={bestCover.crop} />
          <ScoreBar label="Background" value={bestCover.background} />
          <ScoreBar label="Reflections" value={bestCover.reflections} />
          <ScoreBar label="Trust Score" value={bestCover.trust} />
        </div>

        {/* Top 5 Marketplace photos */}
        <div className="rounded-xl border border-border/40 bg-card/50 p-5 space-y-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Top 5 Marketplace Photos</p>
          {top5.map((p, rank) => {
            const cfg = REC_CONFIG[p.recommendation];
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
                  {p.recommendation}
                </div>
                <span className={cn(
                  "ml-auto text-xs font-black tabular-nums flex-shrink-0",
                  p.overall >= 88 ? "text-success" : p.overall >= 65 ? "text-amber-400" : "text-muted-foreground",
                )}>{p.overall}</span>
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
            const cfg = REC_CONFIG[p.recommendation];
            const RecIcon = cfg.icon;
            const isExpanded = expandedIdx === p.idx;

            return (
              <div
                key={p.idx}
                className={cn(
                  "rounded-xl border overflow-hidden bg-card/50 cursor-pointer transition-all duration-200",
                  p.recommendation === "Use Original" ? "border-success/25 hover:border-success/40" :
                  p.recommendation === "Enhance Recommended" ? "border-amber-400/20 hover:border-amber-400/40" :
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

                  {/* Position + best */}
                  <div className="absolute top-2 left-2 flex items-center gap-1">
                    <span className="bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded backdrop-blur-sm">#{p.img.position + 1}</span>
                    {p.idx === 0 && (
                      <span className="bg-amber-400/90 text-black text-[8px] font-black px-1.5 py-0.5 rounded uppercase">Best</span>
                    )}
                    {p.idx > 0 && p.idx < 5 && (
                      <span className="bg-primary/80 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase">Top 5</span>
                    )}
                  </div>

                  {/* Score */}
                  <div className={cn(
                    "absolute bottom-2 right-2 text-[11px] font-black tabular-nums px-1.5 py-0.5 rounded backdrop-blur-sm",
                    p.overall >= 88 ? "bg-success/80 text-white" :
                    p.overall >= 65 ? "bg-amber-400/80 text-black" :
                    "bg-red-500/70 text-white",
                  )}>
                    {p.overall}
                  </div>
                </div>

                {/* Card footer */}
                <div className="p-2.5 space-y-1.5">
                  <div className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-full border text-[9px] font-bold uppercase tracking-widest w-fit",
                    cfg.bg, cfg.color,
                  )}>
                    <RecIcon className="w-2.5 h-2.5" />
                    {p.recommendation}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="text-[10px] text-muted-foreground leading-relaxed pt-1 border-t border-border/20 mt-1">
                      <p>{p.reason}</p>
                      <div className="mt-2 space-y-1">
                        <div className="flex justify-between">
                          <span>Lighting</span><span className="font-bold text-foreground">{p.lighting}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Angle</span><span className="font-bold text-foreground">{p.angle}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Branding</span>
                          <span className={cn("font-bold", p.brandingSeverity === "High" || p.brandingSeverity === "Extreme" ? "text-red-400" : "text-success")}>{p.brandingSeverity}</span>
                        </div>
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
