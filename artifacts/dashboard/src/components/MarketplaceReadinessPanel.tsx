import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetConnectionStatus,
  useConnectMarketplace,
  getGetConnectionStatusQueryKey,
  type ConnectionStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Puzzle,
  Facebook,
  ShoppingBag,
  Zap,
  AlertTriangle,
  LogIn,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

// ─── Types ─────────────────────────────────────────────────────────────────────

type RowStatus = "ok" | "error" | "unknown";

interface StatusRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  status: RowStatus;
  okLabel: string;
  errLabel: string;
  unknownLabel?: string;
}

// ─── Status Row ────────────────────────────────────────────────────────────────

function StatusRow({ icon: Icon, label, status, okLabel, errLabel, unknownLabel = "Checking…" }: StatusRowProps) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.05] last:border-0">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <Icon className="w-4 h-4 opacity-50 shrink-0" />
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {status === "ok" ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-xs font-medium text-emerald-400">{okLabel}</span>
          </>
        ) : status === "error" ? (
          <>
            <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="text-xs font-medium text-red-400">{errLabel}</span>
          </>
        ) : (
          <>
            <span className="w-3.5 h-3.5 rounded-full bg-white/10 shrink-0 inline-block" />
            <span className="text-xs text-muted-foreground">{unknownLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Derive readiness state from API data ─────────────────────────────────────

function deriveState(data: ConnectionStatus | undefined) {
  const extStatus = (data?.chromeExtension as { status?: string } | null | undefined)?.status;
  const extOnline = extStatus === "connected" || extStatus === "online";

  const fbLoggedIn = (data?.facebookSession as { fbLoggedIn?: boolean | null } | undefined)?.fbLoggedIn ?? null;
  const mktConnected = (data?.marketplace as { marketplaceConnected?: boolean | null } | undefined)?.marketplaceConnected ?? null;

  const extRow: RowStatus = extOnline ? "ok" : "error";
  const fbRow: RowStatus = fbLoggedIn === true ? "ok" : fbLoggedIn === false ? "error" : "unknown";
  const mktRow: RowStatus = mktConnected === true ? "ok" : mktConnected === false ? "error" : "unknown";

  const publishingReady = extOnline && fbLoggedIn === true && mktConnected === true;
  const pubRow: RowStatus = publishingReady ? "ok" : extOnline ? "error" : "unknown";

  const connectPending = !!data?.connectRequestedAt;
  const needsConnection = !publishingReady;

  let missingStep: string | null = null;
  if (!extOnline) missingStep = "Extension not connected";
  else if (!fbLoggedIn) missingStep = "Facebook login required";
  else if (!mktConnected) missingStep = "Marketplace access not verified";

  return { extOnline, extRow, fbRow, mktRow, pubRow, publishingReady, connectPending, needsConnection, missingStep, fbLoggedIn };
}

// ─── Main Panel ────────────────────────────────────────────────────────────────

export function MarketplaceReadinessPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetConnectionStatus({
    query: {
      queryKey: getGetConnectionStatusQueryKey(),
      refetchInterval: 12000,
    },
  });

  const { mutate: connectMarketplace, isPending } = useConnectMarketplace({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Connect request sent",
          description: "The extension is opening Facebook Marketplace.",
        });
        void queryClient.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() });
      },
      onError: () => {
        toast({
          title: "Could not send connect request",
          description: "Make sure the extension is installed and running.",
          variant: "destructive",
        });
      },
    },
  });

  const state = deriveState(data);
  const isBusy = isPending || state.connectPending;

  function handleConnect(action: "marketplace" | "login" = "marketplace") {
    connectMarketplace({ data: { action } });
  }

  if (isLoading) return null;

  return (
    <div className={cn(
      "rounded-xl border px-5 py-4 mb-6",
      state.publishingReady
        ? "bg-emerald-500/[0.05] border-emerald-500/20"
        : "bg-white/[0.02] border-white/[0.06]",
    )}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wifi className={cn("w-4 h-4", state.publishingReady ? "text-emerald-400" : "text-muted-foreground")} />
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Marketplace Publishing Readiness
          </span>
        </div>

        {state.publishingReady ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Ready to publish
          </span>
        ) : isBusy ? (
          <span className="flex items-center gap-1.5 text-xs text-amber-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Setting up…
          </span>
        ) : state.missingStep ? (
          <span className="flex items-center gap-1.5 text-xs text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            {state.missingStep}
          </span>
        ) : null}
      </div>

      {/* Status rows */}
      <div className="bg-black/20 rounded-lg border border-white/[0.04] px-4 mb-4">
        <StatusRow
          icon={Puzzle}
          label="Extension Agent"
          status={state.extRow}
          okLabel="Online"
          errLabel="Offline — install & pin the extension"
        />
        <StatusRow
          icon={Facebook}
          label="Facebook Login"
          status={state.fbRow}
          okLabel="Session active"
          errLabel="Not logged in"
          unknownLabel="Not checked yet"
        />
        <StatusRow
          icon={ShoppingBag}
          label="Marketplace Access"
          status={state.mktRow}
          okLabel="Verified"
          errLabel="Not accessible"
          unknownLabel="Not verified yet"
        />
        <StatusRow
          icon={Zap}
          label="Auto Publisher"
          status={state.pubRow}
          okLabel="Ready"
          errLabel="Not ready"
          unknownLabel="Waiting for extension"
        />
      </div>

      {/* CTA area */}
      {!state.publishingReady && (
        <div className="flex items-center gap-3 flex-wrap">
          {!state.extOnline ? (
            <Button
              variant="outline"
              size="sm"
              disabled
              className="gap-2 opacity-50 border-white/10"
            >
              <Puzzle className="w-3.5 h-3.5" />
              Extension Offline
            </Button>
          ) : state.fbLoggedIn === false ? (
            <>
              <Button
                size="sm"
                className="gap-2 bg-primary hover:bg-primary/90"
                onClick={() => handleConnect("marketplace")}
                disabled={isBusy}
              >
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShoppingBag className="w-3.5 h-3.5" />}
                Connect Marketplace
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                onClick={() => handleConnect("login")}
                disabled={isBusy}
              >
                <LogIn className="w-3.5 h-3.5" />
                Open Facebook Login
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              className="gap-2 bg-primary hover:bg-primary/90"
              onClick={() => handleConnect("marketplace")}
              disabled={isBusy}
            >
              {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShoppingBag className="w-3.5 h-3.5" />}
              Connect Marketplace
            </Button>
          )}
        </div>
      )}

      {state.publishingReady && (
        <p className="text-xs text-emerald-400/70">
          DealerPilot is ready to publish. Publish Now is enabled for all vehicles.
        </p>
      )}

      {/* Advanced diagnostics link */}
      <div className="mt-3 pt-3 border-t border-white/[0.05]">
        <Link
          href="/connection-center"
          className="text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
        >
          Connection Details →
        </Link>
      </div>
    </div>
  );
}
