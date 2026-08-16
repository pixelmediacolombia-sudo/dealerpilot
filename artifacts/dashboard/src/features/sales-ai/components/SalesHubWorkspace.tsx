import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { AppLayout } from "@/shared/layout/AppLayout";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  useGetDealer,
  useListDealers,
  getGetDealerQueryKey,
  useGetVehicleStats,
  useListListingWorkspaces,
  useListPublishingJobs,
  useListCreativeJobs,
  useGetLeads,
  useListFeedRuns,
  getListFeedRunsQueryKey,
  useListMarketplaceRecommendations,
  useBulkSchedulePublishing,
} from "@workspace/api-client-react";
import { useDealerLocation } from "@/context/LocationContext";
import { cn } from "@/lib/utils";
import { PublishNowModal } from "@/features/publishing/components/PublishNowModal";
import { GmCoachModal } from "@/components/GmCoachModal";
import { GmDecisionLogPanel } from "@/components/GmDecisionLogPanel";
import { formatCurrency, formatNumber } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import {
  buildDailyMarketplacePlan,
  generateReasoning,
  generateMorningBrief,
  computeConfidence,
  computeRisk,
  computeExpectedResults,
  computeWaitingCost,
  computeCreativeRecommendation,
  buildHoldReasons,
  type DailyVehicleRec,
  type DailyMarketplacePlan,
  type DuplicateGroup,
} from "@/lib/dailyPlan";
import {
  UploadCloud,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  Car,
  ImageIcon,
  CheckCircle2,
  ShieldCheck,
  Brain,
  TrendingDown,
  MessageSquare,
  CalendarDays,
  Sparkles,
} from "lucide-react";

// ─── Colour helpers ───────────────────────────────────────────────────────────

function scoreColor(score: number | null) {
  if (score == null) return { pill: "bg-muted border-border text-muted-foreground", label: "" };
  // Opportunity ranking is not an operational alert. Keep its chip in the
  // soft lavender navigation accent; reserve amber for real attention states.
  if (score >= 80) return { pill: "bg-primary/10 border-primary/20 text-primary", label: "HOT" };
  if (score >= 70) return { pill: "bg-primary/10 border-primary/20 text-primary", label: "WARM" };
  return { pill: "bg-primary/10 border-primary/20 text-primary", label: "WATCH" };
}

function langBadgeClass(lang: string) {
  if (lang === "Spanish-first") return "text-orange-400/70";
  if (lang === "Bilingual") return "text-teal-400/70";
  return "text-muted-foreground";
}

function riskColor(level: "LOW" | "MEDIUM" | "HIGH") {
  if (level === "LOW") return "text-success";
  if (level === "MEDIUM") return "text-warning";
  return "text-destructive";
}

function roiColor(roi: "HIGH" | "MEDIUM" | "LOW") {
  if (roi === "HIGH") return "text-success";
  if (roi === "MEDIUM") return "text-warning";
  return "text-muted-foreground";
}

// ─── Morning Brief ────────────────────────────────────────────────────────────

function MorningBrief({ plan }: { plan: DailyMarketplacePlan }) {
  const brief = generateMorningBrief(plan);
  return (
    <div className="rounded-xl border border-primary/10 bg-primary/[0.018] p-6 mb-7">
      <div className="flex items-center gap-2 mb-4">
        <span className="relative flex h-[6px] w-[6px] shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-40" />
          <span className="relative inline-flex rounded-full h-[6px] w-[6px] bg-primary" />
        </span>
        <p className="text-[11px] font-semibold text-primary/40  tracking-wide">
          DealerPilot · Morning Brief
        </p>
      </div>
      <p className="text-[20px] font-semibold text-foreground mb-3 leading-snug">
        {brief.greeting}
      </p>
      <p className="text-[13px] text-muted-foreground leading-relaxed max-w-xl mb-0">
        {brief.body}
      </p>
      {brief.primaryVehicle && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide mb-1.5">
            Primary Opportunity
          </p>
          <p className="text-[14px] font-bold text-muted-foreground">{brief.primaryVehicle}</p>
          {brief.primaryReason && (
            <p className="text-[11px] text-muted-foreground mt-1 italic leading-relaxed max-w-lg">
              {brief.primaryReason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Publishing Schedule ──────────────────────────────────────────────────────

const TODAY_SLOTS = ["09:00", "11:30", "14:00", "17:30"];

function PublishingSchedule({ plan }: { plan: DailyMarketplacePlan }) {
  const all10 = [...plan.recommendedToday, ...plan.nextBest];
  if (all10.length === 0) return null;
  const todayVehicles = all10.slice(0, 4);
  const tomorrowVehicles = all10.slice(4, 7);
  const weekVehicles = all10.slice(7);

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
        <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">
          Campaign Schedule
        </p>
        <div className="flex-1 h-px bg-muted" />
      </div>
      <div className="rounded-xl border border-border overflow-hidden">
        {/* Today */}
        <div className="px-5 py-2 bg-muted border-b border-border">
          <p className="text-[11px] font-semibold text-primary/50  tracking-wide">Today</p>
        </div>
        {todayVehicles.map((v, i) => (
          <div key={v.vehicleId} className="flex items-center gap-4 px-5 py-2.5 border-b border-border last:border-b-0 hover:bg-muted transition-colors">
            <span className="text-[11px] font-bold text-primary/40 font-mono w-[42px] shrink-0">
              {TODAY_SLOTS[i]}
            </span>
            <div className="w-8 h-6 rounded-md overflow-hidden shrink-0 bg-muted">
              {v.primaryImageUrl
                ? <img src={v.primaryImageUrl} alt={v.label} className="w-full h-full object-cover" />
                : <div className="w-full h-full" />}
            </div>
            <p className="flex-1 text-[12px] font-semibold text-muted-foreground truncate">{v.label}</p>
            {v.primarySegment !== "General" && (
              <span className="text-[11px] font-bold text-muted-foreground  tracking-wide shrink-0 hidden lg:block">
                {v.primarySegment}
              </span>
            )}
            <span className={cn("text-[11px] font-bold px-1.5 py-0.5 rounded border shrink-0", scoreColor(v.opportunityScore).pill)}>
              {v.opportunityScore ?? "—"}
            </span>
          </div>
        ))}
        {/* Tomorrow */}
        {tomorrowVehicles.length > 0 && (
          <>
            <div className="px-5 py-2 bg-muted border-y border-border">
              <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">Tomorrow</p>
            </div>
            {tomorrowVehicles.map((v) => (
              <div key={v.vehicleId} className="flex items-center gap-4 px-5 py-2.5 border-b border-border last:border-b-0 opacity-55">
                <span className="text-[11px] font-bold text-muted-foreground font-mono w-[42px] shrink-0">—</span>
                <div className="w-8 h-6 rounded-md overflow-hidden shrink-0 bg-muted">
                  {v.primaryImageUrl
                    ? <img src={v.primaryImageUrl} alt={v.label} className="w-full h-full object-cover" />
                    : <div className="w-full h-full" />}
                </div>
                <p className="flex-1 text-[12px] font-semibold text-muted-foreground truncate">{v.label}</p>
              </div>
            ))}
          </>
        )}
        {/* This Week */}
        {weekVehicles.length > 0 && (
          <>
            <div className="px-5 py-2 bg-muted border-y border-border">
              <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">This Week</p>
            </div>
            {weekVehicles.map((v) => (
              <div key={v.vehicleId} className="flex items-center gap-4 px-5 py-2.5 border-b border-border last:border-b-0 opacity-35">
                <span className="text-[11px] font-bold text-muted-foreground font-mono w-[42px] shrink-0">—</span>
                <div className="w-8 h-6 rounded-md overflow-hidden shrink-0 bg-muted">
                  {v.primaryImageUrl
                    ? <img src={v.primaryImageUrl} alt={v.label} className="w-full h-full object-cover" />
                    : <div className="w-full h-full" />}
                </div>
                <p className="flex-1 text-[12px] font-semibold text-muted-foreground truncate">{v.label}</p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Strategy Row ─────────────────────────────────────────────────────────────

function StrategyRow({
  rec,
  rank,
  duplicateGroups,
  onPublish,
  onAddToBatch,
  selected,
  onSelect,
}: {
  rec: DailyVehicleRec;
  rank: number;
  duplicateGroups: DuplicateGroup[];
  onPublish: (id: number) => void;
  onAddToBatch: (id: number) => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [, setLocation] = useLocation();
  const sc = scoreColor(rec.opportunityScore);
  const isTopMove = rank <= 3;
  const hasSegment = rec.primarySegment && rec.primarySegment !== "General";

  // Pre-compute all GM intelligence (only needed when expanded)
  const intelligence = useMemo(() => {
    if (!expanded) return null;
    const confidence = computeConfidence(rec);
    const risk = computeRisk(rec);
    const results = computeExpectedResults(rec);
    const cost = computeWaitingCost(rec);
    const reasoning = generateReasoning(rec, duplicateGroups);
    const creative = computeCreativeRecommendation(rec);
    const group = duplicateGroups.find(
      g => g.make.toLowerCase() === rec.make.toLowerCase() && g.model.toLowerCase() === rec.model.toLowerCase(),
    );
    return { confidence, risk, results, cost, reasoning, creative, group };
  }, [expanded, rec, duplicateGroups]);

  return (
    <div>
      {/* ── Row ────────────────────────────────────────────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          "gymove-list-row group m-1 flex items-center gap-0 rounded-lg border border-border/70 bg-card transition-[background-color,border-color,box-shadow,transform] hover:border-primary/20 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected && "gymove-list-row-selected",
        )}
      >
        {/* Rank + Score */}
        <div className="w-[66px] shrink-0 py-3.5 pl-3 flex flex-col items-center gap-1.5">
          <span className={cn("gymove-row-anchor flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-[12px] font-bold leading-none text-primary", selected && "bg-primary-foreground/20 text-primary-foreground")}>
            #{rank}
          </span>
          {rec.opportunityScore != null && (
            <span className={cn("gymove-row-status text-[11px] font-semibold px-1.5 rounded border leading-[18px]", sc.pill)}>
              {rec.opportunityScore}
            </span>
          )}
        </div>

        {/* Photo + Vehicle */}
        <div className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-5">
          <div className="h-[40px] w-[50px] shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
            {rec.primaryImageUrl ? (
              <img src={rec.primaryImageUrl} alt={rec.label} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Car className="w-3 h-3 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="gymove-row-title text-[13px] font-bold text-foreground truncate leading-snug">{rec.label}</p>
            <p className="gymove-row-meta mt-0.5 flex items-center gap-x-2 gap-y-0.5 whitespace-nowrap text-xs text-muted-foreground">
              {rec.priceMode === "DOWN_PAYMENT" && rec.marketplacePrice != null ? (
                <span className="shrink-0 text-warning/70">{formatCurrency(rec.marketplacePrice)} down</span>
              ) : rec.actualPrice != null ? (
                <span className="shrink-0">{formatCurrency(rec.actualPrice)}</span>
              ) : null}
              {rec.imageCount > 0 && (
                <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
                  <ImageIcon className="w-2.5 h-2.5" />{rec.imageCount}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Audience */}
        <div className="w-[132px] shrink-0 py-3 pr-4">
          {hasSegment ? (
            <>
              <p className="gymove-row-meta text-[11px] font-semibold text-muted-foreground leading-tight truncate">{rec.primarySegment}</p>
              <p className={cn("gymove-row-language mt-0.5 text-[11px] font-bold tracking-wide", langBadgeClass(rec.suggestedLanguage))}>
                {rec.suggestedLanguage}
              </p>
            </>
          ) : (
            <p className="gymove-row-meta text-[11px] text-muted-foreground">General</p>
          )}
        </div>

        {/* Actions */}
        <div className="py-3 pr-4 shrink-0 flex items-center gap-1.5">
          <button
            className="gymove-row-icon p-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={(event) => { event.stopPropagation(); setExpanded(v => !v); }}
            title="DealerPilot Analysis"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <Button
            size="sm"
            className={cn(
              "h-8 gap-1.5 rounded-md px-3.5 text-[11px] font-bold",
              selected
                ? "gymove-row-cta-active shadow-sm"
                : isTopMove
                  ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                  : "border border-border bg-muted text-muted-foreground hover:bg-muted/80",
            )}
            onClick={(event) => { event.stopPropagation(); onPublish(rec.vehicleId); }}
          >
            <UploadCloud className="w-3 h-3" />
            {isTopMove ? "Publish" : "Queue"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gymove-row-icon h-8 w-8 rounded-md p-0 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => onAddToBatch(rec.vehicleId)}>Add to Batch</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocation("/marketplace-intelligence")}>Market Intelligence</DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(`/creative-studio/${rec.vehicleId}`, "_self")}>Open Vehicle</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── GM Intelligence Panel ──────────────────────────────────────────── */}
      {expanded && intelligence && (
        <div className="border-b border-border bg-muted">
          <div className="px-6 py-5 space-y-4 max-w-[820px]">

            {/* DealerPilot Reasoning */}
            <div className="rounded-xl border border-primary/12 bg-primary/[0.025] p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <Brain className="w-3.5 h-3.5 text-primary/50 shrink-0" />
                <p className="text-[11px] font-semibold text-primary/40  tracking-wide">
                  DealerPilot Reasoning
                </p>
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed">{intelligence.reasoning}</p>
            </div>

            {/* Confidence + Risk */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-muted p-3.5">
                <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide mb-2">
                  Confidence
                </p>
                <div className={cn(
                  "text-[30px] font-semibold leading-none tabular-nums",
                  intelligence.confidence >= 90 ? "text-success" : intelligence.confidence >= 75 ? "text-primary" : "text-warning",
                )}>
                  {intelligence.confidence}%
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  Calculated from inventory quality, pricing, audience match, creative data, and duplicate protection.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-muted p-3.5">
                <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide mb-2">Risk</p>
                <div className={cn("text-[20px] font-semibold leading-none", riskColor(intelligence.risk.level))}>
                  {intelligence.risk.level}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  {intelligence.risk.explanation}
                </p>
              </div>
            </div>

            {/* Expected Results */}
            <div className="rounded-xl border border-border bg-muted p-3.5">
              <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide mb-3">
                Expected Results <span className="text-muted-foreground font-normal normal-case tracking-normal">(projections — not guarantees)</span>
              </p>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <div className="text-[20px] font-semibold text-primary leading-none tabular-nums">
                    {intelligence.results.conversations[0]}–{intelligence.results.conversations[1]}
                  </div>
                  <div className="flex items-center gap-1 mt-1.5">
                    <MessageSquare className="w-2.5 h-2.5 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground  tracking-wide">Conversations</span>
                  </div>
                </div>
                <div>
                  <div className="text-[20px] font-semibold text-primary/70 leading-none tabular-nums">
                    {intelligence.results.appointments[0]}–{intelligence.results.appointments[1]}
                  </div>
                  <div className="text-[11px] text-muted-foreground  tracking-wide mt-1.5">Appointments</div>
                </div>
                <div>
                  <div className="text-[20px] font-semibold text-success/70 leading-none tabular-nums">
                    {intelligence.results.saleProbability}%
                  </div>
                  <div className="text-[11px] text-muted-foreground  tracking-wide mt-1.5">Sale Probability</div>
                </div>
                <div>
                  <div className={cn("text-[20px] font-semibold leading-none", roiColor(intelligence.results.roi))}>
                    {intelligence.results.roi}
                  </div>
                  <div className="text-[11px] text-muted-foreground  tracking-wide mt-1.5">Expected ROI</div>
                </div>
              </div>
            </div>

            {/* Cost of Waiting */}
            <div className="rounded-xl border border-destructive/[0.10] bg-destructive/[0.018] p-3.5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingDown className="w-3 h-3 text-destructive/40 shrink-0" />
                <p className="text-[11px] font-semibold text-destructive/35  tracking-wide">
                  Cost of Waiting — If Delayed 48 Hours
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-[18px] font-semibold text-destructive/50 leading-none tabular-nums">
                    {formatNumber(intelligence.cost.reachLoss)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">Buyers missed</div>
                </div>
                <div>
                  <div className="text-[18px] font-semibold text-destructive/50 leading-none tabular-nums">
                    {intelligence.cost.conversationsLost}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">Conversations lost</div>
                </div>
                <div>
                  <div className="text-[18px] font-semibold text-destructive/50 leading-none tabular-nums">
                    {formatCurrency(intelligence.cost.revenueLoss)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">Revenue opportunity</div>
                </div>
              </div>
            </div>

            {/* Creative Recommendation */}
            <div className="rounded-xl border border-border bg-muted p-3.5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-3 h-3 text-primary/40 shrink-0" />
                <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">
                  Creative Recommendation
                </p>
              </div>
              <div className="flex flex-wrap gap-3 mb-2">
                {intelligence.creative.formats.map((f, i) => (
                  <div key={f.name} className={cn("flex items-center gap-1.5", i > 0 && "opacity-60")}>
                    <span className="text-xs text-muted-foreground">{f.name}</span>
                    <span className={cn("text-xs font-semibold", i === 0 ? "text-primary/70" : "text-muted-foreground")}>
                      {f.score}%
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Hook: <span className="text-muted-foreground italic">"{intelligence.creative.hook}"</span>
                <span className="text-muted-foreground ml-2">· CTR est. {intelligence.creative.ctr}</span>
                <span className="text-muted-foreground mx-2">·</span>
                <span className="text-muted-foreground">Audience: {intelligence.creative.audience}</span>
                <span className="text-muted-foreground mx-2">·</span>
                <span className="text-muted-foreground">Language: {intelligence.creative.language}</span>
              </p>
            </div>

            {/* Counter Analysis — Why not the other model? */}
            {intelligence.group && intelligence.group.holdOthers.length > 0 && (
              <div className="rounded-xl border border-warning/10 bg-warning/[0.015] p-3.5">
                <p className="text-[11px] font-semibold text-warning/35  tracking-wide mb-3">
                  Counter Analysis — Why Not the Other {rec.make} {rec.model}{intelligence.group.holdOthers.length > 1 ? "s" : ""}?
                </p>
                <div className="space-y-2.5">
                  {intelligence.group.holdOthers.map(v => {
                    const holdReasons = buildHoldReasons(v, rec);
                    return (
                      <div key={v.vehicleId}>
                        <p className="text-[11px] font-bold text-muted-foreground mb-1">{v.label}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {holdReasons.slice(0, 3).map((r, i) => (
                            <span key={i} className="text-xs text-warning/40 bg-warning/[0.06] border border-warning/10 px-2 py-0.5 rounded-full">
                              {r}
                            </span>
                          ))}
                        </div>
                        {holdReasons.length > 3 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Recommended publishing date: after this campaign matures.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

// ─── Strategy Table ───────────────────────────────────────────────────────────

function StrategyTable({
  plan,
  onPublish,
  onAddToBatch,
}: {
  plan: DailyMarketplacePlan;
  onPublish: (id: number) => void;
  onAddToBatch: (id: number) => void;
}) {
  const all10 = [...plan.recommendedToday, ...plan.nextBest];
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(all10[0]?.vehicleId ?? null);
  return (
    <div className="gymove-work-queue rounded-xl border border-border bg-muted/45 p-2">
      {/* Table header */}
      <div className="flex items-center gap-0 rounded-lg bg-muted/80 px-1">
        <div className="w-[66px] shrink-0" />
        <div className="min-w-0 flex-1 pr-5 py-2.5 text-[11px] font-semibold text-muted-foreground tracking-wide">Vehicle</div>
        <div className="w-[132px] shrink-0 pr-4 py-2.5 text-[11px] font-semibold text-muted-foreground tracking-wide">Audience</div>
        <div className="w-[130px] shrink-0 pr-4 py-2.5 text-[11px] font-semibold text-muted-foreground  tracking-wide text-right">Action</div>
      </div>

      {/* Top 3 — Publish Today */}
      {plan.recommendedToday.map((rec, i) => (
        <StrategyRow
          key={rec.vehicleId}
          rec={rec}
          rank={i + 1}
          duplicateGroups={plan.duplicateGroups}
          onPublish={onPublish}
          onAddToBatch={onAddToBatch}
          selected={selectedVehicleId === rec.vehicleId}
          onSelect={() => setSelectedVehicleId(rec.vehicleId)}
        />
      ))}

      {/* Divider: Next Best */}
      {plan.nextBest.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="h-px flex-1 bg-muted" />
          <span className="text-[11px] font-semibold text-muted-foreground  tracking-wide">
            Next Best · Positions 4–{3 + plan.nextBest.length}
          </span>
          <div className="h-px flex-1 bg-muted" />
        </div>
      )}

      {/* Next Best 4–10 */}
      {plan.nextBest.map((rec, i) => (
        <StrategyRow
          key={rec.vehicleId}
          rec={rec}
          rank={i + 4}
          duplicateGroups={plan.duplicateGroups}
          onPublish={onPublish}
          onAddToBatch={onAddToBatch}
          selected={selectedVehicleId === rec.vehicleId}
          onSelect={() => setSelectedVehicleId(rec.vehicleId)}
        />
      ))}

      {all10.length === 0 && (
        <div className="p-12 text-center">
          <CheckCircle2 className="w-7 h-7 text-success/22 mx-auto mb-3" />
          <p className="text-[14px] font-semibold text-muted-foreground">Queue is clear</p>
          <p className="text-[11px] text-muted-foreground mt-1.5">No vehicles require action right now</p>
        </div>
      )}
    </div>
  );
}

// ─── Hold Card ────────────────────────────────────────────────────────────────

function HoldCard({ rec }: { rec: DailyVehicleRec }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-muted">
      <div className="w-8 h-8 rounded-md overflow-hidden bg-secondary/40 flex-shrink-0">
        {rec.primaryImageUrl ? (
          <img src={rec.primaryImageUrl} alt={rec.label} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car className="w-3.5 h-3.5 text-muted-foreground/30" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-muted-foreground truncate">{rec.label}</p>
        {rec.holdReason && <p className="text-xs text-muted-foreground/50 truncate">{rec.holdReason}</p>}
      </div>
      {rec.priceMode === "DOWN_PAYMENT" && rec.marketplacePrice != null ? (
        <span className="text-xs text-warning flex-shrink-0">{formatCurrency(rec.marketplacePrice)} down</span>
      ) : rec.actualPrice != null ? (
        <span className="text-xs text-muted-foreground flex-shrink-0">{formatCurrency(rec.actualPrice)}</span>
      ) : null}
    </div>
  );
}

// ─── Command Center ───────────────────────────────────────────────────────────

export function SalesHub() {
  const [, setLocation] = useLocation();
  // Two-step publish flow: GM Coach → confirm → PublishNowModal or batch add
  // mode: "publish" → opens PublishNowModal; "batch" → does bulk-schedule add
  const [coachVehicle, setCoachVehicle] = useState<{ id: number; label: string; price: number | null; mode: "publish" | "batch" } | null>(null);
  const [publishNowVehicleId, setPublishNowVehicleId] = useState<number | null>(null);
  const [showHold, setShowHold] = useState(false);

  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers?.[0]?.id;
  const { data: dealer } = useGetDealer(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getGetDealerQueryKey(dealerId!) },
  });

  const { selectedLocation } = useDealerLocation();
  const locationFilter = selectedLocation || undefined;

  const { data: vehicleStats } = useGetVehicleStats({ location: locationFilter });
  const { data: workspacesData, isLoading: workspacesLoading } = useListListingWorkspaces({ location: locationFilter });
  const { data: recsData, isLoading: recsLoading } = useListMarketplaceRecommendations({ location: locationFilter });
  const { data: jobsData } = useListPublishingJobs({ location: locationFilter });
  const { data: creativeJobs } = useListCreativeJobs();
  const { data: leads } = useGetLeads();
  const { data: feedRuns } = useListFeedRuns(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getListFeedRunsQueryKey(dealerId!) },
  });

  const bulkSchedule = useBulkSchedulePublishing({
    mutation: {
      onSuccess: (result) => {
        toast({
          title: "Publishing queued",
          description: `${result.enqueued} vehicle${result.enqueued !== 1 ? "s" : ""} added to the publishing queue.`,
        });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to queue vehicle for publishing.", variant: "destructive" });
      },
    },
  });

  // GM Coach called this on confirm — dispatch based on what flow opened the modal
  const handlePublishConfirmed = (vehicleId: number) => {
    const mode = coachVehicle?.mode ?? "publish";
    setCoachVehicle(null);
    if (mode === "batch") {
      // The operator explicitly confirmed the GM review — pass the vehicleId as an override
      // so the API guardrail knows this is an acknowledged decision
      bulkSchedule.mutate(
        { data: { vehicleIds: [vehicleId], spacingMinutes: 30, gmOverrides: [vehicleId] } },
        { onSuccess: () => toast({ title: "Added to batch" }) },
      );
    } else {
      setPublishNowVehicleId(vehicleId);
    }
  };

  // Helper: open GM Coach for a given vehicle (reused by Publish, Add to Batch, and Publish Next Best)
  const openCoach = (vehicleId: number, mode: "publish" | "batch") => {
    const all = plan ? [...plan.recommendedToday, ...plan.nextBest] : [];
    const rec = all.find(r => r.vehicleId === vehicleId);
    setCoachVehicle({ id: vehicleId, label: rec?.label ?? "Vehicle", price: rec?.actualPrice ?? null, mode });
  };

  // Clicking "Publish" on any row gates through GM Coach → PublishNowModal
  const handlePublish = (vehicleId: number) => openCoach(vehicleId, "publish");

  // Clicking "Add to Batch" on any row gates through GM Coach first
  const handleAddToBatch = (vehicleId: number) => openCoach(vehicleId, "batch");

  const plan = useMemo((): DailyMarketplacePlan | null => {
    if (!workspacesData?.workspaces || !recsData?.recommendations || !jobsData?.jobs) return null;
    return buildDailyMarketplacePlan(
      workspacesData.workspaces,
      recsData.recommendations as never,
      jobsData.jobs,
    );
  }, [workspacesData, recsData, jobsData]);

  const isLoading = workspacesLoading || recsLoading;
  const top10Count = plan ? plan.recommendedToday.length + plan.nextBest.length : 0;
  const pendingLeads = leads?.leads?.filter((lead) => lead.status === "new").length ?? 0;
  const priceChanges = vehicleStats?.priceChanged ?? 0;
  const queuedCount = (jobsData?.jobs ?? []).filter(j => ["Queued", "Scheduled", "Publishing", "Assigned"].includes(j.status)).length;
  const listingsLive = (workspacesData?.workspaces ?? []).filter(
    w => w.publishStatus === "published" || w.publishStatus === "published_with_changes",
  ).length;
  const failedJobs = (jobsData?.jobs ?? []).filter(j => j.status === "Failed").length;
  const issueCount = failedJobs + (priceChanges > 0 ? 1 : 0);
  const duplicateGroupCount = plan?.duplicateGroups.length ?? 0;

  const activityItems = useMemo(() => {
    type Item = { id: string; label: string; sub: string; date: Date; color: string; action?: string; actionPath?: string };
    const items: Item[] = [];
    feedRuns?.feedRuns?.forEach(run => {
      if (run.finishedAt) {
        const isAuto = (run as unknown as Record<string, unknown>).triggerType === "auto";
        items.push({ id: `feed-${run.id}`, label: isAuto ? "Inventory synced automatically" : "Inventory synced", sub: `${run.vehiclesNew ?? 0} new · ${run.vehiclesUpdated ?? 0} updated · ${run.vehiclesRemoved ?? 0} removed`, date: new Date(run.finishedAt), color: "bg-primary", action: "View Inventory", actionPath: "/inventory" });
      }
    });
    creativeJobs?.jobs?.forEach(job => {
      if (job.completedAt) items.push({ id: `creative-${job.id}`, label: "Creative generated", sub: job.vehicleLabel ?? "Vehicle", date: new Date(job.completedAt), color: "bg-accent" });
    });
    jobsData?.jobs?.forEach(job => {
      if (job.completedAt && job.status === "Published") items.push({ id: `pub-${job.id}`, label: "Listing published", sub: job.vehicleLabel ?? "Vehicle", date: new Date(job.completedAt), color: "bg-success", action: "View Queue", actionPath: "/listings?tab=publishing" });
      if (job.status === "Failed") items.push({ id: `fail-${job.id}`, label: "Publish failed", sub: `${job.vehicleLabel ?? "Vehicle"} — ${job.failedReason ?? "unknown reason"}`, date: new Date(job.updatedAt ?? job.createdAt), color: "bg-destructive", action: "Retry", actionPath: "/listings?tab=failed" });
    });
    leads?.leads?.slice(0, 5).forEach(lead => {
      items.push({ id: `lead-${lead.id}`, label: "Buyer message received", sub: lead.status === "new" ? "Awaiting reply" : `Status: ${lead.status}`, date: new Date(lead.createdAt), color: "bg-warning", action: "Reply", actionPath: "/sales-ai" });
    });
    return items.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 15);
  }, [feedRuns, creativeJobs, jobsData, leads]);

  return (
    <AppLayout>
      <div className="flex h-full min-w-0 overflow-hidden">

        {/* ── MAIN COLUMN ────────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1 overflow-y-auto bg-background">
          <div className="max-w-[1240px] p-4 sm:p-6 lg:p-7">

            {/* Mission Header */}
            <div className="mb-6 rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_12px_rgb(15_23_42/0.035)] sm:p-6">
              <p className="text-[11px] font-semibold text-primary/32  tracking-wide mb-5">
                Command · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </p>
              <div className="flex flex-col items-stretch gap-5 sm:flex-row sm:items-end sm:gap-6">
                <div className="flex-1">
                  <h1 className="mb-3 text-[42px] font-semibold leading-[0.95] tracking-tight text-foreground sm:text-[52px]">
                    {isLoading ? (
                      <span className="text-muted-foreground">Loading…</span>
                    ) : top10Count > 0 ? (
                      <><span className="text-primary">{top10Count}</span>{" "}Opportunit{top10Count !== 1 ? "ies" : "y"}{"\n"}Today</>
                    ) : (
                      "All Clear"
                    )}
                  </h1>
                  <p className="text-[16px] text-muted-foreground leading-relaxed font-normal max-w-lg">
                    {isLoading ? "" : plan?.summary ?? `${dealer?.name ?? "Alpha Motorsport"} — no action required right now.`}
                  </p>
                </div>
                <Button
                  className="h-11 w-full shrink-0 gap-2.5 rounded-lg bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 sm:w-auto"
                  disabled={!plan?.recommendedToday[0] || isLoading}
                  onClick={() => plan?.recommendedToday[0] && handlePublish(plan.recommendedToday[0].vehicleId)}
                >
                  <UploadCloud className="w-4 h-4" />
                  Publish Next Best
                </Button>
              </div>
            </div>

            {/* Gymove-style KPI row: same live values, denser operational presentation */}
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[
                { value: isLoading ? "—" : String(vehicleStats?.readyToPublish ?? top10Count), label: "Ready", path: "/listings", tone: "purple" },
                { value: isLoading ? "—" : String(listingsLive), label: "Live", path: "/listings?tab=published", tone: "green" },
                { value: isLoading ? "—" : String(pendingLeads), label: "Buyers", path: "/sales-ai", tone: "blue" },
                { value: "0", label: "Appts", path: "/sales-ai", tone: "pink" },
                { value: isLoading ? "—" : String(issueCount), label: "Issues", path: "/listings?tab=failed", tone: "amber" },
              ].map(m => (
                <button key={m.label} onClick={() => setLocation(m.path)} data-kpi-tone={m.tone} className={cn("gymove-kpi-card min-h-[104px] rounded-lg border px-4 py-4 text-left shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_12px_rgb(15_23_42/0.035)] transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:shadow-md", m.tone === "purple" ? "gymove-kpi-purple" : m.tone === "green" ? "gymove-kpi-green" : m.tone === "blue" ? "gymove-kpi-blue" : "gymove-kpi-pink") }>
                  <div className="mb-2 text-[30px] font-bold leading-none tracking-tighter tabular-nums text-foreground">{m.value}</div>
                  <div className="text-[11px] font-semibold text-muted-foreground">{m.label}</div>
                </button>
              ))}
            </div>

            {/* Publishing Conflicts notice */}
            {!isLoading && duplicateGroupCount > 0 && (
              <button
                onClick={() => setLocation("/marketplace-intelligence/publishing-conflicts")}
                className="w-full flex items-center gap-3 mb-6 px-4 py-3 rounded-xl border border-warning/15 bg-warning/[0.04] hover:bg-warning/[0.07] transition-colors text-left group"
              >
                <ShieldCheck className="w-4 h-4 text-warning/60 shrink-0" />
                <span className="flex-1 text-[11px] text-warning/60">
                  <span className="font-bold">{duplicateGroupCount} duplicate group{duplicateGroupCount !== 1 ? "s" : ""} detected</span>
                  {" "}— DealerPilot is protecting these vehicles from self-competition.
                </span>
                <span className="text-xs font-bold text-warning/40 group-hover:text-warning/70 transition-colors  tracking-wider">
                  View →
                </span>
              </button>
            )}

            {/* Morning Brief */}
            {!isLoading && plan && top10Count > 0 && <MorningBrief plan={plan} />}

            {/* Today's Publishing Strategy */}
            <div className="mb-8 rounded-xl border border-border bg-card p-3 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_12px_rgb(15_23_42/0.035)] sm:p-4">
              <div className="flex items-center gap-3 mb-4">
                <p className="text-[11px] font-semibold text-muted-foreground tracking-wide">
                  Today's Publishing Strategy
                </p>
                {plan && (
                  <span className="text-[11px] font-bold text-primary/38 font-mono">
                    {top10Count} vehicle{top10Count !== 1 ? "s" : ""}
                  </span>
                )}
                <div className="flex-1 h-px bg-muted" />
              </div>

              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="h-[72px] rounded-xl bg-muted animate-pulse" />
                  ))}
                </div>
              ) : plan ? (
                <StrategyTable plan={plan} onPublish={handlePublish} onAddToBatch={handleAddToBatch} />
              ) : (
                <div className="rounded-xl border border-border bg-muted p-12 text-center">
                  <CheckCircle2 className="w-7 h-7 text-success/22 mx-auto mb-3" />
                  <p className="text-[14px] font-semibold text-muted-foreground">
                    {queuedCount > 0 ? `${queuedCount} vehicle${queuedCount !== 1 ? "s" : ""} already publishing` : "No vehicles require action right now"}
                  </p>
                </div>
              )}
            </div>

            {/* Campaign Schedule */}
            {!isLoading && plan && top10Count > 0 && <PublishingSchedule plan={plan} />}

            {/* Hold Today */}
            {plan && plan.holdToday.length > 0 && (
              <div className="mb-8">
                <button className="flex items-center gap-2 w-full mb-3" onClick={() => setShowHold(v => !v)}>
                  <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">Hold Today · {plan.holdToday.length}</p>
                  <div className="flex-1 h-px bg-muted" />
                  {showHold ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
                </button>
                {showHold && (
                  <div className="space-y-1.5">
                    {plan.holdToday.slice(0, 8).map(rec => <HoldCard key={rec.vehicleId} rec={rec} />)}
                  </div>
                )}
              </div>
            )}

            {/* GM Decision Log */}
            <GmDecisionLogPanel />

          </div>
        </div>

        {/* ── System Timeline ────────────────────────────────────────────────── */}
        <div className="hidden h-full w-[260px] shrink-0 flex-col border-l border-border xl:flex">
          <div className="px-5 pt-5 pb-3.5 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">System Timeline</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {activityItems.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-[12px]">No recent activity</div>
            ) : (
              <div className="flex flex-col">
                {activityItems.map((item, idx) => (
                  <div key={item.id} className="px-5 py-3 border-b border-border hover:bg-muted transition-colors relative">
                    {idx === 0 && <div className="absolute bottom-0 left-0 top-0 w-0.5 bg-primary" />}
                    <div className="flex items-start gap-2.5">
                      <span className={cn("w-[5px] h-[5px] rounded-full mt-[5px] shrink-0 opacity-70", item.color)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-muted-foreground leading-snug">{item.label}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{item.sub}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[11px] text-muted-foreground font-mono">{format(item.date, "HH:mm")}</p>
                          {item.action && item.actionPath && (
                            <button className="text-[11px] text-primary/40 hover:text-primary font-bold  tracking-wider transition-colors" onClick={() => setLocation(item.actionPath!)}>
                              {item.action} →
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
      <GmCoachModal
        vehicleId={coachVehicle?.id ?? null}
        vehicleLabel={coachVehicle?.label}
        vehiclePrice={coachVehicle?.price}
        onConfirmPublish={handlePublishConfirmed}
        onClose={() => setCoachVehicle(null)}
      />
      <PublishNowModal vehicleId={publishNowVehicleId} onClose={() => setPublishNowVehicleId(null)} />
    </AppLayout>
  );
}
