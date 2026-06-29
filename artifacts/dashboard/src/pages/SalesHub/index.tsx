import { useLocation } from "wouter";
import { 
  CarFront, 
  Sparkles, 
  MessageSquare, 
  ArrowRight,
  TrendingUp,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Activity,
  Server, Database, Rss, Puzzle, Facebook, Store, Bot, Settings
} from "lucide-react";
import { format } from "date-fns";

import { AppLayout } from "@/components/layout/AppLayout";
import { 
  StatusPulse,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { 
  useGetDealer, 
  useListDealers, 
  getGetDealerQueryKey,
  useGetVehicleStats,
  useListListingWorkspaces,
  useListPublishingJobs,
  useListCreativeStudio,
  useGetLeads,
  useGetConnectionStatus
} from "@workspace/api-client-react";

export function SalesHub() {
  const [, setLocation] = useLocation();

  // 1. Fetch Dealer
  const { data: dealersData, isLoading: isLoadingDealers } = useListDealers();
  const dealerId = dealersData?.dealers?.[0]?.id;
  const { data: dealer, isLoading: isLoadingDealer } = useGetDealer(dealerId!, { 
    query: { enabled: !!dealerId, queryKey: getGetDealerQueryKey(dealerId!) }
  });

  // 2. Fetch Data
  const { data: vehicleStats, isLoading: isLoadingStats } = useGetVehicleStats();
  const { data: creativeStudio, isLoading: isLoadingCreative } = useListCreativeStudio();
  const { data: leads, isLoading: isLoadingLeads } = useGetLeads();
  const { data: connections, isLoading: isLoadingConnections } = useGetConnectionStatus();

  // Loading state
  const isLoading = isLoadingDealers || isLoadingDealer || isLoadingStats || 
                    isLoadingCreative || isLoadingLeads || isLoadingConnections;

  // Derived Data
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const vehiclesReady = vehicleStats?.readyToPublish || 0;
  const newVehicles = vehicleStats?.new || 0;
  const pendingLeads = leads?.leads.filter(l => l.status === 'new').length || 0;
  const priceChanges = vehicleStats?.priceChanged || 0;

  const aiActivityTotal = (vehicleStats?.published || 0) + (creativeStudio?.vehicles.reduce((acc, v) => acc + (v.versionCount || 0), 0) || 0) + (leads?.leads.length || 0);

  const getServiceColor = (serviceStatus?: string) => {
    switch (serviceStatus?.toLowerCase()) {
      case "connected":
      case "online": return "success";
      case "offline":
      case "error": return "destructive";
      case "not_synced":
      case "warning": return "warning";
      case "coming_soon": return "info";
      default: return "muted";
    }
  };

  return (
    <AppLayout>
      <div className="p-6 md:p-10 max-w-[1400px] mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/5">
          <div className="flex flex-col gap-2">
            {isLoading ? (
              <Skeleton className="h-12 w-64 bg-white/5" />
            ) : (
              <h1 className="text-4xl font-bold tracking-tight text-white">
                {greeting}, {dealer?.name || "Operator"}
              </h1>
            )}
            
            <div className="flex items-center gap-2 text-sm text-primary/80 bg-primary/10 w-fit px-4 py-2 rounded-full border border-primary/20">
              <StatusPulse color="primary" />
              {isLoading ? (
                <Skeleton className="h-4 w-48 bg-white/5" />
              ) : (
                <span>
                  DealerPilot processed <strong className="text-primary font-semibold">{aiActivityTotal} actions</strong> today.
                </span>
              )}
            </div>
          </div>

          {/* Compact System Pulse */}
          <div className="flex flex-col items-start md:items-end gap-2">
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
              <Activity className="w-3 h-3" /> System Pulse
            </h3>
            <div className="flex items-center gap-3">
              {[
                { key: 'xmlFeed', icon: Rss, name: 'Feed' },
                { key: 'chromeExtension', icon: Puzzle, name: 'Extension' },
                { key: 'marketplace', icon: Store, name: 'Marketplace' },
                { key: 'openai', icon: Bot, name: 'AI' }
              ].map((svc) => (
                <div key={svc.key} className="flex items-center gap-1.5 bg-black/20 px-2 py-1.5 rounded border border-white/5" title={svc.name}>
                  <svc.icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <StatusPulse status={getServiceColor(connections?.[svc.key as keyof typeof connections]?.status)} />
                </div>
              ))}
              <Button variant="ghost" size="icon" className="h-7 w-7 bg-white/5 hover:bg-white/10 ml-2" onClick={() => setLocation("/settings")}>
                <Settings className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
            </div>
          </div>
        </div>

        {/* Mission Control Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Card 1: MARKETPLACE */}
          <div className="glass-panel p-8 rounded-2xl border border-white/5 relative overflow-hidden group hover:border-primary/30 transition-all duration-500 hover:shadow-[0_0_40px_-15px_rgba(var(--primary),0.3)]">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            <div className="flex flex-col h-full">
              <span className="text-primary text-[10px] font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                <Store className="w-3.5 h-3.5" /> Marketplace
              </span>
              <h2 className="text-3xl sm:text-4xl font-light tracking-tight text-white mb-4">
                DealerPilot found <strong className="font-bold">{vehiclesReady}</strong> vehicles ready to publish.
              </h2>
              <p className="text-muted-foreground mb-8 max-w-md">
                Your inventory has been synced and AI has generated optimized listings. Review and push them live to Facebook Marketplace.
              </p>
              <div className="mt-auto">
                <Button 
                  size="lg" 
                  className="w-full sm:w-auto premium-gradient-btn gap-2"
                  onClick={() => setLocation("/publishing")}
                >
                  Publish Now <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            </div>
          </div>

          {/* Card 2: CREATIVES */}
          <div className="glass-panel p-8 rounded-2xl border border-white/5 relative overflow-hidden group hover:border-accent/30 transition-all duration-500 hover:shadow-[0_0_40px_-15px_rgba(var(--accent),0.3)]">
            <div className="absolute top-0 right-0 w-64 h-64 bg-accent/10 rounded-full blur-3xl -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            <div className="flex flex-col h-full">
              <span className="text-accent text-[10px] font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                <ImageIcon className="w-3.5 h-3.5" /> Creatives
              </span>
              <h2 className="text-3xl sm:text-4xl font-light tracking-tight text-white mb-4">
                DealerPilot queued <strong className="font-bold">{newVehicles}</strong> vehicles for design generation.
              </h2>
              <p className="text-muted-foreground mb-8 max-w-md">
                AI is ready to generate high-converting composite images and branded templates for your newly imported inventory.
              </p>
              <div className="mt-auto">
                <Button 
                  size="lg" 
                  className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-white gap-2"
                  onClick={() => setLocation("/creative-studio")}
                >
                  Generate Creatives <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            </div>
          </div>

          {/* Card 3: LEADS */}
          <div className="glass-panel p-8 rounded-2xl border border-white/5 relative overflow-hidden group hover:border-success/30 transition-all duration-500 hover:shadow-[0_0_40px_-15px_rgba(var(--success),0.3)]">
            <div className="absolute top-0 right-0 w-64 h-64 bg-success/10 rounded-full blur-3xl -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            <div className="flex flex-col h-full">
              <span className="text-success text-[10px] font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5" /> Leads
              </span>
              <h2 className="text-3xl sm:text-4xl font-light tracking-tight text-white mb-4">
                DealerPilot captured <strong className="font-bold">{pendingLeads}</strong> new buyer messages.
              </h2>
              <p className="text-muted-foreground mb-8 max-w-md">
                AI has analyzed buyer intent and drafted suggested replies based on listing context. Review and send to potential buyers.
              </p>
              <div className="mt-auto">
                <Button 
                  size="lg" 
                  className="w-full sm:w-auto bg-success hover:bg-success/90 text-white gap-2"
                  onClick={() => setLocation("/sales-ai")}
                >
                  Review Leads <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            </div>
          </div>

          {/* Card 4: INVENTORY */}
          <div className="glass-panel p-8 rounded-2xl border border-white/5 relative overflow-hidden group hover:border-warning/30 transition-all duration-500 hover:shadow-[0_0_40px_-15px_rgba(var(--warning),0.3)]">
            <div className="absolute top-0 right-0 w-64 h-64 bg-warning/10 rounded-full blur-3xl -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            <div className="flex flex-col h-full">
              <span className="text-warning text-[10px] font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                <Rss className="w-3.5 h-3.5" /> Inventory
              </span>
              <h2 className="text-3xl sm:text-4xl font-light tracking-tight text-white mb-4">
                DealerPilot detected <strong className="font-bold">{priceChanges}</strong> pricing updates.
              </h2>
              <p className="text-muted-foreground mb-8 max-w-md">
                The latest inventory feed sync discovered price drops or updates. Allow AI to revise existing listing strategies automatically.
              </p>
              <div className="mt-auto">
                <Button 
                  size="lg" 
                  className="w-full sm:w-auto bg-warning hover:bg-warning/90 text-black font-semibold gap-2"
                  onClick={() => setLocation("/inventory")}
                >
                  Update Inventory <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            </div>
          </div>

        </div>

      </div>
    </AppLayout>
  );
}
