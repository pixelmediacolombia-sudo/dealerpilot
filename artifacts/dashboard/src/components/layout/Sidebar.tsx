import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  CarFront, 
  Share, 
  Users, 
  Bot, 
  Network, 
  Dna, 
  Settings,
  Menu
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetDealer, useListDealers, getGetDealerQueryKey } from "@workspace/api-client-react";

const NAV_ITEMS = [
  { name: "Sales Hub", path: "/", icon: LayoutDashboard },
  { name: "Inventory", path: "/inventory", icon: CarFront },
  { name: "Publishing", path: "/publishing", icon: Share },
  { name: "Leads", path: "/leads", icon: Users },
  { name: "AI Studio", path: "/ai-studio", icon: Bot },
  { name: "Connection Center", path: "/connection-center", icon: Network },
  { name: "Dealer DNA", path: "/dealer-dna", icon: Dna },
  { name: "Settings", path: "/settings", icon: Settings },
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
    <aside className="w-64 border-r border-border bg-card flex flex-col h-[100dvh] sticky top-0">
      <div className="h-16 flex items-center px-6 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded flex items-center justify-center">
            <span className="text-primary-foreground font-bold tracking-tighter">DP</span>
          </div>
          <span className="font-bold text-lg tracking-tight">DealerPilot AI</span>
        </div>
      </div>

      <div className="px-6 py-4 border-b border-border">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Active Dealer
        </div>
        <div className="font-medium text-foreground truncate">
          {dealer?.name || "Alpha Motorsport"}
        </div>
        {dealer?.status === "active" && (
          <div className="flex items-center gap-2 mt-1">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-xs text-muted-foreground">Online</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        <nav className="px-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.path || 
              (item.path !== "/" && location.startsWith(item.path));
            
            return (
              <Link 
                key={item.path} 
                href={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 px-2">
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center overflow-hidden">
            <span className="text-xs font-medium text-muted-foreground">OP</span>
          </div>
          <div>
            <div className="text-sm font-medium leading-none">Operator</div>
            <div className="text-xs text-muted-foreground mt-1">System Admin</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
