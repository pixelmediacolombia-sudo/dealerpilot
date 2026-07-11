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
import { formatCurrency } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import {
  buildDailyMarketplacePlan,
  generateReason,
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
  if (score == null) return { pill: "bg-white/[0.06] border-white/10 text-white/25", label: "" };
  if (score >= 80) return { pill: "bg-green-500/15 border-green-500/25 text-green-400", label: "HOT" };
  if (score >= 70) return { pill: "bg-amber-500/15 border-amber-500/25 text-amber-400", label: "WARM" };
  return { pill: "bg-white/[0.06] border-white/10 text-white/35", label: "WATCH" };
}

function langBadgeClass(lang: string) {
  if (lang === "Spanish-first") return "text-orange-400/70";
  if (lang === "Bilingual") return "text-teal-400/70";
  return "text-white/20";
}

function riskColor(level: "LOW" | "MEDIUM" | "HIGH") {
  if (level === "LOW") return "text-emerald-400";
  if (level === "MEDIUM") return "text-amber-400";
  return "text-red-400";
}

function roiColor(roi: "HIGH" | "MEDIUM" | "LOW") {
  if (roi === "HIGH") return "text-emerald-400";
  if (roi === "MEDIUM") return "text-amber-400";
  return "text-white/30";
}

// ─── Morning Brief ────────────────────────────────────────────────────────────

function MorningBrief({ plan }: { plan: DailyMarketplacePlan }) {
  const brief = generateMorningBrief(plan);
  return (
    <div className="rounded-2xl border border-blue-500/10 bg-blue-500/[0.018] p-6 mb-7">
      <div className="flex items-center gap-2 mb-4">
        <span className="relative flex h-[6px] w-[6px] shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-40" />
          <span className="relative inline-flex rounded-full h-[6px] w-[6px] bg-blue-400" />
        </span>
        <p className="text-[9px] font-black text-blue-400/40 uppercase tracking-[0.28em]">
          DealerPilot · Morning Brief
        </p>
      </div>
      <p className="text-[20px] font-semibold text-white/72 mb-3 leading-snug">
        {brief.greeting}
      </p>
      <p className="text-[13px] text-white/38 leading-relaxed max-w-xl mb-0">
        {brief.body}
      </p>
      {brief.primaryVehicle && (
        <div className="mt-4 pt-4 border-t border-white/[0.05]">
          <p className="text-[9px] font-black text-white/18 uppercase tracking-[0.22em] mb-1.5">
            Primary Opportunity
          </p>
          <p className="text-[14px] font-bold text-white/65">{brief.primaryVehicle}</p>
          {brief.primaryReason && (
            <p className="text-[11px] text-white/32 mt-1 italic leading-relaxed max-w-lg">
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
        <CalendarDays className="w-3.5 h-3.5 text-white/18" />
        <p className="text-[9px] font-black text-white/18 uppercase tracking-[0.22em]">
          Campaign Schedule
        </p>
        <div className="flex-1 h-px bg-white/[0.04]" />
      </div>
      <div className="rounded-2xl border border-white/[0.05] overflow-hidden">
        {/* Today */}
        <div className="px-5 py-2 bg-white/[0.008] border-b border-white/[0.04]">
          <p className="text-[9px] font-black text-blue-400/50 uppercase tracking-[0.22em]">Today</p>
        </div>
        {todayVehicles.map((v, i) => (
          <div key={v.vehicleId} className="flex items-center gap-4 px-5 py-2.5 border-b border-white/[0.025] last:border-b-0 hover:bg-white/[0.015] transition-colors">
            <span className="text-[11px] font-bold text-blue-400/40 font-mono w-[42px] shrink-0">
              {TODAY_SLOTS[i]}
            </span>
            <div className="w-8 h-6 rounded-md overflow-hidden shrink-0 bg-white/[0.03]">
              {v.primaryImageUrl
                ? <img src={v.primaryImageUrl} alt={v.label} className="w-full h-full object-cover" />
                : <div className="w-full h-full" />}
            </div>
            <p className="flex-1 text-[12px] font-semibold text-white/60 truncate">{v.label}</p>
            {v.primarySegment !== "General" && (
              <span className="text-[9px] font-bold text-white/20 uppercase tracking-wide shrink-0 hidden lg:block">
                {v.primarySegment}
              </span>
            )}
            <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0", scoreColor(v.opportunityScore).pill)}>
              {v.opportunityScore ?? "—"}
            </span>
          </div>
        ))}
        {/* Tomorrow */}
        {tomorrowVehicles.length > 0 && (
          <>
            <div className="px-5 py-2 bg-white/[0.005] border-y border-white/[0.04]">
              <p className="text-[9px] font-black text-white/15 uppercase tracking-[0.22em]">Tomorrow</p>
            </div>
            {tomorrowVehicles.map((v) => (
              <div key={v.vehicleId} className="flex items-center gap-4 px-5 py-2.5 border-b border-white/[0.025] last:border-b-0 opacity-55">
                <span className="text-[11px] font-bold text-white/12 font-mono w-[42px] shrink-0">—</span>
                <div className="w-8 h-6 rounded-md overflow-hidden shrink-0 bg-white/[0.03]">
                  {v.primaryImageUrl
                    ? <img src={v.primaryImageUrl} alt={v.label} className="w-full h-full object-cover" />
                    : <div className="w-full h-full" />}
                </div>
                <p className="flex-1 text-[12px] font-semibold text-white/45 truncate">{v.label}</p>
              </div>
            ))}
          </>
        )}
        {/* This Week */}
        {weekVehicles.length > 0 && (
          <>
            <div className="px-5 py-2 bg-white/[0.005] border-y border-white/[0.04]">
              <p className="text-[9px] font-black text-white/12 uppercase tracking-[0.22em]">This Week</p>
            </div>
            {weekVehicles.map((v) => (
              <div key={v.vehicleId} className="flex items-center gap-4 px-5 py-2.5 border-b border-white/[0.025] last:border-b-0 opacity-35">
                <span className="text-[11px] font-bold text-white/10 font-mono w-[42px] shrink-0">—</span>
                <div className="w-8 h-6 rounded-md overflow-hidden shrink-0 bg-white/[0.03]">
                  {v.primaryImageUrl
                    ? <img src={v.primaryImageUrl} alt={v.label} className="w-full h-full object-cover" />
                    : <div className="w-full h-full" />}
                </div>
                <p className="flex-1 text-[12px] font-semibold text-white/30 truncate">{v.label}</p>
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
}: {
  rec: DailyVehicleRec;
  rank: number;
  duplicateGroups: DuplicateGroup[];
  onPublish: (id: number) => void;
  onAddToBatch: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [, setLocation] = useLocation();
  const sc = scoreColor(rec.opportunityScore);
  const isTopMove = rank <= 3;
  const reason = generateReason(rec);
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
        className={cn(
          "flex items-center gap-0 border-b border-white/[0.035] hover:bg-white/[0.018] transition-colors group",
          isTopMove && "border-l-[2px] border-l-blue-500/25",
        )}
      >
        {/* Rank + Score */}
        <div className="w-[58px] shrink-0 py-3.5 pl-4 flex flex-col items-center gap-1.5">
          <span className={cn("text-[12px] font-black leading-none", isTopMove ? "text-blue-400" : "text-white/18")}>
            #{rank}
          </span>
          {rec.opportunityScore != null && (
            <span className={cn("text-[9px] font-black px-1.5 rounded border leading-[18px]", sc.pill)}>
              {rec.opportunityScore}
            </span>
          )}
        </div>

        {/* Photo + Vehicle */}
        <div className="flex items-center gap-3 py-3 pr-5 flex-[2.2] min-w-0">
          <div className="w-[58px] h-[44px] rounded-lg overflow-hidden shrink-0 bg-white/[0.03] border border-white/[0.04]">
            {rec.primaryImageUrl ? (
              <img src={rec.primaryImageUrl} alt={rec.label} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Car className="w-3 h-3 text-white/10" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-white/85 truncate leading-snug">{rec.label}</p>
            <p className="text-[10px] text-white/22 mt-0.5 flex items-center gap-2">
              {rec.priceMode === "DOWN_PAYMENT" && rec.marketplacePrice != null ? (
                <span className="text-amber-400/70">{formatCurrency(rec.marketplacePrice)} down</span>
              ) : rec.actualPrice != null ? (
                <span>{formatCurrency(rec.actualPrice)}</span>
              ) : null}
              {rec.imageCount > 0 && (
                <span className="flex items-center gap-0.5 text-white/15">
                  <ImageIcon className="w-2.5 h-2.5" />{rec.imageCount}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Audience */}
        <div className="py-3 pr-5 w-[148px] shrink-0">
          {hasSegment ? (
            <>
              <p className="text-[11px] font-semibold text-white/55 leading-tight truncate">{rec.primarySegment}</p>
              <p className={cn("text-[9px] font-bold mt-0.5 uppercase tracking-wide", langBadgeClass(rec.suggestedLanguage))}>
                {rec.suggestedLanguage}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-white/22">General</p>
          )}
        </div>

        {/* Reason */}
        <div className="py-3 pr-5 flex-[1.8] min-w-0 hidden lg:block">
          <p className="text-[11px] text-white/32 leading-relaxed line-clamp-2">{reason}</p>
        </div>

        {/* Actions */}
        <div className="py-3 pr-4 shrink-0 flex items-center gap-1.5">
          <button
            className="text-white/12 hover:text-white/35 p-1 transition-colors"
            onClick={() => setExpanded(v => !v)}
            title="DealerPilot Analysis"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <Button
            size="sm"
            className={cn(
              "h-7 gap-1.5 text-[11px] font-bold px-3.5 rounded-lg",
              isTopMove
                ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                : "bg-white/[0.05] hover:bg-white/[0.09] text-white/50 border border-white/[0.06]",
            )}
            onClick={() => onPublish(rec.vehicleId)}
          >
            <UploadCloud className="w-3 h-3" />
            {isTopMove ? "Publish" : "Queue"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-white/15 hover:text-white/40 hover:bg-white/[0.04] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
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
        <div className="border-b border-white/[0.04] bg-white/[0.006]">
          <div className="px-6 py-5 space-y-4 max-w-[820px]">

            {/* DealerPilot Reasoning */}
            <div className="rounded-xl border border-blue-500/12 bg-blue-500/[0.025] p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <Brain className="w-3.5 h-3.5 text-blue-400/50 shrink-0" />
                <p className="text-[9px] font-black text-blue-400/40 uppercase tracking-[0.24em]">
                  DealerPilot Reasoning
                </p>
              </div>
              <p className="text-[12px] text-white/48 leading-relaxed">{intelligence.reasoning}</p>
            </div>

            {/* Confidence + Risk */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.018] p-3.5">
                <p className="text-[9px] font-black text-white/15 uppercase tracking-[0.22em] mb-2">
                  Confidence
                </p>
                <div className={cn(
                  "text-[30px] font-black leading-none tabular-nums",
                  intelligence.confidence >= 90 ? "text-emerald-400" : intelligence.confidence >= 75 ? "text-blue-400" : "text-amber-400",
                )}>
                  {intelligence.confidence}%
                </div>
                <p className="text-[10px] text-white/22 mt-1.5 leading-relaxed">
                  Calculated from inventory quality, pricing, audience match, creative data, and duplicate protection.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.018] p-3.5">
                <p className="text-[9px] font-black text-white/15 uppercase tracking-[0.22em] mb-2">Risk</p>
                <div className={cn("text-[20px] font-black leading-none", riskColor(intelligence.risk.level))}>
                  {intelligence.risk.level}
                </div>
                <p className="text-[10px] text-white/25 mt-1.5 leading-relaxed">
                  {intelligence.risk.explanation}
                </p>
              </div>
            </div>

            {/* Expected Results */}
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.018] p-3.5">
              <p className="text-[9px] font-black text-white/15 uppercase tracking-[0.22em] mb-3">
                Expected Results <span className="text-white/10 font-normal normal-case tracking-normal">(projections — not guarantees)</span>
              </p>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <div className="text-[20px] font-black text-blue-400 leading-none tabular-nums">
                    {intelligence.results.conversations[0]}–{intelligence.results.conversations[1]}
                  </div>
                  <div className="flex items-center gap-1 mt-1.5">
                    <MessageSquare className="w-2.5 h-2.5 text-white/20" />
                    <span className="text-[9px] text-white/22 uppercase tracking-wide">Conversations</span>
                  </div>
                </div>
                <div>
                  <div className="text-[20px] font-black text-blue-400/70 leading-none tabular-nums">
                    {intelligence.results.appointments[0]}–{intelligence.results.appointments[1]}
                  </div>
                  <div className="text-[9px] text-white/22 uppercase tracking-wide mt-1.5">Appointments</div>
                </div>
                <div>
                  <div className="text-[20px] font-black text-emerald-400/70 leading-none tabular-nums">
                    {intelligence.results.saleProbability}%
                  </div>
                  <div className="text-[9px] text-white/22 uppercase tracking-wide mt-1.5">Sale Probability</div>
                </div>
                <div>
                  <div className={cn("text-[20px] font-black leading-none", roiColor(intelligence.results.roi))}>
                    {intelligence.results.roi}
                  </div>
                  <div className="text-[9px] text-white/22 uppercase tracking-wide mt-1.5">Expected ROI</div>
                </div>
              </div>
            </div>

            {/* Cost of Waiting */}
            <div className="rounded-xl border border-red-500/[0.10] bg-red-500/[0.018] p-3.5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingDown className="w-3 h-3 text-red-400/40 shrink-0" />
                <p className="text-[9px] font-black text-red-400/35 uppercase tracking-[0.22em]">
                  Cost of Waiting — If Delayed 48 Hours
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-[18px] font-black text-red-400/50 leading-none tabular-nums">
                    {intelligence.cost.reachLoss.toLocaleString()}
                  </div>
                  <div className="text-[9px] text-white/18 mt-1">Buyers missed</div>
                </div>
                <div>
                  <div className="text-[18px] font-black text-red-400/50 leading-none tabular-nums">
                    {intelligence.cost.conversationsLost}
                  </div>
                  <div className="text-[9px] text-white/18 mt-1">Conversations lost</div>
                </div>
                <div>
                  <div className="text-[18px] font-black text-red-400/50 leading-none tabular-nums">
                    ${intelligence.cost.revenueLoss.toLocaleString()}
                  </div>
                  <div className="text-[9px] text-white/18 mt-1">Revenue opportunity</div>
                </div>
              </div>
            </div>

            {/* Creative Recommendation */}
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.018] p-3.5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-3 h-3 text-violet-400/40 shrink-0" />
                <p className="text-[9px] font-black text-white/15 uppercase tracking-[0.22em]">
                  Creative Recommendation
                </p>
              </div>
              <div className="flex flex-wrap gap-3 mb-2">
                {intelligence.creative.formats.map((f, i) => (
                  <div key={f.name} className={cn("flex items-center gap-1.5", i > 0 && "opacity-60")}>
                    <span className="text-[10px] text-white/40">{f.name}</span>
                    <span className={cn("text-[10px] font-black", i === 0 ? "text-violet-400/70" : "text-white/20")}>
                      {f.score}%
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-white/30 leading-relaxed">
                Hook: <span className="text-white/48 italic">"{intelligence.creative.hook}"</span>
                <span className="text-white/18 ml-2">· CTR est. {intelligence.creative.ctr}</span>
                <span className="text-white/18 mx-2">·</span>
                <span className="text-white/30">Audience: {intelligence.creative.audience}</span>
                <span className="text-white/18 mx-2">·</span>
                <span className="text-white/30">Language: {intelligence.creative.language}</span>
              </p>
            </div>

            {/* Counter Analysis — Why not the other model? */}
            {intelligence.group && intelligence.group.holdOthers.length > 0 && (
              <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.015] p-3.5">
                <p className="text-[9px] font-black text-amber-400/35 uppercase tracking-[0.22em] mb-3">
                  Counter Analysis — Why Not the Other {rec.make} {rec.model}{intelligence.group.holdOthers.length > 1 ? "s" : ""}?
                </p>
                <div className="space-y-2.5">
                  {intelligence.group.holdOthers.map(v => {
                    const holdReasons = buildHoldReasons(v, rec);
                    return (
                      <div key={v.vehicleId}>
                        <p className="text-[11px] font-bold text-white/45 mb-1">{v.label}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {holdReasons.slice(0, 3).map((r, i) => (
                            <span key={i} className="text-[10px] text-amber-400/40 bg-amber-500/[0.06] border border-amber-500/10 px-2 py-0.5 rounded-full">
                              {r}
                            </span>
                          ))}
                        </div>
                        {holdReasons.length > 3 && (
                          <p className="text-[10px] text-white/18 mt-1">
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
  return (
    <div className="rounded-2xl border border-white/[0.05] overflow-hidden">
      {/* Table header */}
      <div className="flex items-center gap-0 border-b border-white/[0.05] bg-white/[0.008]">
        <div className="w-[58px] shrink-0" />
        <div className="flex-[2.2] pr-5 py-2.5 text-[9px] font-black text-white/18 uppercase tracking-[0.22em]">Vehicle</div>
        <div className="w-[148px] shrink-0 pr-5 py-2.5 text-[9px] font-black text-white/18 uppercase tracking-[0.22em]">Audience</div>
        <div className="flex-[1.8] pr-5 py-2.5 text-[9px] font-black text-white/18 uppercase tracking-[0.22em] hidden lg:block">Reason</div>
        <div className="w-[130px] shrink-0 pr-4 py-2.5 text-[9px] font-black text-white/18 uppercase tracking-[0.22em] text-right">Action</div>
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
        />
      ))}

      {/* Divider: Next Best */}
      {plan.nextBest.length > 0 && (
        <div className="flex items-center gap-3 px-5 py-2 border-y border-white/[0.04] bg-white/[0.004]">
          <div className="h-px flex-1 bg-white/[0.04]" />
          <span className="text-[9px] font-black text-white/14 uppercase tracking-[0.24em]">
            Next Best · Positions 4–{3 + plan.nextBest.length}
          </span>
          <div className="h-px flex-1 bg-white/[0.04]" />
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
        />
      ))}

      {all10.length === 0 && (
        <div className="p-12 text-center">
          <CheckCircle2 className="w-7 h-7 text-emerald-400/22 mx-auto mb-3" />
          <p className="text-[14px] font-semibold text-white/30">Queue is clear</p>
          <p className="text-[11px] text-white/18 mt-1.5">No vehicles require action right now</p>
        </div>
      )}
    </div>
  );
}

// ─── Hold Card ────────────────────────────────────────────────────────────────

function HoldCard({ rec }: { rec: DailyVehicleRec }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-white/[0.04] bg-white/[0.012]">
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
        <p className="text-xs font-semibold text-white/65 truncate">{rec.label}</p>
        {rec.holdReason && <p className="text-[10px] text-muted-foreground/50 truncate">{rec.holdReason}</p>}
      </div>
      {rec.priceMode === "DOWN_PAYMENT" && rec.marketplacePrice != null ? (
        <span className="text-[10px] text-amber-400 flex-shrink-0">{formatCurrency(rec.marketplacePrice)} down</span>
      ) : rec.actualPrice != null ? (
        <span className="text-[10px] text-muted-foreground flex-shrink-0">{formatCurrency(rec.actualPrice)}</span>
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
  const pendingLeads = leads?.leads.filter(l => l.status === "new").length ?? 0;
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
      <div className="h-full flex overflow-hidden">

        {/* ── MAIN COLUMN ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-8 max-w-[960px]">

            {/* Mission Header */}
            <div className="mb-8 pt-1">
              <p className="text-[9px] font-black text-blue-400/32 uppercase tracking-[0.28em] mb-5">
                Command · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </p>
              <div className="flex items-end gap-6">
                <div className="flex-1">
                  <h1 className="text-[52px] font-black text-white tracking-tight leading-[0.9] mb-3">
                    {isLoading ? (
                      <span className="text-white/12">Loading…</span>
                    ) : top10Count > 0 ? (
                      <><span className="text-blue-400">{top10Count}</span>{" "}Opportunit{top10Count !== 1 ? "ies" : "y"}{"\n"}Today</>
                    ) : (
                      "All Clear"
                    )}
                  </h1>
                  <p className="text-[16px] text-white/28 leading-relaxed font-normal max-w-lg">
                    {isLoading ? "" : plan?.summary ?? `${dealer?.name ?? "Alpha Motorsport"} — no action required right now.`}
                  </p>
                </div>
                <Button
                  className="shrink-0 h-11 gap-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-[14px] px-7 shadow-xl shadow-blue-500/20 rounded-xl mb-0.5"
                  disabled={!plan?.recommendedToday[0] || isLoading}
                  onClick={() => plan?.recommendedToday[0] && handlePublish(plan.recommendedToday[0].vehicleId)}
                >
                  <UploadCloud className="w-4 h-4" />
                  Publish Next Best
                </Button>
              </div>
            </div>

            {/* Metric strip */}
            <div className="flex items-stretch border-y border-white/[0.04] mb-8 -mx-8 px-8">
              {[
                { value: isLoading ? "—" : String(vehicleStats?.readyToPublish ?? top10Count), label: "Ready", accent: "text-blue-400", path: "/listings" },
                { value: isLoading ? "—" : String(listingsLive), label: "Live", accent: listingsLive > 0 ? "text-green-400" : "text-white/15", path: "/listings?tab=published" },
                { value: isLoading ? "—" : String(pendingLeads), label: "Buyers", accent: pendingLeads > 0 ? "text-violet-400" : "text-white/15", path: "/sales-ai" },
                { value: "0", label: "Appts", accent: "text-white/15", path: "/sales-ai" },
                { value: isLoading ? "—" : String(issueCount), label: "Issues", accent: issueCount > 0 ? "text-red-400" : "text-white/15", path: "/listings?tab=failed" },
              ].map(m => (
                <button key={m.label} onClick={() => setLocation(m.path)} className="flex-1 py-5 px-4 text-left hover:bg-white/[0.02] transition-colors border-r border-white/[0.04] last:border-r-0 first:pl-0 last:pr-0">
                  <div className={cn("text-[40px] font-black leading-none mb-1.5 tracking-tighter", m.accent)}>{m.value}</div>
                  <div className="text-[9px] font-bold text-white/18 uppercase tracking-[0.18em]">{m.label}</div>
                </button>
              ))}
            </div>

            {/* Publishing Conflicts notice */}
            {!isLoading && duplicateGroupCount > 0 && (
              <button
                onClick={() => setLocation("/marketplace-intelligence/publishing-conflicts")}
                className="w-full flex items-center gap-3 mb-6 px-4 py-3 rounded-xl border border-amber-500/15 bg-amber-500/[0.04] hover:bg-amber-500/[0.07] transition-colors text-left group"
              >
                <ShieldCheck className="w-4 h-4 text-amber-400/60 shrink-0" />
                <span className="flex-1 text-[11px] text-amber-400/60">
                  <span className="font-bold">{duplicateGroupCount} duplicate group{duplicateGroupCount !== 1 ? "s" : ""} detected</span>
                  {" "}— DealerPilot is protecting these vehicles from self-competition.
                </span>
                <span className="text-[10px] font-bold text-amber-400/40 group-hover:text-amber-400/70 transition-colors uppercase tracking-wider">
                  View →
                </span>
              </button>
            )}

            {/* Morning Brief */}
            {!isLoading && plan && top10Count > 0 && <MorningBrief plan={plan} />}

            {/* Today's Publishing Strategy */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-4">
                <p className="text-[9px] font-black text-white/18 uppercase tracking-[0.22em]">
                  Today's Publishing Strategy
                </p>
                {plan && (
                  <span className="text-[9px] font-bold text-blue-400/38 font-mono">
                    {top10Count} vehicle{top10Count !== 1 ? "s" : ""}
                  </span>
                )}
                <div className="flex-1 h-px bg-white/[0.04]" />
              </div>

              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="h-[72px] rounded-xl bg-white/[0.015] animate-pulse" />
                  ))}
                </div>
              ) : plan ? (
                <StrategyTable plan={plan} onPublish={handlePublish} onAddToBatch={handleAddToBatch} />
              ) : (
                <div className="rounded-2xl border border-white/[0.04] bg-white/[0.01] p-12 text-center">
                  <CheckCircle2 className="w-7 h-7 text-emerald-400/22 mx-auto mb-3" />
                  <p className="text-[14px] font-semibold text-white/30">
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
                  <p className="text-[9px] font-black text-white/18 uppercase tracking-[0.22em]">Hold Today · {plan.holdToday.length}</p>
                  <div className="flex-1 h-px bg-white/[0.04]" />
                  {showHold ? <ChevronUp className="w-3 h-3 text-white/18" /> : <ChevronDown className="w-3 h-3 text-white/18" />}
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
        <div className="w-[260px] shrink-0 border-l border-white/[0.04] flex flex-col h-full">
          <div className="px-5 pt-5 pb-3.5 border-b border-white/[0.04] shrink-0">
            <div className="flex items-center gap-2">
              <span className="relative flex h-[6px] w-[6px] shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-40" />
                <span className="relative inline-flex rounded-full h-[6px] w-[6px] bg-blue-400" />
              </span>
              <p className="text-[9px] font-black text-white/22 uppercase tracking-[0.22em]">System Timeline</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {activityItems.length === 0 ? (
              <div className="p-8 text-center text-white/15 text-[12px]">No recent activity</div>
            ) : (
              <div className="flex flex-col">
                {activityItems.map((item, idx) => (
                  <div key={item.id} className="px-5 py-3 border-b border-white/[0.03] hover:bg-white/[0.015] transition-colors relative">
                    {idx === 0 && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-blue-500 via-blue-500/30 to-transparent" />}
                    <div className="flex items-start gap-2.5">
                      <span className={cn("w-[5px] h-[5px] rounded-full mt-[5px] shrink-0 opacity-70", item.color)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-white/60 leading-snug">{item.label}</p>
                        <p className="text-[10px] text-white/20 truncate mt-0.5">{item.sub}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[9px] text-white/12 font-mono">{format(item.date, "HH:mm")}</p>
                          {item.action && item.actionPath && (
                            <button className="text-[9px] text-blue-400/40 hover:text-blue-400 font-bold uppercase tracking-wider transition-colors" onClick={() => setLocation(item.actionPath!)}>
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
