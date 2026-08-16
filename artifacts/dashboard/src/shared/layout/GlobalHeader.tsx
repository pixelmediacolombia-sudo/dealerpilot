import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useLocation } from "wouter";
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
  Maximize2,
  Bell,
  Settings2,
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
        <button className="group flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-border/70 bg-card px-3 text-left shadow-[0_2px_8px_rgb(15_23_42/0.025)] transition-colors hover:bg-muted">
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

type HeaderStatusKey = "extension" | "facebook" | "marketplace" | "publishing" | "sync" | "ai";

interface HeaderStatusOption {
  key: HeaderStatusKey;
  label: string;
  shortLabel: string;
  value: string;
  state: PillState;
}

function statusTone(state: PillState) {
  return state === "ok"
    ? { dot: "bg-success", text: "text-success" }
    : state === "warn"
      ? { dot: "bg-warning", text: "text-warning" }
      : state === "error"
        ? { dot: "bg-destructive/80", text: "text-destructive/80" }
        : { dot: "bg-muted-foreground/35", text: "text-muted-foreground" };
}

function StatusSelector({ items }: { items: HeaderStatusOption[] }) {
  const [selectedKey, setSelectedKey] = useState<HeaderStatusKey>("marketplace");
  const selected = items.find((item) => item.key === selectedKey) ?? items[0];
  const selectedTone = statusTone(selected.state);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hidden h-11 w-[220px] shrink-0 items-center gap-2 rounded-xl border border-primary/15 bg-primary/[0.06] px-3 text-left shadow-[0_2px_8px_rgb(15_23_42/0.025)] transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:bg-primary/10 hover:shadow-sm xl:flex 2xl:w-[250px]"
          aria-label={`Selected status: ${selected.label}`}
        >
          <span className={cn("h-2 w-2 shrink-0 rounded-full", selectedTone.dot)} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="mr-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{selected.shortLabel}</span>
            <span className={cn("truncate text-xs font-semibold", selectedTone.text)}>{selected.value}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-1.5">
        <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Connection status</div>
        {items.map((item) => {
          const tone = statusTone(item.state);
          const isSelected = item.key === selectedKey;
          return (
            <DropdownMenuItem
              key={item.key}
              className={cn("cursor-pointer gap-2.5 rounded-lg px-2.5 py-2", isSelected && "bg-primary/10 text-primary")}
              onSelect={() => setSelectedKey(item.key)}
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-foreground">{item.label}</span>
                <span className={cn("block text-[11px] font-medium", tone.text)}>{item.value}</span>
              </span>
              {isSelected ? <span className="text-xs font-bold text-primary" aria-hidden="true">✓</span> : null}
            </DropdownMenuItem>
          );
        })}
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
  const [location, setLocation] = useLocation();
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

  const statusOptions: HeaderStatusOption[] = [
    { key: "extension", label: "Chrome extension", shortLabel: "EXT", value: conn.extState === "ok" ? "Online" : "Offline", state: conn.extState },
    { key: "facebook", label: "Facebook", shortLabel: "FB", value: conn.fbState === "ok" ? "Active" : conn.fbState === "error" ? "Offline" : "Unknown", state: conn.fbState },
    { key: "marketplace", label: "Marketplace", shortLabel: "MKT", value: conn.mktState === "ok" ? "Ready" : conn.mktState === "error" ? "Blocked" : "Unknown", state: conn.mktState },
    { key: "publishing", label: "Publishing", shortLabel: "PUB", value: conn.pubState === "ok" ? "Ready" : conn.pubState === "error" ? "Pending" : "Unknown", state: conn.pubState },
    { key: "sync", label: "Inventory sync", shortLabel: "SYNC", value: syncDetail, state: lastRun?.status === "success" ? "ok" : lastRun ? "error" : "unknown" },
    { key: "ai", label: "AI jobs", shortLabel: "AI", value: aiDetail, state: activeJobs > 0 ? "warn" : "ok" },
  ];

  const dot = (s: string) => <span className="text-muted-foreground text-[11px] select-none">·</span>;
  const div = () => <div className="mx-2 h-4 w-px bg-border" />;
  const pageTitle = location === "/"
    ? "Command center"
    : location.startsWith("/listings") || location.startsWith("/publishing")
      ? "Marketplace"
      : location.startsWith("/inventory")
        ? "Inventory"
        : location.startsWith("/sales-ai") || location.startsWith("/leads") || location.startsWith("/conversations")
          ? "Sales"
          : location.startsWith("/dealer-dna")
            ? "Dealer DNA"
            : location.startsWith("/ai-photo-studio") || location.startsWith("/creative-studio")
              ? "Photo studio"
              : location.startsWith("/connection-center")
                ? "Connection center"
                : location.startsWith("/settings")
                  ? "Settings"
                  : "Dealer operations";

  return (
    <header className="relative z-30 flex min-h-[56px] shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-card px-4 py-2 shadow-[0_1px_0_rgb(15_23_42/0.02)] sm:gap-4 sm:px-6 2xl:gap-5">

      <div className="hidden w-[142px] shrink-0 items-center gap-3 lg:flex">
        <div className="min-w-0 max-w-full">
          <p className="truncate text-[17px] font-bold tracking-[-0.02em] text-foreground">{pageTitle}</p>
          <p className="text-[11px] text-muted-foreground">Dealer operations</p>
        </div>
      </div>

      {/* Location */}
      <div className="shrink-0">
        <LocationSelector />
      </div>

      <StatusSelector items={statusOptions} />

      <div className="flex-1" />

      {/* ── Telemetry strip ─────────────────────────────────── */}
      <div className="hidden shrink-0 items-center gap-2 min-[1750px]:flex">
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
      <div className="hidden items-center gap-2 xl:flex">
        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-[background-color,transform] hover:-translate-y-px hover:bg-primary/15" onClick={() => void document.documentElement.requestFullscreen?.()} aria-label="Enter fullscreen" title="Fullscreen">
          <Maximize2 className="h-[17px] w-[17px]" aria-hidden="true" />
        </button>
        <button type="button" className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-[background-color,transform] hover:-translate-y-px hover:bg-primary/15" onClick={() => toast({ title: "System timeline", description: "Notifications are available in Command center." })} aria-label="View notifications" title="Notifications">
          <Bell className="h-[17px] w-[17px]" aria-hidden="true" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
        </button>
        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-[background-color,transform] hover:-translate-y-px hover:bg-primary/15" onClick={() => setLocation("/settings")} aria-label="Open settings" title="Settings">
          <Settings2 className="h-[17px] w-[17px]" aria-hidden="true" />
        </button>
      </div>

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
