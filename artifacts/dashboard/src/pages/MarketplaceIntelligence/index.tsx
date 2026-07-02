import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useDealerLocation } from "@/context/LocationContext";
import {
  useListMarketplaceRecommendations,
  useListPublishingJobs,
  useGetAutoPublishSettings,
  useUpdateAutoPublishSettings,
  useBulkSchedulePublishing,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { PublishNowModal } from "@/components/PublishNowModal";
import {
  Loader2,
  UploadCloud,
  Eye,
  X,
  Clock,
  MessageSquare,
  CalendarDays,
  Camera,
  Sparkles,
  ExternalLink,
  Car,
  Radio,
  CheckCircle2,
  Zap,
  Settings2,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Constants ───────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = [
  "Queued", "Assigned", "Claimed",
  "Filling Form", "Publishing", "Clicking Publish", "Capturing URL", "Retry",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function strategyStyle(name: string | null | undefined) {
  if (!name) return { bg: "bg-white/5", text: "text-muted-foreground", border: "border-white/10" };
  const n = name.toLowerCase();
  if (n.includes("truck")) return { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/25" };
  if (n.includes("luxury") || n.includes("high-value")) return { bg: "bg-violet-500/15", text: "text-violet-400", border: "border-violet-500/25" };
  if (n.includes("premium suv")) return { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/25" };
  if (n.includes("fast turn")) return { bg: "bg-green-500/15", text: "text-green-400", border: "border-green-500/25" };
  if (n.includes("price review")) return { bg: "bg-destructive/15", text: "text-destructive", border: "border-destructive/25" };
  if (n.includes("performance")) return { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/25" };
  return { bg: "bg-primary/15", text: "text-primary", border: "border-primary/25" };
}

function jobStatusStyle(status: string): { text: string; bg: string } {
  if (status === "Published") return { text: "text-success", bg: "bg-success/10" };
  if (status === "Failed") return { text: "text-destructive", bg: "bg-destructive/10" };
  if (status === "Queued" || status === "Assigned") return { text: "text-blue-400", bg: "bg-blue-500/10" };
  if (["Filling Form", "Publishing", "Clicking Publish", "Capturing URL"].includes(status))
    return { text: "text-yellow-400", bg: "bg-yellow-500/10" };
  if (status === "Retry") return { text: "text-orange-400", bg: "bg-orange-500/10" };
  if (status === "Cancelled") return { text: "text-muted-foreground", bg: "bg-white/[0.05]" };
  if (status === "Needs Review" || status === "Ready for Review") return { text: "text-amber-400", bg: "bg-amber-500/10" };
  return { text: "text-muted-foreground", bg: "bg-white/[0.05]" };
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon: Icon, iconColor, loading,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  iconColor: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className={cn("w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center mb-3", iconColor)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className={cn("text-2xl font-bold mb-0.5", loading ? "text-muted-foreground/30" : "text-white")}>
        {loading ? "—" : value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// ─── Today's Pick Card ────────────────────────────────────────────────────────

type Rec = {
  vehicleId: number;
  year: number | null;
  make: string;
  model: string;
  trim?: string | null;
  price: number | null;
  mileage?: number | null;
  bodyStyle: string | null;
  thumbnailUrl?: string | null;
  photoCount?: number | null;
  estimatedMessages?: number | null;
  estimatedDaysToSell?: number | null;
  confidenceScore: number;
  strategyName: string | null;
  recommendedPhotoStrategy: string;
  reason: string | null;
};

function PickCard({
  rec,
  rank,
  onPublish,
  onPreview,
  onSkip,
  isPublishing,
}: {
  rec: Rec;
  rank: number;
  onPublish: () => void;
  onPreview: () => void;
  onSkip: () => void;
  isPublishing: boolean;
}) {
  const sc = strategyStyle(rec.strategyName);
  const scoreColor = rec.confidenceScore >= 80
    ? "bg-success" : rec.confidenceScore >= 60
    ? "bg-yellow-400" : "bg-muted-foreground";
  const scoreText = rec.confidenceScore >= 80
    ? "text-success" : rec.confidenceScore >= 60
    ? "text-yellow-400" : "text-muted-foreground";

  return (
    <div className="flex gap-4 p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.035] hover:border-white/[0.11] transition-all">
      {/* Rank */}
      <div className="shrink-0 flex flex-col items-center gap-2 pt-0.5">
        <span className="text-[10px] font-bold text-muted-foreground/50 w-5 text-center">#{rank}</span>
      </div>

      {/* Thumbnail */}
      <div className="shrink-0">
        {rec.thumbnailUrl ? (
          <img
            src={rec.thumbnailUrl}
            alt={`${rec.year} ${rec.make} ${rec.model}`}
            className="w-[88px] h-[62px] object-cover rounded-lg bg-white/[0.04]"
          />
        ) : (
          <div className="w-[88px] h-[62px] rounded-lg bg-white/[0.04] flex items-center justify-center">
            <Car className="w-6 h-6 text-white/15" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-2">
        {/* Vehicle name + strategy */}
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white leading-tight truncate">
              {rec.year} {rec.make} {rec.model}
              {rec.trim ? <span className="text-muted-foreground font-normal"> {rec.trim}</span> : null}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {rec.price != null && formatCurrency(rec.price)}
              {rec.mileage != null && ` · ${rec.mileage.toLocaleString()} mi`}
              {rec.bodyStyle && ` · ${rec.bodyStyle}`}
            </div>
          </div>
          {rec.strategyName && (
            <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border shrink-0", sc.bg, sc.text, sc.border)}>
              {rec.strategyName}
            </span>
          )}
        </div>

        {/* Score + metrics */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="w-20 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div className={cn("h-full rounded-full", scoreColor)} style={{ width: `${rec.confidenceScore}%` }} />
            </div>
            <span className={cn("text-xs font-bold", scoreText)}>{rec.confidenceScore}%</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {(rec.estimatedMessages ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                ~{rec.estimatedMessages} msgs
              </span>
            )}
            {(rec.estimatedDaysToSell ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <CalendarDays className="w-3 h-3" />
                ~{rec.estimatedDaysToSell}d
              </span>
            )}
            {(rec.photoCount ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <Camera className="w-3 h-3" />
                {rec.photoCount} photos
              </span>
            )}
            {rec.recommendedPhotoStrategy === "ai_creative" && (
              <span className="flex items-center gap-1 text-violet-400">
                <Sparkles className="w-3 h-3" />
                AI Enhanced
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          className="h-7 px-3 text-xs gap-1.5 premium-gradient-btn"
          disabled={isPublishing}
          onClick={onPublish}
        >
          {isPublishing
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <UploadCloud className="w-3 h-3" />}
          Publish
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-3 text-xs gap-1.5 border-white/[0.10] text-white/60 hover:text-white hover:border-white/20"
          onClick={onPreview}
        >
          <Eye className="w-3 h-3" />
          Preview
        </Button>
        <button
          className="text-white/20 hover:text-white/60 transition-colors p-1 rounded hover:bg-white/[0.05]"
          onClick={onSkip}
          title="Skip for today"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({
  title,
  badge,
  children,
  action,
  emptyMessage,
  isEmpty,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  emptyMessage?: string;
  isEmpty?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white/80">{title}</h2>
          {badge}
        </div>
        {action}
      </div>
      {isEmpty ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] px-4 py-6 text-center text-sm text-muted-foreground">
          {emptyMessage ?? "Nothing here yet."}
        </div>
      ) : children}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MarketplaceIntelligence() {
  const [skippedIds, setSkippedIds] = useState<Set<number>>(new Set());
  const [publishNowVehicleId, setPublishNowVehicleId] = useState<number | null>(null);
  const [publishingVehicleId, setPublishingVehicleId] = useState<number | null>(null);

  const { selectedLocation } = useDealerLocation();
  const { data: recsData, isLoading: recsLoading } = useListMarketplaceRecommendations({ location: selectedLocation });
  const { data: jobsData, isLoading: jobsLoading } = useListPublishingJobs();
  const { data: settingsData } = useGetAutoPublishSettings(1);
  const updateSettings = useUpdateAutoPublishSettings();

  const bulkSchedule = useBulkSchedulePublishing({
    mutation: {
      onSuccess: (result, vars) => {
        const vehicleId = (vars.data.vehicleIds ?? [])[0];
        setPublishingVehicleId(null);
        if (result.enqueued > 0) {
          toast({
            title: "Queued for publishing",
            description: "Extension will pick this up on its next poll.",
          });
          if (vehicleId) setSkippedIds((s) => new Set([...s, vehicleId]));
        } else {
          toast({ title: "Already queued", description: "This vehicle is already in the publishing queue." });
        }
      },
      onError: () => {
        setPublishingVehicleId(null);
        toast({ title: "Error", description: "Failed to queue vehicle.", variant: "destructive" });
      },
    },
  });

  const allRecs = (recsData?.recommendations ?? []) as Rec[];
  const visibleRecs = allRecs.filter((r) => !skippedIds.has(r.vehicleId)).slice(0, 3);
  const allJobs = jobsData?.jobs ?? [];
  const isLoading = recsLoading || jobsLoading;

  // KPIs
  const readyCount = allRecs.filter((r) => r.confidenceScore >= 70).length;
  const eligibleCount = allRecs.length;
  const publishingCount = allJobs.filter((j) => ACTIVE_STATUSES.includes(j.status ?? "")).length;
  const todayStr = new Date().toDateString();
  const publishedTodayCount = allJobs.filter(
    (j) => j.status === "Published" && j.completedAt && new Date(j.completedAt).toDateString() === todayStr,
  ).length;

  // Queue & recently published
  const queue = allJobs
    .filter((j) => ACTIVE_STATUSES.includes(j.status ?? ""))
    .slice(0, 10);

  const recentlyPublished = allJobs
    .filter((j) => j.status === "Published")
    .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime())
    .slice(0, 10);

  const settings = settingsData?.settings;

  const handlePublish = (vehicleId: number) => {
    setPublishingVehicleId(vehicleId);
    bulkSchedule.mutate({ data: { vehicleIds: [vehicleId], spacingMinutes: 30 } });
  };

  const handleToggleAutoPublish = () => {
    if (!settings) return;
    updateSettings.mutate(
      { dealerId: 1, data: { enabled: !settings.enabled } },
      {
        onSuccess: () =>
          toast({
            title: settings.enabled ? "Auto Publish disabled" : "Auto Publish enabled",
            description: settings.enabled ? "Publishing will require manual approval." : "Jobs will queue automatically based on your settings.",
          }),
        onError: () =>
          toast({ title: "Error", description: "Failed to update Auto Publish.", variant: "destructive" }),
      },
    );
  };

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-8">

          {/* Header */}
          <PageHeader
            icon={<Radio className="w-5 h-5 text-primary" />}
            eyebrow="MARKETPLACE AI"
            title="Marketplace AI"
            subtitle="What should I publish today?"
          />

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Ready to Publish" value={readyCount} icon={Zap} iconColor="text-primary" loading={isLoading} />
            <KpiCard label="Publishing Now" value={publishingCount} icon={Loader2} iconColor="text-yellow-400" loading={isLoading} />
            <KpiCard label="Published Today" value={publishedTodayCount} icon={CheckCircle2} iconColor="text-success" loading={isLoading} />
            <KpiCard label="Eligible Vehicles" value={eligibleCount} icon={Car} iconColor="text-blue-400" loading={isLoading} />
          </div>

          {/* Today's Picks */}
          <Section
            title="Today's Picks"
            badge={
              visibleRecs.length > 0 ? (
                <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-bold px-1.5 py-0">
                  {visibleRecs.length}
                </Badge>
              ) : null
            }
            isEmpty={!recsLoading && visibleRecs.length === 0}
            emptyMessage={
              allRecs.length === 0
                ? "No recommendations yet — vehicle strategies are generated automatically once inventory syncs."
                : "You've reviewed all of today's picks."
            }
          >
            {recsLoading ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] px-4 py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading recommendations…
              </div>
            ) : (
              <div className="space-y-2">
                {visibleRecs.map((rec, i) => (
                  <PickCard
                    key={rec.vehicleId}
                    rec={rec}
                    rank={i + 1}
                    onPublish={() => handlePublish(rec.vehicleId)}
                    onPreview={() => setPublishNowVehicleId(rec.vehicleId)}
                    onSkip={() => setSkippedIds((s) => new Set([...s, rec.vehicleId]))}
                    isPublishing={publishingVehicleId === rec.vehicleId && bulkSchedule.isPending}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* Publishing Queue */}
          <Section
            title="Publishing Queue"
            badge={
              queue.length > 0 ? (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-yellow-400/15 text-[10px] font-bold text-yellow-400">
                  {queue.length}
                </span>
              ) : null
            }
            isEmpty={!jobsLoading && queue.length === 0}
            emptyMessage="No active publishing jobs — queue a vehicle above to get started."
          >
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] divide-y divide-white/[0.04] overflow-hidden">
              {queue.map((job) => {
                const ss = jobStatusStyle(job.status ?? "");
                return (
                  <div key={job.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold shrink-0", ss.bg, ss.text)}>
                      {job.status}
                    </span>
                    <span className="flex-1 text-sm text-white truncate">{job.vehicleLabel ?? `Vehicle #${job.vehicleId}`}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{relativeTime(job.startedAt ?? job.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Recently Published */}
          <Section
            title="Recently Published"
            isEmpty={!jobsLoading && recentlyPublished.length === 0}
            emptyMessage="No published vehicles yet — publish your first vehicle above."
          >
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] divide-y divide-white/[0.04] overflow-hidden">
              {recentlyPublished.map((job) => (
                <div key={job.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                  <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                  <span className="flex-1 text-sm text-white truncate">{job.vehicleLabel ?? `Vehicle #${job.vehicleId}`}</span>
                  {job.listingUrl && (
                    <a
                      href={job.listingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors shrink-0"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View
                    </a>
                  )}
                  <span className="text-xs text-muted-foreground shrink-0">{shortDate(job.completedAt)}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Auto Publish */}
          <Section title="Auto Publish" action={
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-white"
              onClick={() => toast({ title: "Settings", description: "Open Settings → Publishing to configure Auto Publish in detail." })}
            >
              <Settings2 className="w-3.5 h-3.5" />
              Configure
            </Button>
          }>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-white">
                    Auto Publish is{" "}
                    <span className={settings?.enabled ? "text-success" : "text-muted-foreground"}>
                      {settings?.enabled ? "ON" : "OFF"}
                    </span>
                  </div>
                  {settings && (
                    <div className="text-xs text-muted-foreground">
                      {settings.enabled
                        ? `${settings.vehiclesPerBatch} vehicles every ${settings.frequencyDays}d · ${settings.preferredWindowStart}–${settings.preferredWindowEnd}`
                        : "Enable to automatically queue vehicles based on AI recommendations."}
                    </div>
                  )}
                </div>
                <button
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
                    settings?.enabled ? "bg-success" : "bg-white/10",
                    updateSettings.isPending && "opacity-50 cursor-not-allowed",
                  )}
                  onClick={handleToggleAutoPublish}
                  disabled={updateSettings.isPending || !settings}
                  role="switch"
                  aria-checked={settings?.enabled ?? false}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transform transition-transform duration-200",
                      settings?.enabled ? "translate-x-5" : "translate-x-0",
                    )}
                  />
                </button>
              </div>
              {settings?.enabled && (
                <div className="mt-3 pt-3 border-t border-white/[0.05] flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <RotateCcw className="w-3 h-3" />
                    Require approval: {settings.requireApproval ? "Yes" : "No"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Camera className="w-3 h-3" />
                    Min photo score: {settings.photoScoreThreshold}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" />
                    AI creative if low quality: {settings.aiCreativeIfLow ? "Yes" : "No"}
                  </span>
                </div>
              )}
            </div>
          </Section>

        </div>
      </div>

      {publishNowVehicleId !== null && (
        <PublishNowModal
          vehicleId={publishNowVehicleId}
          onClose={() => setPublishNowVehicleId(null)}
        />
      )}
    </AppLayout>
  );
}
