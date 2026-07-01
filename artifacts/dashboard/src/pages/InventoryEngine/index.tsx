import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader, SectionCard, KpiCard, StatusPulse } from "@/components/shared";
import {
  useGetInventoryHealth,
  useGetMetaCatalogDiagnostics,
  useValidateMetaCatalogFeed,
  useListDealers,
  useSyncDealerFeed,
  useListFeedRuns,
  getListFeedRunsQueryKey,
  getGetInventoryHealthQueryKey,
  getGetMetaCatalogDiagnosticsQueryKey,
  getValidateMetaCatalogFeedQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Activity,
  Clock,
  Image,
  Tag,
  Layers,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Store,
  Globe,
  Flag,
  Database,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const DEALER_ID = 1;

function HealthBadge({ status }: { status: "Healthy" | "Needs Attention" | "Critical" | undefined }) {
  if (!status) return null;
  const map = {
    Healthy: {
      cls: "bg-success/10 text-success border-success/20",
      icon: ShieldCheck,
      label: "Healthy",
    },
    "Needs Attention": {
      cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
      icon: ShieldAlert,
      label: "Needs Attention",
    },
    Critical: {
      cls: "bg-destructive/10 text-destructive border-destructive/20",
      icon: ShieldX,
      label: "Critical",
    },
  } as const;
  const { cls, icon: Icon, label } = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border",
        cls,
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-success" : score >= 60 ? "bg-yellow-400" : "bg-destructive";
  return (
    <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all duration-500", color)}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: `${label} copied`, description: text });
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-white transition-colors"
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function FeedUrlRow({ label, url }: { label: string; url: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-white/70 font-mono truncate max-w-[260px]">{url}</span>
        <CopyButton text={url} label="Copy" />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-white transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

export function InventoryEngine() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showVehicleIssues, setShowVehicleIssues] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers[0]?.id ?? DEALER_ID;

  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useGetInventoryHealth({
    query: { queryKey: getGetInventoryHealthQueryKey(), refetchInterval: 60_000 },
  });

  const { data: diagnostics, isLoading: diagLoading, refetch: refetchDiag } = useGetMetaCatalogDiagnostics({
    query: { queryKey: getGetMetaCatalogDiagnosticsQueryKey(), refetchInterval: 120_000 },
  });

  const { data: validation, isLoading: validationLoading, refetch: refetchValidation } = useValidateMetaCatalogFeed({
    query: { queryKey: getValidateMetaCatalogFeedQueryKey(), refetchInterval: 120_000 },
  });

  const { data: feedRunsData } = useListFeedRuns(dealerId, {
    query: { enabled: !!dealerId, queryKey: getListFeedRunsQueryKey(dealerId) },
  });

  const syncMutation = useSyncDealerFeed();

  const handleSync = async () => {
    setSyncLoading(true);
    try {
      await syncMutation.mutateAsync({ id: dealerId });
      toast({ title: "Sync complete", description: "Inventory feed synced successfully." });
      await refetchHealth();
      await refetchDiag();
      await queryClient.invalidateQueries({ queryKey: getListFeedRunsQueryKey(dealerId) });
    } catch {
      toast({
        title: "Sync failed",
        description: "Could not sync the inventory feed.",
        variant: "destructive",
      });
    } finally {
      setSyncLoading(false);
    }
  };

  const handleValidate = async () => {
    await Promise.all([refetchDiag(), refetchValidation()]);
    toast({ title: "Feed validated", description: "Meta Automotive validation refreshed." });
  };

  const handleDownloadCsv = () => {
    window.open("/api/channels/meta-catalog/feed.csv", "_blank");
  };

  const feedRuns = feedRunsData?.feedRuns ?? [];

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
          <PageHeader
            title="Inventory Engine"
            subtitle="Feed health, normalization, delta detection, and channel-ready catalog outputs"
            action={
              <Button
                onClick={handleSync}
                disabled={syncLoading}
                size="sm"
                className="gap-2"
              >
                {syncLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Sync Now
              </Button>
            }
          />

          {/* ── PART 1: Feed Health ── */}
          <SectionCard
            title="Feed Health"
            description={
              health?.feedUrl
                ? `Source: ${health.feedUrl}`
                : "No feed URL configured"
            }
            action={
              health ? (
                <div className="flex items-center gap-3">
                  <HealthBadge status={health.healthStatus} />
                  <span className="text-sm font-semibold text-white">{health.healthScore}/100</span>
                </div>
              ) : undefined
            }
          >
            {healthLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : health ? (
              <div className="space-y-6">
                {/* Health score bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Feed health score</span>
                    <span className="font-medium text-white">{health.healthScore} / 100</span>
                  </div>
                  <ScoreBar score={health.healthScore} />
                </div>

                {/* Sync timing */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-white/[0.03] border border-white/5 px-4 py-3 space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                      <Clock className="w-3 h-3" />
                      Last Sync
                    </div>
                    <div className="text-sm font-medium text-white">
                      {health.lastSyncAt ? formatDate(health.lastSyncAt) : "Never"}
                    </div>
                    {health.lastSyncStatus && (
                      <div
                        className={cn(
                          "text-[11px] font-medium",
                          health.lastSyncStatus === "success" ? "text-success" : "text-destructive",
                        )}
                      >
                        {health.lastSyncStatus === "success" ? "Succeeded" : "Failed"}
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg bg-white/[0.03] border border-white/5 px-4 py-3 space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                      <Clock className="w-3 h-3" />
                      Next Auto-Sync
                    </div>
                    <div className="text-sm font-medium text-white">
                      {health.nextSyncAt ? formatDate(health.nextSyncAt) : "Not scheduled"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">Every 24 hours</div>
                  </div>
                </div>

                {/* KPI grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <KpiCard
                    label="Total Vehicles"
                    value={health.totalVehicles}
                    icon={<Database className="w-4 h-4" />}
                  />
                  <KpiCard
                    label="Total Photos"
                    value={health.totalPhotos}
                    icon={<Image className="w-4 h-4" />}
                  />
                  <KpiCard
                    label="Avg Photos / Vehicle"
                    value={health.avgPhotosPerVehicle}
                    icon={<Layers className="w-4 h-4" />}
                  />
                  <KpiCard
                    label="Duplicate VINs"
                    value={health.duplicateVins}
                    icon={<Tag className="w-4 h-4" />}
                    valueColor={health.duplicateVins > 0 ? "text-destructive" : undefined}
                  />
                </div>

                {/* Last feed run deltas */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-success/5 border border-success/10 px-4 py-3 text-center">
                    <div className="text-2xl font-bold text-success">{health.newVehicles}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">New this sync</div>
                  </div>
                  <div className="rounded-lg bg-primary/5 border border-primary/10 px-4 py-3 text-center">
                    <div className="text-2xl font-bold text-primary">{health.updatedVehicles}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">Updated</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] border border-white/5 px-4 py-3 text-center">
                    <div className="text-2xl font-bold text-muted-foreground">{health.removedVehicles}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">Removed / Sold</div>
                  </div>
                </div>

                {/* Issues */}
                {(health.vehiclesMissingPrice > 0 || health.vehiclesMissingImages > 0) && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Issues
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {health.vehiclesMissingPrice > 0 && (
                        <div className="flex items-center gap-2 rounded-lg bg-yellow-500/5 border border-yellow-500/10 px-3 py-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                          <span className="text-xs text-yellow-300">
                            {health.vehiclesMissingPrice} vehicle{health.vehiclesMissingPrice !== 1 ? "s" : ""} missing price
                          </span>
                        </div>
                      )}
                      {health.vehiclesMissingImages > 0 && (
                        <div className="flex items-center gap-2 rounded-lg bg-yellow-500/5 border border-yellow-500/10 px-3 py-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                          <span className="text-xs text-yellow-300">
                            {health.vehiclesMissingImages} vehicle{health.vehiclesMissingImages !== 1 ? "s" : ""} missing images
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Feed run history */}
                {feedRuns.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Sync History
                    </div>
                    <div className="space-y-1.5">
                      {feedRuns.slice(0, 5).map((run) => (
                        <div
                          key={run.id}
                          className="flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            {run.status === "success" ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                            ) : run.status === "error" ? (
                              <XCircle className="w-3.5 h-3.5 text-destructive" />
                            ) : (
                              <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
                            )}
                            <span className="text-xs text-white/70">
                              {run.startedAt ? formatDate(run.startedAt) : "—"}
                            </span>
                            {run.errorMessage && (
                              <span className="text-xs text-destructive truncate max-w-[180px]">
                                {run.errorMessage}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                            {run.vehiclesNew != null && run.vehiclesNew > 0 && (
                              <span className="text-success">+{run.vehiclesNew}</span>
                            )}
                            {run.vehiclesUpdated != null && run.vehiclesUpdated > 0 && (
                              <span className="text-primary">~{run.vehiclesUpdated}</span>
                            )}
                            {run.vehiclesRemoved != null && run.vehiclesRemoved > 0 && (
                              <span>−{run.vehiclesRemoved}</span>
                            )}
                            <span>{run.vehiclesImported ?? 0} total</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No health data available
              </div>
            )}
          </SectionCard>

          {/* ── META AUTOMOTIVE VALIDATION ── */}
          {(() => {
            const total = validation?.totalVehicles ?? 0;
            const exportable = validation?.exportableVehicles ?? 0;
            const blocked = validation?.blockedVehicles ?? 0;
            const readiness = validation?.feedReadinessPercent ?? 0;
            const isReady = blocked === 0 && total > 0;
            const coverage = validation?.fieldCoverage;

            type MetaFieldKey = "vehicle_id" | "image_url" | "price" | "url";
            const FIELDS: { key: MetaFieldKey; label: string; desc: string }[] = [
              { key: "vehicle_id", label: "vehicle_id", desc: "Unique vehicle ID (VIN)" },
              { key: "image_url", label: "image[0].url", desc: "Primary photo HTTPS URL" },
              { key: "price", label: "price", desc: "Price — \"28900 USD\" format" },
              { key: "url", label: "url", desc: "Vehicle Detail Page (VDP) HTTPS URL" },
            ];

            return (
              <SectionCard
                title="Meta Automotive Validation"
                description={
                  total > 0
                    ? `${exportable} exportable / ${total} total — ${blocked > 0 ? `${blocked} blocked from feed` : "all vehicles clear"}`
                    : "Required field coverage — must be 100% before uploading to Commerce Manager"
                }
                action={
                  isReady ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-success/10 text-success border-success/20">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Feed Ready
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-destructive/10 text-destructive border-destructive/20">
                      <XCircle className="w-3.5 h-3.5" />
                      {blocked} Blocked
                    </span>
                  )
                }
              >
                {validationLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : validation ? (
                  <div className="space-y-5">
                    {/* Field checklist */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {FIELDS.map(({ key, label, desc }) => {
                        const count = coverage ? coverage[key] : 0;
                        const passing = total > 0 ? count === total : true;
                        return (
                          <div
                            key={key}
                            className={cn(
                              "flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 border",
                              passing
                                ? "bg-success/5 border-success/20"
                                : "bg-destructive/5 border-destructive/20",
                            )}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {passing ? (
                                <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                              ) : (
                                <XCircle className="w-4 h-4 text-destructive shrink-0" />
                              )}
                              <div className="min-w-0">
                                <div className="text-xs font-mono font-semibold text-white truncate">
                                  {label}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate">
                                  {desc}
                                </div>
                              </div>
                            </div>
                            <div className={cn(
                              "text-xs font-semibold shrink-0 tabular-nums",
                              passing ? "text-success" : "text-destructive",
                            )}>
                              {count}/{total}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Readiness bar */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Feed Readiness</span>
                        <span className={cn(
                          "font-semibold",
                          readiness === 100 ? "text-success" : readiness >= 90 ? "text-yellow-400" : "text-destructive",
                        )}>
                          {readiness}%
                        </span>
                      </div>
                      <ScoreBar score={readiness} />
                    </div>

                    {/* Problem vehicles */}
                    {validation.invalidVehicles > 0 && (
                      <div className="rounded-lg bg-destructive/5 border border-destructive/15 px-4 py-3 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-destructive">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {validation.invalidVehicles} vehicle{validation.invalidVehicles !== 1 ? "s" : ""} with missing required fields
                        </div>
                        <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                          {validation.vehicles
                            .filter((v) => !v.valid)
                            .map((v) => (
                              <div key={v.vin} className="flex items-start gap-2 text-[11px] py-1 border-t border-destructive/10 first:border-0">
                                <XCircle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
                                <div className="min-w-0">
                                  <span className="font-medium text-white/80">{v.title}</span>
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {v.errors.map((e) => (
                                      <span key={e} className="text-[10px] text-destructive bg-destructive/10 rounded px-1.5 py-0.5">
                                        {e}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {isReady && (
                      <div className="flex items-center gap-2 text-xs text-success">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        All {total} vehicles pass Meta Automotive required field validation — feed is ready to upload.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No validation data available. Click Validate above.
                  </div>
                )}
              </SectionCard>
            );
          })()}

          {/* ── PART 2: Meta Catalog Adapter ── */}
          <SectionCard
            title="Meta Catalog Adapter"
            description="DealerPilot-hosted feeds — generated from normalized inventory, ready for Meta Commerce Manager"
            action={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={handleValidate}>
                  <Activity className="w-3.5 h-3.5" />
                  Validate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 h-7 text-xs"
                  onClick={handleDownloadCsv}
                  disabled={!!(validation && validation.invalidVehicles > 0)}
                  title={validation && validation.invalidVehicles > 0 ? "Fix required field errors before exporting" : undefined}
                >
                  <Download className="w-3.5 h-3.5" />
                  CSV
                </Button>
              </div>
            }
          >
            {diagLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : diagnostics ? (
              <div className="space-y-5">
                {/* Feed URLs */}
                <div className="rounded-lg bg-white/[0.03] border border-white/5 px-4 py-3 space-y-0.5">
                  <FeedUrlRow label="XML Feed (Meta Commerce Manager)" url={diagnostics.feedXmlUrl} />
                  <FeedUrlRow label="CSV Feed (Meta Business Suite)" url={diagnostics.feedCsvUrl} />
                </div>

                {/* Diagnostics KPIs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <KpiCard
                    label="Total Vehicles"
                    value={diagnostics.totalVehicles}
                    icon={<Database className="w-4 h-4" />}
                  />
                  <KpiCard
                    label="Exportable"
                    value={diagnostics.exportableVehicles}
                    icon={<CheckCircle2 className="w-4 h-4" />}
                    accentColor="green"
                  />
                  <KpiCard
                    label="Blocked"
                    value={diagnostics.blockedVehicles}
                    icon={<XCircle className="w-4 h-4" />}
                    valueColor={diagnostics.blockedVehicles > 0 ? "text-destructive" : undefined}
                  />
                  <KpiCard
                    label="Warnings"
                    value={diagnostics.totalWarnings}
                    icon={<AlertTriangle className="w-4 h-4" />}
                    accentColor="orange"
                  />
                </div>

                {/* Last generated */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  Last generated: {formatDate(diagnostics.lastGenerated)}
                </div>

                {/* Per-vehicle issues toggle */}
                {diagnostics.vehicles.filter((v) => !v.valid || v.warnings.length > 0).length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowVehicleIssues((s) => !s)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white transition-colors"
                    >
                      {showVehicleIssues ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      {showVehicleIssues ? "Hide" : "Show"} per-vehicle issues (
                      {diagnostics.vehicles.filter((v) => !v.valid).length} errors,{" "}
                      {diagnostics.vehicles.filter((v) => v.warnings.length > 0).length} warnings)
                    </button>
                    {showVehicleIssues && (
                      <div className="mt-3 space-y-1.5 max-h-72 overflow-y-auto pr-1">
                        {diagnostics.vehicles
                          .filter((v) => !v.valid || v.warnings.length > 0)
                          .map((v) => (
                            <div
                              key={v.vin}
                              className="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"
                            >
                              <div className="flex items-center gap-2 mb-1">
                                {v.valid ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                                ) : (
                                  <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                                )}
                                <span className="text-xs font-medium text-white truncate">
                                  {v.title}
                                </span>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {v.vin}
                                </span>
                              </div>
                              {v.errors.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {v.errors.map((e) => (
                                    <span
                                      key={e}
                                      className="inline-flex items-center gap-1 text-[10px] bg-destructive/10 text-destructive border border-destructive/20 rounded px-1.5 py-0.5"
                                    >
                                      {e}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {v.warnings.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {v.warnings.map((w) => (
                                    <span
                                      key={w}
                                      className="inline-flex items-center gap-1 text-[10px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded px-1.5 py-0.5"
                                    >
                                      {w}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No diagnostics available
              </div>
            )}
          </SectionCard>

          {/* ── PART 3: Channel Separation ── */}
          <SectionCard
            title="Channel Separation"
            description="Each channel has its own identity, feed, and publishing path — never mixed"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Marketplace */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Store className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">Marketplace</div>
                    <div className="text-[11px] text-muted-foreground">Personal account</div>
                  </div>
                </div>
                <div className="space-y-1.5 text-[12px] text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <StatusPulse status="active" />
                    <span>Chrome Extension</span>
                  </div>
                  <div className="flex items-center gap-2 pl-4">
                    <span className="text-white/60">Operator-driven publishing</span>
                  </div>
                  <div className="flex items-center gap-2 pl-4">
                    <span className="text-white/60">VIN-deduplicated inventory</span>
                  </div>
                </div>
                <div className="pt-1">
                  <a
                    href="/listings"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    Open Publishing Queue <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              {/* Meta Catalog */}
              <div className="rounded-xl border border-accent/20 bg-accent/5 p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-accent/20 flex items-center justify-center">
                    <Globe className="w-4 h-4 text-accent" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">Meta Catalog</div>
                    <div className="text-[11px] text-muted-foreground">DealerPilot hosted</div>
                  </div>
                </div>
                <div className="space-y-1.5 text-[12px] text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <StatusPulse status="active" />
                    <span>Commerce Manager</span>
                  </div>
                  <div className="flex items-center gap-2 pl-4">
                    <span className="text-white/60">XML + CSV feed endpoints</span>
                  </div>
                  <div className="flex items-center gap-2 pl-4">
                    <span className="text-white/60">Auto-normalized inventory</span>
                  </div>
                </div>
                <div className="pt-1 space-y-1">
                  <a
                    href="/api/channels/meta-catalog/feed.xml"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
                  >
                    XML Feed <ExternalLink className="w-3 h-3" />
                  </a>
                  <a
                    href="/api/channels/meta-catalog/feed.csv"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
                  >
                    CSV Feed <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              {/* Facebook Page */}
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-3 opacity-60">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center">
                    <Flag className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white/60">Facebook Page</div>
                    <div className="text-[11px] text-muted-foreground">Official Page API</div>
                  </div>
                </div>
                <div className="space-y-1.5 text-[12px] text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-white/20 inline-block" />
                    <span>Coming later</span>
                  </div>
                  <div className="flex items-center gap-2 pl-4">
                    <span>Page-managed listings</span>
                  </div>
                  <div className="flex items-center gap-2 pl-4">
                    <span>Requires Page token</span>
                  </div>
                </div>
                <div className="pt-1">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-white/5 rounded px-2 py-0.5">
                    Planned
                  </span>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </AppLayout>
  );
}
