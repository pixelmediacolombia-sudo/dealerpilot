/**
 * DailyOperatorPanel.tsx
 *
 * The AI Operator header for the Marketplace AI page.
 * Shows today's publishing recommendations from buildDailyMarketplacePlan()
 * and surfaces duplicate model groups.
 */
import { useMemo, useState } from "react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import {
  buildDailyMarketplacePlan,
  type DailyVehicleRec,
  type DuplicateGroup,
  type PlanWorkspace,
  type PlanRecommendation,
  type PlanJob,
} from "@/lib/dailyPlan";
import {
  UploadCloud,
  Loader2,
  Car,
  ImageIcon,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Zap,
  MoreHorizontal,
  Target,
  Plus,
  PlayCircle,
} from "lucide-react";

const DUPE_VISIBLE = 5;

function DuplicateGroupsSection({ groups }: { groups: DuplicateGroup[] }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const sorted = [...groups].sort((a, b) => b.count - a.count);
  const visible = showAll ? sorted : sorted.slice(0, DUPE_VISIBLE);
  const hidden = sorted.length - DUPE_VISIBLE;

  return (
    <div className="border-t border-border">
      <button
        className="w-full flex items-center gap-2 px-5 py-2.5 hover:bg-muted transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0" />
        <span className="text-xs font-semibold text-warning flex-1 text-left">
          {groups.length} duplicate model group{groups.length !== 1 ? "s" : ""} detected — hold duplicates to avoid self-competition
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-5 pb-3 space-y-2">
          {visible.map((g) => (
            <div key={g.key} className="rounded-lg bg-warning/5 border border-warning/15 px-3 py-2">
              <p className="text-xs font-bold text-warning">{g.make} {g.model} — {g.count} ready</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{g.winReason}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs">
                <span className="text-success font-semibold">Publish: {g.publishFirst.label}</span>
                {g.holdOthers.slice(0, 2).map(h => (
                  <span key={h.vehicleId} className="text-muted-foreground">· Hold: {h.label}</span>
                ))}
                {g.holdOthers.length > 2 && (
                  <span className="text-muted-foreground">· +{g.holdOthers.length - 2} more</span>
                )}
              </div>
            </div>
          ))}
          {!showAll && hidden > 0 && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full text-center text-xs text-muted-foreground hover:text-warning py-1 transition-colors"
            >
              + {hidden} more group{hidden !== 1 ? "s" : ""} — click to show all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function strategyColor(name: string | null | undefined) {
  if (!name) return { bg: "bg-primary/10", text: "text-primary", border: "border-primary/20" };
  const n = name.toLowerCase();
  if (n.includes("truck")) return { bg: "bg-warning/15", text: "text-warning", border: "border-warning/25" };
  if (n.includes("luxury")) return { bg: "bg-primary/15", text: "text-primary", border: "border-primary/25" };
  if (n.includes("suv") || n.includes("premium")) return { bg: "bg-primary/15", text: "text-primary", border: "border-primary/25" };
  if (n.includes("fast turn")) return { bg: "bg-success/15", text: "text-success", border: "border-success/25" };
  return { bg: "bg-primary/10", text: "text-primary", border: "border-primary/20" };
}

function RecRow({
  rec,
  index,
  onPublish,
  onAddToBatch,
  isPublishing,
}: {
  rec: DailyVehicleRec;
  index: number;
  onPublish: (id: number) => void;
  onAddToBatch: (id: number) => void;
  isPublishing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const colors = strategyColor(rec.strategyName);

  return (
    <div className="rounded-lg border border-border bg-muted hover:border-primary/20 transition-colors overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Index + thumb */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-[11px] font-semibold text-primary">{index + 1}</span>
          </div>
          <div className="w-10 h-8 rounded-md overflow-hidden bg-secondary/40 flex-shrink-0">
            {rec.primaryImageUrl ? (
              <img src={rec.primaryImageUrl} alt={rec.label} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Car className="w-3 h-3 text-muted-foreground/30" />
              </div>
            )}
          </div>
        </div>

        {/* Vehicle info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {rec.strategyName && (
              <span className={cn("inline-flex items-center px-1.5 py-0 rounded text-[11px] font-bold border", colors.bg, colors.text, colors.border)}>
                {rec.strategyName}
              </span>
            )}
            <span className="font-semibold text-sm text-foreground truncate">{rec.label}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-muted-foreground">
            {rec.priceMode === "DOWN_PAYMENT" && rec.marketplacePrice != null ? (
              <span className="text-warning font-semibold">{formatCurrency(rec.marketplacePrice)} down</span>
            ) : rec.actualPrice != null ? (
              <span>{formatCurrency(rec.actualPrice)}</span>
            ) : null}
            <span className="flex items-center gap-0.5">
              <ImageIcon className="w-2.5 h-2.5" />{rec.imageCount}
            </span>
            {rec.reasons[0] && (
              <span className="truncate max-w-[200px] hidden md:block">· {rec.reasons[0]}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-0.5"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <Button
            size="sm"
            className="h-7 px-2.5 gap-1 bg-success hover:bg-success/90 text-foreground text-xs font-bold  tracking-wide whitespace-nowrap"
            disabled={isPublishing}
            onClick={() => onPublish(rec.vehicleId)}
          >
            {isPublishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <UploadCloud className="w-3 h-3" />}
            Publish Now
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => onAddToBatch(rec.vehicleId)}>
                <Plus className="w-3 h-3 mr-1.5" /> Add to Batch
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {expanded && (
        <div className="px-10 pb-3 pt-2 border-t border-border space-y-2.5">
          {/* Why this vehicle */}
          {rec.reasons.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold  tracking-wide text-muted-foreground">Why This Vehicle</p>
              {rec.reasons.map((r, i) => (
                <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-primary/50 mt-1.5 flex-shrink-0" />{r}
                </p>
              ))}
            </div>
          )}
          {/* Buyer Segment */}
          {rec.primarySegment && rec.primarySegment !== "General" && (
            <div className="rounded-lg border border-border bg-muted p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold text-foreground">{rec.primarySegment} Buyers</span>
                  {rec.secondarySegment && (
                    <span className="text-xs text-muted-foreground">· also {rec.secondarySegment}</span>
                  )}
                </div>
                <span className={cn(
                  "shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded border  tracking-wide",
                  rec.suggestedLanguage === "Spanish-first"
                    ? "bg-orange-500/15 text-orange-400 border-orange-500/25"
                    : rec.suggestedLanguage === "Bilingual"
                    ? "bg-teal-500/15 text-teal-400 border-teal-500/25"
                    : "bg-muted text-muted-foreground border-border",
                )}>
                  {rec.suggestedLanguage}
                </span>
              </div>
              {rec.whyThisAudience && (
                <p className="text-xs text-muted-foreground leading-relaxed">{rec.whyThisAudience}</p>
              )}
              {rec.adAngle && (
                <p className="text-xs text-muted-foreground italic">"{rec.adAngle}"</p>
              )}
            </div>
          )}
          {/* Opportunity score */}
          {rec.opportunityScore != null && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground  tracking-wide">Opportunity Score</span>
              <span className={cn(
                "text-[11px] font-semibold px-2 py-0 rounded border",
                rec.opportunityScore >= 80
                  ? "bg-success/15 border-success/25 text-success"
                  : rec.opportunityScore >= 70
                  ? "bg-warning/15 border-warning/25 text-warning"
                  : "bg-muted border-border text-muted-foreground",
              )}>
                {rec.opportunityScore}
              </span>
            </div>
          )}
          {rec.expectedImpact && (
            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-primary/5 border border-primary/15">
              <Target className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
              <p className="text-xs text-foreground">{rec.expectedImpact}</p>
            </div>
          )}
          {rec.priceMode === "DOWN_PAYMENT" && rec.actualPrice != null && rec.marketplacePrice != null && (
            <div className="text-xs text-muted-foreground/60">
              Actual vehicle price: {formatCurrency(rec.actualPrice)} ·
              Marketplace price: {formatCurrency(rec.marketplacePrice)} down
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DailyOperatorPanel({
  workspaces,
  recommendations,
  activeJobs,
  onPublish,
  onAddToBatch,
  onPublishBatch,
  publishingId,
  isPending,
}: {
  workspaces: PlanWorkspace[];
  recommendations: PlanRecommendation[];
  activeJobs: PlanJob[];
  onPublish: (id: number) => void;
  onAddToBatch: (id: number) => void;
  onPublishBatch?: (vehicleIds: number[]) => void;
  publishingId: number | null;
  isPending: boolean;
}) {

  const plan = useMemo(() =>
    buildDailyMarketplacePlan(workspaces, recommendations, activeJobs),
    [workspaces, recommendations, activeJobs],
  );

  const hasRecs = plan.recommendedToday.length > 0;
  const recCount = plan.recommendedToday.length;
  const queuedCount = plan.alreadyQueued.length;
  const canBatch = recCount >= 3 && !!onPublishBatch;

  return (
    <div className="rounded-xl border border-primary/15 bg-primary/[0.02] overflow-hidden mb-6">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-primary/10">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Zap className="w-4 h-4 text-primary flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-foreground">
              {hasRecs
                ? `DealerPilot recommends publishing ${recCount} vehicle${recCount !== 1 ? "s" : ""} today`
                : queuedCount > 0
                  ? `${queuedCount} vehicle${queuedCount !== 1 ? "s" : ""} already queued for publishing`
                  : "No vehicles recommended today"}
            </p>
            <p className="text-xs text-muted-foreground">{plan.summary}</p>
          </div>
        </div>
        {canBatch && (
          <Button
            size="sm"
            className="h-7 px-2.5 gap-1.5 bg-primary hover:bg-primary/90 text-foreground text-xs font-bold  tracking-wide whitespace-nowrap flex-shrink-0"
            onClick={() => onPublishBatch!(plan.recommendedToday.slice(0, 3).map((r) => r.vehicleId))}
          >
            <PlayCircle className="w-3 h-3" />
            Publish Today's 3
          </Button>
        )}
        <Badge className="text-[11px] font-bold  tracking-wide bg-warning/10 text-warning border-warning/20 flex-shrink-0">
          Estimated Strategy
        </Badge>
      </div>

      {/* Recommendations */}
      {hasRecs && (
        <div className="p-3 space-y-2">
          {plan.recommendedToday.map((rec, i) => (
            <RecRow
              key={rec.vehicleId}
              rec={rec}
              index={i}
              onPublish={onPublish}
              onAddToBatch={onAddToBatch}
              isPublishing={publishingId === rec.vehicleId && isPending}
            />
          ))}
        </div>
      )}

      {/* Duplicate groups — show top 5 by group size, collapse the rest */}
      {plan.duplicateGroups.length > 0 && (
        <DuplicateGroupsSection groups={plan.duplicateGroups} />
      )}
    </div>
  );
}
