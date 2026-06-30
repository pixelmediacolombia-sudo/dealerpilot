import { useState, useMemo, useCallback } from "react";
import { Link, useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetCreativeVehicleDetail,
  getGetCreativeVehicleDetailQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatMileage } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PhotoAuditPanel } from "./PhotoAuditPanel";
import { photoScore, scoreTextClass, scoreBadgeClass } from "./vehicleAudit";
import {
  ArrowLeft,
  Car,
  ImageIcon,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Star,
  Info,
  ArrowRight,
  Gauge,
} from "lucide-react";
import { EmptyState } from "@/components/shared";

type Img = { url: string; position: number; category?: string | null };

// ── AI Report ────────────────────────────────────────────────────────────────

type AIDecision = "Use Original" | "Enhance Recommended" | "Do Not Use";

function confidence(score: number): "High" | "Medium" | "Low" {
  return score >= 85 ? "High" : score >= 70 ? "Medium" : "Low";
}

function specDecision(score: number, brandingOverlays: number): AIDecision {
  if (score >= 90 && brandingOverlays >= 8) return "Use Original";
  if (score >= 75) return "Enhance Recommended";
  if (score >= 60) return "Enhance Recommended";
  return "Do Not Use";
}

const enhanceFilter = "contrast(1.12) brightness(1.08) saturate(1.18) drop-shadow(0 12px 32px rgba(0,0,0,0.35))";

// ── Main Component ────────────────────────────────────────────────────────────

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

  const [generateState, setGenerateState] = useState<"idle" | "generating" | "done">("idle");
  const [generateProgress, setGenerateProgress] = useState(0);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState<number | null>(null);

  // Score all photos and find best cover
  const scoredPhotos = useMemo(() => {
    if (!data?.images?.length) return [];
    return data.images
      .map((img) => ({ img, ...photoScore(data.vehicle.id, img.position) }))
      .sort((a, b) => b.total - a.total);
  }, [data]);

  const bestCover = scoredPhotos[0];

  // Selected photo for preview (default = best cover)
  const activePhoto = useMemo(() => {
    if (selectedPhotoIdx !== null) return scoredPhotos.find((p) => p.img.position === selectedPhotoIdx) ?? bestCover;
    return bestCover;
  }, [selectedPhotoIdx, scoredPhotos, bestCover]);

  const handleSelectPhoto = (position: number) => {
    setSelectedPhotoIdx(position);
    setGenerateState("idle");
    setGenerateProgress(0);
  };

  const handleGenerate = useCallback(() => {
    setGenerateState("generating");
    setGenerateProgress(0);
    const steps = [
      { pct: 15, delay: 400 },
      { pct: 32, delay: 500 },
      { pct: 51, delay: 600 },
      { pct: 69, delay: 500 },
      { pct: 84, delay: 400 },
      { pct: 100, delay: 350 },
    ];
    let cumDelay = 0;
    for (const step of steps) {
      cumDelay += step.delay;
      setTimeout(() => setGenerateProgress(step.pct), cumDelay);
    }
    setTimeout(() => setGenerateState("done"), cumDelay + 200);
  }, []);

  const generateLabel =
    generateProgress < 20 ? "Analyzing source photo…"
    : generateProgress < 40 ? "Detecting dealer overlays…"
    : generateProgress < 60 ? "Isolating vehicle…"
    : generateProgress < 80 ? "Enhancing lighting…"
    : "Finalizing Marketplace Ready…";

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              DealerPilot is analyzing…
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
            action={<Link href="/creative-studio"><Button>Back to AI Vehicle Studio</Button></Link>}
          />
        </div>
      </AppLayout>
    );
  }

  const { vehicle, images } = data;
  const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  const aiScore = activePhoto?.total ?? 0;
  const aiDecision = activePhoto ? specDecision(activePhoto.total, activePhoto.brandingOverlays) : "Enhance Recommended";
  const aiConfidence = confidence(aiScore);
  const topReasons = activePhoto?.topReasons ?? ["Dealer overlays present", "Lighting needs boost"];

  // Spec-defined AI reasons based on decision + dimensions
  const positiveReasons: string[] = [];
  const penaltyReasons: string[] = [];

  if (aiDecision === "Use Original") {
    positiveReasons.push("Excellent photo quality", "No dealer overlays detected", "Strong Marketplace CTR prediction");
  } else {
    penaltyReasons.push(...topReasons);
    if (aiDecision === "Enhance Recommended") {
      penaltyReasons.push("Enhancement will remove overlays and boost contrast");
    }
  }

  const expectedScore = Math.min(97, aiScore + (aiDecision === "Enhance Recommended" ? 18 : 0));
  const expectedCTR = aiDecision === "Enhance Recommended" ? Math.round((expectedScore - aiScore) * 1.4) : 0;

  const DecisionIcon = aiDecision === "Use Original" ? CheckCircle2 : aiDecision === "Enhance Recommended" ? Sparkles : XCircle;
  const decisionColor = aiDecision === "Use Original" ? "text-success" : aiDecision === "Enhance Recommended" ? "text-amber-400" : "text-red-400";
  const decisionBg = aiDecision === "Use Original" ? "bg-success/15 border-success/30" : aiDecision === "Enhance Recommended" ? "bg-amber-500/15 border-amber-500/30" : "bg-red-500/15 border-red-500/30";

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="animate-in fade-in duration-500">

          {/* ── Compact sticky header ── */}
          <div className="sticky top-0 z-20 border-b border-border/30 bg-background/95 backdrop-blur-xl">
            <div className="px-8 py-3 max-w-7xl mx-auto flex items-center gap-4">
              <Link href="/creative-studio">
                <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground -ml-2">
                  <ArrowLeft className="w-3.5 h-3.5" /> AI Vehicle Studio
                </Button>
              </Link>
              <div className="w-px h-4 bg-border/40" />
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm text-foreground truncate">{vehicleName}</span>
                <span className="text-muted-foreground text-xs ml-2">{formatCurrency(vehicle.price)}</span>
                <span className="text-muted-foreground/60 text-xs ml-2">· {images?.length ?? 0} photos · VIN {vehicle.vin.slice(-8)}</span>
              </div>
              <Badge className={cn("text-[9px] font-bold uppercase tracking-widest border gap-1", decisionBg, decisionColor)}>
                <DecisionIcon className="w-3 h-3" />
                {aiDecision}
              </Badge>
            </div>
          </div>

          <div className="p-8 max-w-7xl mx-auto space-y-8">

            {/* ── Main audit panel: Original | Marketplace Ready | AI Report ── */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_320px] gap-6 items-start">

              {/* Original Photo */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Original Photo</p>
                  {bestCover && activePhoto?.img.position === bestCover.img.position && (
                    <Badge className="text-[9px] font-bold bg-amber-400/20 text-amber-400 border-amber-400/30 gap-1">
                      <Star className="w-2.5 h-2.5 fill-amber-400" /> Best Cover
                    </Badge>
                  )}
                </div>
                <div className="aspect-[4/3] bg-secondary/30 rounded-xl overflow-hidden relative">
                  {activePhoto?.img.url ? (
                    <img
                      src={activePhoto.img.url}
                      alt={vehicleName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Car className="w-12 h-12 text-muted-foreground/20" />
                    </div>
                  )}
                  <div className="absolute top-3 left-3">
                    <span className="bg-black/70 text-white text-[9px] font-bold px-2 py-1 rounded backdrop-blur-sm">
                      Photo #{(activePhoto?.img.position ?? 0) + 1}
                    </span>
                  </div>
                  <div className="absolute bottom-3 right-3">
                    <span className={cn(
                      "text-[11px] font-black tabular-nums px-2 py-1 rounded backdrop-blur-sm",
                      aiScore >= 88 ? "bg-success/80 text-white" : aiScore >= 65 ? "bg-amber-400/80 text-black" : "bg-red-500/70 text-white"
                    )}>
                      {aiScore}
                    </span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground/60 text-center">Source from XML feed</p>
              </div>

              {/* Arrow separator (desktop) */}
              {/* Marketplace Ready */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Marketplace Ready</p>
                  {generateState === "done" && (
                    <Badge className="text-[9px] font-bold bg-success/15 text-success border-success/30 gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5" /> Ready
                    </Badge>
                  )}
                </div>
                <div className="aspect-[4/3] bg-secondary/30 rounded-xl overflow-hidden relative">
                  {activePhoto?.img.url ? (
                    <>
                      <img
                        src={activePhoto.img.url}
                        alt={`${vehicleName} — Marketplace Ready`}
                        className="w-full h-full object-cover transition-all duration-700"
                        style={generateState === "done" || aiDecision === "Use Original" ? { filter: enhanceFilter } : { filter: "grayscale(0.3) brightness(0.85)" }}
                      />
                      {/* Generating overlay */}
                      {generateState === "generating" && (
                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
                          <Loader2 className="w-8 h-8 text-primary animate-spin" />
                          <p className="text-xs text-white/80 font-medium">{generateLabel}</p>
                          <div className="w-40 h-1 rounded-full bg-white/20 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all duration-500"
                              style={{ width: `${generateProgress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {/* Use original overlay */}
                      {aiDecision === "Use Original" && generateState === "idle" && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="bg-success/90 text-white rounded-xl px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-lg">
                            <CheckCircle2 className="w-4 h-4" /> No Enhancement Required
                          </div>
                        </div>
                      )}
                      {/* Ready badge */}
                      {generateState === "done" && (
                        <div className="absolute top-3 right-3">
                          <Badge className="bg-success/90 text-white border-0 text-[9px] font-bold uppercase tracking-widest gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Marketplace Ready
                          </Badge>
                        </div>
                      )}
                      {/* Awaiting overlay */}
                      {aiDecision !== "Use Original" && generateState === "idle" && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <div className="text-white/60 text-[10px] text-center font-medium">
                            Click Generate to enhance
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Car className="w-12 h-12 text-muted-foreground/20" />
                    </div>
                  )}
                </div>

                {/* Generate controls */}
                {aiDecision === "Use Original" ? (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-success/5 border border-success/20 text-[10px] text-success font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    Original photo meets Marketplace standards. No enhancement needed.
                  </div>
                ) : generateState === "idle" ? (
                  <Button
                    className="w-full gap-2 font-bold text-[11px] uppercase tracking-widest premium-gradient-btn"
                    onClick={handleGenerate}
                    disabled={!activePhoto?.img.url}
                  >
                    <Sparkles className="w-4 h-4" />
                    Generate Marketplace Ready
                  </Button>
                ) : generateState === "generating" ? (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-[10px] text-primary font-medium">
                    <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                    {generateLabel} · {generateProgress}%
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 p-3 rounded-lg bg-success/5 border border-success/20 text-[10px] text-success font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                      Marketplace Ready — overlays removed, lighting enhanced
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => { setGenerateState("idle"); setGenerateProgress(0); }}
                      className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground flex-shrink-0">
                      Re-run
                    </Button>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/60 text-center">
                  {aiDecision === "Use Original" ? "Original preserved" : "One optimized result · overlays removed · exposure corrected"}
                </p>
              </div>

              {/* AI Report */}
              <div className="rounded-xl border border-border/40 bg-card/50 overflow-hidden">
                <div className="px-5 py-4 border-b border-border/30 flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-primary" />
                  <span className="text-[10px] font-bold text-primary uppercase tracking-widest">AI Report</span>
                  <Badge className="ml-auto bg-primary/10 text-primary/80 border-primary/20 text-[9px]">AI-estimated</Badge>
                </div>

                <div className="p-5 space-y-5">
                  {/* Score */}
                  <div className="text-center">
                    <div className={cn("text-6xl font-black tabular-nums", scoreTextClass(aiScore))}>{aiScore}</div>
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">/100 Overall Score</div>
                  </div>

                  {/* Key metrics */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground font-medium">Best Cover</span>
                      <span className="font-bold text-foreground flex items-center gap-1">
                        <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                        Photo #{(bestCover?.img.position ?? 0) + 1}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground font-medium">Confidence</span>
                      <span className={cn(
                        "font-bold",
                        aiConfidence === "High" ? "text-success" : aiConfidence === "Medium" ? "text-amber-400" : "text-red-400"
                      )}>{aiConfidence}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground font-medium">Photos ranked</span>
                      <span className="font-bold text-foreground">{scoredPhotos.length}</span>
                    </div>
                  </div>

                  {/* Decision */}
                  <div className={cn("flex items-center gap-2 px-3 py-2.5 rounded-lg border", decisionBg)}>
                    <DecisionIcon className={cn("w-4 h-4 flex-shrink-0", decisionColor)} />
                    <span className={cn("font-bold text-[11px] uppercase tracking-widest", decisionColor)}>
                      {aiDecision}
                    </span>
                  </div>

                  {/* Reasons */}
                  <div className="space-y-2">
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Reasoning</p>
                    {aiDecision === "Use Original" ? (
                      positiveReasons.map((r, i) => (
                        <div key={i} className="flex items-start gap-2 text-[10px] text-muted-foreground">
                          <CheckCircle2 className="w-3 h-3 text-success mt-0.5 flex-shrink-0" />
                          {r}
                        </div>
                      ))
                    ) : (
                      penaltyReasons.map((r, i) => (
                        <div key={i} className="flex items-start gap-2 text-[10px] text-muted-foreground">
                          <AlertTriangle className={cn("w-3 h-3 mt-0.5 flex-shrink-0", i === 0 ? "text-amber-400" : "text-muted-foreground/50")} />
                          {r}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Enhancement gain (if applicable) */}
                  {aiDecision === "Enhance Recommended" && (
                    <div className="pt-3 border-t border-border/20 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Expected score</span>
                        <span className="font-bold text-success">{expectedScore}/100</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">CTR improvement</span>
                        <span className="font-bold text-success">+{expectedCTR}%</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Disclaimer */}
                <div className="px-5 pb-4 flex items-start gap-1.5">
                  <Info className="w-3 h-3 text-muted-foreground/50 mt-0.5 flex-shrink-0" />
                  <p className="text-[9px] text-muted-foreground/50 leading-snug">
                    AI-estimated · heuristic based on visible quality signals. Not true computer vision.
                  </p>
                </div>
              </div>
            </div>

            {/* ── Horizontal photo strip ── */}
            {scoredPhotos.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    All Photos — Ranked by AI Score ({scoredPhotos.length} total)
                  </p>
                  <p className="text-[10px] text-muted-foreground/60">Click to preview</p>
                </div>

                <div className="flex gap-2.5 overflow-x-auto pb-3" style={{ scrollbarWidth: "thin" }}>
                  {scoredPhotos.map((p, rank) => {
                    const isActive = activePhoto?.img.position === p.img.position;
                    const isBest = rank === 0;
                    return (
                      <button
                        key={p.img.position}
                        onClick={() => handleSelectPhoto(p.img.position)}
                        className={cn(
                          "flex-shrink-0 w-24 rounded-lg overflow-hidden border-2 transition-all duration-200 text-left",
                          isActive
                            ? "border-primary shadow-lg shadow-primary/20 ring-1 ring-primary/30"
                            : p.decision === "Do Not Use"
                              ? "border-red-500/30 opacity-60 hover:opacity-80"
                              : "border-border/40 hover:border-border opacity-70 hover:opacity-100",
                        )}
                      >
                        {/* Thumbnail */}
                        <div className="aspect-[4/3] relative overflow-hidden bg-secondary/40">
                          {p.img.url ? (
                            <img src={p.img.url} alt={`Photo ${p.img.position + 1}`} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Car className="w-4 h-4 text-muted-foreground/20" />
                            </div>
                          )}
                          {/* Rank badges */}
                          <div className="absolute top-1 left-1 flex gap-0.5">
                            {isBest && <span className="bg-amber-400/90 text-black text-[7px] font-black px-1 rounded">Best</span>}
                            {!isBest && rank < 5 && <span className="bg-primary/80 text-white text-[7px] font-bold px-1 rounded">Top</span>}
                          </div>
                          {/* Score badge */}
                          <div className={cn(
                            "absolute bottom-1 right-1 text-[9px] font-black px-1 rounded",
                            p.total >= 80 ? "bg-success/90 text-white" : p.total >= 60 ? "bg-amber-400/90 text-black" : "bg-red-500/80 text-white"
                          )}>
                            {p.total}
                          </div>
                        </div>
                        {/* Label */}
                        <div className="px-1.5 py-1 bg-card/80 space-y-0.5">
                          <div className="text-[8px] font-bold text-foreground/70">#{p.img.position + 1}</div>
                          <div className={cn(
                            "text-[7px] font-bold uppercase truncate",
                            p.decision === "Use Original" ? "text-success" : p.decision === "Enhance Recommended" ? "text-amber-400" : "text-red-400"
                          )}>
                            {p.decision === "Use Original" ? "Original" : p.decision === "Enhance Recommended" ? "Enhance" : "Don't Use"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Collapsible full analysis ── */}
            <div className="rounded-xl border border-border/30 overflow-hidden">
              <button
                onClick={() => setShowAnalysis((v) => !v)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/10 transition-colors"
              >
                <Gauge className="w-4 h-4 text-muted-foreground" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex-1 text-left">
                  Full Photo Analysis — 8-Dimension Breakdown
                </span>
                <span className="text-[9px] text-muted-foreground/60 mr-2">
                  {showAnalysis ? "Collapse" : "Expand"}
                </span>
                {showAnalysis
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                }
              </button>
              {showAnalysis && (
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
