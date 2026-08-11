import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
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
  Moon,
  Sun,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useDealerLocation, type DealerLocation } from "@/context/LocationContext";
import { AccountMenu } from "@/app/AuthGate";

// ── Types ──────────────────────────────────────────────────────────────────────

type PillState = "ok" | "warn" | "error" | "unknown";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";
  const label = isDark ? "Use light theme" : "Use dark theme";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );
}

// ── Telemetry segment ─────────────────────────────────────────────────────────

function TelSeg({ label, value, state }: { label: string; value: string; state: PillState }) {
  const dot =
    state === "ok" ? "bg-success" :
    state === "warn" ? "bg-warning" :
    state === "error" ? "bg-destructive/80" :
    "bg-muted-foreground/35";
  const val =
    state === "ok" ? "text-success" :
    state === "warn" ? "text-warning" :
    state === "error" ? "text-destructive/80" :
    "text-muted-foreground";
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className={cn("text-[11px] font-semibold tabular-nums", val)}>{value}</span>
    </div>
  );
}

// ── Location selector ─────────────────────────────────────────────────────────

type LocationOption = { value: DealerLocation; label: string };
const LOCATIONS: LocationOption[] = [
  { value: "", label: "All Locations" },
  { value: "Manassas", label: "Manassas" },
];

function LocationSelector() {
  const { selectedLocation, setSelectedLocation } = useDealerLocation();
  const displayLabel = selectedLocation === "" ? "All locations" : selectedLocation;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="group flex min-h-10 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-muted">
          <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="hidden text-sm font-medium text-foreground lg:inline">
            Alpha Motorsport
          </span>
          <span className="text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
            {displayLabel}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
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
  const dealerId = dealersData?.dealers?.[0]?.id;

  const { data: connData } = useGetConnectionStatus({
    query: {
      queryKey: getGetConnectionStatusQueryKey(),
      refetchInterval: 5000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: "always",
    },
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
  let syncDetail = "Never";
  if (lastRun?.finishedAt) {
    const mins = Math.round((Date.now() - new Date(lastRun.finishedAt).getTime()) / 60000);
    syncDetail = mins < 1 ? "Now" : mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  }

  const jobs = jobsData?.jobs ?? [];
  const activeJobs = jobs.filter(j => j.status === "Queued" || j.status === "Generating").length;
  const aiDetail = activeJobs > 0 ? `${activeJobs} active` : "Idle";

  const dot = (s: string) => <span className="text-muted-foreground text-[11px] select-none">·</span>;
  const div = () => <div className="mx-2 h-4 w-px bg-border" />;

  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card/95 px-3 shadow-[0_1px_0_rgb(15_23_42/0.02)] backdrop-blur-md sm:gap-3 sm:px-6">

      {/* Location */}
      <LocationSelector />

      <div className="flex-1" />

      {/* ── Telemetry strip ─────────────────────────────────── */}
      <div className="hidden items-center gap-2 2xl:flex">
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
      <ThemeToggle />

      <AccountMenu />

      {conn.needsConnect && (
        <>
          {div()}
          <Button
            size="sm"
            className="h-9 gap-1.5 rounded-md border border-primary bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90"
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
