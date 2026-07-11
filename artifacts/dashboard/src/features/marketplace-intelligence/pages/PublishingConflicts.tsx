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
        "flex items-start gap-4 px-5 py-4 border-b border-white/[0.04] last:border-b-0",
        isPublish
          ? "border-l-[3px] border-l-emerald-500/40 bg-emerald-500/[0.025]"
          : "border-l-[3px] border-l-white/[0.06]",
      )}
    >
      {/* Decision badge */}
      <div className="shrink-0 mt-0.5">
        <span
          className={cn(
            "inline-flex items-center justify-center w-[52px] text-[9px] font-black uppercase tracking-[0.18em] px-2 py-1 rounded border",
            isPublish
              ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
              : "bg-white/[0.04] border-white/[0.08] text-white/25",
          )}
        >
          {isPublish ? "Publish" : "Hold"}
        </span>
      </div>

      {/* Photo */}
      <div className="w-[64px] h-[50px] rounded-lg overflow-hidden shrink-0 bg-white/[0.03] border border-white/[0.05]">
        {vehicle.primaryImageUrl ? (
          <img src={vehicle.primaryImageUrl} alt={vehicle.label} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car className="w-3.5 h-3.5 text-white/10" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
          <p className="text-[13px] font-bold text-white/80">{vehicle.label}</p>
          {vehicle.opportunityScore != null && (
            <span className="text-[9px] font-black text-white/30 bg-white/[0.04] border border-white/[0.07] px-1.5 py-0.5 rounded">
              Score {vehicle.opportunityScore}
            </span>
          )}
        </div>
        <p className="text-[10px] text-white/22 mb-2 flex items-center gap-2">
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
          <p className="text-[9px] font-black text-white/15 uppercase tracking-[0.20em] mb-1">
            {isPublish ? "Why publish this:" : "Why hold:"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {reasons.map((r, i) => (
              <span
                key={i}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full border",
                  isPublish
                    ? "bg-emerald-500/[0.08] border-emerald-500/20 text-emerald-400/70"
                    : "bg-white/[0.03] border-white/[0.06] text-white/30",
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
          <button className="text-[10px] text-white/18 hover:text-white/40 border border-white/[0.06] hover:border-white/[0.14] px-2.5 py-1.5 rounded-lg transition-colors">
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
    <div className="rounded-2xl border border-white/[0.06] overflow-hidden mb-4">
      {/* Group header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.05] bg-white/[0.015]">
        <div>
          <p className="text-[9px] font-black text-white/22 uppercase tracking-[0.24em]">
            {group.make.toUpperCase()} {group.model.toUpperCase()}
          </p>
          <p className="text-[10px] text-white/18 mt-0.5">
            {totalVehicles} units · publish 1, hold {group.holdOthers.length}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-amber-400/40" />
          <span className="text-[9px] text-amber-400/40 font-bold uppercase tracking-wider">
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
              className="flex items-center gap-1.5 text-[10px] font-bold text-white/22 hover:text-white/50 uppercase tracking-wider mb-5 transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              Marketplace Intelligence
            </button>
            <p className="text-[9px] font-black text-amber-400/40 uppercase tracking-[0.28em] mb-3">
              Marketplace · Publishing Conflicts
            </p>
            <h1 className="text-[36px] font-black text-white tracking-tight leading-none mb-2">
              Duplicate Manager
            </h1>
            <p className="text-[15px] text-white/28 max-w-lg leading-relaxed">
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
                accent: "text-amber-400",
              },
              {
                value: protectedCount,
                label: "Vehicles Protected",
                sub: "held from Marketplace",
                accent: "text-blue-400",
              },
              {
                value: visibilityGain,
                label: "Est. Visibility Gain",
                sub: "from conflict prevention",
                accent: "text-emerald-400",
              },
            ].map(s => (
              <div
                key={s.label}
                className="rounded-2xl border border-white/[0.05] bg-white/[0.01] p-5"
              >
                <div className={cn("text-[32px] font-black leading-none mb-1.5 tabular-nums", s.accent)}>
                  {isLoading ? "—" : s.value}
                </div>
                <div className="text-[11px] font-semibold text-white/50">{s.label}</div>
                <div className="text-[10px] text-white/22 mt-0.5">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* ── Groups ───────────────────────────────────────────────────────── */}
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-[200px] rounded-2xl bg-white/[0.015] animate-pulse" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.05] bg-white/[0.01] p-16 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400/30 mx-auto mb-4" />
              <p className="text-[15px] font-semibold text-white/40">No conflicts detected</p>
              <p className="text-[12px] text-white/22 mt-2">
                All active inventory models are unique — no self-competition risk.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3 mb-5">
                <p className="text-[9px] font-black text-white/18 uppercase tracking-[0.22em]">
                  {groups.length} Group{groups.length !== 1 ? "s" : ""}
                </p>
                <div className="flex-1 h-px bg-white/[0.04]" />
                <div className="flex items-center gap-1.5 text-[9px] text-white/22">
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
