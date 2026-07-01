import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetConnectionStatus,
  getGetConnectionStatusQueryKey,
  useConnectMarketplace,
  type ConnectionStatus,
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

type SvcStatus = { status?: string; detail?: string | null; lastHeartbeatAt?: string | null; backendUrl?: string | null } | undefined;

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

// ── Main page ──────────────────────────────────────────────────────────────────

const SERVICES = [
  { key: "backend", name: "Core API Server", icon: Server, description: "Main orchestration and task runner" },
  { key: "database", name: "Primary Database", icon: Database, description: "Persistent state storage" },
  { key: "xmlFeed", name: "Inventory Sync", icon: Rss, description: "Nightly dealer feed ingestion" },
  { key: "messenger", name: "Messenger Graph", icon: MessageCircle, description: "Lead interception" },
  { key: "openai", name: "Intelligence Engine", icon: Bot, description: "AI generation and natural language" },
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
        <div className="p-8 max-w-5xl mx-auto space-y-8 pb-20">

          <PageHeader
            title="Connection Center"
            description="Connect DealerPilot to Facebook Marketplace and monitor service health."
            icon={Activity}
          />

          {isLoading ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-8">
              {/* Hero: Marketplace Connection */}
              <MarketplaceConnectionPanel
                status={status}
                isConnecting={isConnecting}
                onConnect={handleConnect}
              />

              {/* Service health grid */}
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                  Service Health
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {SERVICES.map(({ key, name, icon: Icon, description }) => {
                    const svc = status?.[key as keyof typeof status] as SvcStatus;
                    const color = svcColor(svc?.status);
                    const label = svcLabel(svc?.status);

                    return (
                      <Card
                        key={key}
                        className="glass-panel overflow-hidden border-white/5 transition-all hover:border-white/10 hover-lift relative group"
                      >
                        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

                        <CardHeader className="pb-4 flex flex-row items-start justify-between space-y-0 relative z-10">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2.5 text-foreground">
                              <Icon className="w-5 h-5 opacity-80" />
                              <CardTitle className="text-base font-semibold tracking-tight">{name}</CardTitle>
                            </div>
                            <CardDescription className="text-sm text-muted-foreground line-clamp-1">
                              {description}
                            </CardDescription>
                          </div>
                          <div className="pl-4 pt-1">
                            <StatusPulse status={color} label={label} />
                          </div>
                        </CardHeader>

                        <CardContent className="relative z-10">
                          <div className="space-y-3 pt-1">
                            {svc?.detail && (
                              <div className="text-sm px-3 py-2 bg-black/40 rounded border border-white/5 text-foreground/80 leading-relaxed font-mono text-xs">
                                {svc.detail}
                              </div>
                            )}
                            {(svc?.lastHeartbeatAt || svc?.backendUrl) && (
                              <div className="grid grid-cols-2 gap-3 text-sm">
                                {svc.lastHeartbeatAt && (
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Heartbeat</span>
                                    <span className="block font-medium text-foreground text-xs">{formatDate(svc.lastHeartbeatAt)}</span>
                                  </div>
                                )}
                                {svc.backendUrl && (
                                  <div className="space-y-1 col-span-2 sm:col-span-1">
                                    <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Target</span>
                                    <span className="block font-mono text-xs text-primary/90 truncate bg-primary/10 px-2 py-1 rounded">
                                      {svc.backendUrl}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                            {!svc?.detail && !svc?.lastHeartbeatAt && !svc?.backendUrl && (
                              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground bg-black/20 rounded border border-white/5 border-dashed">
                                Awaiting telemetry…
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
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
