import { Link, useLocation } from "wouter";
import {
  Command,
  MessageSquare,
  Dna,
  Settings,
  ChevronRight,
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
} from "@/components/ui/dropdown-menu";

interface NavItem {
  name: string;
  path: string;
  icon: React.ElementType;
  accent: keyof typeof ACCENT;
}

const NAV_ITEMS: NavItem[] = [
  { name: "Command Center",  path: "/",              icon: Command,     accent: "blue"   },
  { name: "Marketplace",     path: "/listings",      icon: ShoppingBag, accent: "green"  },
  { name: "Inventory",       path: "/inventory",     icon: Boxes,       accent: "cyan"   },
  { name: "AI Photo Studio", path: "/ai-photo-studio", icon: Camera,   accent: "amber"  },
  { name: "Sales AI",        path: "/sales-ai",      icon: MessageSquare, accent: "violet" },
  { name: "Dealer DNA",      path: "/dealer-dna",    icon: Dna,         accent: "orange" },
];

const ACTIVE_PATHS: Record<string, string[]> = {
  "/":               ["/"],
  "/listings":       ["/listings", "/publishing", "/marketplace-intelligence"],
  "/inventory":      ["/inventory", "/inventory-engine"],
  "/ai-photo-studio":["/ai-photo-studio", "/creative-studio"],
  "/sales-ai":       ["/sales-ai", "/conversations", "/leads", "/sales-ai/marketplace-listings"],
  "/dealer-dna":     ["/dealer-dna"],
};

const ACCENT = {
  blue:   { text: "text-blue-400",   bg: "bg-blue-500/[0.08]",   bar: "bg-blue-400",   shadow: "shadow-[0_0_8px_rgba(59,130,246,0.5)]"   },
  green:  { text: "text-green-400",  bg: "bg-green-500/[0.08]",  bar: "bg-green-400",  shadow: "shadow-[0_0_8px_rgba(34,197,94,0.5)]"   },
  cyan:   { text: "text-cyan-400",   bg: "bg-cyan-500/[0.08]",   bar: "bg-cyan-400",   shadow: "shadow-[0_0_8px_rgba(6,182,212,0.5)]"    },
  amber:  { text: "text-amber-400",  bg: "bg-amber-500/[0.08]",  bar: "bg-amber-400",  shadow: "shadow-[0_0_8px_rgba(245,158,11,0.5)]"   },
  violet: { text: "text-violet-400", bg: "bg-violet-500/[0.08]", bar: "bg-violet-400", shadow: "shadow-[0_0_8px_rgba(139,92,246,0.5)]"   },
  orange: { text: "text-orange-400", bg: "bg-orange-500/[0.08]", bar: "bg-orange-400", shadow: "shadow-[0_0_8px_rgba(249,115,22,0.5)]"   },
} as const;

export function Sidebar() {
  const [location, setLocation] = useLocation();

  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers[0]?.id;
  const { data: dealer } = useGetDealer(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getGetDealerQueryKey(dealerId!) },
  });

  function isActive(item: NavItem): boolean {
    const paths = ACTIVE_PATHS[item.path] ?? [item.path];
    if (item.path === "/") return location === "/";
    return paths.some((p) => location.startsWith(p));
  }

  return (
    <aside className="w-[220px] border-r border-white/[0.04] bg-background flex flex-col h-[100dvh] sticky top-0 relative z-20 shrink-0">

      {/* Logo */}
      <div className="h-14 flex items-center px-5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25 shrink-0">
            <span className="text-white font-black tracking-tighter text-[13px]">DP</span>
          </div>
          <div>
            <div className="font-bold text-[13px] tracking-tight text-white leading-none">DealerPilot</div>
            <div className="text-[9px] text-blue-400/70 font-semibold tracking-[0.18em] uppercase mt-0.5">
              AI Operator
            </div>
          </div>
        </div>
      </div>

      {/* Active dealer */}
      <div className="px-4 pt-1 pb-3 shrink-0">
        <div className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.15em] mb-1">
          Active Dealer
        </div>
        <div className="flex items-center gap-2">
          {dealer?.status === "active" && (
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
          )}
          <span className="font-semibold text-[13px] text-white/80 truncate">
            {dealer?.name ?? "Alpha Motorsport"}
          </span>
        </div>
      </div>

      <div className="mx-4 mb-3 h-px bg-white/[0.04] shrink-0" />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-1 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          const a = ACCENT[item.accent];
          return (
            <Link
              key={item.path}
              href={item.path}
              className={cn(
                "flex items-center justify-between px-3 py-[9px] rounded-lg text-[13px] font-medium transition-all duration-150 group relative",
                active
                  ? cn("text-white", a.bg)
                  : "text-white/35 hover:bg-white/[0.03] hover:text-white/70",
              )}
            >
              {active && (
                <div className={cn("absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-r-full", a.bar, a.shadow)} />
              )}
              <div className="flex items-center gap-3">
                <item.icon
                  className={cn(
                    "w-[15px] h-[15px] transition-colors shrink-0",
                    active ? a.text : "text-white/25 group-hover:text-white/50",
                  )}
                />
                <span className="tracking-[0.01em]">{item.name}</span>
              </div>
              {active && <ChevronRight className="w-3 h-3 text-white/20 shrink-0" />}
            </Link>
          );
        })}
      </nav>

      {/* Avatar / Settings menu */}
      <div className="p-3 border-t border-white/[0.04] shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors group outline-none">
              <div className="w-7 h-7 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center shrink-0">
                <span className="text-[11px] font-bold text-blue-400">OP</span>
              </div>
              <div className="min-w-0 flex-1 text-left">
                <div className="text-[12px] font-semibold text-white/70 leading-none">Operator</div>
                <div className="text-[10px] text-white/30 mt-0.5 truncate">
                  {dealer?.name ?? "Alpha Motorsport"}
                </div>
              </div>
              <ChevronUp className="w-3 h-3 text-white/20 group-hover:text-white/40 shrink-0 transition-colors" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52 mb-1">
            <DropdownMenuItem onClick={() => setLocation("/settings")} className="gap-2.5 text-[12px]">
              <Settings className="w-3.5 h-3.5" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLocation("/connection-center")} className="gap-2.5 text-[12px]">
              <Plug className="w-3.5 h-3.5" />
              Connection Center
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setLocation("/settings")} className="gap-2.5 text-[12px] text-muted-foreground">
              <span className="text-[10px] font-mono text-white/20">v4.0</span>
              DealerPilot AI
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
