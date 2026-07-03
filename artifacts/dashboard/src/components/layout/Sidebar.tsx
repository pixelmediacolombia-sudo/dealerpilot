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
} from "@/components/ui/dropdown-menu";

interface NavItem {
  name: string;
  path: string;
  icon: React.ElementType;
  accent: keyof typeof ACCENT;
}

const NAV_ITEMS: NavItem[] = [
  { name: "Command",     path: "/",               icon: Command,      accent: "blue"   },
  { name: "Marketplace", path: "/listings",        icon: ShoppingBag,  accent: "green"  },
  { name: "Inventory",   path: "/inventory",       icon: Boxes,        accent: "cyan"   },
  { name: "Studio",      path: "/ai-photo-studio", icon: Camera,       accent: "amber"  },
  { name: "Sales",       path: "/sales-ai",        icon: MessageSquare,accent: "violet" },
  { name: "DNA",         path: "/dealer-dna",      icon: Dna,          accent: "orange" },
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
  blue:   { text: "text-blue-400",   bar: "bg-blue-400",   glow: "shadow-[0_0_12px_rgba(59,130,246,0.6)]"    },
  green:  { text: "text-green-400",  bar: "bg-green-400",  glow: "shadow-[0_0_12px_rgba(34,197,94,0.6)]"    },
  cyan:   { text: "text-cyan-400",   bar: "bg-cyan-400",   glow: "shadow-[0_0_12px_rgba(6,182,212,0.6)]"     },
  amber:  { text: "text-amber-400",  bar: "bg-amber-400",  glow: "shadow-[0_0_12px_rgba(245,158,11,0.6)]"   },
  violet: { text: "text-violet-400", bar: "bg-violet-400", glow: "shadow-[0_0_12px_rgba(139,92,246,0.6)]"   },
  orange: { text: "text-orange-400", bar: "bg-orange-400", glow: "shadow-[0_0_12px_rgba(249,115,22,0.6)]"   },
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
    <aside className="w-[176px] flex flex-col h-[100dvh] sticky top-0 relative z-20 shrink-0 bg-[#06040d]/95 backdrop-blur-2xl">

      {/* Right edge glow divider */}
      <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/[0.05] to-transparent pointer-events-none" />

      {/* Logo */}
      <div className="h-[52px] flex items-center px-5 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-[0_0_14px_rgba(59,130,246,0.45)] shrink-0">
            <span className="text-white font-black tracking-tighter text-[11px]">DP</span>
          </div>
          <div>
            <div className="font-bold text-[12px] tracking-tight text-white/90 leading-none">DealerPilot</div>
            <div className="text-[8px] text-blue-400/45 font-black tracking-[0.22em] uppercase mt-0.5">
              AI OPERATOR
            </div>
          </div>
        </div>
      </div>

      {/* Dealer chip */}
      <div className="px-5 pb-4 shrink-0">
        <div className="flex items-center gap-1.5">
          {dealer?.status === "active" ? (
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-white/10 shrink-0" />
          )}
          <span className="text-[10px] font-medium text-white/28 truncate leading-none">
            {dealer?.name ?? "Alpha Motorsport"}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 mb-3 h-px bg-gradient-to-r from-white/[0.05] via-white/[0.03] to-transparent shrink-0" />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-1 space-y-[2px]">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          const a = ACCENT[item.accent];
          return (
            <Link
              key={item.path}
              href={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-[10px] rounded-xl text-[12px] transition-all duration-150 group relative",
                active
                  ? "text-white font-bold"
                  : "text-white/28 hover:text-white/60 font-medium",
              )}
            >
              {/* Active rail */}
              {active && (
                <div className={cn(
                  "absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-r-full",
                  a.bar,
                  a.glow,
                )} />
              )}
              <item.icon
                className={cn(
                  "w-[14px] h-[14px] transition-colors shrink-0",
                  active ? a.text : "text-white/18 group-hover:text-white/45",
                )}
              />
              <span className="tracking-[0.01em]">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Operator profile */}
      <div className="px-3 pb-4 pt-3 border-t border-white/[0.04] shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/[0.03] transition-colors group outline-none">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-600/30 to-blue-900/20 border border-blue-500/20 flex items-center justify-center shrink-0">
                <span className="text-[9px] font-bold text-blue-400/80">OP</span>
              </div>
              <span className="text-[11px] font-semibold text-white/35 group-hover:text-white/55 transition-colors flex-1 text-left leading-none">
                Operator
              </span>
              <ChevronUp className="w-2.5 h-2.5 text-white/12 group-hover:text-white/30 shrink-0 transition-colors" />
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
            <DropdownMenuItem className="gap-2.5 text-[12px] text-muted-foreground cursor-default">
              <span className="text-[10px] font-mono text-white/15">v4.0</span>
              DealerPilot AI
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
