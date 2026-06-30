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
  Clock,
  Layers,
  Wand2,
  CalendarClock,
  ChevronRight,
  XCircle,
  Loader2,
  LayoutGrid,
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
};

type Props = {
  vehicles: WorkspaceVehicle[];
  photoScoreByVehicle: Map<number, PhotoScoreEntry>;
  onClose: () => void;
  onApprove: (readyVehicleIds: number[]) => void;
  isApproving: boolean;
};

// ── AI analysis ─────────────────────────────────────────────────────────────

function analyzeVehicle(
  w: WorkspaceVehicle,
  photoEntry: PhotoScoreEntry | undefined,
): VehicleAnalysis {
  const photoDecision = photoEntry?.photoDecision ?? null;
  const photoScoreVal = photoEntry?.photoScore ?? 0;
  const listingScore = w.listingScore ?? 0;

  if (w.publishStatus === "Published") {
    return {
      status: "Not Recommended Today",
      reason: "Already live on Marketplace — avoid duplicate listings.",
      recommendation: "Skip for this batch.",
      photoScore: photoScoreVal,
      publishOrder: 99,
    };
  }

  if (!w.imageCount || w.imageCount === 0) {
    return {
      status: "Needs Better Photo",
      reason: "No vehicle photos found in XML feed.",
      recommendation: "Add photos via XML feed re-sync before publishing.",
      photoScore: 0,
      publishOrder: 90,
    };
  }

  if (
    photoDecision === "needs_review" ||
    photoDecision === "generate_ai_creative"
  ) {
    return {
      status: "Needs Better Photo",
      reason:
        "Lead photo has promotional overlay or insufficient quality for Marketplace.",
      recommendation: "Run Photo Enhancer to produce a clean listing photo.",
      photoScore: photoScoreVal,
      publishOrder: 80,
    };
  }

  if (!w.listingScore || w.aiStatus === "Generating" || listingScore < 45) {
    return {
      status: "Needs Listing",
      reason: `Listing score ${listingScore || "n/a"} — AI description not yet generated or score is too low.`,
      recommendation: "Generate or improve AI listing content first.",
      photoScore: photoScoreVal,
      publishOrder: 70,
    };
  }

  if (!w.price) {
    return {
      status: "Needs Price Review",
      reason: "Price is missing or not set.",
      recommendation: "Confirm price before publishing.",
      photoScore: photoScoreVal,
      publishOrder: 60,
    };
  }

  const photoNote =
    photoDecision === "use_original_recommend_ai_cover"
      ? "AI cover photo recommended"
      : "Photo approved";

  const qualityNote =
    listingScore >= 80
      ? "High-quality listing"
      : listingScore >= 65
        ? "Good listing"
        : "Acceptable listing";

  return {
    status: "Ready",
    reason: `Score ${listingScore} · ${photoNote}`,
    recommendation: `${qualityNote} — clear to publish.`,
    photoScore: photoScoreVal,
    publishOrder: 100 - listingScore,
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

// ── Component ────────────────────────────────────────────────────────────────

export function BatchReviewPanel({
  vehicles,
  photoScoreByVehicle,
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
      m.set(v.vehicleId, analyzeVehicle(v, photoScoreByVehicle.get(v.vehicleId)));
    }
    return m;
  }, [vehicles, photoScoreByVehicle]);

  const ready = vehicles.filter(
    (v) => analysisMap.get(v.vehicleId)?.status === "Ready",
  );
  const needsReview = vehicles.filter(
    (v) => analysisMap.get(v.vehicleId)?.status !== "Ready",
  );

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
  const batchToPublish = ready.slice(0, effectiveBatchSize);

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
            DealerPilot AI · Batch Review
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            {[
              {
                label: "Ready to Publish",
                value: ready.length,
                color: "text-success",
                bg: "bg-success/10",
              },
              {
                label: "Need Review",
                value: needsReview.length,
                color: "text-amber-400",
                bg: "bg-amber-500/10",
              },
              {
                label: "Total Selected",
                value: vehicles.length,
                color: "text-foreground",
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
                className={cn(
                  "rounded-xl px-4 py-3 flex flex-col gap-0.5",
                  s.bg,
                )}
              >
                <span className={cn("text-2xl font-black", s.color)}>
                  {s.value}
                </span>
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
            Vehicle Analysis ({vehicles.length} selected)
          </p>

          {sortedVehicles.map((v, idx) => {
            const analysis = analysisMap.get(v.vehicleId)!;
            const cfg = STATUS_CONFIG[analysis.status];
            const StatusIcon = cfg.icon;
            const photoEntry = photoScoreByVehicle.get(v.vehicleId);

            return (
              <div
                key={v.vehicleId}
                className={cn(
                  "flex items-center gap-4 p-4 rounded-xl border transition-all",
                  analysis.status === "Ready"
                    ? "border-success/20 bg-success/5"
                    : "border-border/50 bg-card/60",
                )}
              >
                {/* Order number */}
                <div className="w-7 h-7 rounded-full bg-secondary/60 flex items-center justify-center text-[11px] font-bold text-muted-foreground flex-shrink-0">
                  {idx + 1}
                </div>

                {/* Thumbnail */}
                <div className="w-16 h-12 rounded-lg overflow-hidden bg-secondary/40 flex-shrink-0">
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
                </div>

                {/* Vehicle info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-foreground truncate">
                      {v.label}
                    </span>
                    {v.price && (
                      <span className="text-xs text-muted-foreground font-medium">
                        {formatCurrency(v.price)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
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
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
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
              {/* When to post */}
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

              {/* Posting window */}
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

              {/* Spacing */}
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

              {/* Batch size */}
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
                <p className="font-bold text-foreground">
                  DealerPilot batch plan
                </p>
                <div className="text-muted-foreground space-y-1 text-xs leading-relaxed">
                  <p>
                    ✓ Publishing{" "}
                    <strong className="text-foreground">
                      {effectiveBatchSize} vehicle
                      {effectiveBatchSize !== 1 ? "s" : ""}
                    </strong>{" "}
                    {scheduleMode === "today" ? "today" : "as scheduled"} in the{" "}
                    <strong className="text-foreground">{windowLabel}</strong>{" "}
                    window.
                  </p>
                  <p>
                    ✓ Posts spaced{" "}
                    <strong className="text-foreground">
                      {spacing} minutes
                    </strong>{" "}
                    apart — avoids Marketplace spam detection.
                  </p>
                  {needsReview.length > 0 && (
                    <p>
                      ✓{" "}
                      <strong className="text-foreground">
                        {needsReview.length} vehicle
                        {needsReview.length !== 1 ? "s" : ""}
                      </strong>{" "}
                      held for review — not included in this batch.
                    </p>
                  )}
                  <p>
                    ✓ Extension will handle publishing in order — no manual
                    clicks required.
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
              Approve & Schedule {effectiveBatchSize} Vehicle
              {effectiveBatchSize !== 1 ? "s" : ""}
              <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <div className="text-sm text-muted-foreground">
              No vehicles are ready to publish. Resolve the issues above and try
              again.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
