import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetConnectionStatus,
  getGetConnectionStatusQueryKey,
  useConnectMarketplace,
  useListWorkers,
  getListWorkersQueryKey,
  useRunWorkerNow,
  useGetSystemTimeline,
  getGetSystemTimelineQueryKey,
  type ConnectionStatus,
  type WorkerStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatusPulse } from "@/components/shared";
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
  if (value === true) return <TrueIcon className="w-4 h-4 text-emerald-400" />;
  if (value === false) return <FalseIcon className="w-4 h-4 text-red-400" />;
  return <span className="w-4 h-4 rounded-full bg-white/10 inline-block" />;
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
    <div className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <Icon className="w-4 h-4 opacity-60" />
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {ok === true ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-400">{okLabel}</span>
          </>
        ) : ok === false ? (
          <>
            <XCircle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-xs font-medium text-red-400">{nokLabel}</span>
          </>
        ) : (
          <>
            <span className="w-3.5 h-3.5 rounded-full bg-white/15 inline-block" />
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
    ? { label: "Marketplace Connected", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" }
    : isConnectPending || isConnecting
    ? { label: "Setting Up…", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" }
    : !extOnline
    ? { label: "Extension Offline", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" }
    : { label: "Not Connected", color: "text-muted-foreground", bg: "bg-white/5 border-white/10" };

  return (
    <Card className="glass-panel border-white/5 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent pointer-events-none" />

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
        <div className="bg-black/30 rounded-lg border border-white/5 px-4 py-1">
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
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="text-sm text-amber-300">
                Facebook login required — the extension cannot access Marketplace.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10 flex-shrink-0 gap-1.5"
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

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <p className="text-[9px] font-black text-white/18 uppercase tracking-[0.22em]">AI Workers</p>
        <div className="flex-1 h-px bg-white/[0.04]" />
      </div>

      <Card className="glass-panel border-white/5 overflow-hidden">
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
              <Loader2 className="w-5 h-5 animate-spin text-white/20" />
            </div>
          ) : (
            <div className="border border-white/[0.05] bg-white/[0.01] rounded-xl overflow-hidden">
              {workers.map((w, idx) => {
                const color = workerStatusColor(w.status);
                const isRunning = runningId === w.id;
                return (
                  <div
                    key={w.id}
                    className={cn(
                      "flex items-center gap-4 px-5 py-3.5",
                      idx < workers.length - 1 && "border-b border-white/[0.04]",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold text-white/70">{w.name}</p>
                        <StatusPulse status={color} label={w.status} />
                      </div>
                      <p className="text-[11px] text-white/22 mt-0.5 truncate">
                        {w.lastResult ?? w.lastError ?? w.description}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-white/18 font-mono">
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
                      className="border-white/10 text-white/70 hover:bg-white/5 gap-1.5 shrink-0"
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
          )}

          {/* System timeline */}
          {events.length > 0 && (
            <div className="pt-1">
              <div className="flex items-center gap-2 mb-2 text-[10px] font-bold text-white/22 uppercase tracking-wider">
                <History className="w-3 h-3" />
                Recent Activity
              </div>
              <div className="border border-white/[0.04] bg-white/[0.01] rounded-lg overflow-hidden">
                {events.map((e, ei) => (
                  <div
                    key={e.id}
                    className={cn(
                      "flex items-start justify-between gap-3 px-3.5 py-2",
                      ei < events.length - 1 && "border-b border-white/[0.04]",
                    )}
                  >
                    <span className="text-[11px] text-white/50 min-w-0">{e.message}</span>
                    <span className="text-[10px] text-white/18 font-mono shrink-0">{formatDate(e.createdAt)}</span>
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

// ── Main page ──────────────────────────────────────────────────────────────────

const SERVICES = [
  { key: "backend", name: "Core API Server", icon: Server, description: "Powers the DealerPilot platform" },
  { key: "database", name: "Data Storage", icon: Database, description: "Securely stores your dealer data" },
  { key: "xmlFeed", name: "Inventory Sync", icon: Rss, description: "Nightly feed keeps inventory current" },
  { key: "messenger", name: "Sales AI / Messaging", icon: MessageCircle, description: "Buyer conversation monitoring & AI reply engine" },
  { key: "openai", name: "AI Engine", icon: Bot, description: "Opportunity Engine · GM Coach · Photo Studio · OpenAI · FAL.ai" },
] as const;

export function ConnectionCenter() {
  const queryClient = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);

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
              <Loader2 className="w-5 h-5 animate-spin text-white/20" />
            </div>
          ) : (
            <div className="space-y-8">
              {/* Hero: Marketplace Connection */}
              <MarketplaceConnectionPanel
                status={status}
                isConnecting={isConnecting}
                onConnect={handleConnect}
              />

              {/* AI Workers */}
              <AiWorkersPanel />

              {/* Service health telemetry */}
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <p className="text-[9px] font-black text-white/18 uppercase tracking-[0.22em]">Service Health</p>
                  <div className="flex-1 h-px bg-white/[0.04]" />
                </div>
                <div className="border border-white/[0.05] bg-white/[0.01] rounded-xl overflow-hidden">
                  {SERVICES.map(({ key, name, icon: Icon, description }, idx) => {
                    const svc = status?.[key as keyof typeof status] as SvcStatus;
                    const color = svcColor(svc?.status);
                    const label = svcLabel(svc?.status);
                    const hasComponents = !!svc?.components?.length;

                    return (
                      <div
                        key={key}
                        className={cn(
                          "transition-colors hover:bg-white/[0.015]",
                          idx < SERVICES.length - 1 && "border-b border-white/[0.04]",
                        )}
                      >
                        {/* Main row */}
                        <div className="flex items-center gap-5 px-5 py-4">
                          <div className="w-8 h-8 rounded-lg border border-white/[0.06] bg-white/[0.02] flex items-center justify-center shrink-0">
                            <Icon className="w-3.5 h-3.5 text-white/30" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-white/70">{name}</p>
                            <p className="text-[11px] text-white/22 mt-0.5">
                              {svc?.detail ?? description}
                            </p>
                            {svc?.lastHeartbeatAt && (
                              <p className="text-[10px] text-white/18 font-mono mt-1">{formatDate(svc.lastHeartbeatAt)}</p>
                            )}
                          </div>
                          <StatusPulse status={color} label={label} />
                        </div>

                        {/* Sub-components (AI Engine / Messaging details) */}
                        {hasComponents && (
                          <div className="px-5 pb-3 -mt-1">
                            <div className="ml-[52px] border border-white/[0.04] bg-white/[0.015] rounded-lg overflow-hidden">
                              {svc!.components!.map((c, ci) => {
                                const cColor = svcColor(c.status);
                                return (
                                  <div
                                    key={c.name}
                                    className={cn(
                                      "flex items-center justify-between px-3.5 py-2",
                                      ci < svc!.components!.length - 1 && "border-b border-white/[0.04]",
                                    )}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      {cColor === "success" ? (
                                        <CheckCircle2 className="w-3 h-3 text-emerald-400/70 shrink-0" />
                                      ) : cColor === "warning" ? (
                                        <AlertTriangle className="w-3 h-3 text-amber-400/70 shrink-0" />
                                      ) : (
                                        <XCircle className="w-3 h-3 text-red-400/60 shrink-0" />
                                      )}
                                      <span className="text-[11px] font-semibold text-white/55 shrink-0">{c.name}</span>
                                      {c.detail && (
                                        <span className="text-[10px] text-white/22 truncate ml-1 hidden sm:block">— {c.detail}</span>
                                      )}
                                    </div>
                                    <span className={cn(
                                      "text-[10px] font-bold shrink-0 ml-3",
                                      cColor === "success" ? "text-emerald-400/70" : cColor === "warning" ? "text-amber-400/70" : "text-red-400/60",
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
