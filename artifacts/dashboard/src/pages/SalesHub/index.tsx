import { useMemo } from "react";
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
  Server, Database, Rss, Puzzle, Facebook, Store, Bot, Settings,
  Clock, Play
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
  useGetConnectionStatus,
  useListFeedRuns,
  getListFeedRunsQueryKey,
  useListCreativeJobs
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

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
  
  // Additional for pipeline and feed
  const { data: feedRuns } = useListFeedRuns(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getListFeedRunsQueryKey(dealerId!) }
  });
  const { data: creativeJobs } = useListCreativeJobs();
  const { data: publishingJobs } = useListPublishingJobs();
  const { data: workspacesData } = useListListingWorkspaces();

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
  
  // mock renewal count since we can't fully derive it
  const renewalCount = workspacesData?.workspaces?.filter(w => w.publishStatus === 'Approved').length || 0;

  const aiActivityTotal = (vehicleStats?.published || 0) + (creativeStudio?.vehicles.reduce((acc, v) => acc + (v.versionCount || 0), 0) || 0) + (leads?.leads.length || 0);
  const estimatedMinutes = (vehiclesReady * 0.75 + pendingLeads * 1.5 + newVehicles * 0.5).toFixed(0);

  // Live Activity Feed
  const activityItems = useMemo(() => {
    type ActivityItem = { id: string; type: string; label: string; date: Date; color: string };
    const items: ActivityItem[] = [];
    
    feedRuns?.feedRuns?.forEach(run => {
      if (run.finishedAt) {
        items.push({
          id: `feed-${run.id}`,
          type: 'feed',
          label: `Inventory Sync · ${run.vehiclesNew} new vehicles`,
          date: new Date(run.finishedAt),
          color: 'bg-primary'
        });
      }
    });

    creativeJobs?.jobs?.forEach(job => {
      if (job.completedAt) {
        items.push({
          id: `creative-${job.id}`,
          type: 'creative',
          label: `Creative Generated · ${job.vehicleLabel || 'Vehicle'}`,
          date: new Date(job.completedAt),
          color: 'bg-accent'
        });
      }
    });

    publishingJobs?.jobs?.forEach(job => {
      if (job.completedAt) {
        items.push({
          id: `publishing-${job.id}`,
          type: 'publishing',
          label: `Listing Published · ${job.vehicleLabel || 'Vehicle'}`,
          date: new Date(job.completedAt),
          color: 'bg-success'
        });
      }
    });

    leads?.leads?.forEach(lead => {
      items.push({
        id: `lead-${lead.id}`,
        type: 'lead',
        label: `Buyer Message`,
        date: new Date(lead.createdAt),
        color: 'bg-warning'
      });
    });

    return items.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 12);
  }, [feedRuns, creativeJobs, publishingJobs, leads]);


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

  // Pipeline Counts
  const pipelineCounts = {
    inventory: vehicleStats?.total || 0,
    analysis: vehicleStats?.active || 0,
    creative: creativeStudio?.vehicles.filter(v => v.creativeStatus === "Generating").length || 0,
    listing: workspacesData?.workspaces.length || 0,
    publishing: publishingJobs?.jobs.filter(j => j.status === "Publishing").length || 0,
    live: vehicleStats?.published || 0
  };

  return (
    <AppLayout>
      <div className="p-6 md:p-10 max-w-[1400px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
        
        {/* System Pulse Header (keeps the top bar) */}
        <div className="flex justify-end pb-4 mb-6 border-b border-white/5 shrink-0">
          <div className="flex flex-col items-end gap-2">
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

        <div className="flex flex-col xl:flex-row gap-8 flex-1 min-h-0">
          
          {/* LEFT COLUMN */}
          <div className="flex-1 flex flex-col gap-8 overflow-y-auto pr-2 pb-10">
            
            {/* 1. Morning Brief Hero */}
            <div className="glass-panel p-8 rounded-2xl border border-white/5 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-50 -z-10" />
              
              <div className="flex flex-col gap-6">
                <div>
                  <div className="text-sm font-medium text-primary uppercase tracking-wider mb-2">
                    DealerPilot — {greeting}
                  </div>
                  <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-1">
                    {dealer?.name || "Alpha Motorsport"}
                  </h1>
                  <p className="text-xl text-muted-foreground">
                    DealerPilot completed <span className="text-white font-medium">{aiActivityTotal}</span> overnight actions.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-success flex-shrink-0" />
                    <span className="text-white">Publish <strong className="font-bold">{vehiclesReady}</strong> Marketplace listings</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-warning flex-shrink-0" />
                    <span className="text-white">Renew <strong className="font-bold">{renewalCount}</strong> expired ads</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-destructive flex-shrink-0" />
                    <span className="text-white">Reply to <strong className="font-bold">{pendingLeads}</strong> Marketplace buyers</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-success flex-shrink-0" />
                    <span className="text-white">Generate creatives for <strong className="font-bold">{newVehicles}</strong> new vehicles</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Clock className="w-4 h-4" />
                  Estimated work: ~{estimatedMinutes} minutes
                </div>

                <Button 
                  className="w-full premium-gradient-btn h-14 text-lg font-medium mt-2 gap-2"
                  onClick={() => setLocation("/listings")}
                >
                  <Play className="w-5 h-5 fill-current" /> Start AI Workflow <ArrowRight className="w-5 h-5 ml-1" />
                </Button>
              </div>
            </div>

            {/* 2. Mission Cards */}
            <div className="flex flex-col gap-4">
              
              <div className="glass-panel p-5 rounded-xl border border-white/5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between group hover:border-success/30 transition-colors">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-success">Mission</span>
                  <h3 className="text-lg font-semibold text-white">Publish {vehiclesReady} Vehicles</h3>
                  <p className="text-sm text-muted-foreground">Estimated · {(vehiclesReady * 0.75).toFixed(0)} min | Priority: High</p>
                </div>
                <Button className="w-full sm:w-auto bg-success hover:bg-success/90 text-white gap-2" onClick={() => setLocation("/publishing")}>
                  Start Publishing <ArrowRight className="w-4 h-4" />
                </Button>
              </div>

              <div className="glass-panel p-5 rounded-xl border border-white/5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between group hover:border-accent/30 transition-colors">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-accent">Mission</span>
                  <h3 className="text-lg font-semibold text-white">Generate Creatives</h3>
                  <p className="text-sm text-muted-foreground">Estimated · {(newVehicles * 0.5).toFixed(0)} min | Priority: Medium</p>
                </div>
                <Button className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-white gap-2" onClick={() => setLocation("/creative-studio")}>
                  Start Generation <ArrowRight className="w-4 h-4" />
                </Button>
              </div>

              <div className="glass-panel p-5 rounded-xl border border-white/5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between group hover:border-destructive/30 transition-colors">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-destructive">Mission</span>
                  <h3 className="text-lg font-semibold text-white">Reply to {pendingLeads} Buyers</h3>
                  <p className="text-sm text-muted-foreground">Estimated · {(pendingLeads * 1.5).toFixed(0)} min | Priority: High</p>
                </div>
                <Button className="w-full sm:w-auto bg-destructive hover:bg-destructive/90 text-white gap-2" onClick={() => setLocation("/sales-ai")}>
                  Review Replies <ArrowRight className="w-4 h-4" />
                </Button>
              </div>

              <div className="glass-panel p-5 rounded-xl border border-white/5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between group hover:border-warning/30 transition-colors">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-warning">Mission</span>
                  <h3 className="text-lg font-semibold text-white">Update Inventory ({priceChanges})</h3>
                  <p className="text-sm text-muted-foreground">Estimated · 1 min | Priority: Low</p>
                </div>
                <Button className="w-full sm:w-auto bg-warning hover:bg-warning/90 text-black font-medium gap-2" onClick={() => setLocation("/inventory")}>
                  Review Changes <ArrowRight className="w-4 h-4" />
                </Button>
              </div>

            </div>

            {/* 4. AI Workflow Pipeline */}
            <div className="glass-panel p-6 rounded-2xl border border-white/5 mt-4">
              <h3 className="text-sm font-semibold text-white mb-6 uppercase tracking-wider">AI Workflow Pipeline</h3>
              
              <div className="flex items-center justify-between relative">
                {/* Connecting Line */}
                <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-gradient-to-r from-primary/20 via-accent/20 to-success/20 -translate-y-1/2 -z-10 hidden sm:block" />
                
                {[
                  { label: "Inventory", count: pipelineCounts.inventory },
                  { label: "AI Analysis", count: pipelineCounts.analysis },
                  { label: "Creative", count: pipelineCounts.creative },
                  { label: "Listing", count: pipelineCounts.listing },
                  { label: "Publishing", count: pipelineCounts.publishing },
                  { label: "Facebook Live", count: pipelineCounts.live },
                ].map((stage, i, arr) => (
                  <div key={stage.label} className="flex flex-col items-center gap-3 bg-card/80 px-2 sm:px-4 py-2 rounded-lg">
                    <span className="text-xs sm:text-sm font-medium text-muted-foreground whitespace-nowrap">{stage.label}</span>
                    <div className="bg-white/10 text-white px-3 py-1 rounded-full text-sm font-bold min-w-[3rem] text-center border border-white/5">
                      {stage.count}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN - Live Activity Feed */}
          <div className="w-full xl:w-80 shrink-0 flex flex-col gap-4 sticky top-6 self-start max-h-[calc(100vh-120px)]">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
                </span>
                DealerPilot Live
              </h2>
            </div>
            
            <div className="glass-panel rounded-2xl border border-white/5 flex-1 overflow-y-auto p-1">
              <div className="flex flex-col">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="p-4 border-b border-white/5 flex gap-3">
                      <Skeleton className="w-2 h-2 rounded-full mt-1.5 shrink-0" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-3 w-12" />
                        <Skeleton className="h-4 w-full" />
                      </div>
                    </div>
                  ))
                ) : activityItems.length > 0 ? (
                  activityItems.map((item, index) => (
                    <div key={item.id} className="p-4 border-b border-white/5 last:border-0 flex gap-3 group hover:bg-white/[0.02] transition-colors relative">
                      {index === 0 && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary rounded-r" />}
                      <span className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", item.color)} />
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-xs text-muted-foreground font-mono">{format(item.date, 'HH:mm')}</span>
                        <span className="text-sm text-white/90 truncate">{item.label}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    No recent activity
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
