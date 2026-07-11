import { useState, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { Button } from "@/shared/ui/button";
import { cn } from "@/lib/utils";
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
  if (rec === "PUBLISH") return "text-emerald-400";
  if (rec === "HOLD") return "text-red-400";
  return "text-amber-400";
}

function recBorderColor(rec: "PUBLISH" | "HOLD" | "RECONSIDER") {
  if (rec === "PUBLISH") return "border-emerald-500/20 bg-emerald-500/[0.04]";
  if (rec === "HOLD") return "border-red-500/20 bg-red-500/[0.04]";
  return "border-amber-500/20 bg-amber-500/[0.04]";
}

function recLabel(rec: "PUBLISH" | "HOLD" | "RECONSIDER") {
  if (rec === "PUBLISH") return "Publish Now";
  if (rec === "HOLD") return "Hold — Don't Publish";
  return "Reconsider";
}

function recIcon(rec: "PUBLISH" | "HOLD" | "RECONSIDER") {
  if (rec === "PUBLISH") return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
  if (rec === "HOLD") return <ShieldAlert className="w-5 h-5 text-red-400" />;
  return <AlertTriangle className="w-5 h-5 text-amber-400" />;
}

function DeltaBadge({ pct }: { pct: number }) {
  if (pct === 0) return <span className="text-white/30 text-[12px]">No change</span>;
  const positive = pct > 0;
  return (
    <span className={cn("flex items-center gap-0.5 text-[13px] font-bold", positive ? "text-emerald-400" : "text-red-400")}>
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
        className="w-[420px] sm:w-[460px] bg-[#080e18] border-white/[0.07] flex flex-col gap-0 p-0 overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-white/[0.05] shrink-0">
          <div className="flex items-center gap-2.5 mb-1">
            <Brain className="w-4 h-4 text-blue-400/60 shrink-0" />
            <p className="text-[9px] font-black text-blue-400/40 uppercase tracking-[0.28em]">
              DealerPilot GM Review
            </p>
          </div>
          <SheetTitle className="text-[15px] font-bold text-white/75 leading-snug">
            {vehicleLabel ?? "Vehicle Review"}
          </SheetTitle>
          <p className="text-[11px] text-white/22 mt-0.5">
            Review the GM analysis before publishing to Facebook Marketplace
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">

          {/* ── Loading ─────────────────────────────────────────────────── */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="relative">
                <Brain className="w-10 h-10 text-blue-400/20" />
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin absolute -bottom-1 -right-1" />
              </div>
              <div className="text-center">
                <p className="text-[13px] font-semibold text-white/45">GM is reviewing this vehicle…</p>
                <p className="text-[11px] text-white/20 mt-1">Analyzing inventory, pricing, audience fit, and conflicts</p>
              </div>
            </div>
          )}

          {/* ── Error ───────────────────────────────────────────────────── */}
          {!isLoading && error && (
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/[0.05] p-4">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[12px] font-semibold text-red-400/80">Analysis unavailable</p>
                  <p className="text-[11px] text-white/28 mt-1">{error}</p>
                </div>
              </div>
              <p className="text-[11px] text-white/22">You can still publish — the GM review is advisory only.</p>
              <Button
                className="w-full h-9 bg-blue-600 hover:bg-blue-500 text-white font-bold text-[12px]"
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
                  <span className={cn("text-[15px] font-black", recColor(analysis.recommendation))}>
                    {recLabel(analysis.recommendation)}
                  </span>
                  <span className="ml-auto text-[11px] font-bold text-white/22">
                    {analysis.confidence}% confidence
                  </span>
                </div>
                <p className="text-[12px] text-white/55 leading-relaxed">{analysis.whyPublish}</p>
              </div>

              {/* Risk Warning */}
              {analysis.riskWarning && (
                <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-3.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400/60 shrink-0" />
                    <p className="text-[9px] font-black text-amber-400/40 uppercase tracking-[0.22em]">Risk Warning</p>
                  </div>
                  <p className="text-[11px] text-white/45 leading-relaxed">{analysis.riskWarning}</p>
                </div>
              )}

              {/* Duplicate Conflict */}
              {analysis.duplicateConflictWarning && (
                <div className="rounded-xl border border-red-500/15 bg-red-500/[0.04] p-3.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-red-400/60 shrink-0" />
                    <p className="text-[9px] font-black text-red-400/35 uppercase tracking-[0.22em]">Self-Competition Warning</p>
                  </div>
                  <p className="text-[11px] text-white/45 leading-relaxed">{analysis.duplicateConflictWarning}</p>
                </div>
              )}

              {/* Better Alternative */}
              {analysis.hasBetterAlternative && analysis.betterAlternative && (
                <div className="rounded-xl border border-blue-500/15 bg-blue-500/[0.03] p-3.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <ArrowRight className="w-3.5 h-3.5 text-blue-400/50 shrink-0" />
                    <p className="text-[9px] font-black text-blue-400/40 uppercase tracking-[0.22em]">Better Alternative</p>
                  </div>
                  <p className="text-[11px] text-white/45 leading-relaxed">{analysis.betterAlternative}</p>
                </div>
              )}

              {/* Creative Recommendation */}
              <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-3.5">
                <p className="text-[9px] font-black text-white/15 uppercase tracking-[0.22em] mb-2.5">
                  Creative Recommendation
                </p>
                <div className="space-y-2">
                  <div>
                    <p className="text-[9px] text-white/18 uppercase tracking-wider mb-0.5">Ad Hook</p>
                    <p className="text-[12px] font-semibold text-white/60 italic">"{analysis.adAngle}"</p>
                  </div>
                  <div className="flex gap-4">
                    <div>
                      <p className="text-[9px] text-white/18 uppercase tracking-wider mb-0.5">Language</p>
                      <p className="text-[11px] font-bold text-white/45">{analysis.suggestedLanguage}</p>
                    </div>
                    {analysis.timingRecommendation && (
                      <div>
                        <p className="text-[9px] text-white/18 uppercase tracking-wider mb-0.5">Timing</p>
                        <p className="text-[11px] text-white/40">{analysis.timingRecommendation}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Expected Impact */}
              <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-3.5">
                <p className="text-[9px] font-black text-white/15 uppercase tracking-[0.22em] mb-2">
                  Expected Impact
                </p>
                <p className="text-[12px] text-white/45 leading-relaxed">{analysis.expectedImpact}</p>
                {analysis.audienceOverlapWarning && (
                  <p className="text-[10px] text-amber-400/50 mt-2 italic">{analysis.audienceOverlapWarning}</p>
                )}
              </div>

              {/* ── What-if Price Slider ───────────────────────────────── */}
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.012] p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[9px] font-black text-white/15 uppercase tracking-[0.22em]">
                    AI What-if
                  </p>
                  <p className="text-[9px] text-white/18">What if I change the price?</p>
                </div>

                {/* Price display */}
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[9px] text-white/18 uppercase tracking-wider mb-0.5">Current</p>
                    <p className="text-[15px] font-black text-white/50">
                      ${vehiclePrice != null ? vehiclePrice.toLocaleString() : "—"}
                    </p>
                  </div>
                  {priceDelta !== 0 && hypoPrice != null && (
                    <>
                      <ArrowRight className="w-3.5 h-3.5 text-white/15" />
                      <div className="text-right">
                        <p className="text-[9px] text-white/18 uppercase tracking-wider mb-0.5">Hypothetical</p>
                        <p className={cn(
                          "text-[15px] font-black",
                          priceDelta < 0 ? "text-emerald-400/70" : "text-red-400/70",
                        )}>
                          ${hypoPrice.toLocaleString()}
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
                    className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.03] flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/[0.06] disabled:opacity-25 transition-colors"
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
                      className="w-full h-1.5 appearance-none rounded-full cursor-pointer bg-white/[0.06] accent-blue-500"
                    />
                  </div>

                  <button
                    disabled={priceDelta >= DELTA_MAX}
                    onClick={() => setPriceDelta(d => Math.min(DELTA_MAX, d + DELTA_STEP))}
                    className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.03] flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/[0.06] disabled:opacity-25 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>

                  <div className={cn(
                    "w-[52px] text-center text-[13px] font-black tabular-nums",
                    priceDelta < 0 ? "text-emerald-400/70" : priceDelta > 0 ? "text-red-400/70" : "text-white/20",
                  )}>
                    {priceDelta > 0 ? "+" : ""}{priceDelta}%
                  </div>
                </div>

                {/* What-if results */}
                {priceDelta === 0 && (
                  <p className="text-[11px] text-white/18 text-center py-1">
                    Use the slider or +/− buttons to model a price change
                  </p>
                )}

                {priceDelta !== 0 && whatIfLoading && (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400/50" />
                    <p className="text-[11px] text-white/20">Calculating…</p>
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
                        <div key={m.label} className="text-center rounded-lg border border-white/[0.04] bg-white/[0.02] py-2 px-1">
                          <DeltaBadge pct={m.value} />
                          <p className="text-[9px] text-white/18 mt-1">{m.label}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-white/32 leading-relaxed">{whatIf.explanation}</p>
                    <p className="text-[9px] text-white/14">
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
          <div className="shrink-0 px-5 py-4 border-t border-white/[0.05] flex gap-2.5">
            <Button
              variant="ghost"
              className="flex-1 h-10 text-white/35 hover:text-white/60 hover:bg-white/[0.04] font-semibold text-[12px]"
              onClick={handleClose}
            >
              {analysis?.recommendation === "HOLD" ? "Hold Vehicle" : "Cancel"}
            </Button>
            <Button
              className={cn(
                "flex-[2] h-10 font-bold text-[13px] gap-2",
                analysis?.recommendation === "HOLD"
                  ? "bg-amber-600 hover:bg-amber-500 text-white"
                  : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20",
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
