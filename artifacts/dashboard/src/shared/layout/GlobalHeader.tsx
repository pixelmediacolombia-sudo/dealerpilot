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
  Search,
  Maximize2,
  Bell,
  Settings2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useDealerLocation, type DealerLocation } from "@/context/LocationContext";
import { AccountMenu } from "@/app/AuthGate";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/shared/ui/command";

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
        <button className="group flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-border/70 bg-card px-3 text-left shadow-[0_2px_8px_rgb(15_23_42/0.025)] transition-colors hover:bg-muted">
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

function WorkspaceSearch({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const navigate = (path: string) => {
    setOpen(false);
    onNavigate(path);
  };

  return (
    <>
      <button
        type="button"
        className="hidden h-11 w-[260px] shrink-0 items-center gap-3 rounded-xl bg-primary/10 px-4 text-left text-sm text-muted-foreground shadow-[0_2px_8px_rgb(15_23_42/0.025)] transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:bg-primary/15 hover:shadow-sm xl:flex 2xl:w-[320px]"
        onClick={() => setOpen(true)}
        aria-label="Search DealerPilot"
      >
        <Search className="h-[18px] w-[18px] shrink-0 text-primary" aria-hidden="true" />
        <span className="flex-1 truncate">Search workspace</span>
        <kbd className="shrink-0 whitespace-nowrap rounded-md border border-primary/20 bg-card px-1.5 py-0.5 text-[10px] font-semibold text-primary">⌘ K</kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search DealerPilot..." />
        <CommandList>
          <CommandEmpty>No workspace matches found.</CommandEmpty>
          <CommandGroup heading="Workspace">
            <CommandItem onSelect={() => navigate("/")}>
              <span>Command center</span><CommandShortcut>⌘ 1</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => navigate("/listings")}>
              <span>Marketplace</span><CommandShortcut>⌘ 2</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => navigate("/inventory")}>
              <span>Inventory</span><CommandShortcut>⌘ 3</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Tools">
            <CommandItem onSelect={() => navigate("/sales-ai")}>Sales</CommandItem>
            <CommandItem onSelect={() => navigate("/dealer-dna")}>Dealer DNA</CommandItem>
            <CommandItem onSelect={() => navigate("/settings")}>Settings</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
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
    <header className="relative z-30 flex min-h-[78px] shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-card px-4 py-3 shadow-[0_1px_0_rgb(15_23_42/0.02)] sm:gap-4 sm:px-6 2xl:gap-5">

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

      <WorkspaceSearch onNavigate={setLocation} />

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
