import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetMarketplaceDashboard,
  useListMarketplaceRecommendations,
} from "@workspace/api-client-react";
import { SectionCard, PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import {
  TrendingUp,
  MessageSquare,
  Flame,
  BarChart3,
  Clock,
  Camera,
  Star,
  AlertTriangle,
  Lightbulb,
  CalendarCheck,
  Zap,
  ChevronDown,
  ChevronUp,
  Target,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "recommendations", label: "Strategic Recommendations", icon: Lightbulb },
  { key: "downpayment", label: "Down Payment", icon: TrendingUp },
  { key: "posting", label: "Posting Time", icon: Clock },
  { key: "creative", label: "Creative Performance", icon: Camera },
  { key: "weak", label: "Weak Listings", icon: AlertTriangle },
  { key: "nextbatch", label: "Next Batch", icon: CalendarCheck },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Strategy name → color scheme
function strategyColor(name: string | null | undefined): { bg: string; text: string; border: string } {
  if (!name) return { bg: "bg-white/5", text: "text-muted-foreground", border: "border-white/10" };
  const n = name.toLowerCase();
  if (n.includes("truck")) return { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/25" };
  if (n.includes("luxury")) return { bg: "bg-violet-500/15", text: "text-violet-400", border: "border-violet-500/25" };
  if (n.includes("premium suv")) return { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/25" };
  if (n.includes("fast turn")) return { bg: "bg-green-500/15", text: "text-green-400", border: "border-green-500/25" };
  if (n.includes("serious buyer")) return { bg: "bg-primary/15", text: "text-primary", border: "border-primary/25" };
  if (n.includes("price review")) return { bg: "bg-destructive/15", text: "text-destructive", border: "border-destructive/25" };
  if (n.includes("performance")) return { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/25" };
  if (n.includes("high-value")) return { bg: "bg-violet-500/15", text: "text-violet-400", border: "border-violet-500/25" };
  return { bg: "bg-primary/15", text: "text-primary", border: "border-primary/25" };
}

function qualityBadge(q: string | null | undefined) {
  if (q === "hot") return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">🔥 Hot</Badge>;
  if (q === "warm") return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">🌡 Warm</Badge>;
  return <Badge className="bg-white/5 text-muted-foreground border-white/10 text-xs">❄ Cold</Badge>;
}

function photoBadge(strat: string) {
  if (strat === "ai_creative")
    return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">AI Creative</Badge>;
  if (strat === "mixed")
    return <Badge className="bg-teal-500/20 text-teal-400 border-teal-500/30 text-xs">Mixed</Badge>;
  return <Badge className="bg-white/5 text-muted-foreground border-white/10 text-xs">Original</Badge>;
}

function strategyBadge(strat: string) {
  if (strat === "down_payment")
    return <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">Down Payment</Badge>;
  if (strat === "price_review")
    return <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-xs">Price Review</Badge>;
  return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">Full Price</Badge>;
}

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-success" : score >= 60 ? "bg-yellow-400" : "bg-muted-foreground";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
      </div>
      <span className={cn("text-xs font-medium w-7 text-right", score >= 80 ? "text-success" : score >= 60 ? "text-yellow-400" : "text-muted-foreground")}>
        {score}%
      </span>
    </div>
  );
}

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.round((score / max) * 100);
  const color = pct >= 70 ? "bg-success" : pct >= 40 ? "bg-yellow-400" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-6 text-right">{score}</span>
    </div>
  );
}

// Rich v2 recommendation card
type Rec = {
  vehicleId: number;
  year: number | null;
  make: string;
  model: string;
  price: number | null;
  bodyStyle: string | null;
  recommendedPriceStrategy: string;
  recommendedDownPayment: number | null;
  recommendedPhotoStrategy: string;
  recommendedDayLabel: string | null;
  recommendedTimeLabel: string | null;
  confidenceScore: number;
  expectedLeadQuality: string | null;
  strategyName: string | null;
  reason: string | null;
  supportingSignals: string[];
  expectedImpact: string | null;
  actionCta: string | null;
};

function StrategyCard({ rec }: { rec: Rec }) {
  const [expanded, setExpanded] = useState(false);
  const colors = strategyColor(rec.strategyName);
  const hasV2 = Boolean(rec.strategyName);

  return (
    <div className={cn(
      "rounded-xl border transition-all",
      "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.10]",
    )}>
      {/* Header row */}
      <div
        className="flex items-center gap-4 p-4 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Strategy name badge */}
        <div className="shrink-0">
          {hasV2 ? (
            <span className={cn("inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border", colors.bg, colors.text, colors.border)}>
              {rec.strategyName}
            </span>
          ) : (
            strategyBadge(rec.recommendedPriceStrategy)
          )}
        </div>

        {/* Vehicle */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white truncate">
            {rec.year} {rec.make} {rec.model}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            {rec.price != null && <span>{formatCurrency(rec.price)}</span>}
            {rec.bodyStyle && <span>· {rec.bodyStyle}</span>}
            {rec.recommendedDownPayment != null && (
              <span className="text-primary font-medium">· {formatCurrency(rec.recommendedDownPayment)} down</span>
            )}
          </div>
        </div>

        {/* Right-side badges */}
        <div className="flex items-center gap-3 shrink-0">
          {qualityBadge(rec.expectedLeadQuality)}
          {photoBadge(rec.recommendedPhotoStrategy)}
          <div className="w-24">
            <ConfidenceBar score={rec.confidenceScore} />
          </div>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />
          }
        </div>
      </div>

      {/* Expanded v2 detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/[0.05] pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Reason */}
            {rec.reason && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Why this strategy</div>
                <p className="text-sm text-white/80 leading-relaxed">{rec.reason}</p>
              </div>
            )}

            {/* Supporting signals */}
            {rec.supportingSignals && rec.supportingSignals.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Supporting Signals</div>
                <div className="flex flex-wrap gap-1.5">
                  {rec.supportingSignals.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-xs text-white/70">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Expected impact */}
            {rec.expectedImpact && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/15 flex items-start gap-2.5">
                <Target className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-primary mb-1">Expected Impact</div>
                  <div className="text-xs text-white/80">{rec.expectedImpact}</div>
                </div>
              </div>
            )}

            {/* Action CTA */}
            {rec.actionCta && (
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-start gap-2.5">
                <ArrowRight className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-success mb-1">Action</div>
                  <div className="text-xs text-white/80">{rec.actionCta}</div>
                </div>
              </div>
            )}
          </div>

          {/* Posting timing */}
          {(rec.recommendedDayLabel || rec.recommendedTimeLabel) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              Best post time: <span className="text-white font-medium">{rec.recommendedDayLabel} at {rec.recommendedTimeLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MarketplaceIntelligence() {
  const [activeTab, setActiveTab] = useState<TabKey>("recommendations");

  const { data: dash, isLoading: dashLoading } = useGetMarketplaceDashboard();
  const { data: recsData, isLoading: recsLoading } = useListMarketplaceRecommendations();

  const isLoading = dashLoading || recsLoading;
  const summary = dash?.summary;
  const recs = (recsData?.recommendations ?? []) as Rec[];
  const engineVersion = (recsData as { strategyEngineVersion?: string } | undefined)?.strategyEngineVersion;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <PageHeader
              icon={<BarChart3 className="w-5 h-5 text-primary" />}
              eyebrow="MARKETPLACE INTELLIGENCE"
              title="Marketplace Intelligence"
              subtitle="DealerPilot learns from every listing, conversation, and lead to sharpen your strategy."
            />
            {engineVersion === "v2" && (
              <div className="shrink-0 mt-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/15 border border-primary/25 text-primary text-xs font-semibold">
                  <Zap className="w-3 h-3" />
                  Strategy Engine v2
                </span>
              </div>
            )}
          </div>

          {/* KPI Summary */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total Listings Tracked", value: summary?.totalListings ?? 0, icon: BarChart3, color: "text-primary" },
              { label: "Avg Outcome Score", value: `${summary?.avgOutcomeScore ?? 0}/100`, icon: Star, color: "text-yellow-400" },
              { label: "Total Conversations", value: summary?.totalConversations ?? 0, icon: MessageSquare, color: "text-blue-400" },
              { label: "Total Hot Leads", value: summary?.totalHotLeads ?? 0, icon: Flame, color: "text-orange-400" },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className="bg-white/[0.02] border-white/[0.06]">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={cn("p-2 rounded-lg bg-white/[0.04]", color)}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xl font-bold text-white">{isLoading ? "—" : value}</div>
                    <div className="text-xs text-muted-foreground">{label}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-white/[0.03] p-1 rounded-lg border border-white/[0.06] flex-wrap">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all",
                  activeTab === key
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-white/70",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* ── Strategic Recommendations (v2 cards) ── */}
          {activeTab === "recommendations" && (
            <SectionCard
              icon={<Lightbulb className="w-4 h-4 text-primary" />}
              title="Strategic Recommendations"
              action={engineVersion === "v2" ? (
                <span className="text-[10px] text-primary/60 font-medium">Click any card to expand · Strategy Engine v2</span>
              ) : undefined}
            >
              {recsLoading ? (
                <div className="text-muted-foreground text-sm py-8 text-center">Loading recommendations…</div>
              ) : recs.length === 0 ? (
                <div className="text-muted-foreground text-sm py-8 text-center">
                  No recommendations yet. Run the seed endpoint to generate data.
                </div>
              ) : (
                <div className="space-y-2">
                  {recs.map((rec) => (
                    <StrategyCard key={rec.vehicleId} rec={rec} />
                  ))}
                </div>
              )}
            </SectionCard>
          )}

          {/* ── Down Payment Performance ── */}
          {activeTab === "downpayment" && (
            <div className="space-y-4">
              {dashLoading ? (
                <div className="text-muted-foreground text-sm py-8 text-center">Loading…</div>
              ) : (dash?.downPaymentPerformance ?? []).length === 0 ? (
                <div className="text-muted-foreground text-sm py-8 text-center">No down payment performance data yet.</div>
              ) : (
                (dash?.downPaymentPerformance ?? []).map((typeGroup) => (
                  <SectionCard
                    key={typeGroup.vehicleType}
                    icon={<TrendingUp className="w-4 h-4 text-primary" />}
                    title={`${typeGroup.vehicleType} — Best Down: ${formatCurrency(typeGroup.bestDownPayment)}`}
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground border-b border-white/5">
                            <th className="pb-2 pr-4 font-medium">Published Down</th>
                            <th className="pb-2 pr-4 font-medium">Listings</th>
                            <th className="pb-2 pr-4 font-medium">Hot Leads</th>
                            <th className="pb-2 font-medium">Outcome Score</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.03]">
                          {typeGroup.variants.map((v) => (
                            <tr key={v.publishedDownPayment} className={cn(v.publishedDownPayment === typeGroup.bestDownPayment && "bg-primary/5")}>
                              <td className="py-2.5 pr-4">
                                <span className={cn("font-medium", v.publishedDownPayment === typeGroup.bestDownPayment ? "text-primary" : "text-white")}>
                                  {formatCurrency(v.publishedDownPayment)}
                                </span>
                                {v.publishedDownPayment === typeGroup.bestDownPayment && (
                                  <Badge className="ml-2 bg-primary/20 text-primary border-primary/30 text-[10px] py-0">Best</Badge>
                                )}
                              </td>
                              <td className="py-2.5 pr-4 text-muted-foreground">{v.totalListings}</td>
                              <td className="py-2.5 pr-4">
                                <span className="text-orange-400 font-medium">{v.hotLeads}</span>
                              </td>
                              <td className="py-2.5 w-40">
                                <ScoreBar score={v.avgOutcomeScore} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </SectionCard>
                ))
              )}
            </div>
          )}

          {/* ── Posting Time Performance ── */}
          {activeTab === "posting" && (
            <SectionCard icon={<Clock className="w-4 h-4 text-primary" />} title="Best Posting Days">
              {dashLoading ? (
                <div className="text-muted-foreground text-sm py-8 text-center">Loading…</div>
              ) : (
                <div className="space-y-3">
                  {(dash?.postingTimePerformance ?? []).map((slot, i) => (
                    <div key={slot.dayOfWeek} className="flex items-center gap-4">
                      <div className="w-24 text-sm text-right text-muted-foreground shrink-0">{slot.dayLabel}</div>
                      <div className="flex-1 relative h-7 bg-white/[0.03] rounded overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded transition-all",
                            i === 0 ? "bg-primary/50" : i === 1 ? "bg-primary/35" : "bg-white/[0.08]",
                          )}
                          style={{ width: `${slot.avgOutcomeScore}%` }}
                        />
                        <div className="absolute inset-0 flex items-center px-3 gap-4">
                          <span className="text-xs font-medium text-white">{slot.avgOutcomeScore} avg score</span>
                          <span className="text-xs text-muted-foreground">{slot.totalHotLeads} hot leads · {slot.totalConversations} convos · {slot.totalListings} listings</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="mt-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-muted-foreground">
                    <Zap className="w-3.5 h-3.5 text-primary inline mr-1.5" />
                    Best posting time: <span className="text-white font-medium">
                      {dash?.nextBatchRecommendation.recommendedDayLabel} at {dash?.nextBatchRecommendation.recommendedTimeLabel}
                    </span> — based on {summary?.totalListings} tracked listings.
                  </div>
                </div>
              )}
            </SectionCard>
          )}

          {/* ── Creative Performance ── */}
          {activeTab === "creative" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                {(["original", "ai_creative", "mixed"] as const).map((strat) => {
                  const perf = dash?.creativePerformance?.[strat];
                  if (!perf) return null;
                  const labels: Record<string, string> = { original: "Original Photos", ai_creative: "AI Creative", mixed: "Mixed" };
                  return (
                    <Card key={strat} className="bg-white/[0.02] border-white/[0.06]">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Camera className="w-4 h-4 text-primary" />
                          {labels[strat]}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <div className="text-2xl font-bold text-white">{perf.avgOutcomeScore}</div>
                          <div className="text-xs text-muted-foreground">Avg Outcome Score</div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <div className="text-sm font-medium text-white">{perf.totalListings}</div>
                            <div className="text-[10px] text-muted-foreground">Listings</div>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-orange-400">{perf.hotLeads}</div>
                            <div className="text-[10px] text-muted-foreground">Hot Leads</div>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">{perf.conversationsCount}</div>
                            <div className="text-[10px] text-muted-foreground">Convos</div>
                          </div>
                        </div>
                        <ScoreBar score={perf.avgOutcomeScore} />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <SectionCard icon={<BarChart3 className="w-4 h-4 text-primary" />} title="Performance by Vehicle Type">
                {dashLoading ? (
                  <div className="text-muted-foreground text-sm py-4 text-center">Loading…</div>
                ) : (
                  <div className="space-y-2">
                    {(dash?.vehicleTypePerformance ?? []).map((vt) => (
                      <div key={vt.vehicleType} className="flex items-center gap-4">
                        <div className="w-24 text-sm text-muted-foreground shrink-0">{vt.vehicleType}</div>
                        <div className="flex-1 relative h-7 bg-white/[0.03] rounded overflow-hidden">
                          <div
                            className="h-full bg-primary/30 rounded"
                            style={{ width: `${vt.avgOutcomeScore}%` }}
                          />
                          <div className="absolute inset-0 flex items-center px-3 gap-4">
                            <span className="text-xs font-medium text-white">{vt.avgOutcomeScore} score</span>
                            <span className="text-xs text-muted-foreground">
                              {vt.totalHotLeads} hot · {vt.totalConversations} convos · {vt.totalListings} listings
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {/* ── Weak Listings ── */}
          {activeTab === "weak" && (
            <div className="space-y-4">
              <SectionCard icon={<AlertTriangle className="w-4 h-4 text-destructive" />} title="Low Outcome — Needs Renewal">
                {dashLoading ? (
                  <div className="text-muted-foreground text-sm py-4 text-center">Loading…</div>
                ) : (dash?.weakListings ?? []).length === 0 ? (
                  <div className="text-muted-foreground text-sm py-4 text-center">No weak listings found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground border-b border-white/5">
                          <th className="pb-2 pr-4 font-medium">Vehicle</th>
                          <th className="pb-2 pr-4 font-medium">Conversations</th>
                          <th className="pb-2 pr-4 font-medium">Days Live</th>
                          <th className="pb-2 font-medium">Outcome Score</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.03]">
                        {(dash?.weakListings ?? []).map((w) => (
                          <tr key={w.vehicleId}>
                            <td className="py-2.5 pr-4 font-medium text-white">{w.year} {w.make} {w.model}</td>
                            <td className="py-2.5 pr-4 text-muted-foreground">{w.conversationsCount}</td>
                            <td className="py-2.5 pr-4 text-muted-foreground">{w.daysSincePublished}d</td>
                            <td className="py-2.5 w-40">
                              <ScoreBar score={w.outcomeScore} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>

              <SectionCard icon={<MessageSquare className="w-4 h-4 text-yellow-400" />} title="High Views, Low Lead Quality">
                {(dash?.highViewsLowQuality ?? []).length === 0 ? (
                  <div className="text-muted-foreground text-sm py-4 text-center">No high-view / low-quality listings.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground border-b border-white/5">
                          <th className="pb-2 pr-4 font-medium">Vehicle</th>
                          <th className="pb-2 pr-4 font-medium">Conversations</th>
                          <th className="pb-2 font-medium">Outcome Score</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.03]">
                        {(dash?.highViewsLowQuality ?? []).map((w) => (
                          <tr key={`hv-${w.vehicleId}`}>
                            <td className="py-2.5 pr-4 font-medium text-white">{w.year} {w.make} {w.model}</td>
                            <td className="py-2.5 pr-4 text-blue-400">{w.conversationsCount}</td>
                            <td className="py-2.5 w-40">
                              <ScoreBar score={w.outcomeScore} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {/* ── Next Batch ── */}
          {activeTab === "nextbatch" && (
            <div className="space-y-4">
              {dash?.nextBatchRecommendation && (
                <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 flex items-center gap-4">
                  <div className="p-3 rounded-lg bg-primary/20">
                    <CalendarCheck className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="text-white font-semibold">
                      Post on {dash.nextBatchRecommendation.recommendedDayLabel} at {dash.nextBatchRecommendation.recommendedTimeLabel}
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      Based on {summary?.totalListings} tracked listings — estimated {dash.nextBatchRecommendation.estimatedHotLeads} hot leads expected
                    </div>
                  </div>
                  <Badge className="bg-primary/20 text-primary border-primary/30">
                    {dash.nextBatchRecommendation.recommendedDayLabel}s at {dash.nextBatchRecommendation.recommendedTimeLabel}
                  </Badge>
                </div>
              )}

              <SectionCard icon={<Zap className="w-4 h-4 text-primary" />} title="Recommended Vehicles for Next Batch">
                {dashLoading ? (
                  <div className="text-muted-foreground text-sm py-8 text-center">Loading…</div>
                ) : (dash?.nextBatchRecommendation?.vehicles ?? []).length === 0 ? (
                  <div className="text-muted-foreground text-sm py-8 text-center">No vehicle recommendations available yet.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {(dash?.nextBatchRecommendation?.vehicles ?? []).map((v) => (
                      <div
                        key={v.vehicleId}
                        className="flex items-center gap-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-white">
                            {v.year} {v.make} {v.model}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {v.vehicleType} · {v.price != null ? formatCurrency(v.price) : "—"}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {strategyBadge(v.recommendedPriceStrategy)}
                          {v.recommendedDownPayment != null && (
                            <span className="text-xs text-muted-foreground">{formatCurrency(v.recommendedDownPayment)} down</span>
                          )}
                          {qualityBadge(v.expectedLeadQuality)}
                          <div className="w-20">
                            <ConfidenceBar score={v.confidenceScore} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
