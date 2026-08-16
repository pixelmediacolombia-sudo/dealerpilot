import { useState, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { Button } from "@/shared/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import {
  Brain,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Minus,
  Plus,
} from "lucide-react";

// ─── Types (mirror the OpenAPI schemas) ──────────────────────────────────────

interface GmAnalysisResult {
  vehicleId: number;
  recommendation: "PUBLISH" | "HOLD" | "RECONSIDER";
  whyPublish: string;
  riskWarning: string | null;
  betterAlternative: string | null;
  hasBetterAlternative: boolean;
  adAngle: string;
  suggestedLanguage: string;
  expectedImpact: string;
  timingRecommendation: string | null;
  audienceOverlapWarning: string | null;
  duplicateConflictWarning: string | null;
  confidence: number;
  cachedAt: string;
}

interface GmWhatIfResult {
  vehicleId: number;
  currentPrice: number;
  hypotheticalPrice: number;
  priceDeltaPercent: number;
  conversationsDeltaPct: number;
  appointmentsDeltaPct: number;
  saleProbabilityDelta: number;
  confidence: number;
  explanation: string;
}

export interface GmCoachModalProps {
  vehicleId: number | null;
  vehicleLabel?: string | null;
  vehiclePrice?: number | null;
  onConfirmPublish: (vehicleId: number) => void;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function recColor(rec: "PUBLISH" | "HOLD" | "RECONSIDER") {
  if (rec === "PUBLISH") return "text-success";
  if (rec === "HOLD") return "text-destructive";
  return "text-warning";
}

function recBorderColor(rec: "PUBLISH" | "HOLD" | "RECONSIDER") {
  if (rec === "PUBLISH") return "border-success/20 bg-success/[0.04]";
  if (rec === "HOLD") return "border-destructive/20 bg-destructive/[0.04]";
  return "border-warning/20 bg-warning/[0.04]";
}

function recLabel(rec: "PUBLISH" | "HOLD" | "RECONSIDER") {
  if (rec === "PUBLISH") return "Publish Now";
  if (rec === "HOLD") return "Hold — Don't Publish";
  return "Reconsider";
}

function recIcon(rec: "PUBLISH" | "HOLD" | "RECONSIDER") {
  if (rec === "PUBLISH") return <CheckCircle2 className="w-5 h-5 text-success" />;
  if (rec === "HOLD") return <ShieldAlert className="w-5 h-5 text-destructive" />;
  return <AlertTriangle className="w-5 h-5 text-warning" />;
}

function DeltaBadge({ pct }: { pct: number }) {
  if (pct === 0) return <span className="text-muted-foreground text-[12px]">No change</span>;
  const positive = pct > 0;
  return (
    <span className={cn("flex items-center gap-0.5 text-[13px] font-bold", positive ? "text-success" : "text-destructive")}>
      {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {positive ? "+" : ""}{pct}%
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GmCoachModal({
  vehicleId,
  vehicleLabel,
  vehiclePrice,
  onConfirmPublish,
  onClose,
}: GmCoachModalProps) {
  const isOpen = vehicleId !== null;

  const [analysis, setAnalysis] = useState<GmAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What-if state
  const [priceDelta, setPriceDelta] = useState(0);
  const [whatIf, setWhatIf] = useState<GmWhatIfResult | null>(null);
  const [whatIfLoading, setWhatIfLoading] = useState(false);
  const DELTA_STEP = 5;
  const DELTA_MIN = -30;
  const DELTA_MAX = 30;

  // ── Fetch GM analysis on open ─────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !vehicleId) return;
    setAnalysis(null);
    setError(null);
    setPriceDelta(0);
    setWhatIf(null);
    setIsLoading(true);

    fetch("/api/gm/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicleId }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<GmAnalysisResult>;
      })
      .then(setAnalysis)
      .catch((e) => setError(e instanceof Error ? e.message : "Analysis failed"))
      .finally(() => setIsLoading(false));
  }, [isOpen, vehicleId]);

  // ── Fetch what-if when priceDelta changes (debounced) ─────────────────────
  const fetchWhatIf = useCallback(
    (delta: number) => {
      if (!vehicleId || delta === 0) {
        setWhatIf(null);
        return;
      }
      setWhatIfLoading(true);
      fetch("/api/gm/whatif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId, priceDeltaPercent: delta }),
      })
        .then(r => r.json() as Promise<GmWhatIfResult>)
        .then(setWhatIf)
        .catch(() => setWhatIf(null))
        .finally(() => setWhatIfLoading(false));
    },
    [vehicleId],
  );

  useEffect(() => {
    const t = setTimeout(() => fetchWhatIf(priceDelta), 350);
    return () => clearTimeout(t);
  }, [priceDelta, fetchWhatIf]);

  function resetAndClose() {
    setAnalysis(null);
    setError(null);
    setPriceDelta(0);
    setWhatIf(null);
    onClose();
  }

  function handleClose() {
    if (vehicleId && analysis) {
      fetch("/api/gm/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId,
          vehicleLabel: vehicleLabel ?? `Vehicle #${vehicleId}`,
          gmRecommendation: analysis.recommendation,
          gmConfidence: analysis.confidence,
          operatorAction: "held",
          overridden: false,
          finalPublishStatus: "held",
        }),
      }).catch(() => {});
    }
    resetAndClose();
  }

  function handleConfirm() {
    if (!vehicleId) return;
    if (analysis) {
      const overridden = analysis.recommendation !== "PUBLISH";
      fetch("/api/gm/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId,
          vehicleLabel: vehicleLabel ?? `Vehicle #${vehicleId}`,
          gmRecommendation: analysis.recommendation,
          gmConfidence: analysis.confidence,
          operatorAction: overridden ? "overridden" : "confirmed_publish",
          overridden,
          finalPublishStatus: "published",
        }),
      }).catch(() => {});
    }
    onConfirmPublish(vehicleId);
    resetAndClose();
  }

  const currentPrice = vehiclePrice ?? analysis?.vehicleId ?? 0;
  const hypoPrice = whatIf?.hypotheticalPrice ?? null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <SheetContent
        side="right"
        className="w-[420px] sm:w-[460px] bg-[#080e18] border-border flex flex-col gap-0 p-0 overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5 mb-1">
            <Brain className="w-4 h-4 text-primary/60 shrink-0" />
            <p className="text-[11px] font-semibold text-primary/40  tracking-wide">
              DealerPilot GM Review
            </p>
          </div>
          <SheetTitle className="text-[15px] font-bold text-foreground leading-snug">
            {vehicleLabel ?? "Vehicle Review"}
          </SheetTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Review the GM analysis before publishing to Facebook Marketplace
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">

          {/* ── Loading ─────────────────────────────────────────────────── */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="relative">
                <Brain className="w-10 h-10 text-primary/20" />
                <Loader2 className="w-5 h-5 text-primary animate-spin absolute -bottom-1 -right-1" />
              </div>
              <div className="text-center">
                <p className="text-[13px] font-semibold text-muted-foreground">GM is reviewing this vehicle…</p>
                <p className="text-[11px] text-muted-foreground mt-1">Analyzing inventory, pricing, audience fit, and conflicts</p>
              </div>
            </div>
          )}

          {/* ── Error ───────────────────────────────────────────────────── */}
          {!isLoading && error && (
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/[0.05] p-4">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-[12px] font-semibold text-destructive/80">Analysis unavailable</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{error}</p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">You can still publish — the GM review is advisory only.</p>
              <Button
                className="w-full h-9 bg-primary hover:bg-primary text-foreground font-bold text-[12px]"
                onClick={handleConfirm}
              >
                Publish Anyway
              </Button>
            </div>
          )}

          {/* ── Analysis ────────────────────────────────────────────────── */}
          {!isLoading && !error && analysis && (
            <div className="p-5 space-y-4">

              {/* Recommendation Banner */}
              <div className={cn("rounded-xl border p-4", recBorderColor(analysis.recommendation))}>
                <div className="flex items-center gap-2.5 mb-2">
                  {recIcon(analysis.recommendation)}
                  <span className={cn("text-[15px] font-semibold", recColor(analysis.recommendation))}>
                    {recLabel(analysis.recommendation)}
                  </span>
                  <span className="ml-auto text-[11px] font-bold text-muted-foreground">
                    {analysis.confidence}% confidence
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground leading-relaxed">{analysis.whyPublish}</p>
              </div>

              {/* Risk Warning */}
              {analysis.riskWarning && (
                <div className="rounded-xl border border-warning/15 bg-warning/[0.04] p-3.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-warning/60 shrink-0" />
                    <p className="text-[11px] font-semibold text-warning/40  tracking-wide">Risk Warning</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{analysis.riskWarning}</p>
                </div>
              )}

              {/* Duplicate Conflict */}
              {analysis.duplicateConflictWarning && (
                <div className="rounded-xl border border-destructive/15 bg-destructive/[0.04] p-3.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-destructive/60 shrink-0" />
                    <p className="text-[11px] font-semibold text-destructive/35  tracking-wide">Self-Competition Warning</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{analysis.duplicateConflictWarning}</p>
                </div>
              )}

              {/* Better Alternative */}
              {analysis.hasBetterAlternative && analysis.betterAlternative && (
                <div className="rounded-xl border border-primary/15 bg-primary/[0.03] p-3.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <ArrowRight className="w-3.5 h-3.5 text-primary/50 shrink-0" />
                    <p className="text-[11px] font-semibold text-primary/40  tracking-wide">Better Alternative</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{analysis.betterAlternative}</p>
                </div>
              )}

              {/* Creative Recommendation */}
              <div className="rounded-xl border border-border bg-muted p-3.5">
                <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide mb-2.5">
                  Creative Recommendation
                </p>
                <div className="space-y-2">
                  <div>
                    <p className="text-[11px] text-muted-foreground  tracking-wider mb-0.5">Ad Hook</p>
                    <p className="text-[12px] font-semibold text-muted-foreground italic">"{analysis.adAngle}"</p>
                  </div>
                  <div className="flex gap-4">
                    <div>
                      <p className="text-[11px] text-muted-foreground  tracking-wider mb-0.5">Language</p>
                      <p className="text-[11px] font-bold text-muted-foreground">{analysis.suggestedLanguage}</p>
                    </div>
                    {analysis.timingRecommendation && (
                      <div>
                        <p className="text-[11px] text-muted-foreground  tracking-wider mb-0.5">Timing</p>
                        <p className="text-[11px] text-muted-foreground">{analysis.timingRecommendation}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Expected Impact */}
              <div className="rounded-xl border border-border bg-muted p-3.5">
                <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide mb-2">
                  Expected Impact
                </p>
                <p className="text-[12px] text-muted-foreground leading-relaxed">{analysis.expectedImpact}</p>
                {analysis.audienceOverlapWarning && (
                  <p className="text-xs text-warning/50 mt-2 italic">{analysis.audienceOverlapWarning}</p>
                )}
              </div>

              {/* ── What-if Price Slider ───────────────────────────────── */}
              <div className="rounded-xl border border-border bg-muted p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">
                    AI What-if
                  </p>
                  <p className="text-[11px] text-muted-foreground">What if I change the price?</p>
                </div>

                {/* Price display */}
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[11px] text-muted-foreground  tracking-wider mb-0.5">Current</p>
                    <p className="text-[15px] font-semibold text-muted-foreground">
                      {vehiclePrice != null ? formatCurrency(vehiclePrice) : "—"}
                    </p>
                  </div>
                  {priceDelta !== 0 && hypoPrice != null && (
                    <>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                      <div className="text-right">
                        <p className="text-[11px] text-muted-foreground  tracking-wider mb-0.5">Hypothetical</p>
                        <p className={cn(
                          "text-[15px] font-semibold",
                          priceDelta < 0 ? "text-success/70" : "text-destructive/70",
                        )}>
                          {formatCurrency(hypoPrice)}
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {/* Stepper */}
                <div className="flex items-center gap-2 mb-3">
                  <button
                    disabled={priceDelta <= DELTA_MIN}
                    onClick={() => setPriceDelta(d => Math.max(DELTA_MIN, d - DELTA_STEP))}
                    className="w-8 h-8 rounded-lg border border-border bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 transition-colors"
                  >
                    <Minus className="w-3 h-3" />
                  </button>

                  <div className="flex-1 relative">
                    <input
                      type="range"
                      min={DELTA_MIN}
                      max={DELTA_MAX}
                      step={DELTA_STEP}
                      value={priceDelta}
                      onChange={e => setPriceDelta(Number(e.target.value))}
                      className="w-full h-1.5 appearance-none rounded-full cursor-pointer bg-muted accent-blue-500"
                    />
                  </div>

                  <button
                    disabled={priceDelta >= DELTA_MAX}
                    onClick={() => setPriceDelta(d => Math.min(DELTA_MAX, d + DELTA_STEP))}
                    className="w-8 h-8 rounded-lg border border-border bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>

                  <div className={cn(
                    "w-[52px] text-center text-[13px] font-semibold tabular-nums",
                    priceDelta < 0 ? "text-success/70" : priceDelta > 0 ? "text-destructive/70" : "text-muted-foreground",
                  )}>
                    {priceDelta > 0 ? "+" : ""}{priceDelta}%
                  </div>
                </div>

                {/* What-if results */}
                {priceDelta === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-1">
                    Use the slider or +/− buttons to model a price change
                  </p>
                )}

                {priceDelta !== 0 && whatIfLoading && (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/50" />
                    <p className="text-[11px] text-muted-foreground">Calculating…</p>
                  </div>
                )}

                {priceDelta !== 0 && !whatIfLoading && whatIf && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "Conversations", value: whatIf.conversationsDeltaPct },
                        { label: "Appointments", value: whatIf.appointmentsDeltaPct },
                        { label: "Sale Prob.", value: whatIf.saleProbabilityDelta },
                      ].map(m => (
                        <div key={m.label} className="text-center rounded-lg border border-border bg-muted py-2 px-1">
                          <DeltaBadge pct={m.value} />
                          <p className="text-[11px] text-muted-foreground mt-1">{m.label}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{whatIf.explanation}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Confidence: {whatIf.confidence}% · Based on Opportunity Engine data
                    </p>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* ── Footer Actions ──────────────────────────────────────────────────── */}
        {!isLoading && (
          <div className="shrink-0 px-5 py-4 border-t border-border flex gap-2.5">
            <Button
              variant="ghost"
              className="flex-1 h-10 text-muted-foreground hover:text-muted-foreground hover:bg-muted font-semibold text-[12px]"
              onClick={handleClose}
            >
              {analysis?.recommendation === "HOLD" ? "Hold Vehicle" : "Cancel"}
            </Button>
            <Button
              className={cn(
                "flex-[2] h-10 font-bold text-[13px] gap-2",
                analysis?.recommendation === "HOLD"
                  ? "bg-warning hover:bg-warning text-foreground"
                  : "bg-primary hover:bg-primary text-foreground shadow-lg shadow-blue-500/20",
              )}
              onClick={handleConfirm}
            >
              {analysis?.recommendation === "HOLD"
                ? "Publish Anyway (Override)"
                : "Confirm — Publish Now"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
