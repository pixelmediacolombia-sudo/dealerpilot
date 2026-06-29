import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { 
  useListDealers, 
  useGetDealer, 
  useUpdateDealer, 
  useSyncDealerFeed,
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
import { Save, RefreshCw, AlertCircle, CheckCircle2, Loader2, Building2, Settings as SettingsIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader, SectionCard } from "@/components/shared";

export function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get dealer
  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers[0]?.id;
  const { data: dealer, isLoading: dealerLoading } = useGetDealer(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getGetDealerQueryKey(dealerId!) }
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
        <div className="p-8 max-w-5xl mx-auto space-y-8 pb-20">
          
          <PageHeader 
            title="Control Center"
            description="Manage dealership profiles, billing, and system integrations."
            icon={SettingsIcon}
          />

          <div className="grid gap-8">
            
            <SectionCard 
              title="Dealership Profile" 
              description="General information about the primary active dealership."
              icon={Building2}
            >
              <div className="space-y-6">
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-3">
                    <Label htmlFor="name">Dealership Name</Label>
                    <Input 
                      id="name" 
                      value={name} 
                      onChange={(e) => setName(e.target.value)} 
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-3">
                    <Label htmlFor="website">Website URL</Label>
                    <Input 
                      id="website" 
                      value={websiteUrl} 
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder="https://"
                      className="bg-background"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button 
                    onClick={handleSaveDealer} 
                    disabled={updateDealer.isPending}
                    className="w-full sm:w-auto gap-2"
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
            >
              <div className="space-y-8">
                <div className="space-y-3">
                  <Label htmlFor="xml">XML Feed URL</Label>
                  <div className="flex gap-3">
                    <Input 
                      id="xml" 
                      value={xmlFeedUrl} 
                      onChange={(e) => setXmlFeedUrl(e.target.value)}
                      placeholder="https://..."
                      className="flex-1 font-mono text-sm bg-background"
                    />
                    <Button 
                      variant="secondary"
                      onClick={handleSaveDealer}
                      disabled={updateDealer.isPending}
                      className="whitespace-nowrap"
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

          </div>
        </div>
      </div>
    </AppLayout>
  );
}
