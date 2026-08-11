import { Link, useLocation } from "wouter";
import {
  Command,
  MessageSquare,
  Dna,
  Settings,
  Boxes,
  Camera,
  ShoppingBag,
  ChevronUp,
  Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetDealer, useListDealers, getGetDealerQueryKey } from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

interface NavItem {
  name: string;
  shortName: string;
  path: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { name: "Command center", shortName: "Command", path: "/", icon: Command },
  { name: "Marketplace", shortName: "Market", path: "/listings", icon: ShoppingBag },
  { name: "Inventory", shortName: "Inventory", path: "/inventory", icon: Boxes },
  { name: "Photo studio", shortName: "Studio", path: "/ai-photo-studio", icon: Camera },
  { name: "Sales", shortName: "Sales", path: "/sales-ai", icon: MessageSquare },
  { name: "Dealer DNA", shortName: "DNA", path: "/dealer-dna", icon: Dna },
];

const ACTIVE_PATHS: Record<string, string[]> = {
  "/": ["/"],
  "/listings": ["/listings", "/publishing", "/marketplace-intelligence"],
  "/inventory": ["/inventory", "/inventory-engine"],
  "/ai-photo-studio": ["/ai-photo-studio", "/creative-studio"],
  "/sales-ai": ["/sales-ai", "/conversations", "/leads", "/sales-ai/marketplace-listings"],
  "/dealer-dna": ["/dealer-dna"],
};

function BrandMark() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-primary text-[11px] font-bold tracking-[-0.04em] text-primary-foreground shadow-sm">
      DP
    </span>
  );
}

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers?.[0]?.id;
  const { data: dealer } = useGetDealer(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getGetDealerQueryKey(dealerId!) },
  });

  function isActive(item: NavItem): boolean {
    const paths = ACTIVE_PATHS[item.path] ?? [item.path];
    if (item.path === "/") return location === "/";
    return paths.some((path) => location.startsWith(path));
  }

  return (
    <>
      <aside className="relative z-20 hidden h-[100dvh] w-[76px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[4px_0_20px_rgb(15_23_42/0.025)] md:flex xl:w-[248px]">
        <Link href="/" className="flex h-[72px] items-center gap-3 px-5" aria-label="DealerPilot home">
          <BrandMark />
          <span className="hidden min-w-0 xl:block">
            <span className="block text-[15px] font-semibold tracking-tight text-foreground">DealerPilot</span>
            <span className="block text-xs text-muted-foreground">Operations</span>
          </span>
        </Link>

        <div className="hidden px-5 pb-5 xl:block">
          <div className="flex items-center gap-2 rounded-xl border border-sidebar-border bg-card/60 px-3 py-2.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", dealer?.status === "active" ? "bg-success" : "bg-muted-foreground/40")} />
            <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
              {dealer?.name ?? "Alpha MotorSports"}
            </span>
          </div>
        </div>

        <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-2.5 py-2 overscroll-contain xl:px-3">
          <p className="hidden px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 xl:block">Workspace</p>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.path}
                href={item.path}
                aria-current={active ? "page" : undefined}
                title={item.name}
                className={cn(
                  "group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-[background-color,color]",
                  active
                    ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-card/80 hover:text-foreground",
                )}
              >
                {active ? <span className="absolute -left-2.5 h-6 w-0.5 rounded-r-full bg-primary xl:-left-3" /> : null}
                <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} aria-hidden="true" />
                <span className="hidden truncate xl:block">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-2.5 xl:p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-muted-foreground transition-colors hover:bg-card/80 hover:text-foreground" aria-label="Open operator menu">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[10px] font-semibold text-foreground">OP</span>
                <span className="hidden flex-1 text-left text-sm font-medium xl:block">Operator</span>
                <ChevronUp className="hidden h-4 w-4 xl:block" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="mb-1 w-52">
              <DropdownMenuItem onClick={() => setLocation("/settings")} className="gap-2.5 text-sm">
                <Settings className="h-4 w-4" aria-hidden="true" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocation("/connection-center")} className="gap-2.5 text-sm">
                <Plug className="h-4 w-4" aria-hidden="true" />
                Connection center
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="cursor-default gap-2.5 text-xs text-muted-foreground">
                <span className="font-mono">v4.0</span>
                DealerPilot
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 grid h-[68px] grid-cols-6 border-t border-border bg-card/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgb(15_23_42/0.06)] backdrop-blur-md md:hidden">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.path}
              href={item.path}
              aria-current={active ? "page" : undefined}
              className={cn("flex min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium", active ? "text-primary" : "text-muted-foreground")}
            >
              <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
              <span className="max-w-full truncate">{item.shortName}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
