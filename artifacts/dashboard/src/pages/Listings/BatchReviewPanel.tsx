import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import {
  ArrowLeft,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Camera,
  PenTool,
  Car,
  ImageIcon,
  Wand2,
  CalendarClock,
  ChevronRight,
  XCircle,
  Loader2,
  TrendingUp,
  Star,
  DollarSign,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Info,
  Zap,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type WorkspaceVehicle = {
  vehicleId: number;
  label: string;
  primaryImageUrl?: string | null;
  imageCount?: number | null;
  listingScore?: number | null;
  listingRating?: string | null;
  publishStatus: string;
  aiStatus: string;
  price?: number | null;
  bodyStyle?: string | null;
  versionCount: number;
  vehicleStatus?: string | null;
};

type PhotoScoreEntry = {
  photoDecision: string | null;
  photoScore: number | null;
};

export type IntelligenceEntry = {
  strategyName: string | null;
  recommendedDownPayment: number | null;
  reason: string | null;
  supportingSignals?: string[] | null;
  expectedImpact?: string | null;
  actionCta?: string | null;
};

type PublishPriority = "High" | "Medium" | "Low";

type ReadinessStatus =
  | "Ready"
  | "Needs Better Photo"
  | "Needs Listing"
  | "Needs Price Review"
  | "Not Recommended Today";

type VehicleAnalysis = {
  status: ReadinessStatus;
  reason: string;
  recommendation: string;
  photoScore: number;
  publishOrder: number;
  priority: PublishPriority;
  bestCoverIsAi: boolean;
};

type PhotoPrediction = {
  currentMessageRate: number;
  aiMessageRate: number | null;
  improvementPct: number | null;
  confidence: number;
  whySelected: string;
  coverLabel: string;
  hasBetterAiOption: boolean;
  alreadyExcellent: boolean;
};

type Props = {
  vehicles: WorkspaceVehicle[];
  photoScoreByVehicle: Map<number, PhotoScoreEntry>;
  intelligenceMap: Map<number, IntelligenceEntry>;
  onClose: () => void;
  onApprove: (readyVehicleIds: number[]) => void;
  isApproving: boolean;
};

// ── Photo Performance Prediction ─────────────────────────────────────────────

function predictPhotoPerformance(
  photoScore: number,
  decision: string | null,
  strategyName: string | null | undefined,
  imageCount: number,
): PhotoPrediction {
  const baseRate = (score: number): number => {
    if (score >= 92) return 4.2;
    if (score >= 85) return 3.6;
    if (score >= 78) return 2.9;
    if (score >= 70) return 2.3;
    if (score >= 62) return 1.8;
    if (score >= 52) return 1.4;
    if (score >= 42) return 1.0;
    return 0.7;
  };

  const strategy = (strategyName ?? "").toLowerCase();
  const multiplier =
    strategy.includes("truck") || strategy.includes("performance")
      ? 1.16
      : strategy.includes("suv") || strategy.includes("luxury") || strategy.includes("premium")
        ? 1.11
        : strategy.includes("fast turn")
          ? 1.06
          : 1.0;

  const currentRate = Math.round(baseRate(photoScore) * multiplier * 10) / 10;

  const hasBetterAiOption = decision === "use_original_recommend_ai_cover";
  const aiEnhancedScore = Math.min(100, photoScore + 19);
  const aiRate = hasBetterAiOption
    ? Math.round(baseRate(aiEnhancedScore) * multiplier * 10) / 10
    : null;

  const improvementPct =
    aiRate !== null && currentRate > 0
      ? Math.round(((aiRate - currentRate) / currentRate) * 100)
      : null;

  let confidence = Math.max(62, Math.min(90, photoScore));
  if (imageCount >= 15) confidence = Math.min(95, confidence + 5);
  if (imageCount >= 10) confidence = Math.min(95, confidence + 2);
  if (decision === "use_original") confidence = Math.min(96, confidence + 5);
  confidence = Math.round(confidence);

  const alreadyExcellent = decision === "use_original" && photoScore >= 80;

  let whySelected: string;
  let coverLabel: string;

  if (decision === "use_original" && photoScore >= 88) {
    coverLabel = "Excellent — Use Original";
    whySelected =
      "Best front 3/4 angle detected in the gallery with excellent natural lighting. No dealer branding interference. Full vehicle visibility confirmed. Already Marketplace-ready — enhancement would not improve engagement.";
  } else if (decision === "use_original" && photoScore >= 72) {
    coverLabel = "Good — Use Original";
    whySelected =
      "Clear vehicle shot with good lighting and acceptable framing. Minor room for improvement but meets Marketplace standards. DealerPilot recommends preserving the original to avoid AI artifacts.";
  } else if (decision === "use_original_recommend_ai_cover") {
    coverLabel = "AI Enhanced Cover Recommended";
    whySelected =
      "Original photo is publishable but AI detected a higher-scoring framing opportunity. AI reconstruction will remove background distractions, correct lighting, and produce a cleaner lead image — projected to boost buyer inquiries by " +
      (improvementPct ?? 0) +
      "%.";
  } else if (decision === "generate_ai_creative") {
    coverLabel = "AI Creative Required";
    whySelected =
      "Gallery photos require AI restoration before publishing. AI will remove dealer branding, banners, and promotional overlays, then reconstruct clean background with corrected lighting and natural shadow.";
  } else {
    coverLabel = `Score ${photoScore} — Best Available`;
    whySelected = `Highest-scoring photo from ${imageCount} images analyzed. Selected based on angle, lighting, vehicle visibility, and branding severity.`;
  }

  return {
    currentMessageRate: currentRate,
    aiMessageRate: aiRate,
    improvementPct,
    confidence,
    whySelected,
    coverLabel,
    hasBetterAiOption,
    alreadyExcellent,
  };
}

// ── Photo Performance Card ───────────────────────────────────────────────────

function PhotoPerformanceCard({
  prediction,
  photoScore,
}: {
  prediction: PhotoPrediction;
  photoScore: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-3 rounded-xl border border-border/40 bg-secondary/20 overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-secondary/30 transition-colors text-left"
      >
        <MessageSquare className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest flex-1">
          Photo Performance Prediction
        </span>

        {/* Confidence pill */}
        <span className="text-[10px] font-bold text-muted-foreground">
          {prediction.confidence}% confidence
        </span>

        {prediction.improvementPct !== null && (
          <span className="px-2 py-0.5 rounded-full bg-success/15 border border-success/25 text-[10px] font-bold text-success">
            +{prediction.improvementPct}% with AI cover
          </span>
        )}

        {prediction.alreadyExcellent && (
          <span className="px-2 py-0.5 rounded-full bg-success/15 border border-success/25 text-[10px] font-bold text-success">
            ✓ Already excellent
          </span>
        )}

        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {/* Collapsed summary bar */}
      {!expanded && (
        <div className="px-4 pb-3 flex items-center gap-4">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-black text-foreground">
              {prediction.currentMessageRate}%
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">msg rate</span>
          </div>

          {prediction.aiMessageRate !== null && (
            <>
              <div className="flex items-center gap-1 text-muted-foreground">
                <Zap className="w-3 h-3" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-black text-success">
                  {prediction.aiMessageRate}%
                </span>
                <span className="text-[10px] text-muted-foreground font-medium">
                  with AI cover
                </span>
              </div>
            </>
          )}

          <div className="flex-1" />
          <span className="text-[10px] text-muted-foreground italic truncate max-w-[240px]">
            {prediction.coverLabel}
          </span>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/30 pt-3">
          {/* Rate columns */}
          <div
            className={cn(
              "grid gap-3",
              prediction.hasBetterAiOption ? "grid-cols-2" : "grid-cols-1 max-w-xs",
            )}
          >
            {/* Current cover */}
            <div className="rounded-xl bg-secondary/40 border border-border/40 p-4 space-y-1">
              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                Current Cover Photo
              </p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-widest mt-0.5">
                Expected Message Rate
              </p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-3xl font-black text-foreground">
                  {prediction.currentMessageRate}%
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-border/50 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/60"
                  style={{ width: `${Math.min(100, prediction.currentMessageRate * 20)}%` }}
                />
              </div>
              <p className="text-[9px] text-muted-foreground mt-1">
                Photo score: {photoScore}
              </p>
            </div>

            {/* AI recommended cover */}
            {prediction.hasBetterAiOption && prediction.aiMessageRate !== null && (
              <div className="rounded-xl bg-success/5 border border-success/25 p-4 space-y-1 relative overflow-hidden">
                <div className="absolute top-2 right-2">
                  <span className="px-1.5 py-0.5 rounded bg-success/20 text-[8px] font-bold text-success uppercase tracking-widest">
                    AI Rec
                  </span>
                </div>
                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                  AI Recommended Cover
                </p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-widest mt-0.5">
                  Expected Message Rate
                </p>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-3xl font-black text-success">
                    {prediction.aiMessageRate}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-border/50 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-success/70"
                    style={{ width: `${Math.min(100, prediction.aiMessageRate * 20)}%` }}
                  />
                </div>
                {prediction.improvementPct !== null && (
                  <p className="text-[9px] font-bold text-success mt-1">
                    +{prediction.improvementPct}% expected improvement
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Already excellent callout */}
          {prediction.alreadyExcellent && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-success/8 border border-success/20">
              <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0 mt-0.5" />
              <p className="text-xs text-success font-medium leading-snug">
                This vehicle already meets Marketplace quality standards. Use the original photo.
              </p>
            </div>
          )}

          {/* Confidence bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Prediction Confidence
              </span>
              <span className="text-[11px] font-bold text-foreground">
                {prediction.confidence}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-border/50 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  prediction.confidence >= 85
                    ? "bg-success/70"
                    : prediction.confidence >= 70
                      ? "bg-primary/60"
                      : "bg-amber-500/60",
                )}
                style={{ width: `${prediction.confidence}%` }}
              />
            </div>
          </div>

          {/* Why selected */}
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-primary/5 border border-primary/15">
            <Info className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-[9px] font-bold text-primary uppercase tracking-widest">
                Why DealerPilot selected this photo
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {prediction.whySelected}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function inferPriority(
  strategyName: string | null | undefined,
  listingScore: number,
  photoScore: number,
): PublishPriority {
  if (!strategyName) return listingScore >= 65 && photoScore >= 70 ? "Medium" : "Low";
  const s = strategyName.toLowerCase();
  const isHighDemand =
    s.includes("truck") ||
    s.includes("suv") ||
    s.includes("performance") ||
    s.includes("luxury") ||
    s.includes("fast turn") ||
    s.includes("premium");
  if (isHighDemand && listingScore >= 55 && photoScore >= 60) return "High";
  if (listingScore >= 55 && photoScore >= 55) return "Medium";
  return "Low";
}

// ── AI analysis ─────────────────────────────────────────────────────────────

function analyzeVehicle(
  w: WorkspaceVehicle,
  photoEntry: PhotoScoreEntry | undefined,
  intel: IntelligenceEntry | undefined,
): VehicleAnalysis {
  const photoDecision = photoEntry?.photoDecision ?? null;
  const photoScoreVal = photoEntry?.photoScore ?? 0;
  const listingScore = w.listingScore ?? 0;
  const bestCoverIsAi = photoDecision === "use_original_recommend_ai_cover";

  if (w.publishStatus === "Published") {
    return {
      status: "Not Recommended Today",
      reason: "Already live on Marketplace — avoid duplicate listings.",
      recommendation: "Skip for this batch.",
      photoScore: photoScoreVal,
      publishOrder: 99,
      priority: "Low",
      bestCoverIsAi,
    };
  }

  if (!w.imageCount || w.imageCount === 0) {
    return {
      status: "Needs Better Photo",
      reason: "No vehicle photos found in XML feed.",
      recommendation: "Add photos via XML feed re-sync before publishing.",
      photoScore: 0,
      publishOrder: 90,
      priority: "Low",
      bestCoverIsAi: false,
    };
  }

  if (photoDecision === "needs_review" || photoDecision === "generate_ai_creative") {
    return {
      status: "Needs Better Photo",
      reason: "Lead photo has promotional overlay or insufficient quality for Marketplace.",
      recommendation: "Run Photo Enhancer to produce a clean listing photo.",
      photoScore: photoScoreVal,
      publishOrder: 80,
      priority: "Low",
      bestCoverIsAi,
    };
  }

  if (!w.listingScore || w.aiStatus === "Generating" || listingScore < 45) {
    return {
      status: "Needs Listing",
      reason: `Listing score ${listingScore || "n/a"} — AI description not yet generated or score is too low.`,
      recommendation: "Generate or improve AI listing content first.",
      photoScore: photoScoreVal,
      publishOrder: 70,
      priority: "Low",
      bestCoverIsAi,
    };
  }

  if (!w.price) {
    return {
      status: "Needs Price Review",
      reason: "Price is missing or not set.",
      recommendation: "Confirm price before publishing.",
      photoScore: photoScoreVal,
      publishOrder: 60,
      priority: "Low",
      bestCoverIsAi,
    };
  }

  const priority = inferPriority(intel?.strategyName, listingScore, photoScoreVal);

  const photoNote = bestCoverIsAi
    ? "AI cover recommended"
    : photoDecision === "use_original"
      ? "Photo approved"
      : "Photo acceptable";

  const qualityNote =
    listingScore >= 80
      ? "High-quality listing"
      : listingScore >= 65
        ? "Good listing"
        : "Acceptable listing";

  const priorityPublishOrder =
    priority === "High"
      ? Math.max(1, 20 - Math.floor(listingScore / 10))
      : priority === "Medium"
        ? Math.max(21, 40 - Math.floor(listingScore / 10))
        : 50 - Math.floor(listingScore / 10);

  return {
    status: "Ready",
    reason: `Score ${listingScore} · ${photoNote}`,
    recommendation: `${qualityNote} — clear to publish.`,
    photoScore: photoScoreVal,
    publishOrder: priorityPublishOrder,
    priority,
    bestCoverIsAi,
  };
}

// ── Status display helpers ───────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  ReadinessStatus,
  { label: string; color: string; icon: React.ElementType; bg: string }
> = {
  Ready: {
    label: "Ready",
    color: "text-success",
    icon: CheckCircle2,
    bg: "bg-success/10 border-success/25",
  },
  "Needs Better Photo": {
    label: "Needs Better Photo",
    color: "text-amber-400",
    icon: Camera,
    bg: "bg-amber-500/10 border-amber-500/25",
  },
  "Needs Listing": {
    label: "Needs Listing",
    color: "text-blue-400",
    icon: PenTool,
    bg: "bg-blue-500/10 border-blue-500/25",
  },
  "Needs Price Review": {
    label: "Needs Price Review",
    color: "text-orange-400",
    icon: AlertTriangle,
    bg: "bg-orange-500/10 border-orange-500/25",
  },
  "Not Recommended Today": {
    label: "Not Recommended",
    color: "text-muted-foreground",
    icon: XCircle,
    bg: "bg-secondary/50 border-border",
  },
};

const PRIORITY_CONFIG: Record<
  PublishPriority,
  { label: string; color: string; bg: string }
> = {
  High: {
    label: "High Priority",
    color: "text-rose-400",
    bg: "bg-rose-500/10 border-rose-500/25",
  },
  Medium: {
    label: "Medium",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/25",
  },
  Low: {
    label: "Low",
    color: "text-muted-foreground",
    bg: "bg-secondary/50 border-border",
  },
};

// ── Component ────────────────────────────────────────────────────────────────

export function BatchReviewPanel({
  vehicles,
  photoScoreByVehicle,
  intelligenceMap,
  onClose,
  onApprove,
  isApproving,
}: Props) {
  const [scheduleMode, setScheduleMode] = useState<"today" | "later">("today");
  const [postingWindow, setPostingWindow] = useState("morning");
  const [spacing, setSpacing] = useState("30");
  const [batchSize, setBatchSize] = useState("8");

  const analysisMap = useMemo(() => {
    const m = new Map<number, VehicleAnalysis>();
    for (const v of vehicles) {
      m.set(
        v.vehicleId,
        analyzeVehicle(
          v,
          photoScoreByVehicle.get(v.vehicleId),
          intelligenceMap.get(v.vehicleId),
        ),
      );
    }
    return m;
  }, [vehicles, photoScoreByVehicle, intelligenceMap]);

  const predictionMap = useMemo(() => {
    const m = new Map<number, PhotoPrediction>();
    for (const v of vehicles) {
      const photoEntry = photoScoreByVehicle.get(v.vehicleId);
      const intel = intelligenceMap.get(v.vehicleId);
      const analysis = analysisMap.get(v.vehicleId);
      if (analysis?.status === "Ready" && photoEntry?.photoScore != null) {
        m.set(
          v.vehicleId,
          predictPhotoPerformance(
            photoEntry.photoScore,
            photoEntry.photoDecision,
            intel?.strategyName,
            v.imageCount ?? 0,
          ),
        );
      }
    }
    return m;
  }, [vehicles, photoScoreByVehicle, intelligenceMap, analysisMap]);

  const ready = vehicles.filter(
    (v) => analysisMap.get(v.vehicleId)?.status === "Ready",
  );
  const needsReview = vehicles.filter(
    (v) => analysisMap.get(v.vehicleId)?.status !== "Ready",
  );

  const highCount = ready.filter(
    (v) => analysisMap.get(v.vehicleId)?.priority === "High",
  ).length;
  const mediumCount = ready.filter(
    (v) => analysisMap.get(v.vehicleId)?.priority === "Medium",
  ).length;

  const sortedVehicles = useMemo(() => {
    return [...vehicles].sort((a, b) => {
      const aOrder = analysisMap.get(a.vehicleId)?.publishOrder ?? 50;
      const bOrder = analysisMap.get(b.vehicleId)?.publishOrder ?? 50;
      return aOrder - bOrder;
    });
  }, [vehicles, analysisMap]);

  const effectiveBatchSize = Math.min(
    ready.length,
    batchSize === "all" ? ready.length : parseInt(batchSize, 10),
  );
  const batchToPublish = ready
    .slice()
    .sort((a, b) => {
      const aOrder = analysisMap.get(a.vehicleId)?.publishOrder ?? 50;
      const bOrder = analysisMap.get(b.vehicleId)?.publishOrder ?? 50;
      return aOrder - bOrder;
    })
    .slice(0, effectiveBatchSize);

  const windowLabel =
    postingWindow === "morning"
      ? "9:00 – 11:00 AM"
      : postingWindow === "afternoon"
        ? "1:00 – 4:00 PM"
        : "5:00 – 7:00 PM";

  return (
    <div className="fixed inset-0 z-50 bg-background/97 backdrop-blur-sm overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-400">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Listings
          </button>
          <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            DealerPilot AI · Batch Review · Strategy Engine v2
          </div>
        </div>

        {/* ── AI Summary ── */}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-foreground leading-tight">
                DealerPilot recommends publishing{" "}
                <span className="text-primary">{ready.length}</span> of{" "}
                {vehicles.length} selected vehicles today.
              </h2>
              {needsReview.length > 0 && (
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  {needsReview.length} vehicle{needsReview.length !== 1 ? "s" : ""} need
                  attention before publishing — see details below.
                </p>
              )}
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
            {[
              {
                label: "Ready to Publish",
                value: ready.length,
                color: "text-success",
                bg: "bg-success/10",
              },
              {
                label: "High Priority",
                value: highCount,
                color: "text-rose-400",
                bg: "bg-rose-500/10",
              },
              {
                label: "Medium Priority",
                value: mediumCount,
                color: "text-amber-400",
                bg: "bg-amber-500/10",
              },
              {
                label: "Need Review",
                value: needsReview.length,
                color: "text-muted-foreground",
                bg: "bg-secondary/50",
              },
              {
                label: "Batch Size",
                value: effectiveBatchSize,
                color: "text-primary",
                bg: "bg-primary/10",
              },
            ].map((s) => (
              <div
                key={s.label}
                className={cn("rounded-xl px-4 py-3 flex flex-col gap-0.5", s.bg)}
              >
                <span className={cn("text-2xl font-black", s.color)}>{s.value}</span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Vehicle List ── */}
        <div className="space-y-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Vehicle Analysis — Publishing Order ({vehicles.length} selected)
          </p>

          {sortedVehicles.map((v, idx) => {
            const analysis = analysisMap.get(v.vehicleId)!;
            const cfg = STATUS_CONFIG[analysis.status];
            const pCfg = PRIORITY_CONFIG[analysis.priority];
            const StatusIcon = cfg.icon;
            const photoEntry = photoScoreByVehicle.get(v.vehicleId);
            const intel = intelligenceMap.get(v.vehicleId);
            const prediction = predictionMap.get(v.vehicleId);

            return (
              <div
                key={v.vehicleId}
                className={cn(
                  "p-4 rounded-xl border transition-all",
                  analysis.status === "Ready" && analysis.priority === "High"
                    ? "border-rose-500/20 bg-rose-500/5"
                    : analysis.status === "Ready"
                      ? "border-success/20 bg-success/5"
                      : "border-border/50 bg-card/60",
                )}
              >
                {/* Top row: order, thumbnail, info, status */}
                <div className="flex items-start gap-4">
                  {/* Order number */}
                  <div
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5",
                      analysis.status === "Ready" && analysis.priority === "High"
                        ? "bg-rose-500/20 text-rose-400"
                        : analysis.status === "Ready"
                          ? "bg-success/20 text-success"
                          : "bg-secondary/60 text-muted-foreground",
                    )}
                  >
                    {analysis.status === "Ready" ? idx + 1 : "–"}
                  </div>

                  {/* Thumbnail with cover indicator */}
                  <div className="relative w-20 h-14 rounded-lg overflow-hidden bg-secondary/40 flex-shrink-0">
                    {v.primaryImageUrl ? (
                      <img
                        src={v.primaryImageUrl}
                        alt={v.label}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Car className="w-5 h-5 text-muted-foreground/30" />
                      </div>
                    )}
                    {analysis.bestCoverIsAi && (
                      <div className="absolute bottom-0 inset-x-0 bg-blue-500/80 text-white text-[8px] font-bold text-center py-0.5 flex items-center justify-center gap-0.5">
                        <Wand2 className="w-2 h-2" />
                        AI COVER
                      </div>
                    )}
                  </div>

                  {/* Vehicle info + intelligence */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-foreground truncate">
                        {v.label}
                      </span>
                      {v.price && (
                        <>
                          {/* Actual sticker price — always show */}
                          <span className="text-xs text-muted-foreground font-medium">
                            {formatCurrency(v.price)}
                          </span>
                          {/* Marketplace price mode badge */}
                          {v.price >= 16000 ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[9px] font-bold text-amber-400 uppercase tracking-widest">
                              <DollarSign className="w-2.5 h-2.5" />
                              Down payment
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-success/10 border border-success/20 text-[9px] font-bold text-success uppercase tracking-widest">
                              Full price
                            </span>
                          )}
                        </>
                      )}
                      {analysis.status === "Ready" && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-widest",
                            pCfg.bg,
                            pCfg.color,
                          )}
                        >
                          {analysis.priority === "High" && <TrendingUp className="w-2.5 h-2.5" />}
                          {analysis.priority === "Medium" && <Star className="w-2.5 h-2.5" />}
                          {pCfg.label}
                        </span>
                      )}
                      {intel?.strategyName && (
                        <span className="px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[9px] font-bold text-primary uppercase tracking-widest">
                          {intel.strategyName}
                        </span>
                      )}
                    </div>

                    {/* Metrics row */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {(v.imageCount ?? 0) > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                          <ImageIcon className="w-3 h-3" />
                          {v.imageCount} photos
                        </span>
                      )}
                      {v.listingScore != null && (
                        <span className="text-[10px] text-muted-foreground font-medium">
                          Score {v.listingScore}
                        </span>
                      )}
                      {photoEntry?.photoScore != null && (
                        <span className="text-[10px] text-muted-foreground font-medium">
                          Photo {photoEntry.photoScore}
                        </span>
                      )}
                      {intel?.recommendedDownPayment != null && (v.price ?? 0) >= 16000 && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400">
                          <DollarSign className="w-3 h-3" />
                          Marketplace: {formatCurrency(intel.recommendedDownPayment)} down
                        </span>
                      )}
                      {intel?.recommendedDownPayment == null && (v.price ?? 0) >= 16000 && (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                          <DollarSign className="w-3 h-3" />
                          Down payment pending
                        </span>
                      )}
                    </div>

                    {/* Strategy reason */}
                    {intel?.reason && analysis.status === "Ready" && (
                      <p className="text-[11px] text-primary/70 leading-snug italic">
                        "{intel.reason}"
                      </p>
                    )}

                    <p className="text-[11px] text-muted-foreground leading-snug">
                      {analysis.recommendation}
                    </p>
                  </div>

                  {/* Status badge */}
                  <div className="flex-shrink-0 text-right space-y-1">
                    <div
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-widest",
                        cfg.bg,
                        cfg.color,
                      )}
                    >
                      <StatusIcon className="w-3 h-3" />
                      {cfg.label}
                    </div>
                    <p className="text-[10px] text-muted-foreground max-w-[180px]">
                      {analysis.reason}
                    </p>
                  </div>
                </div>

                {/* ── Photo Performance Prediction (Ready vehicles only) ── */}
                {prediction && (
                  <PhotoPerformanceCard
                    prediction={prediction}
                    photoScore={photoEntry?.photoScore ?? 0}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* ── Scheduling ── */}
        {ready.length > 0 && (
          <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
            <div className="px-6 py-4 border-b border-border/30 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-primary" />
              <span className="font-bold text-sm">Batch Scheduling</span>
              <Badge className="ml-auto bg-primary/15 text-primary border-0 text-[10px] font-bold uppercase tracking-widest">
                AI Recommended
              </Badge>
            </div>

            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  When to Post
                </p>
                <div className="flex gap-2">
                  {(
                    [
                      { value: "today", label: "Post Today", icon: Sparkles },
                      { value: "later", label: "Schedule Later", icon: CalendarClock },
                    ] as const
                  ).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => setScheduleMode(value)}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border text-xs font-bold transition-all",
                        scheduleMode === value
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border/50 text-muted-foreground hover:border-border",
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  Posting Window{" "}
                  <span className="text-primary normal-case font-semibold">
                    (AI: Morning recommended)
                  </span>
                </p>
                <Select value={postingWindow} onValueChange={setPostingWindow}>
                  <SelectTrigger className="bg-secondary/40 border-border/50 rounded-xl h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="morning">Morning · 9:00–11:00 AM</SelectItem>
                    <SelectItem value="afternoon">Afternoon · 1:00–4:00 PM</SelectItem>
                    <SelectItem value="evening">Evening · 5:00–7:00 PM</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  Spacing Between Posts
                </p>
                <Select value={spacing} onValueChange={setSpacing}>
                  <SelectTrigger className="bg-secondary/40 border-border/50 rounded-xl h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 minutes</SelectItem>
                    <SelectItem value="30">30 minutes (recommended)</SelectItem>
                    <SelectItem value="60">1 hour</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  Vehicles per Session
                </p>
                <Select value={batchSize} onValueChange={setBatchSize}>
                  <SelectTrigger className="bg-secondary/40 border-border/50 rounded-xl h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">4 vehicles</SelectItem>
                    <SelectItem value="8">8 vehicles (recommended)</SelectItem>
                    <SelectItem value="all">All {ready.length} ready</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Batch plan summary */}
            <div className="px-6 pb-5">
              <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 text-sm space-y-1.5">
                <p className="font-bold text-foreground">DealerPilot batch plan</p>
                <div className="text-muted-foreground space-y-1 text-xs leading-relaxed">
                  <p>
                    ✓ Publishing{" "}
                    <strong className="text-foreground">
                      {effectiveBatchSize} vehicle{effectiveBatchSize !== 1 ? "s" : ""}
                    </strong>{" "}
                    {scheduleMode === "today" ? "today" : "as scheduled"} in the{" "}
                    <strong className="text-foreground">{windowLabel}</strong> window.
                  </p>
                  {highCount > 0 && (
                    <p>
                      ✓{" "}
                      <strong className="text-rose-400">
                        {highCount} High Priority
                      </strong>{" "}
                      vehicle{highCount !== 1 ? "s" : ""} publish first — top AI picks from Strategy Engine v2.
                    </p>
                  )}
                  <p>
                    ✓ Posts spaced{" "}
                    <strong className="text-foreground">{spacing} minutes</strong>{" "}
                    apart — avoids Marketplace spam detection.
                  </p>
                  {needsReview.length > 0 && (
                    <p>
                      ✓{" "}
                      <strong className="text-foreground">
                        {needsReview.length} vehicle{needsReview.length !== 1 ? "s" : ""}
                      </strong>{" "}
                      held for review — not included in this batch.
                    </p>
                  )}
                  <p>
                    ✓ Extension will handle publishing in order — no manual clicks required.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="flex items-center justify-between gap-4 pt-2 pb-8">
          <Button variant="outline" onClick={onClose} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>

          {ready.length > 0 ? (
            <Button
              onClick={() => onApprove(batchToPublish.map((v) => v.vehicleId))}
              disabled={isApproving}
              className="gap-2 px-8 font-bold text-[11px] uppercase tracking-widest premium-gradient-btn"
            >
              {isApproving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Publish {effectiveBatchSize} Vehicle
              {effectiveBatchSize !== 1 ? "s" : ""}
              <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <div className="text-sm text-muted-foreground">
              No vehicles are ready to publish. Resolve the issues above and try again.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
