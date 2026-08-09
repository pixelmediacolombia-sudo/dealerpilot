import { useMemo } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/shared/layout/AppLayout";
import {
  useListListingWorkspaces,
  useListPublishingJobs,
  useListMarketplaceRecommendations,
} from "@workspace/api-client-react";
import { useDealerLocation } from "@/context/LocationContext";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import {
  buildDailyMarketplacePlan,
  buildPublishReasons,
  buildHoldReasons,
  type DailyVehicleRec,
  type DuplicateGroup,
} from "@/lib/dailyPlan";
import {
  ArrowLeft,
  Car,
  CheckCircle2,
  ShieldCheck,
  ImageIcon,
  Eye,
} from "lucide-react";
import { Button } from "@/shared/ui/button";

// ─── Publish / Hold Decision Card ─────────────────────────────────────────────

function VehicleDecisionCard({
  vehicle,
  decision,
  reasons,
}: {
  vehicle: DailyVehicleRec;
  decision: "publish" | "hold";
  reasons: string[];
}) {
  const isPublish = decision === "publish";

  return (
    <div
      className={cn(
        "flex items-start gap-4 px-5 py-4 border-b border-border last:border-b-0",
        isPublish
          ? "border-l-[3px] border-l-emerald-500/40 bg-success/[0.025]"
          : "border-l-[3px] border-l-white/[0.06]",
      )}
    >
      {/* Decision badge */}
      <div className="shrink-0 mt-0.5">
        <span
          className={cn(
            "inline-flex items-center justify-center w-[52px] text-[11px] font-semibold  tracking-wide px-2 py-1 rounded border",
            isPublish
              ? "bg-success/15 border-success/30 text-success"
              : "bg-muted border-border text-muted-foreground",
          )}
        >
          {isPublish ? "Publish" : "Hold"}
        </span>
      </div>

      {/* Photo */}
      <div className="w-[64px] h-[50px] rounded-lg overflow-hidden shrink-0 bg-muted border border-border">
        {vehicle.primaryImageUrl ? (
          <img src={vehicle.primaryImageUrl} alt={vehicle.label} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
          <p className="text-[13px] font-bold text-foreground">{vehicle.label}</p>
          {vehicle.opportunityScore != null && (
            <span className="text-[11px] font-semibold text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded">
              Score {vehicle.opportunityScore}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
          {vehicle.actualPrice != null && formatCurrency(vehicle.actualPrice)}
          {vehicle.imageCount > 0 && (
            <span className="flex items-center gap-0.5">
              <ImageIcon className="w-2.5 h-2.5" />{vehicle.imageCount} photos
            </span>
          )}
          {vehicle.mileage != null && (
            <span>{vehicle.mileage.toLocaleString()} mi</span>
          )}
        </p>

        {/* Reasons */}
        <div className="space-y-1">
          <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide mb-1">
            {isPublish ? "Why publish this:" : "Why hold:"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {reasons.map((r, i) => (
              <span
                key={i}
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full border",
                  isPublish
                    ? "bg-success/[0.08] border-success/20 text-success/70"
                    : "bg-muted border-border text-muted-foreground",
                )}
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Override button (hold only) */}
      {!isPublish && (
        <div className="shrink-0 self-center">
          <button className="text-xs text-muted-foreground hover:text-muted-foreground border border-border hover:border-border px-2.5 py-1.5 rounded-lg transition-colors">
            Override
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Duplicate Group Card ─────────────────────────────────────────────────────

function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
  const publishReasons = buildPublishReasons(group);
  const totalVehicles = 1 + group.holdOthers.length;

  return (
    <div className="rounded-xl border border-border overflow-hidden mb-4">
      {/* Group header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted">
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">
            {group.make.toUpperCase()} {group.model.toUpperCase()}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalVehicles} units · publish 1, hold {group.holdOthers.length}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-warning/40" />
          <span className="text-[11px] text-warning/40 font-bold  tracking-wider">
            Self-Competition Guard
          </span>
        </div>
      </div>

      {/* Publish winner */}
      <VehicleDecisionCard
        vehicle={group.publishFirst}
        decision="publish"
        reasons={publishReasons}
      />

      {/* Hold others */}
      {group.holdOthers.map(v => (
        <VehicleDecisionCard
          key={v.vehicleId}
          vehicle={v}
          decision="hold"
          reasons={buildHoldReasons(v, group.publishFirst)}
        />
      ))}
    </div>
  );
}

// ─── Publishing Conflicts Page ─────────────────────────────────────────────────

export function PublishingConflictsPage() {
  const [, setLocation] = useLocation();
  const { selectedLocation } = useDealerLocation();

  const { data: workspacesData, isLoading: workspacesLoading } = useListListingWorkspaces({ location: selectedLocation });
  const { data: recsData, isLoading: recsLoading } = useListMarketplaceRecommendations({ location: selectedLocation });
  const { data: jobsData } = useListPublishingJobs({ location: selectedLocation });

  const plan = useMemo(() => {
    if (!workspacesData?.workspaces || !recsData?.recommendations || !jobsData?.jobs) return null;
    return buildDailyMarketplacePlan(
      workspacesData.workspaces,
      recsData.recommendations as never,
      jobsData.jobs,
    );
  }, [workspacesData, recsData, jobsData]);

  const isLoading = workspacesLoading || recsLoading;
  const groups = plan?.duplicateGroups ?? [];
  const protectedCount = groups.reduce((sum, g) => sum + g.holdOthers.length, 0);
  const visibilityGain = groups.length > 0 ? `+${Math.min(Math.round(protectedCount * 0.45), 28)}%` : "+0%";

  return (
    <AppLayout>
      <div className="overflow-y-auto h-full">
        <div className="p-8 max-w-[860px]">

          {/* ── Header ───────────────────────────────────────────────────────── */}
          <div className="mb-8">
            <button
              onClick={() => setLocation("/marketplace-intelligence")}
              className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-muted-foreground  tracking-wider mb-5 transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              Marketplace Intelligence
            </button>
            <p className="text-[11px] font-semibold text-warning/40  tracking-wide mb-3">
              Marketplace · Publishing Conflicts
            </p>
            <h1 className="text-[36px] font-semibold text-foreground tracking-tight leading-none mb-2">
              Duplicate Manager
            </h1>
            <p className="text-[15px] text-muted-foreground max-w-lg leading-relaxed">
              DealerPilot automatically prevents inventory self-competition.
              Only the highest-opportunity vehicle in each model group is published.
            </p>
          </div>

          {/* ── Stats ────────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              {
                value: groups.length,
                label: "Duplicate Groups",
                sub: "model conflicts detected",
                accent: "text-warning",
              },
              {
                value: protectedCount,
                label: "Vehicles Protected",
                sub: "held from Marketplace",
                accent: "text-primary",
              },
              {
                value: visibilityGain,
                label: "Est. Visibility Gain",
                sub: "from conflict prevention",
                accent: "text-success",
              },
            ].map(s => (
              <div
                key={s.label}
                className="rounded-xl border border-border bg-muted p-5"
              >
                <div className={cn("text-[32px] font-semibold leading-none mb-1.5 tabular-nums", s.accent)}>
                  {isLoading ? "—" : s.value}
                </div>
                <div className="text-[11px] font-semibold text-muted-foreground">{s.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* ── Groups ───────────────────────────────────────────────────────── */}
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-[200px] rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-xl border border-border bg-muted p-16 text-center">
              <CheckCircle2 className="w-8 h-8 text-success/30 mx-auto mb-4" />
              <p className="text-[15px] font-semibold text-muted-foreground">No conflicts detected</p>
              <p className="text-[12px] text-muted-foreground mt-2">
                All active inventory models are unique — no self-competition risk.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3 mb-5">
                <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">
                  {groups.length} Group{groups.length !== 1 ? "s" : ""}
                </p>
                <div className="flex-1 h-px bg-muted" />
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Eye className="w-3 h-3" />
                  Operator can override individual hold decisions
                </div>
              </div>
              {groups
                .slice()
                .sort((a, b) => b.count - a.count)
                .map(group => (
                  <DuplicateGroupCard key={group.key} group={group} />
                ))}
            </div>
          )}

        </div>
      </div>
    </AppLayout>
  );
}
