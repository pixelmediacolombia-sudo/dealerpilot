import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  useGetConnectionStatus,
  useConnectMarketplace,
  useListFeedRuns,
  useListCreativeJobs,
  useListDealers,
  getGetConnectionStatusQueryKey,
  getListFeedRunsQueryKey,
  getListCreativeJobsQueryKey,
  type ConnectionStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MapPin,
  ChevronDown,
  ShoppingBag,
  Zap,
  Loader2,
  WifiOff,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useDealerLocation, type DealerLocation } from "@/context/LocationContext";

// ─── Pill ──────────────────────────────────────────────────────────────────────

type PillState = "ok" | "warn" | "error" | "unknown";

function pilotDot(s: PillState) {
  if (s === "ok") return "bg-emerald-400";
  if (s === "warn") return "bg-amber-400";
  if (s === "error") return "bg-red-400";
  return "bg-white/20";
}

function Pill({
  label,
  state,
  detail,
}: {
  label: string;
  state: PillState;
  detail: string;
}) {
  const dot = pilotDot(state);
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06]">
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {state === "ok" && (
          <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-50", dot)} />
        )}
        <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", dot)} />
      </span>
      <span className="text-[10px] font-medium text-white/40 whitespace-nowrap">{label}</span>
      <span className={cn(
        "text-[10px] font-bold whitespace-nowrap",
        state === "ok" ? "text-emerald-400/80" :
        state === "warn" ? "text-amber-400/80" :
        state === "error" ? "text-red-400/80" :
        "text-white/20",
      )}>{detail}</span>
    </div>
  );
}

// ─── Location selector ─────────────────────────────────────────────────────────

const LOCATIONS: DealerLocation[] = ["Manassas", "Fredericksburg"];

function LocationSelector() {
  const { selectedLocation, setSelectedLocation } = useDealerLocation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-primary/20 hover:bg-white/[0.07] hover:border-primary/30 transition-colors outline-none cursor-pointer">
          <MapPin className="w-3 h-3 text-primary/60 shrink-0" />
          <span className="text-[10px] font-medium text-white/50 whitespace-nowrap">Alpha Motorsport</span>
          <span className="text-[10px] font-bold text-primary/90 whitespace-nowrap">— {selectedLocation.toUpperCase()}</span>
          <ChevronDown className="w-3 h-3 text-white/30 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[230px]">
        {LOCATIONS.map((loc) => (
          <DropdownMenuItem
            key={loc}
            className={cn(
              "text-xs cursor-pointer",
              loc === selectedLocation && "text-primary font-semibold",
            )}
            onClick={() => setSelectedLocation(loc)}
          >
            <MapPin className={cn("w-3.5 h-3.5 mr-2 shrink-0", loc === selectedLocation ? "text-primary" : "text-muted-foreground")} />
            Alpha Motorsport — {loc}
            {loc === selectedLocation && (
              <span className="ml-auto text-primary text-xs">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Derive connection state ───────────────────────────────────────────────────

function deriveConn(data: ConnectionStatus | undefined) {
  const extStatus = (data?.chromeExtension as { status?: string } | null | undefined)?.status?.toLowerCase() ?? "";
  const extOnline = extStatus === "connected" || extStatus === "online";

  const fbLoggedIn = (data?.facebookSession as { fbLoggedIn?: boolean | null } | undefined)?.fbLoggedIn ?? null;
  const mktConnected = (data?.marketplace as { marketplaceConnected?: boolean | null } | undefined)?.marketplaceConnected ?? null;

  const extState: PillState = extOnline ? "ok" : "error";
  const fbState: PillState = fbLoggedIn === true ? "ok" : fbLoggedIn === false ? "error" : "unknown";
  const mktState: PillState = mktConnected === true ? "ok" : mktConnected === false ? "error" : "unknown";

  const publishingReady = extOnline && fbLoggedIn === true && mktConnected === true;
  const pubState: PillState = publishingReady ? "ok" : extOnline ? "error" : "unknown";

  const needsConnect = !publishingReady;
  const connectPending = !!data?.connectRequestedAt;

  return { extState, fbState, mktState, pubState, extOnline, publishingReady, needsConnect, connectPending };
}

// ─── GlobalHeader ─────────────────────────────────────────────────────────────

export function GlobalHeader() {
  const queryClient = useQueryClient();
  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers[0]?.id;

  const { data: connData } = useGetConnectionStatus({
    query: { queryKey: getGetConnectionStatusQueryKey(), refetchInterval: 12000 },
  });

  const { data: feedRunsData } = useListFeedRuns(dealerId ?? 1, {
    query: { queryKey: getListFeedRunsQueryKey(dealerId ?? 1), enabled: true, staleTime: 60000 },
  });

  const { data: jobsData } = useListCreativeJobs(undefined, {
    query: { queryKey: getListCreativeJobsQueryKey(), refetchInterval: 10000 },
  });

  const { mutate: connectMarketplace, isPending } = useConnectMarketplace({
    mutation: {
      onSuccess: () => {
        toast({ title: "Connect request sent", description: "Extension is opening Facebook Marketplace." });
        void queryClient.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() });
      },
      onError: () => {
        toast({ title: "Connect failed", description: "Make sure the extension is installed and running.", variant: "destructive" });
      },
    },
  });

  const conn = deriveConn(connData);
  const isBusy = isPending || conn.connectPending;

  // Last Sync
  const lastRun = feedRunsData?.feedRuns?.[0];
  let syncDetail = "NEVER";
  if (lastRun?.finishedAt) {
    const mins = Math.round((Date.now() - new Date(lastRun.finishedAt).getTime()) / 60000);
    syncDetail = mins < 1 ? "NOW" : mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  }

  // AI
  const jobs = jobsData?.jobs ?? [];
  const activeJobs = jobs.filter(j => j.status === "Queued" || j.status === "Generating").length;
  const aiDetail = activeJobs > 0 ? `${activeJobs} ACTIVE` : "IDLE";

  return (
    <header className="h-10 border-b border-white/[0.05] bg-background/80 backdrop-blur-sm flex items-center gap-2 px-5 shrink-0 relative z-30">

      {/* Location selector — left side */}
      <LocationSelector />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Connection status pills */}
      <Pill
        label="Extension"
        state={conn.extState}
        detail={conn.extState === "ok" ? "ONLINE" : "OFFLINE"}
      />
      <Pill
        label="Facebook"
        state={conn.fbState}
        detail={conn.fbState === "ok" ? "ACTIVE" : conn.fbState === "error" ? "OFFLINE" : "UNKNOWN"}
      />
      <Pill
        label="Marketplace"
        state={conn.mktState}
        detail={conn.mktState === "ok" ? "READY" : conn.mktState === "error" ? "BLOCKED" : "UNKNOWN"}
      />
      <Pill
        label="Publishing"
        state={conn.pubState}
        detail={conn.pubState === "ok" ? "READY" : conn.pubState === "error" ? "NOT READY" : "PENDING"}
      />

      {/* Divider */}
      <div className="h-4 w-px bg-white/10 mx-0.5" />

      {/* Last sync + AI */}
      <Pill
        label="Sync"
        state={lastRun?.status === "success" ? "ok" : lastRun ? "error" : "unknown"}
        detail={syncDetail}
      />
      <Pill
        label="AI"
        state={activeJobs > 0 ? "warn" : "ok"}
        detail={aiDetail}
      />

      {/* Connect Marketplace button — only when not ready */}
      {conn.needsConnect && (
        <>
          <div className="h-4 w-px bg-white/10 mx-0.5" />
          <Button
            size="sm"
            className="h-7 text-[11px] px-3 gap-1.5 bg-primary/90 hover:bg-primary text-white font-semibold"
            onClick={() => connectMarketplace({ data: { action: "marketplace" } })}
            disabled={isBusy || !conn.extOnline}
            title={!conn.extOnline ? "Extension must be online to connect" : "Connect to Facebook Marketplace"}
          >
            {isBusy ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : !conn.extOnline ? (
              <WifiOff className="w-3 h-3" />
            ) : (
              <ShoppingBag className="w-3 h-3" />
            )}
            {isBusy ? "Connecting…" : "Connect Marketplace"}
          </Button>
        </>
      )}
    </header>
  );
}
