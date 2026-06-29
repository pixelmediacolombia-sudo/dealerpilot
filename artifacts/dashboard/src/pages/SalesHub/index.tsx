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
  Activity
} from "lucide-react";
import { format } from "date-fns";

import { AppLayout } from "@/components/layout/AppLayout";
import { 
  PageHeader, 
  KpiCard, 
  SectionCard, 
  StatusPulse,
  AnimatedCounter
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
  useGetLeads
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
  const { data: listingWorkspaces, isLoading: isLoadingWorkspaces } = useListListingWorkspaces();
  const { data: publishingJobs, isLoading: isLoadingJobs } = useListPublishingJobs();
  const { data: creativeStudio, isLoading: isLoadingCreative } = useListCreativeStudio();
  const { data: leads, isLoading: isLoadingLeads } = useGetLeads();

  // Loading state
  const isLoading = isLoadingDealers || isLoadingDealer || isLoadingStats || 
                    isLoadingWorkspaces || isLoadingJobs || isLoadingCreative || isLoadingLeads;

  // Derived Data
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Summaries
  const listingsGenerated = listingWorkspaces?.workspaces.reduce((acc, w) => acc + (w.versionCount || 0), 0) || 0;
  const creativesGenerated = creativeStudio?.vehicles.reduce((acc, v) => acc + (v.versionCount || 0), 0) || 0;
  const completedJobs = publishingJobs?.jobs.filter(j => j.status === 'completed').length || 0;
  const aiActivityTotal = listingsGenerated + creativesGenerated + completedJobs;

  // KPI calculations
  const totalInventory = vehicleStats?.total || 0;
  const publishedInventory = vehicleStats?.published || 0;
  
  const publishSuccessRate = publishingJobs?.jobs.length 
    ? Math.round((completedJobs / publishingJobs.jobs.length) * 100)
    : 100;

  const pendingLeads = leads?.leads.filter(l => l.status === 'new').length || 0;
  const totalLeads = leads?.leads.length || 0;

  // Recommendations
  const actionItems = [];
  if (vehicleStats?.readyToPublish && vehicleStats.readyToPublish > 0) {
    actionItems.push({
      id: "ready-publish",
      title: `${vehicleStats.readyToPublish} vehicles ready to publish`,
      description: "AI has finished generating listings and creatives. Review and publish to Marketplace.",
      icon: Sparkles,
      color: "text-primary",
      bg: "bg-primary/10",
      action: () => setLocation("/listings"),
      cta: "Review Listings"
    });
  }
  
  const failedJobs = publishingJobs?.jobs.filter(j => j.status === 'failed').length || 0;
  if (failedJobs > 0) {
    actionItems.push({
      id: "failed-jobs",
      title: `${failedJobs} publishing jobs failed`,
      description: "Some listings could not be published to Facebook Marketplace. Check the error logs.",
      icon: AlertCircle,
      color: "text-destructive",
      bg: "bg-destructive/10",
      action: () => setLocation("/publishing"),
      cta: "View Queue"
    });
  }

  if (pendingLeads > 0) {
    actionItems.push({
      id: "pending-leads",
      title: `${pendingLeads} new leads waiting`,
      description: "Buyers have messaged your dealership. The AI is ready with suggested replies.",
      icon: MessageSquare,
      color: "text-accent",
      bg: "bg-accent/10",
      action: () => setLocation("/leads"),
      cta: "View Leads"
    });
  }

  if (vehicleStats?.priceChanged && vehicleStats.priceChanged > 0) {
    actionItems.push({
      id: "price-changes",
      title: `${vehicleStats.priceChanged} price changes detected`,
      description: "Recent feed sync detected price drops. AI can update the listings automatically.",
      icon: TrendingUp,
      color: "text-warning",
      bg: "bg-warning/10",
      action: () => setLocation("/inventory"),
      cta: "Update Inventory"
    });
  }

  // Fallback if everything is perfect
  if (actionItems.length === 0 && !isLoading) {
    actionItems.push({
      id: "all-good",
      title: "All systems nominal",
      description: "Your AI copilot is actively monitoring inventory, leads, and listings.",
      icon: CheckCircle2,
      color: "text-success",
      bg: "bg-success/10",
      action: () => setLocation("/inventory"),
      cta: "View Inventory"
    });
  }

  return (
    <AppLayout>
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Header Section */}
        <div className="flex flex-col gap-2">
          {isLoading ? (
            <Skeleton className="h-10 w-64 bg-white/5" />
          ) : (
            <h1 className="text-3xl font-bold tracking-tight text-white">
              {greeting}, {dealer?.name || "Operator"}
            </h1>
          )}
          
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-white/5 w-fit px-3 py-1.5 rounded-full border border-white/10">
            <StatusPulse color="primary" />
            {isLoading ? (
              <Skeleton className="h-4 w-48 bg-white/5" />
            ) : (
              <span>
                AI Copilot has processed <strong className="text-white">{aiActivityTotal}</strong> actions today
              </span>
            )}
          </div>
        </div>

        {/* Action Panel */}
        <SectionCard 
          title="Recommended Actions" 
          description="Your copilot has identified tasks that need your attention."
          className="border-primary/20 shadow-[0_0_30px_-15px_rgba(var(--primary),0.3)]"
        >
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-24 bg-white/5 rounded-xl" />
              <Skeleton className="h-24 bg-white/5 rounded-xl" />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {actionItems.map((item) => (
                <div key={item.id} className="flex items-start gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors group">
                  <div className={`p-2.5 rounded-lg ${item.bg} ${item.color} shrink-0`}>
                    <item.icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-white tracking-tight">{item.title}</h4>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                    <Button 
                      variant="link" 
                      className="px-0 mt-2 h-auto text-primary hover:text-primary/80"
                      onClick={item.action}
                    >
                      {item.cta} <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* KPI Clusters */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Mission Control Metrics</h2>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> Live Data
            </div>
          </div>
          
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 bg-white/5 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Marketplace Cluster */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Marketplace</h3>
                <KpiCard
                  title="Active Inventory"
                  value={totalInventory}
                  icon={CarFront}
                  accentColor="blue"
                  trend={{ value: 12, label: "from last week", isPositive: true }}
                />
                <KpiCard
                  title="Published Listings"
                  value={publishedInventory}
                  icon={Sparkles}
                  accentColor="blue"
                />
              </div>

              {/* AI Cluster */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">AI Engines</h3>
                <KpiCard
                  title="Creatives Generated"
                  value={creativesGenerated}
                  icon={ImageIcon}
                  accentColor="purple"
                  trend={{ value: 5, label: "today", isPositive: true }}
                />
                <KpiCard
                  title="Publishing Success"
                  value={publishSuccessRate}
                  formatValue={(v) => `${v}%`}
                  icon={CheckCircle2}
                  accentColor="green"
                />
              </div>

              {/* Leads Cluster */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Sales & Leads</h3>
                <KpiCard
                  title="Total Conversations"
                  value={totalLeads}
                  icon={MessageSquare}
                  accentColor="orange"
                  trend={{ value: 8, label: "this week", isPositive: true }}
                />
                <KpiCard
                  title="Pending Replies"
                  value={pendingLeads}
                  icon={AlertCircle}
                  accentColor={pendingLeads > 0 ? "orange" : "green"}
                />
              </div>
            </div>
          )}
        </div>

      </div>
    </AppLayout>
  );
}
