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
  Plus,
  Send,
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
  group: "Workspace" | "Tools";
}

const NAV_ITEMS: NavItem[] = [
  { name: "Command center", shortName: "Command", path: "/", icon: Command, group: "Workspace" },
  { name: "Marketplace", shortName: "Market", path: "/listings", icon: ShoppingBag, group: "Workspace" },
  { name: "Page", shortName: "Page", path: "/pages", icon: Send, group: "Workspace" },
  { name: "Inventory", shortName: "Inventory", path: "/inventory", icon: Boxes, group: "Workspace" },
  { name: "Photo studio", shortName: "Studio", path: "/ai-photo-studio", icon: Camera, group: "Tools" },
  { name: "Sales", shortName: "Sales", path: "/sales-ai", icon: MessageSquare, group: "Tools" },
  { name: "Dealer DNA", shortName: "DNA", path: "/dealer-dna", icon: Dna, group: "Tools" },
];

const ACTIVE_PATHS: Record<string, string[]> = {
  "/": ["/"],
  "/listings": ["/listings", "/publishing", "/marketplace-intelligence"],
  "/pages": ["/pages"],
  "/inventory": ["/inventory", "/inventory-engine"],
  "/ai-photo-studio": ["/ai-photo-studio", "/creative-studio"],
  "/sales-ai": ["/sales-ai", "/conversations", "/leads", "/sales-ai/marketplace-listings"],
  "/dealer-dna": ["/dealer-dna"],
};

function BrandMark() {
  return (
    <span className="relative block h-8 w-8 shrink-0" aria-hidden="true">
      <img src="/dealerpilot-p-dark-tight-transparent.png" alt="" className="block h-full w-full object-contain outline-none dark:hidden" />
      <img src="/dealerpilot-p-transparent.png" alt="" className="hidden h-full w-full object-contain outline-none dark:block" />
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
  const isBasicPlan = dealer?.plan === "basic";
  const visibleNavItems = NAV_ITEMS.filter((item) => !(isBasicPlan && item.path === "/pages"));

  function isActive(item: NavItem): boolean {
    const paths = ACTIVE_PATHS[item.path] ?? [item.path];
    if (item.path === "/") return location === "/";
    return paths.some((path) => location.startsWith(path));
  }

  return (
    <>
      <aside className="relative z-20 hidden h-[100dvh] w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[4px_0_18px_rgb(15_23_42/0.035)] lg:flex">
        <Link href="/" className="flex h-[72px] items-center gap-3 border-b border-sidebar-border px-5" aria-label="DealerPilot home">
          <BrandMark />
          <span className="min-w-0">
            <span className="block text-[16px] font-bold tracking-[-0.02em] text-sidebar-foreground">DealerPilot</span>
            <span className="block text-[11px] text-sidebar-foreground/55">Dealer operations</span>
          </span>
        </Link>

        <div className="px-4 pb-3 pt-4">
          <div className="flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar px-3 py-2.5 shadow-[0_3px_12px_rgb(15_23_42/0.035)]">
            <span className={cn("h-1.5 w-1.5 rounded-full", dealer?.status === "active" ? "bg-success" : "bg-muted-foreground/40")} />
            <span className="min-w-0 truncate text-xs font-semibold text-sidebar-foreground/75">
              {dealer?.name ?? "Alpha MotorSports"}
            </span>
          </div>
          <Link href="/inventory" className="mt-3 flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-[0_8px_18px_rgb(15_23_42/0.12)] transition-[background-color,transform] hover:bg-primary/90 hover:-translate-y-px">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add vehicle
          </Link>
        </div>

        <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-3 py-2 overscroll-contain">
          {visibleNavItems.map((item, index) => {
            const active = isActive(item);
            return (
              <div key={item.path}>
                {index === 0 || visibleNavItems[index - 1].group !== item.group ? (
                <p className="px-3 pb-2 pt-5 text-[11px] font-semibold tracking-[0.02em] text-sidebar-foreground/45 first:pt-2">{item.group}</p>
                ) : null}
                <Link
                  href={item.path}
                  aria-current={active ? "page" : undefined}
                  title={item.name}
                  className={cn(
                    "group relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition-[background-color,color,box-shadow]",
                    active
                      ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  )}
                >
                  {active ? <span className="absolute -left-4 h-7 w-1 rounded-r-full bg-sidebar-primary" /> : null}
                  <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-sidebar-primary" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground")} aria-hidden="true" />
                  <span className="truncate">{item.name}</span>
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
              <button className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground" aria-label="Open operator menu">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent text-[10px] font-semibold text-sidebar-accent-foreground">OP</span>
                <span className="flex-1 text-left text-sm font-medium">Operator</span>
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
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

      <nav aria-label="Mobile navigation" className={cn("fixed inset-x-0 bottom-0 z-40 grid h-[68px] border-t border-sidebar-border bg-sidebar px-2 pb-[env(safe-area-inset-bottom)] text-sidebar-foreground shadow-[0_-8px_24px_rgb(15_23_42/0.18)] lg:hidden", isBasicPlan ? "grid-cols-6" : "grid-cols-7")}>
        {visibleNavItems.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.path}
              href={item.path}
              aria-current={active ? "page" : undefined}
              className={cn("relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium", active ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground/60")}
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
