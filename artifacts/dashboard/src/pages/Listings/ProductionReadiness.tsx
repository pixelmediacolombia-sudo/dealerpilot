import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetFeedQuality,
  getGetFeedQualityQueryKey,
  useGetLaunchChecklist,
  getGetLaunchChecklistQueryKey,
  useRunPublishDryRun,
  useGetExtensionDiagnostics,
  getGetExtensionDiagnosticsQueryKey,
  useGetFieldValidation,
  getGetFieldValidationQueryKey,
  useListVehiclePhotoScores,
  getListVehiclePhotoScoresQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Play,
  Loader2,
  Wifi,
  WifiOff,
  ArrowLeft,
  Car,
  ImageIcon,
  FileText,
  Gauge,
  ShieldCheck,
  Zap,
  Eye,
  MonitorSmartphone,
  ClipboardCheck,
  Database,
  Radio,
  Facebook,
  ChevronDown,
  ChevronUp,
  Wand2,
} from "lucide-react";
import { PageHeader, SectionCard } from "@/components/shared";
import { formatCurrency } from "@/lib/format";

const DEALER_ID = 1;

function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full ring-2 ring-offset-2 ring-offset-card",
        online ? "bg-success ring-success/30" : "bg-destructive ring-destructive/30",
      )}
    />
  );
}

function CheckItem({
  passed,
  label,
  detail,
  icon: Icon,
}: {
  passed: boolean;
  label: string;
  detail: string;
  icon?: React.ElementType;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-4 p-4 rounded-xl border transition-colors",
        passed
          ? "bg-success/5 border-success/20"
          : "bg-destructive/5 border-destructive/20",
      )}
    >
      <div className="mt-0.5 shrink-0">
        {passed ? (
          <CheckCircle2 className="w-5 h-5 text-success" />
        ) : (
          <XCircle className="w-5 h-5 text-destructive" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
          <span className="font-semibold text-sm text-foreground">{label}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  variant = "default",
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  variant?: "default" | "success" | "warning" | "destructive";
  sub?: string;
}) {
  const colors = {
    default: "bg-secondary/40 border-border/40 text-foreground",
    success: "bg-success/10 border-success/20 text-success",
    warning: "bg-warning/10 border-warning/20 text-warning",
    destructive: "bg-destructive/10 border-destructive/20 text-destructive",
  };
  const iconColors = {
    default: "text-muted-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  };
  return (
    <div className={cn("rounded-xl border p-5 flex flex-col gap-2", colors[variant])}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-widest opacity-70">{label}</span>
        <Icon className={cn("w-4 h-4", iconColors[variant])} />
      </div>
      <div className="text-3xl font-bold tabular-nums">{value}</div>
      {sub && <p className="text-xs opacity-60 leading-tight">{sub}</p>}
    </div>
  );
}

function FieldBadge({ value }: { value: boolean | null | undefined }) {
  if (value === null || value === undefined) return <Badge variant="secondary" className="text-[10px]">No data</Badge>;
  return value ? (
    <Badge className="bg-success/20 text-success border-success/20 border text-[10px]">Found</Badge>
  ) : (
    <Badge className="bg-destructive/20 text-destructive border-destructive/20 border text-[10px]">Not found</Badge>
  );
}

// ─── Section: Feed Quality ────────────────────────────────────────────────────
function FeedQualitySection() {
  const { data, isLoading, refetch } = useGetFeedQuality(
    { dealerId: DEALER_ID },
    { query: { queryKey: getGetFeedQualityQueryKey({ dealerId: DEALER_ID }) } },
  );
  const q = data?.quality;

  return (
    <SectionCard className="border-border/50">
      <div className="p-6 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Database className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <div className="font-bold">XML Feed Quality</div>
            <div className="text-xs text-muted-foreground">Real-time inventory analysis</div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refetch()} className="gap-2 text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>
      <div className="p-6">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : !q ? (
          <p className="text-muted-foreground text-sm">No feed data available.</p>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Vehicles" value={q.total} icon={Car} />
              <StatCard
                label="5+ Photos"
                value={q.withFiveOrMorePhotos}
                icon={ImageIcon}
                variant={q.withFiveOrMorePhotos > 0 ? "success" : "destructive"}
                sub={`${q.total > 0 ? Math.round((q.withFiveOrMorePhotos / q.total) * 100) : 0}% of inventory`}
              />
              <StatCard
                label="Ready for Batch"
                value={q.readyForBatch}
                icon={Play}
                variant={q.readyForBatch > 0 ? "success" : "warning"}
                sub="Pass all validation checks"
              />
              <StatCard
                label="Already Published"
                value={q.alreadyPublished}
                icon={CheckCircle2}
                variant="default"
                sub="Currently live on Marketplace"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard
                label="Missing VIN"
                value={q.missingVin}
                icon={AlertTriangle}
                variant={q.missingVin > 0 ? "destructive" : "success"}
              />
              <StatCard
                label="Missing Price"
                value={q.missingPrice}
                icon={AlertTriangle}
                variant={q.missingPrice > 0 ? "destructive" : "success"}
              />
              <StatCard
                label="Missing Mileage"
                value={q.missingMileage}
                icon={AlertTriangle}
                variant={q.missingMileage > 0 ? "destructive" : "success"}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                label="Listing Generated"
                value={q.listingGenerated}
                icon={FileText}
                variant={q.listingGenerated > 0 ? "success" : "warning"}
                sub={`${q.total > 0 ? Math.round((q.listingGenerated / q.total) * 100) : 0}% have AI listing`}
              />
              <StatCard
                label="Photo Quality Analyzed"
                value={q.photoAnalyzed}
                icon={Gauge}
                variant={q.photoAnalyzed > 0 ? "success" : "warning"}
                sub={`${q.total > 0 ? Math.round((q.photoAnalyzed / q.total) * 100) : 0}% analyzed`}
              />
            </div>
            <div className="bg-secondary/30 rounded-lg p-4 text-sm space-y-1.5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Radio className="w-3.5 h-3.5" />
                <span className="font-medium">Feed URL:</span>
                <span className="font-mono text-xs truncate">{q.feedUrl ?? "Not configured"}</span>
              </div>
              {q.lastFeedRunAt && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span className="font-medium">Last sync:</span>
                  <span>{new Date(q.lastFeedRunAt).toLocaleString()}</span>
                  {q.lastFeedStatus && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] ml-1",
                        q.lastFeedStatus === "success"
                          ? "bg-success/10 text-success border-success/20"
                          : "bg-destructive/10 text-destructive border-destructive/20",
                      )}
                    >
                      {q.lastFeedStatus}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Section: Launch Checklist ────────────────────────────────────────────────
function LaunchChecklistSection() {
  const { data, isLoading, refetch } = useGetLaunchChecklist(
    { dealerId: DEALER_ID },
    { query: { queryKey: getGetLaunchChecklistQueryKey({ dealerId: DEALER_ID }) } },
  );
  const checklist = data?.checklist;

  const iconMap: Record<string, React.ElementType> = {
    feedConnected: Radio,
    extensionInstalled: MonitorSmartphone,
    facebookLoggedIn: Facebook,
    hasEnoughPhotos: ImageIcon,
    listingGenerated: FileText,
    photoAnalyzed: Gauge,
    dryRunPassed: Play,
    assistedPublishTested: ShieldCheck,
  };

  return (
    <SectionCard className="border-border/50">
      <div className="p-6 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center">
            <ClipboardCheck className="w-4 h-4 text-success" />
          </div>
          <div>
            <div className="font-bold">Alpha Launch Checklist</div>
            <div className="text-xs text-muted-foreground">Complete before first live run</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {checklist && (
            <Badge
              variant="outline"
              className={cn(
                "font-bold px-3",
                checklist.allPassed
                  ? "bg-success/10 text-success border-success/20"
                  : "bg-secondary text-foreground border-border",
              )}
            >
              {checklist.passedCount} / {checklist.totalCount}
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={() => void refetch()} className="gap-2 text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>
      <div className="p-6">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : !checklist ? (
          <p className="text-muted-foreground text-sm">No checklist data.</p>
        ) : (
          <div className="space-y-3">
            {checklist.allPassed && (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-success/10 border border-success/20 mb-4">
                <Zap className="w-5 h-5 text-success" />
                <div>
                  <div className="font-bold text-success">Ready for Alpha Launch!</div>
                  <div className="text-xs text-success/70">All checks passed. You can start an Assisted Mode batch.</div>
                </div>
              </div>
            )}
            {checklist.items.map((item) => (
              <CheckItem
                key={item.key}
                passed={item.passed}
                label={item.label}
                detail={item.detail}
                icon={iconMap[item.key]}
              />
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Section: Batch Dry Run ───────────────────────────────────────────────────
function BatchDryRunSection() {
  const [count, setCount] = useState(4);
  const [result, setResult] = useState<{
    selected: {
      vehicleId: number;
      label: string;
      photoCount: number;
      photoScore: number;
      photoDecision: string;
      priorityScore: number;
      eligible: boolean;
      skipReason?: string | null;
      price?: number | null;
    }[];
    skipped: {
      vehicleId: number;
      label: string;
      photoCount: number;
      photoScore: number;
      photoDecision: string;
      priorityScore: number;
      eligible: boolean;
      skipReason?: string | null;
      price?: number | null;
    }[];
    totalEligible: number;
  } | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const { mutate, isPending, isError } = useRunPublishDryRun({
    mutation: {
      onSuccess(data) {
        setResult(data);
      },
    },
  });

  function runDryRun() {
    mutate({ data: { dealerId: DEALER_ID, count } });
  }

  const photoDecisionLabel: Record<string, { label: string; color: string }> = {
    use_original: { label: "Original", color: "bg-success/20 text-success border-success/20" },
    use_original_recommend_ai_cover: { label: "AI Cover Rec", color: "bg-blue-500/20 text-blue-400 border-blue-500/20" },
    generate_ai_creative: { label: "AI Creative", color: "bg-purple-500/20 text-purple-400 border-purple-500/20" },
    needs_review: { label: "Review", color: "bg-warning/20 text-warning border-warning/20" },
  };

  return (
    <SectionCard className="border-border/50">
      <div className="p-6 border-b border-border/30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Eye className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="font-bold">Batch Dry Run</div>
            <div className="text-xs text-muted-foreground">
              Preview vehicle selection without creating any jobs
            </div>
          </div>
        </div>
      </div>
      <div className="p-6 space-y-6">
        {/* Controls */}
        <div className="flex items-end gap-6">
          <div className="flex-1 max-w-xs space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Batch size</label>
              <span className="text-sm font-bold text-primary">{count} vehicles</span>
            </div>
            <Slider
              value={[count]}
              onValueChange={([v]) => setCount(v ?? 4)}
              min={1}
              max={10}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>1</span>
              <span className="text-primary font-medium">Alpha: max 4</span>
              <span>10</span>
            </div>
          </div>
          <Button
            onClick={runDryRun}
            disabled={isPending}
            className="gap-2 bg-primary/90 hover:bg-primary"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Run Dry Run
          </Button>
        </div>

        {isError && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
            Dry run failed. Check that inventory is synced and listings are generated.
          </div>
        )}

        {result && (
          <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-success/10 border border-success/20 p-4 text-center">
                <div className="text-2xl font-bold text-success">{result.selected.length}</div>
                <div className="text-xs text-success/70 font-medium mt-1">Would Select</div>
              </div>
              <div className="rounded-xl bg-secondary/40 border border-border/30 p-4 text-center">
                <div className="text-2xl font-bold">{result.totalEligible}</div>
                <div className="text-xs text-muted-foreground font-medium mt-1">Total Eligible</div>
              </div>
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-center">
                <div className="text-2xl font-bold text-destructive">{result.skipped.length}</div>
                <div className="text-xs text-destructive/70 font-medium mt-1">Skipped</div>
              </div>
            </div>

            {/* Selected vehicles */}
            {result.selected.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-widest text-success/80 px-1">
                  ✓ Would be queued
                </div>
                {result.selected.map((v, idx) => {
                  const pd = photoDecisionLabel[v.photoDecision] ?? photoDecisionLabel.needs_review;
                  return (
                    <div
                      key={v.vehicleId}
                      className="flex items-center gap-4 p-4 rounded-xl bg-success/5 border border-success/20"
                    >
                      <div className="w-7 h-7 rounded-full bg-success/20 text-success text-xs font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link href={`/listings/${v.vehicleId}`}>
                          <span className="font-semibold text-sm hover:text-primary transition-colors cursor-pointer">
                            {v.label}
                          </span>
                        </Link>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          {v.price != null && (
                            <span className="text-xs text-muted-foreground font-medium">
                              {formatCurrency(v.price)}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {v.photoCount} photos
                          </span>
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] border", pd.color)}
                          >
                            {pd.label}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-muted-foreground">Priority</div>
                        <div className="font-bold text-primary">{v.priorityScore}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Skipped vehicles */}
            {result.skipped.length > 0 && (
              <div className="space-y-2">
                <button
                  className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-destructive/70 px-1 hover:text-destructive transition-colors"
                  onClick={() => setShowSkipped((s) => !s)}
                >
                  {showSkipped ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  ✗ Skipped ({result.skipped.length})
                </button>
                {showSkipped && result.skipped.map((v) => (
                  <div
                    key={v.vehicleId}
                    className="flex items-center gap-4 p-3 rounded-xl bg-secondary/20 border border-border/30 opacity-70"
                  >
                    <XCircle className="w-4 h-4 text-destructive/50 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm">{v.label}</span>
                      <div className="text-xs text-destructive/70 mt-0.5">{v.skipReason ?? "Not eligible"}</div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">{v.photoCount} photos</div>
                  </div>
                ))}
              </div>
            )}

            {result.selected.length === 0 && (
              <div className="rounded-xl bg-warning/10 border border-warning/20 p-5 text-center">
                <AlertTriangle className="w-6 h-6 text-warning mx-auto mb-2" />
                <div className="font-semibold text-warning">No vehicles are eligible</div>
                <div className="text-xs text-warning/70 mt-1">
                  Upload more photos (5+ per vehicle) and generate AI listings first.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Section: Extension Diagnostics ──────────────────────────────────────────
function ExtensionDiagnosticsSection() {
  const { data, isLoading, refetch } = useGetExtensionDiagnostics(
    { dealerId: DEALER_ID },
    {
      query: {
        queryKey: getGetExtensionDiagnosticsQueryKey({ dealerId: DEALER_ID }),
        refetchInterval: 15000,
      },
    },
  );
  const diag = data?.diagnostics;

  const diagnosticItems = diag
    ? [
        {
          label: "Extension installed",
          passed: diag.connectionCount > 0,
          detail: diag.connectionCount > 0 ? `${diag.connectionCount} connection(s) seen` : "Extension has never connected",
          icon: MonitorSmartphone,
        },
        {
          label: "Extension online",
          passed: diag.extensionOnline,
          detail: diag.extensionOnline
            ? `Online — last heartbeat: ${diag.lastHeartbeatAt ? new Date(diag.lastHeartbeatAt).toLocaleTimeString() : "unknown"}`
            : "Extension is not sending heartbeats",
          icon: Wifi,
        },
        {
          label: "Backend reachable",
          passed: diag.backendReachable,
          detail: diag.backendReachable
            ? "Extension has successfully reached the API"
            : "No API connection detected",
          icon: Radio,
        },
        {
          label: "Facebook session visible",
          passed: diag.facebookSessionVisible,
          detail: diag.facebookSessionVisible
            ? "Marketplace page activity detected"
            : "Open facebook.com/marketplace in the browser with the extension active",
          icon: Facebook,
        },
        {
          label: "Marketplace page reachable",
          passed: diag.marketplacePageReachable,
          detail: diag.marketplacePageReachable
            ? "Extension can access Marketplace"
            : "Navigate to a Marketplace listing page",
          icon: Eye,
        },
      ]
    : [];

  return (
    <SectionCard className="border-border/50">
      <div className="p-6 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-500/10 flex items-center justify-center">
            <MonitorSmartphone className="w-4 h-4 text-orange-400" />
          </div>
          <div>
            <div className="font-bold">Extension Diagnostics</div>
            <div className="text-xs text-muted-foreground">Auto-refreshes every 15 seconds</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {diag && (
            <div className="flex items-center gap-2 text-sm">
              <StatusDot online={diag.extensionOnline} />
              <span className={cn("font-semibold", diag.extensionOnline ? "text-success" : "text-destructive")}>
                {diag.extensionOnline ? "Online" : "Offline"}
              </span>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => void refetch()} className="gap-2 text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>
      <div className="p-6">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : !diag ? (
          <p className="text-muted-foreground text-sm">No diagnostic data available.</p>
        ) : (
          <div className="space-y-6">
            <div className="space-y-3">
              {diagnosticItems.map((item) => (
                <CheckItem key={item.label} {...item} />
              ))}
            </div>

            {/* Last activity */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-secondary/30 border border-border/30 p-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Last Job Claim
                </div>
                {diag.lastJobClaimAt ? (
                  <>
                    <div className="font-semibold text-sm">
                      {new Date(diag.lastJobClaimAt).toLocaleString()}
                    </div>
                    {diag.lastJobClaimExtensionId && (
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        {diag.lastJobClaimExtensionId.substring(0, 12)}...
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">No job claims yet</div>
                )}
              </div>
              <div className="rounded-xl bg-secondary/30 border border-border/30 p-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Last Event
                </div>
                {diag.lastEventAt ? (
                  <>
                    <div className="font-semibold text-sm">
                      {new Date(diag.lastEventAt).toLocaleString()}
                    </div>
                    {diag.lastEventType && (
                      <Badge variant="secondary" className="text-[10px] mt-1">
                        {diag.lastEventType}
                      </Badge>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">No events yet</div>
                )}
              </div>
            </div>

            {/* Connections list */}
            {(diag.connections ?? []).length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">
                  Known Connections
                </div>
                {(diag.connections ?? []).map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-secondary/20 border border-border/20"
                  >
                    <StatusDot online={c.status === "online"} />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm">{c.name}</span>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        c.status === "online"
                          ? "bg-success/10 text-success border-success/20"
                          : "bg-secondary text-muted-foreground border-border",
                      )}
                    >
                      {c.status}
                    </Badge>
                    {c.lastHeartbeatAt && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(c.lastHeartbeatAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Section: Field Validation Report ────────────────────────────────────────
function FieldValidationSection() {
  const { data, isLoading, refetch } = useGetFieldValidation(
    { dealerId: DEALER_ID },
    { query: { queryKey: getGetFieldValidationQueryKey({ dealerId: DEALER_ID }) } },
  );

  const agg = data?.aggregated;
  const reports = data?.reports ?? [];

  const fields = [
    { key: "titleFound", label: "Title" },
    { key: "priceFound", label: "Price" },
    { key: "descriptionFound", label: "Description" },
    { key: "mileageFound", label: "Mileage" },
    { key: "imageUploadFound", label: "Image Upload" },
    { key: "publishButtonDetected", label: "Publish Button (not clicked)" },
  ] as const;

  return (
    <SectionCard className="border-border/50">
      <div className="p-6 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <div className="font-bold">Facebook Field Validation</div>
            <div className="text-xs text-muted-foreground">
              Populated by the Chrome extension when it runs a job
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refetch()} className="gap-2 text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>
      <div className="p-6">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-10 space-y-3">
            <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto">
              <ShieldCheck className="w-6 h-6 text-muted-foreground/40" />
            </div>
            <div className="font-semibold text-muted-foreground">No field validation data yet</div>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
              The Chrome extension sends field validation data when it fills a Marketplace listing. Run an assisted publish job to populate this report.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {agg && (
              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Latest validation ({agg.lastTestedAt ? new Date(agg.lastTestedAt).toLocaleString() : "—"})
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {fields.map(({ key, label }) => (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 p-3 rounded-lg bg-secondary/20 border border-border/20"
                    >
                      <span className="text-xs font-medium">{label}</span>
                      <FieldBadge value={agg[key as keyof typeof agg] as boolean | null} />
                    </div>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground text-right">
                  Based on {agg.totalReports} report(s)
                </div>
              </div>
            )}

            {reports.length > 1 && (
              <details className="group">
                <summary className="text-xs font-bold uppercase tracking-widest text-muted-foreground cursor-pointer flex items-center gap-2">
                  <span>Recent Reports ({reports.length})</span>
                </summary>
                <div className="mt-3 space-y-2">
                  {reports.slice(0, 10).map((r) => (
                    <div
                      key={`${r.jobId}-${r.testedAt}`}
                      className="p-3 rounded-lg bg-secondary/10 border border-border/20 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Vehicle #{r.vehicleId}</span>
                        <span className="text-muted-foreground">{new Date(r.testedAt).toLocaleString()}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {fields.map(({ key, label }) => (
                          <div key={key} className="flex items-center gap-1">
                            <span className="text-muted-foreground">{label}:</span>
                            <FieldBadge value={r[key as keyof typeof r] as boolean | null} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Section: Alpha Launch Mode ───────────────────────────────────────────────
function AlphaLaunchModeSection() {
  const { data: photoScoresData } = useListVehiclePhotoScores(
    { dealerId: DEALER_ID },
    { query: { queryKey: getListVehiclePhotoScoresQueryKey({ dealerId: DEALER_ID }) } },
  );
  const scores = photoScoresData?.scores ?? [];
  const useOriginal = scores.filter((s) => s.photoDecision === "use_original").length;
  const aiCoverRec = scores.filter((s) => s.photoDecision === "use_original_recommend_ai_cover").length;
  const aiCreative = scores.filter((s) => s.photoDecision === "generate_ai_creative").length;
  const needsReview = scores.filter((s) => s.photoDecision === "needs_review").length;

  return (
    <SectionCard className="border-border/50">
      <div className="p-6 border-b border-border/30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-warning/10 flex items-center justify-center">
            <Zap className="w-4 h-4 text-warning" />
          </div>
          <div>
            <div className="font-bold">Alpha Launch Mode</div>
            <div className="text-xs text-muted-foreground">
              Conservative settings for first real runs
            </div>
          </div>
        </div>
      </div>
      <div className="p-6 space-y-6">
        {/* Mode rules */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl bg-success/5 border border-success/20 p-5 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-success" />
              <span className="font-bold text-success">Assisted Mode</span>
              <Badge className="bg-success/20 text-success border-success/20 border text-[10px]">Default</Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Extension opens Marketplace, fills all fields, pauses, and waits for the operator to review and manually click Publish. Safe for alpha.
            </p>
          </div>
          <div className="rounded-xl bg-secondary/30 border border-border/40 p-5 space-y-2 opacity-60">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-muted-foreground" />
              <span className="font-bold text-muted-foreground">Controlled Auto Mode</span>
              <Badge variant="secondary" className="text-[10px]">Locked</Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Extension clicks Publish automatically. Requires explicit confirmation and higher confidence threshold. Not recommended for alpha.
            </p>
          </div>
        </div>

        {/* Default constraints */}
        <div className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Alpha Default Constraints
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Mode", value: "Assisted Only", icon: ShieldCheck },
              { label: "Vehicles / batch", value: "3–4 max", icon: Car },
              { label: "Frequency", value: "Every 2 days", icon: RefreshCw },
              { label: "Min delay", value: "10–20 min", icon: Gauge },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl bg-secondary/30 border border-border/30 p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Icon className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
                </div>
                <div className="font-bold text-sm">{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Photo decision breakdown */}
        {scores.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Photo Quality Breakdown ({scores.length} vehicles analyzed)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl bg-success/10 border border-success/20 p-4 text-center">
                <div className="text-2xl font-bold text-success">{useOriginal}</div>
                <div className="text-[10px] text-success/70 font-medium mt-1 uppercase tracking-wide">Use Original</div>
              </div>
              <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-4 text-center">
                <div className="text-2xl font-bold text-blue-400">{aiCoverRec}</div>
                <div className="text-[10px] text-blue-400/70 font-medium mt-1 uppercase tracking-wide">AI Cover Rec</div>
              </div>
              <div className="rounded-xl bg-purple-500/10 border border-purple-500/20 p-4 text-center">
                <div className="text-2xl font-bold text-purple-400">{aiCreative}</div>
                <div className="text-[10px] text-purple-400/70 font-medium mt-1 uppercase tracking-wide">AI Creative</div>
              </div>
              <div className="rounded-xl bg-warning/10 border border-warning/20 p-4 text-center">
                <div className="text-2xl font-bold text-warning">{needsReview}</div>
                <div className="text-[10px] text-warning/70 font-medium mt-1 uppercase tracking-wide">Needs Review</div>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl bg-warning/10 border border-warning/20 p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
          <div className="text-sm text-warning/90">
            <span className="font-bold">Alpha Safety Notice:</span>{" "}
            The extension will never click Publish automatically in Assisted Mode. Always have an operator at the browser during a publishing session. Controlled Auto Mode requires explicit unlock in Settings.
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function ProductionReadiness() {
  const { data: checklistData } = useGetLaunchChecklist(
    { dealerId: DEALER_ID },
    { query: { queryKey: getGetLaunchChecklistQueryKey({ dealerId: DEALER_ID }) } },
  );
  const checklist = checklistData?.checklist;
  const passedCount = checklist?.passedCount ?? 0;
  const totalCount = checklist?.totalCount ?? 8;
  const pct = Math.round((passedCount / totalCount) * 100);

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-8 max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500">
          <PageHeader
            eyebrow="Marketplace AI"
            title="Production Readiness"
            description={
              <div className="flex flex-col gap-3">
                <span className="text-muted-foreground text-sm">
                  Alpha Motorsport pre-launch validation. Complete all checks before the first live publishing run.
                </span>
                {checklist && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 max-w-xs h-2 bg-secondary/50 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-700",
                          pct === 100 ? "bg-success" : pct >= 50 ? "bg-primary" : "bg-warning",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold">
                      {passedCount}/{totalCount} checks passed
                    </span>
                    {checklist.allPassed && (
                      <Badge className="bg-success/20 text-success border-success/20 border">
                        <Zap className="w-3 h-3 mr-1" /> Ready to launch
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            }
            action={
              <Link href="/listings">
                <Button variant="outline" className="gap-2 border-border/50">
                  <ArrowLeft className="w-4 h-4" />
                  Back to Marketplace AI
                </Button>
              </Link>
            }
          />

          <LaunchChecklistSection />
          <FeedQualitySection />
          <AlphaLaunchModeSection />
          <BatchDryRunSection />
          <ExtensionDiagnosticsSection />
          <FieldValidationSection />
        </div>
      </div>
    </AppLayout>
  );
}
