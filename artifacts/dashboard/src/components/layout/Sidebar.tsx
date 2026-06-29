import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  CarFront, 
  Sparkles,
  Wand2, 
  MessageSquare,
  Network, 
  Dna, 
  Settings,
  ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetDealer, useListDealers, getGetDealerQueryKey } from "@workspace/api-client-react";

const NAV_ITEMS = [
  { name: "Sales Hub", path: "/", icon: LayoutDashboard },
  { name: "Vehicle Intelligence", path: "/inventory", icon: CarFront },
  { name: "Marketplace AI", path: "/listings", icon: Sparkles },
  { name: "Creative AI", path: "/creative-studio", icon: Wand2 },
  { name: "Sales AI", path: "/leads", icon: MessageSquare },
  { name: "Dealer DNA", path: "/dealer-dna", icon: Dna },
  { name: "Connections", path: "/connection-center", icon: Network },
  { name: "Control Center", path: "/settings", icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();

  // Get dealer info
  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers[0]?.id;
  const { data: dealer } = useGetDealer(dealerId!, { 
    query: { enabled: !!dealerId, queryKey: getGetDealerQueryKey(dealerId!) }
  });

  return (
    <aside className="w-64 border-r border-white/5 bg-background flex flex-col h-[100dvh] sticky top-0 relative z-20">
      {/* Glow effect top left */}
      <div className="absolute top-0 left-0 w-full h-32 bg-primary/5 blur-3xl -z-10 pointer-events-none" />
      
      <div className="h-20 flex items-center px-6 border-b border-white/5 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
            <span className="text-white font-bold tracking-tighter text-sm">DP</span>
          </div>
          <span className="font-semibold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">DealerPilot AI</span>
        </div>
      </div>

      <div className="px-6 py-5">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
          <span>Active Dealer</span>
          {dealer?.status === "active" && (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
            </span>
          )}
        </div>
        <div className="font-medium text-foreground truncate text-sm">
          {dealer?.name || "Alpha Motorsport"}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-3">
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            // Precise route matching
            let isActive = false;
            if (item.path === "/") {
              isActive = location === "/";
            } else if (item.path === "/listings") {
              isActive = location.startsWith("/listings") || location.startsWith("/publishing");
            } else {
              isActive = location.startsWith(item.path);
            }
            
            return (
              <Link 
                key={item.path} 
                href={item.path}
                className={cn(
                  "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative",
                  isActive 
                    ? "text-white bg-white/5" 
                    : "text-muted-foreground hover:bg-white/5 hover:text-white"
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-full shadow-[0_0_8px_rgba(var(--primary),0.8)]" />
                )}
                <div className="flex items-center gap-3">
                  <item.icon className={cn(
                    "w-4 h-4 transition-colors", 
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-white/70"
                  )} />
                  <span className="tracking-wide">{item.name}</span>
                </div>
                {isActive && (
                  <ChevronRight className="w-4 h-4 text-white/30" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-4 mt-auto">
        <div className="p-3 rounded-xl border border-white/5 bg-white/[0.02] flex items-center gap-3 glass-panel">
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center overflow-hidden border border-white/10">
            <span className="text-xs font-medium text-muted-foreground">OP</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-none truncate text-white/90">Operator</div>
            <div className="text-[11px] text-muted-foreground mt-1 truncate">Alpha Motorsport</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
