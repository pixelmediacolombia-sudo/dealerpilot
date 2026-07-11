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
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  MapPin,
  ChevronDown,
  ShoppingBag,
  Loader2,
  WifiOff,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useDealerLocation, type DealerLocation } from "@/context/LocationContext";

// ── Types ──────────────────────────────────────────────────────────────────────

type PillState = "ok" | "warn" | "error" | "unknown";

// ── Telemetry segment ─────────────────────────────────────────────────────────

function TelSeg({ label, value, state }: { label: string; value: string; state: PillState }) {
  const dot =
    state === "ok" ? "bg-emerald-400" :
    state === "warn" ? "bg-amber-400" :
    state === "error" ? "bg-red-400/80" :
    "bg-white/[0.12]";
  const val =
    state === "ok" ? "text-emerald-400" :
    state === "warn" ? "text-amber-400" :
    state === "error" ? "text-red-400/80" :
    "text-white/[0.18]";
  return (
    <div className="flex items-center gap-[5px]">
      <span className={cn("w-[5px] h-[5px] rounded-full shrink-0", dot)} />
      <span className="text-[9px] text-white/[0.18] font-mono tracking-[0.12em] uppercase">{label}</span>
      <span className={cn("text-[9px] font-mono font-bold tracking-[0.08em]", val)}>{value}</span>
    </div>
  );
}

// ── Location selector ─────────────────────────────────────────────────────────

type LocationOption = { value: DealerLocation; label: string };
const LOCATIONS: LocationOption[] = [
  { value: "", label: "All Locations" },
  { value: "Manassas", label: "Manassas" },
  { value: "Fredericksburg", label: "Fredericksburg" },
];

function LocationSelector() {
  const { selectedLocation, setSelectedLocation } = useDealerLocation();
  const displayLabel = selectedLocation === "" ? "ALL" : selectedLocation.toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 outline-none group">
          <MapPin className="w-2.5 h-2.5 text-blue-400/40 shrink-0" />
          <span className="text-[10px] font-semibold text-white/30 group-hover:text-white/50 transition-colors">
            Alpha Motorsport
          </span>
          <span className="text-[10px] font-bold text-blue-400/60 group-hover:text-blue-400/90 transition-colors uppercase tracking-widest">
            {displayLabel}
          </span>
          <ChevronDown className="w-2.5 h-2.5 text-white/15 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        {LOCATIONS.map(({ value, label }) => (
          <DropdownMenuItem
            key={value}
            className={cn("text-xs cursor-pointer", value === selectedLocation && "text-primary font-semibold")}
            onClick={() => setSelectedLocation(value)}
          >
            <MapPin className={cn("w-3.5 h-3.5 mr-2 shrink-0", value === selectedLocation ? "text-primary" : "text-muted-foreground")} />
            {value === "" ? "All Locations" : `Alpha Motorsport — ${label}`}
            {value === selectedLocation && <span className="ml-auto text-primary text-xs">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Derive connection state ───────────────────────────────────────────────────

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

  return {
    extState, fbState, mktState, pubState, extOnline, publishingReady,
    needsConnect: !publishingReady,
    connectPending: !!data?.connectRequestedAt,
  };
}

// ── GlobalHeader ──────────────────────────────────────────────────────────────

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

  const lastRun = feedRunsData?.feedRuns?.[0];
  let syncDetail = "NEVER";
  if (lastRun?.finishedAt) {
    const mins = Math.round((Date.now() - new Date(lastRun.finishedAt).getTime()) / 60000);
    syncDetail = mins < 1 ? "NOW" : mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  }

  const jobs = jobsData?.jobs ?? [];
  const activeJobs = jobs.filter(j => j.status === "Queued" || j.status === "Generating").length;
  const aiDetail = activeJobs > 0 ? `${activeJobs} ACTIVE` : "IDLE";

  const dot = (s: string) => <span className="text-white/[0.06] text-[9px] select-none">·</span>;
  const div = () => <div className="h-3 w-px bg-white/[0.05] mx-3" />;

  return (
    <header className="h-9 border-b border-white/[0.04] bg-[#06040d]/90 backdrop-blur-md flex items-center gap-3 px-5 shrink-0 relative z-30">

      {/* Location */}
      <LocationSelector />

      <div className="flex-1" />

      {/* ── Telemetry strip ─────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <TelSeg label="EXT" value={conn.extState === "ok" ? "ONLINE" : "OFFLINE"} state={conn.extState} />
        {dot("·")}
        <TelSeg label="FB" value={conn.fbState === "ok" ? "ACTIVE" : conn.fbState === "error" ? "OFFLINE" : "—"} state={conn.fbState} />
        {dot("·")}
        <TelSeg label="MKT" value={conn.mktState === "ok" ? "READY" : conn.mktState === "error" ? "BLOCKED" : "—"} state={conn.mktState} />
        {dot("·")}
        <TelSeg label="PUB" value={conn.pubState === "ok" ? "READY" : conn.pubState === "error" ? "PENDING" : "—"} state={conn.pubState} />

        {div()}

        <TelSeg label="SYNC" value={syncDetail} state={lastRun?.status === "success" ? "ok" : lastRun ? "error" : "unknown"} />
        {dot("·")}
        <TelSeg label="AI" value={aiDetail} state={activeJobs > 0 ? "warn" : "ok"} />
      </div>

      {/* Connect button — only when not ready */}
      {conn.needsConnect && (
        <>
          {div()}
          <Button
            size="sm"
            className="h-6 text-[10px] px-3 gap-1.5 bg-blue-600/80 hover:bg-blue-600 text-white font-bold border border-blue-500/25 shadow-none rounded-md"
            onClick={() => connectMarketplace({ data: { action: "marketplace" } })}
            disabled={isBusy || !conn.extOnline}
            title={!conn.extOnline ? "Extension must be online to connect" : "Connect to Facebook Marketplace"}
          >
            {isBusy ? (
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
            ) : !conn.extOnline ? (
              <WifiOff className="w-2.5 h-2.5" />
            ) : (
              <ShoppingBag className="w-2.5 h-2.5" />
            )}
            {isBusy ? "Connecting…" : "Connect"}
          </Button>
        </>
      )}
    </header>
  );
}
