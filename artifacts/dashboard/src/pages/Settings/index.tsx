import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { 
  useListDealers, 
  useGetDealer, 
  useUpdateDealer, 
  useSyncDealerFeed,
  useGetConnectionStatus,
  useListFeedRuns,
  getListFeedRunsQueryKey,
  getGetDealerQueryKey,
  getListVehiclesQueryKey,
  getGetVehicleStatsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { 
  Save, RefreshCw, AlertCircle, CheckCircle2, Loader2, Building2, 
  Settings as SettingsIcon, Server, Database, Rss, Puzzle, 
  Facebook, Store, MessageCircle, Bot, Activity, History
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader, SectionCard, StatusPulse } from "@/components/shared";
import { cn } from "@/lib/utils";

export function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get dealer
  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers[0]?.id;
  const { data: dealer, isLoading: dealerLoading } = useGetDealer(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getGetDealerQueryKey(dealerId!) }
  });

  const { data: connections } = useGetConnectionStatus();
  const { data: feedRunsData } = useListFeedRuns(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getListFeedRunsQueryKey(dealerId!) }
  });

  // Local state for forms
  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [xmlFeedUrl, setXmlFeedUrl] = useState("");
  
  // Sync state to local form
  useEffect(() => {
    if (dealer) {
      setName(dealer.name || "");
      setWebsiteUrl(dealer.websiteUrl || "");
      setXmlFeedUrl(dealer.xmlFeedUrl || "");
    }
  }, [dealer]);

  // Mutations
  const updateDealer = useUpdateDealer();
  const syncFeed = useSyncDealerFeed();

  const handleSaveDealer = () => {
    if (!dealerId) return;
    updateDealer.mutate({
      id: dealerId,
      data: { name, websiteUrl, xmlFeedUrl }
    }, {
      onSuccess: () => {
        toast({ title: "Settings saved successfully" });
        queryClient.invalidateQueries({ queryKey: getGetDealerQueryKey(dealerId) });
      },
      onError: (err) => {
        toast({ title: "Error saving settings", variant: "destructive" });
      }
    });
  };

  const handleSync = () => {
    if (!dealerId) return;
    syncFeed.mutate({ id: dealerId }, {
      onSuccess: (run) => {
        toast({
          title: "Sync completed",
          description: `Imported: ${run.vehiclesImported} | New: ${run.vehiclesNew} | Updated: ${run.vehiclesUpdated} | Removed: ${run.vehiclesRemoved}`
        });
        queryClient.invalidateQueries({ queryKey: getGetDealerQueryKey(dealerId) });
        queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetVehicleStatsQueryKey() });
      },
      onError: (err) => {
        toast({ title: "Sync failed", description: err.message || "Unknown error", variant: "destructive" });
      }
    });
  };

  const getStatusConfig = (serviceStatus: string) => {
    switch (serviceStatus?.toLowerCase()) {
      case "connected":
      case "online":
        return { color: "success", label: "Online" } as const;
      case "offline":
      case "error":
        return { color: "destructive", label: "Offline" } as const;
      case "not_synced":
      case "warning":
        return { color: "warning", label: "Degraded" } as const;
      case "coming_soon":
        return { color: "info", label: "Pending" } as const;
      default:
        return { color: "muted", label: "Unknown" } as const;
    }
  };

  const services = [
    { key: 'backend', name: 'Core API Server', icon: Server, description: 'Main orchestration and task runner' },
    { key: 'database', name: 'Primary Database', icon: Database, description: 'Persistent state storage' },
    { key: 'xmlFeed', name: 'Inventory Sync', icon: Rss, description: 'Nightly dealer feed ingestion' },
    { key: 'chromeExtension', name: 'Publishing Agent', icon: Puzzle, description: 'Browser automation bridge' },
    { key: 'facebookSession', name: 'FB Auth Token', icon: Facebook, description: 'Marketplace session state' },
    { key: 'marketplace', name: 'Marketplace API', icon: Store, description: 'Listing publication endpoints' },
    { key: 'messenger', name: 'Messenger Graph', icon: MessageCircle, description: 'Lead interception' },
    { key: 'openai', name: 'Intelligence Engine', icon: Bot, description: 'AI generation and natural language' },
  ] as const;

  if (dealerLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-5xl mx-auto space-y-8 pb-20 fade-in slide-in-from-bottom-4 duration-500 animate-in">
          
          <PageHeader 
            eyebrow="CONFIGURATION"
            title="System Settings"
            description="Manage your dealership profile, inventory feed, and verify DealerPilot's real-time telemetry."
            icon={SettingsIcon}
          />

          <div className="grid gap-8">
            
            <SectionCard 
              title="Dealership Profile" 
              description="General information about your active dealership."
              icon={Building2}
              className="border-white/5"
            >
              <div className="space-y-6">
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-3">
                    <Label htmlFor="name" className="text-xs uppercase tracking-wider text-muted-foreground">Dealership Name</Label>
                    <Input 
                      id="name" 
                      value={name} 
                      onChange={(e) => setName(e.target.value)} 
                      className="bg-black/20 border-white/10"
                    />
                  </div>
                  <div className="space-y-3">
                    <Label htmlFor="website" className="text-xs uppercase tracking-wider text-muted-foreground">Website URL</Label>
                    <Input 
                      id="website" 
                      value={websiteUrl} 
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder="https://"
                      className="bg-black/20 border-white/10"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <Button 
                    onClick={handleSaveDealer} 
                    disabled={updateDealer.isPending}
                    className="w-full sm:w-auto gap-2 premium-gradient-btn"
                  >
                    {updateDealer.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Profile
                  </Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard 
              title="Inventory Feed Integration" 
              description="Configure your automated nightly XML inventory source."
              icon={RefreshCw}
              className="border-white/5"
            >
              <div className="space-y-8">
                <div className="space-y-3">
                  <Label htmlFor="xml" className="text-xs uppercase tracking-wider text-muted-foreground">XML Feed URL</Label>
                  <div className="flex gap-3">
                    <Input 
                      id="xml" 
                      value={xmlFeedUrl} 
                      onChange={(e) => setXmlFeedUrl(e.target.value)}
                      placeholder="https://..."
                      className="flex-1 font-mono text-sm bg-black/20 border-white/10"
                    />
                    <Button 
                      variant="secondary"
                      onClick={handleSaveDealer}
                      disabled={updateDealer.isPending}
                      className="whitespace-nowrap bg-white/10 hover:bg-white/15"
                    >
                      Save URL
                    </Button>
                  </div>
                </div>

                <div className="bg-black/20 rounded-xl p-6 border border-white/5 relative overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 relative z-10">
                    <div>
                      <h4 className="font-medium text-foreground text-sm uppercase tracking-wider">Manual Sync Trigger</h4>
                      <p className="text-sm text-muted-foreground mt-1">Force an immediate data pull from the configured feed.</p>
                    </div>
                    <Button 
                      onClick={handleSync} 
                      disabled={syncFeed.isPending || !dealer?.xmlFeedUrl}
                      className="whitespace-nowrap gap-2 bg-white/5 hover:bg-white/10 text-foreground border border-white/10"
                      variant="outline"
                    >
                      {syncFeed.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      Sync Inventory Now
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-6 border-t border-white/5 relative z-10">
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Sync Status</p>
                      <div className="flex items-center gap-2">
                        {dealer?.lastSyncStatus === 'success' ? (
                          <><CheckCircle2 className="w-4 h-4 text-success" /><span className="text-sm font-medium text-success">Healthy</span></>
                        ) : dealer?.lastSyncStatus === 'error' ? (
                          <><AlertCircle className="w-4 h-4 text-destructive" /><span className="text-sm font-medium text-destructive">Failed</span></>
                        ) : (
                          <span className="text-sm font-medium text-muted-foreground">Pending</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Last Run</p>
                      <p className="text-sm font-medium text-foreground">{formatDate(dealer?.lastSyncAt) || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Total Imported</p>
                      <p className="text-sm font-medium text-primary">{dealer?.totalVehiclesImported || 0}</p>
                    </div>
                  </div>

                  {dealer?.lastError && (
                    <Alert variant="destructive" className="mt-6 bg-destructive/10 border-destructive/20 text-destructive relative z-10">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Last Sync Encountered Issues</AlertTitle>
                      <AlertDescription className="text-xs mt-2 opacity-90 font-mono break-all bg-black/40 p-2 rounded">
                        {dealer.lastError}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
            </SectionCard>

            <SectionCard 
              title="System Connections" 
              description="Real-time telemetry for the DealerPilot operating system."
              icon={Activity}
              className="border-white/5"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {services.map(({ key, name, icon: Icon, description }) => {
                  const svc = connections?.[key as keyof typeof connections] as { status?: string; lastHeartbeatAt?: string | null; backendUrl?: string | null; detail?: string | null } | null | undefined;
                  const config = getStatusConfig(svc?.status || "unknown");

                  return (
                    <div key={key} className="flex flex-col justify-between p-4 rounded-xl bg-black/20 border border-white/5 hover:border-white/10 transition-colors">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Icon className="w-5 h-5 text-muted-foreground" />
                          <StatusPulse status={config.color} />
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm text-foreground tracking-tight">{name}</h4>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{description}</p>
                        </div>
                      </div>
                      {(svc?.lastHeartbeatAt || svc?.backendUrl || svc?.detail) && (
                        <div className="mt-4 pt-3 border-t border-white/5">
                          {svc?.detail && (
                            <p className="text-[10px] font-mono text-muted-foreground line-clamp-1 truncate mb-2">{svc.detail}</p>
                          )}
                          {svc?.lastHeartbeatAt && (
                            <p className="text-[10px] text-muted-foreground">Heartbeat: {formatDate(svc.lastHeartbeatAt)}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            <SectionCard
              title="Feed Run History"
              description="Last 5 inventory sync operations."
              icon={History}
              className="border-white/5"
            >
              <div className="space-y-3">
                {(!feedRunsData?.feedRuns || feedRunsData.feedRuns.length === 0) ? (
                  <div className="text-center p-6 bg-black/20 rounded-xl border border-white/5 border-dashed">
                    <p className="text-sm text-muted-foreground">No sync history available.</p>
                  </div>
                ) : (
                  feedRunsData.feedRuns.slice(0, 5).map((run) => (
                    <div key={run.id} className="flex items-center justify-between p-4 rounded-xl bg-black/20 border border-white/5">
                      <div className="flex items-center gap-4">
                        {run.status === "success" ? (
                          <div className="p-2 bg-success/10 text-success rounded-lg">
                            <CheckCircle2 className="w-4 h-4" />
                          </div>
                        ) : run.status === "error" ? (
                          <div className="p-2 bg-destructive/10 text-destructive rounded-lg">
                            <AlertCircle className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className="p-2 bg-warning/10 text-warning rounded-lg animate-pulse">
                            <Loader2 className="w-4 h-4" />
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-foreground">{formatDate(run.startedAt)}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Imported: {run.vehiclesImported} • New: {run.vehiclesNew} • Updated: {run.vehiclesUpdated} • Removed: {run.vehiclesRemoved}
                          </p>
                        </div>
                      </div>
                      {run.errorMessage && (
                        <div className="text-xs font-mono text-destructive max-w-xs truncate">
                          {run.errorMessage}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </SectionCard>

          </div>
        </div>
      </div>
    </AppLayout>
  );
}
