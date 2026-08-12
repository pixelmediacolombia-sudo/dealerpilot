import { useState } from "react";
import { AppLayout } from "@/shared/layout/AppLayout";
import {
  useGetConnectionStatus,
  getGetConnectionStatusQueryKey,
  useConnectMarketplace,
  useListWorkers,
  getListWorkersQueryKey,
  useRunWorkerNow,
  useGetSystemTimeline,
  getGetSystemTimelineQueryKey,
  useGetOrchestratorStatus,
  getGetOrchestratorStatusQueryKey,
  useRunOrchestratorCycle,
  type ConnectionStatus,
  type WorkerStatus,
  type WorkerDecision,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { PageHeader, StatusPulse } from "@/shared/ui";
import { useGetDealer, useListDealers, getGetDealerQueryKey } from "@workspace/api-client-react";
import {
  Server,
  Database,
  Rss,
  MessageCircle,
  Bot,
  Activity,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Wifi,
  WifiOff,
  LogIn,
  RefreshCw,
  ShoppingBag,
  Facebook,
  Puzzle,
  Zap,
  Clock,
  Play,
  History,
  Brain,
  Pause,
  CircleSlash,
} from "lucide-react";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

// ── Status helpers ─────────────────────────────────────────────────────────────

function svcColor(s: string | undefined): "success" | "destructive" | "warning" | "info" | "muted" {
  switch (s?.toLowerCase()) {
    case "connected":
    case "online":
      return "success";
    case "offline":
    case "error":
      return "destructive";
    case "not_synced":
    case "warning":
      return "warning";
    case "coming_soon":
      return "info";
    default:
      return "muted";
  }
}

function svcLabel(s: string | undefined) {
  switch (s?.toLowerCase()) {
    case "connected":
    case "online":
      return "Online";
    case "offline":
    case "error":
      return "Offline";
    case "not_synced":
      return "Not synced";
    case "coming_soon":
      return "Soon";
    default:
      return "Unknown";
  }
}

// ── Marketplace Connection Panel ───────────────────────────────────────────────

type AiComponent = { name: string; status: string; detail?: string };
type SvcStatus = {
  status?: string;
  detail?: string | null;
  lastHeartbeatAt?: string | null;
  backendUrl?: string | null;
  components?: AiComponent[];
  leadCount?: number;
  convCount?: number;
} | undefined;

interface ConnectionPanelProps {
  status: ConnectionStatus | undefined;
  isConnecting: boolean;
  onConnect: (action: "marketplace" | "login") => void;
}

function TriStateIcon({
  value,
  trueIcon: TrueIcon,
  falseIcon: FalseIcon,
}: {
  value: boolean | null | undefined;
  trueIcon: React.ComponentType<{ className?: string }>;
  falseIcon: React.ComponentType<{ className?: string }>;
}) {
  if (value === true) return <TrueIcon className="w-4 h-4 text-success" />;
  if (value === false) return <FalseIcon className="w-4 h-4 text-destructive" />;
  return <span className="w-4 h-4 rounded-full bg-muted inline-block" />;
}

function StatusRow({
  label,
  ok,
  okLabel,
  nokLabel,
  unknownLabel = "Unknown",
  icon: Icon,
}: {
  label: string;
  ok: boolean | null | undefined;
  okLabel: string;
  nokLabel: string;
  unknownLabel?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <Icon className="w-4 h-4 opacity-60" />
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {ok === true ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
            <span className="text-xs font-medium text-success">{okLabel}</span>
          </>
        ) : ok === false ? (
          <>
            <XCircle className="w-3.5 h-3.5 text-destructive" />
            <span className="text-xs font-medium text-destructive">{nokLabel}</span>
          </>
        ) : (
          <>
            <span className="w-3.5 h-3.5 rounded-full bg-muted inline-block" />
            <span className="text-xs text-muted-foreground">{unknownLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}

function MarketplaceConnectionPanel({ status, isConnecting, onConnect }: ConnectionPanelProps) {
  const connected = status?.overallConnected ?? false;
  const extOnline = status?.extensionOnline ?? false;
  const fbLoggedIn = (status?.facebookSession as { fbLoggedIn?: boolean | null } | undefined)?.fbLoggedIn ?? null;
  const mktConnected = (status?.marketplace as { marketplaceConnected?: boolean | null } | undefined)?.marketplaceConnected ?? null;
  const isConnectPending = !!status?.connectRequestedAt;

  const showLoginBanner = extOnline && fbLoggedIn === false;

  const overallStatus = connected
    ? { label: "Marketplace Connected", color: "text-success", bg: "bg-success/10 border-success/20" }
    : isConnectPending || isConnecting
    ? { label: "Setting Up…", color: "text-warning", bg: "bg-warning/10 border-warning/20" }
    : !extOnline
    ? { label: "Extension Offline", color: "text-destructive", bg: "bg-destructive/10 border-destructive/20" }
    : { label: "Not Connected", color: "text-muted-foreground", bg: "bg-muted border-border" };

  return (
    <Card className="glass-panel border-border overflow-hidden">

      <CardHeader className="pb-4 relative z-10">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <ShoppingBag className="w-5 h-5 text-primary opacity-80" />
              <CardTitle className="text-lg font-semibold tracking-tight">
                Marketplace Connection
              </CardTitle>
            </div>
            <CardDescription className="text-sm text-muted-foreground">
              Connect DealerPilot to Facebook Marketplace via the Chrome extension.
            </CardDescription>
          </div>

          <div
            className={cn(
              "px-3 py-1 rounded-full border text-xs font-semibold flex items-center gap-1.5",
              overallStatus.bg,
              overallStatus.color,
            )}
          >
            {(isConnectPending || isConnecting) && (
              <Loader2 className="w-3 h-3 animate-spin" />
            )}
            {connected && <CheckCircle2 className="w-3 h-3" />}
            {overallStatus.label}
          </div>
        </div>
      </CardHeader>

      <CardContent className="relative z-10 space-y-5">
        {/* Status rows */}
        <div className="rounded-lg border border-border bg-muted/60 px-4 py-1">
          <StatusRow
            label="Extension Agent"
            ok={extOnline}
            okLabel="Online"
            nokLabel="Offline"
            unknownLabel="Not detected"
            icon={Puzzle}
          />
          <StatusRow
            label="Facebook Session"
            ok={fbLoggedIn}
            okLabel="Detected"
            nokLabel="Not logged in"
            unknownLabel="Not checked yet"
            icon={Facebook}
          />
          <StatusRow
            label="Marketplace Access"
            ok={mktConnected}
            okLabel="Ready"
            nokLabel="Not accessible"
            unknownLabel="Not verified yet"
            icon={ShoppingBag}
          />
          <StatusRow
            label="Publishing Ready"
            ok={connected || undefined}
            okLabel="Yes — Publish Now enabled"
            nokLabel="No"
            unknownLabel="Pending verification"
            icon={Activity}
          />
        </div>

        {/* Login required banner */}
        {showLoginBanner && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-warning/10 border border-warning/20 rounded-lg">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
              <span className="text-sm text-warning">
                Facebook login required — the extension cannot access Marketplace.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-warning/40 text-warning hover:bg-warning/10 flex-shrink-0 gap-1.5"
              onClick={() => onConnect("login")}
              disabled={isConnecting || isConnectPending}
            >
              <LogIn className="w-3.5 h-3.5" />
              Open Facebook Login
            </Button>
          </div>
        )}

        {/* Action area */}
        <div className="flex items-center gap-3">
          {!extOnline ? (
            <Button disabled className="gap-2 opacity-50">
              <WifiOff className="w-4 h-4" />
              Extension Offline
            </Button>
          ) : connected ? (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => onConnect("marketplace")}
              disabled={isConnecting || isConnectPending}
            >
              {isConnecting || isConnectPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Reconnect
            </Button>
          ) : (
            <Button
              className="gap-2"
              onClick={() => onConnect("marketplace")}
              disabled={isConnecting || isConnectPending}
            >
              {isConnecting || isConnectPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wifi className="w-4 h-4" />
              )}
              {isConnectPending ? "Waiting for extension…" : "Connect Marketplace"}
            </Button>
          )}

          {(isConnectPending || isConnecting) && !showLoginBanner && (
            <p className="text-xs text-muted-foreground">
              Extension opening Facebook — may take up to 15 seconds…
            </p>
          )}
        </div>

        {/* Extension install hint */}
        {!extOnline && (
          <p className="text-xs text-muted-foreground">
            Install or reload the DealerPilot Chrome extension, then return here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── AI Workers Panel ────────────────────────────────────────────────────────────

function workerStatusColor(status: WorkerStatus["status"]): "success" | "destructive" | "warning" | "info" | "muted" {
  switch (status) {
    case "Online":
      return "success";
    case "Failed":
      return "destructive";
    case "Sleeping":
      return "info";
    default:
      return "muted";
  }
}

function photoWorkerStatusColor(status: string): "success" | "destructive" | "warning" | "info" | "muted" {
  if (status === "Running") return "success";
  if (status === "Paused (Budget)" || status === "Paused (No Vehicles)") return "warning";
  return "info";
}

function AiWorkersPanel() {
  const queryClient = useQueryClient();
  const [runningId, setRunningId] = useState<string | null>(null);

  const { data: workersData, isLoading } = useListWorkers({
    query: { queryKey: getListWorkersQueryKey(), refetchInterval: 15000 },
  });

  const { data: timelineData } = useGetSystemTimeline(
    { limit: 8 },
    { query: { queryKey: getGetSystemTimelineQueryKey({ limit: 8 }), refetchInterval: 15000 } },
  );

  const { mutate: runWorker } = useRunWorkerNow({
    mutation: {
      onMutate: (vars) => setRunningId(vars.id),
      onSuccess: (result) => {
        toast({
          title: result.skipped ? "Worker skipped" : "Worker run complete",
          description: result.summary,
        });
        queryClient.invalidateQueries({ queryKey: getListWorkersQueryKey() });
      },
      onError: () => {
        toast({ title: "Run failed", description: "Could not trigger the worker.", variant: "destructive" });
      },
      onSettled: () => setRunningId(null),
    },
  });

  const workers = workersData?.workers ?? [];
  const events = timelineData?.events ?? [];
  const todayOpenAISpendEstimate = workersData?.todayOpenAISpendEstimate ?? 0;
  const todayFALSpendEstimate = workersData?.todayFALSpendEstimate ?? 0;
  const openAIBudgetRemaining = workersData?.openAIBudgetRemaining ?? 0;
  const falBudgetRemaining = workersData?.falBudgetRemaining ?? 0;
  const photoWorkerStatus = workersData?.photoWorkerStatus ?? "Sleeping";

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">AI Workers</p>
        <div className="flex-1 h-px bg-muted" />
      </div>

      <Card className="glass-panel border-border overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2.5">
            <Zap className="w-5 h-5 text-primary opacity-80" />
            <CardTitle className="text-lg font-semibold tracking-tight">Background Workers</CardTitle>
          </div>
          <CardDescription className="text-sm text-muted-foreground">
            Scheduled jobs that keep inventory, opportunity scores, and publishing in sync — independent of dashboard activity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted px-3.5 py-2.5">
              <p className="text-xs font-bold text-muted-foreground  tracking-wider">Photo Worker Status</p>
              <StatusPulse status={photoWorkerStatusColor(photoWorkerStatus)} label={photoWorkerStatus} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-muted px-3.5 py-2.5">
                <p className="text-xs font-bold text-muted-foreground  tracking-wider">Today's FAL Spend</p>
                <p className="text-[13px] font-semibold text-foreground mt-0.5">
                  ${todayFALSpendEstimate.toFixed(2)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted px-3.5 py-2.5">
                <p className="text-xs font-bold text-muted-foreground  tracking-wider">Today's OpenAI Spend</p>
                <p className="text-[13px] font-semibold text-foreground mt-0.5">
                  ${todayOpenAISpendEstimate.toFixed(3)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted px-3.5 py-2.5">
                <p className="text-xs font-bold text-muted-foreground  tracking-wider">Remaining FAL Budget</p>
                <p className="text-[13px] font-semibold text-foreground mt-0.5">
                  ${falBudgetRemaining.toFixed(2)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted px-3.5 py-2.5">
                <p className="text-xs font-bold text-muted-foreground  tracking-wider">Remaining OpenAI Budget</p>
                <p className="text-[13px] font-semibold text-foreground mt-0.5">
                  ${openAIBudgetRemaining.toFixed(3)}
                </p>
              </div>
            </div>
            <div className="border border-border bg-muted rounded-xl overflow-hidden">
              {workers.map((w, idx) => {
                const color = workerStatusColor(w.status);
                const isRunning = runningId === w.id;
                return (
                  <div
                    key={w.id}
                    className={cn(
                      "flex items-center gap-4 px-5 py-3.5",
                      idx < workers.length - 1 && "border-b border-border",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold text-foreground">{w.name}</p>
                        <StatusPulse status={color} label={w.status} />
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {w.lastResult ?? w.lastError ?? w.description}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground font-mono">
                        {w.lastRunAt && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" /> Last {formatDate(w.lastRunAt)}
                          </span>
                        )}
                        {w.nextRunAt && (
                          <span>Next {formatDate(w.nextRunAt)}</span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-border text-foreground hover:bg-muted gap-1.5 shrink-0"
                      disabled={isRunning || !w.enabled}
                      onClick={() => runWorker({ id: w.id })}
                    >
                      {isRunning ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                      Run now
                    </Button>
                  </div>
                );
              })}
            </div>
            </>
          )}

          {/* System timeline */}
          {events.length > 0 && (
            <div className="pt-1">
              <div className="flex items-center gap-2 mb-2 text-xs font-bold text-muted-foreground  tracking-wider">
                <History className="w-3 h-3" />
                Recent Activity
              </div>
              <div className="border border-border bg-muted rounded-lg overflow-hidden">
                {events.map((e, ei) => (
                  <div
                    key={e.id}
                    className={cn(
                      "flex items-start justify-between gap-3 px-3.5 py-2",
                      ei < events.length - 1 && "border-b border-border",
                    )}
                  >
                    <span className="text-[11px] text-muted-foreground min-w-0">{e.message}</span>
                    <span className="text-xs text-muted-foreground font-mono shrink-0">{formatDate(e.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── AI Orchestrator Panel ────────────────────────────────────────────────────────

function orchestratorStatusColor(status: string | undefined): "success" | "destructive" | "warning" | "info" | "muted" {
  switch (status) {
    case "Active":
      return "success";
    case "Failed":
      return "destructive";
    case "Sleeping":
      return "info";
    default:
      return "muted";
  }
}

function decisionActionMeta(action: WorkerDecision["action"]): {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
} {
  switch (action) {
    case "RUN":
      return { icon: Play, color: "text-success" };
    case "PAUSE":
      return { icon: Pause, color: "text-warning" };
    default:
      return { icon: CircleSlash, color: "text-muted-foreground" };
  }
}

function AiOrchestratorPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetOrchestratorStatus({
    query: { queryKey: getGetOrchestratorStatusQueryKey(), refetchInterval: 15000 },
  });

  const { mutate: runCycle, isPending: isRunning } = useRunOrchestratorCycle({
    mutation: {
      onSuccess: (result) => {
        toast({
          title: "Orchestration cycle complete",
          description: `${result.ranWorkerIds.length} ran · ${result.skippedWorkerIds.length} skipped · ${result.pausedWorkerIds.length} paused`,
        });
        queryClient.invalidateQueries({ queryKey: getGetOrchestratorStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListWorkersQueryKey() });
      },
      onError: () => {
        toast({ title: "Run failed", description: "Could not trigger the orchestrator.", variant: "destructive" });
      },
    },
  });

  const status = data?.status ?? "Sleeping";
  const decisions = data?.decisions ?? [];
  const workersRunning = data?.workersRunning ?? [];
  const workersSkipped = data?.workersSkipped ?? [];
  const workersPaused = data?.workersPaused ?? [];
  const extensionOnline = data?.extensionOnline ?? false;
  const budget = data?.budgetStatus;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">AI Orchestrator</p>
        <div className="flex-1 h-px bg-muted" />
      </div>

      <Card className="glass-panel border-border overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <Brain className="w-5 h-5 text-primary opacity-80" />
                <CardTitle className="text-lg font-semibold tracking-tight">DealerPilot Orchestrator</CardTitle>
                <StatusPulse status={orchestratorStatusColor(status)} label={status} />
              </div>
              <CardDescription className="text-sm text-muted-foreground">
                Decides which workers actually need to run — instead of firing all six on a blind timer.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-border text-foreground hover:bg-muted gap-1.5 shrink-0"
              disabled={isRunning}
              onClick={() => runCycle()}
            >
              {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Re-evaluate now
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {data?.lastDecisionAt && (
                <p className="text-[11px] text-muted-foreground -mt-1">
                  Last decision {formatDate(data.lastDecisionAt)}
                </p>
              )}

              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg border border-border bg-muted px-3.5 py-2.5">
                  <p className="text-xs font-bold text-muted-foreground  tracking-wider">Running</p>
                  <p className="text-[13px] font-semibold text-success mt-0.5">{workersRunning.length}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted px-3.5 py-2.5">
                  <p className="text-xs font-bold text-muted-foreground  tracking-wider">Skipped</p>
                  <p className="text-[13px] font-semibold text-muted-foreground mt-0.5">{workersSkipped.length}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted px-3.5 py-2.5">
                  <p className="text-xs font-bold text-muted-foreground  tracking-wider">Paused</p>
                  <p className="text-[13px] font-semibold text-warning mt-0.5">{workersPaused.length}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted px-3.5 py-2.5">
                  <p className="text-xs font-bold text-muted-foreground  tracking-wider">Extension</p>
                  <p className={cn("text-[13px] font-semibold mt-0.5", extensionOnline ? "text-success" : "text-destructive")}>
                    {extensionOnline ? "Online" : "Offline"}
                  </p>
                </div>
              </div>

              {budget && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-muted px-3.5 py-2.5">
                    <p className="text-xs font-bold text-muted-foreground  tracking-wider">FAL Budget Remaining</p>
                    <p className="text-[13px] font-semibold text-foreground mt-0.5">
                      ${budget.falBudgetRemaining.toFixed(2)} / ${budget.falDailyBudgetUsd.toFixed(2)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted px-3.5 py-2.5">
                    <p className="text-xs font-bold text-muted-foreground  tracking-wider">OpenAI Budget Remaining</p>
                    <p className="text-[13px] font-semibold text-foreground mt-0.5">
                      ${budget.openAIBudgetRemaining.toFixed(3)} / ${budget.openAIDailyBudgetUsd.toFixed(2)}
                    </p>
                  </div>
                </div>
              )}

              <div className="border border-border bg-muted rounded-xl overflow-hidden">
                {decisions.map((d, idx) => {
                  const { icon: ActionIcon, color } = decisionActionMeta(d.action);
                  return (
                    <div
                      key={d.workerId}
                      className={cn(
                        "flex items-center gap-3 px-5 py-3",
                        idx < decisions.length - 1 && "border-b border-border",
                      )}
                    >
                      <ActionIcon className={cn("w-3.5 h-3.5 shrink-0", color)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[12px] font-semibold text-foreground capitalize">{d.workerId}</p>
                          <span className={cn("text-xs font-bold  tracking-wider", color)}>{d.action}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{d.reason}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

const SERVICES = [
  { key: "chromeExtension", name: "Publishing Agent", icon: Puzzle, description: "Chrome extension status for Marketplace publishing" },
  { key: "messenger", name: "Messenger AI", icon: MessageCircle, description: "Chrome extension chat capture and Sales AI replies" },
  { key: "facebookPage", name: "Facebook Page", icon: Facebook, description: "Page token and Page ID for Messenger Send API" },
  { key: "openai", name: "AI Engine", icon: Bot, description: "Opportunity Engine · GM Coach · Photo Studio · OpenAI · FAL.ai" },
  { key: "xmlFeed", name: "Inventory Sync", icon: Rss, description: "Nightly feed keeps inventory current" },
  { key: "backend", name: "Core API Server", icon: Server, description: "Powers the DealerPilot platform" },
  { key: "database", name: "Data Storage", icon: Database, description: "Securely stores your dealer data" },
] as const;

export function ConnectionCenter() {
  const queryClient = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);
  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers?.[0]?.id;
  const { data: dealer } = useGetDealer(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getGetDealerQueryKey(dealerId!) },
  });
  const visibleServices = SERVICES.filter((service) => !(dealer?.plan === "basic" && service.key === "facebookPage"));

  const { data: status, isLoading } = useGetConnectionStatus({
    query: {
      queryKey: getGetConnectionStatusQueryKey(),
      // Poll faster while a connect request is pending
      refetchInterval: (query) => {
        const d = query.state.data;
        if (d?.connectRequestedAt) return 3000;
        return 15000;
      },
    },
  });

  const { mutate: doConnect } = useConnectMarketplace({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() });
        toast({ title: "Connection request sent", description: "The extension will open Facebook shortly." });
      },
      onError: () => {
        setIsConnecting(false);
        toast({ title: "Request failed", description: "Could not reach the backend — is the API server running?", variant: "destructive" });
      },
      onSettled: () => {
        setIsConnecting(false);
      },
    },
  });

  function handleConnect(action: "marketplace" | "login") {
    setIsConnecting(true);
    doConnect({ data: { action } });
  }

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-4xl mx-auto animate-in fade-in duration-400 pb-16">

          <PageHeader
            eyebrow="System"
            title="Connection Center"
            description="Connect DealerPilot to Facebook Marketplace and monitor service health."
            className="mb-8"
          />

          {isLoading ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-8">
              {/* Hero: Marketplace Connection */}
              <MarketplaceConnectionPanel
                status={status}
                isConnecting={isConnecting}
                onConnect={handleConnect}
              />

              {/* AI Orchestrator */}
              <AiOrchestratorPanel />

              {/* AI Workers */}
              <AiWorkersPanel />

              {/* Service health telemetry */}
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">Service Health</p>
                  <div className="flex-1 h-px bg-muted" />
                </div>
                <div className="border border-border bg-muted rounded-xl overflow-hidden">
                  {visibleServices.map(({ key, name, icon: Icon, description }, idx) => {
                    const svc = (status as unknown as Record<string, SvcStatus> | undefined)?.[key];
                    const color = svcColor(svc?.status);
                    const label = svcLabel(svc?.status);
                    const hasComponents = !!svc?.components?.length;

                    return (
                      <div
                        key={key}
                        className={cn(
                          "transition-colors hover:bg-muted",
                          idx < visibleServices.length - 1 && "border-b border-border",
                        )}
                      >
                        {/* Main row */}
                        <div className="flex items-center gap-5 px-5 py-4">
                          <div className="w-8 h-8 rounded-lg border border-border bg-muted flex items-center justify-center shrink-0">
                            <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-foreground">{name}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {svc?.detail ?? description}
                            </p>
                            {svc?.lastHeartbeatAt && (
                              <p className="text-xs text-muted-foreground font-mono mt-1">{formatDate(svc.lastHeartbeatAt)}</p>
                            )}
                          </div>
                          <StatusPulse status={color} label={label} />
                        </div>

                        {/* Sub-components (AI Engine / Messaging details) */}
                        {hasComponents && (
                          <div className="px-5 pb-3 -mt-1">
                            <div className="ml-[52px] border border-border bg-muted rounded-lg overflow-hidden">
                              {svc!.components!.map((c, ci) => {
                                const cColor = svcColor(c.status);
                                return (
                                  <div
                                    key={c.name}
                                    className={cn(
                                      "flex items-center justify-between px-3.5 py-2",
                                      ci < svc!.components!.length - 1 && "border-b border-border",
                                    )}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      {cColor === "success" ? (
                                        <CheckCircle2 className="w-3 h-3 text-success/70 shrink-0" />
                                      ) : cColor === "warning" ? (
                                        <AlertTriangle className="w-3 h-3 text-warning/70 shrink-0" />
                                      ) : (
                                        <XCircle className="w-3 h-3 text-destructive/60 shrink-0" />
                                      )}
                                      <span className="text-[11px] font-semibold text-muted-foreground shrink-0">{c.name}</span>
                                      {c.detail && (
                                        <span className="text-xs text-muted-foreground truncate ml-1 hidden sm:block">— {c.detail}</span>
                                      )}
                                    </div>
                                    <span className={cn(
                                      "text-xs font-bold shrink-0 ml-3",
                                      cColor === "success" ? "text-success/70" : cColor === "warning" ? "text-warning/70" : "text-destructive/60",
                                    )}>
                                      {cColor === "success" ? "Live" : cColor === "warning" ? "Warning" : "Offline"}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </AppLayout>
  );
}
