import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Sparkles,
  Wand2,
  MessageSquare,
  Dna,
  Settings,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetDealer, useListDealers, getGetDealerQueryKey } from "@workspace/api-client-react";

const NAV_ITEMS = [
  { name: "Sales Hub", path: "/", icon: LayoutDashboard },
  { name: "Marketplace AI", path: "/listings", icon: Sparkles },
  { name: "Creative AI", path: "/creative-studio", icon: Wand2 },
  { name: "Sales AI", path: "/leads", icon: MessageSquare },
  { name: "Dealer DNA", path: "/dealer-dna", icon: Dna },
  { name: "Settings", path: "/settings", icon: Settings },
];

// Routes that belong to each nav item (for active state)
const ACTIVE_PATHS: Record<string, string[]> = {
  "/": ["/"],
  "/listings": ["/listings", "/inventory", "/publishing"],
  "/creative-studio": ["/creative-studio"],
  "/leads": ["/leads"],
  "/dealer-dna": ["/dealer-dna"],
  "/settings": ["/settings", "/connection-center"],
};

export function Sidebar() {
  const [location] = useLocation();

  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers[0]?.id;
  const { data: dealer } = useGetDealer(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getGetDealerQueryKey(dealerId!) },
  });

  function isActive(item: { path: string }): boolean {
    const paths = ACTIVE_PATHS[item.path] ?? [item.path];
    if (item.path === "/") return location === "/";
    return paths.some((p) => location.startsWith(p));
  }

  return (
    <aside className="w-60 border-r border-white/5 bg-background flex flex-col h-[100dvh] sticky top-0 relative z-20 shrink-0">
      {/* ambient glow */}
      <div className="absolute top-0 left-0 w-full h-32 bg-primary/5 blur-3xl -z-10 pointer-events-none" />

      {/* Logo */}
      <div className="h-16 flex items-center px-5 border-b border-white/5 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20 shrink-0">
            <span className="text-white font-bold tracking-tighter text-sm">DP</span>
          </div>
          <div>
            <div className="font-semibold text-sm tracking-tight text-white leading-none">
              DealerPilot
            </div>
            <div className="text-[10px] text-primary font-medium tracking-widest uppercase mt-0.5">
              AI Copilot
            </div>
          </div>
        </div>
      </div>

      {/* Dealer pill */}
      <div className="px-5 pt-4 pb-3">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">
          Active Dealer
        </div>
        <div className="flex items-center gap-2">
          {dealer?.status === "active" && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
            </span>
          )}
          <span className="font-medium text-sm text-white truncate">
            {dealer?.name ?? "Alpha Motorsport"}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 mb-3 h-px bg-white/5" />

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-1 px-3">
        <nav className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={cn(
                  "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group relative",
                  active
                    ? "text-white bg-white/[0.06]"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-white/80",
                )}
              >
                {active && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-primary rounded-r-full shadow-[0_0_6px_hsl(var(--primary))]" />
                )}
                <div className="flex items-center gap-3">
                  <item.icon
                    className={cn(
                      "w-4 h-4 transition-colors shrink-0",
                      active
                        ? "text-primary"
                        : "text-muted-foreground group-hover:text-white/60",
                    )}
                  />
                  <span className="tracking-wide text-[13px]">{item.name}</span>
                </div>
                {active && <ChevronRight className="w-3.5 h-3.5 text-white/25 shrink-0" />}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* User */}
      <div className="p-4 border-t border-white/5">
        <div className="flex items-center gap-3 px-2">
          <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
            <span className="text-[11px] font-semibold text-primary">OP</span>
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-white/80 leading-none">Operator</div>
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {dealer?.name ?? "Alpha Motorsport"}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
