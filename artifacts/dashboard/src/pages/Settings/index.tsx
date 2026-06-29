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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { Save, RefreshCw, AlertCircle, CheckCircle2, Loader2, Building2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
        <div className="p-8 max-w-4xl mx-auto space-y-8">
          
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground mt-1">Manage dealership profile and integration feeds.</p>
          </div>

          <div className="grid gap-8">
            
            {/* Dealer Profile */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5" /> Dealership Profile
                </CardTitle>
                <CardDescription>General information about the dealership.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Dealership Name</Label>
                    <Input 
                      id="name" 
                      value={name} 
                      onChange={(e) => setName(e.target.value)} 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="website">Website URL</Label>
                    <Input 
                      id="website" 
                      value={websiteUrl} 
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder="https://"
                    />
                  </div>
                </div>
                <Button 
                  onClick={handleSaveDealer} 
                  disabled={updateDealer.isPending}
                  className="w-full sm:w-auto"
                >
                  {updateDealer.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  <Save className="w-4 h-4 mr-2" /> Save Profile
                </Button>
              </CardContent>
            </Card>

            {/* XML Feed Integration */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="w-5 h-5" /> XML Feed Integration
                </CardTitle>
                <CardDescription>Configure the automated inventory source.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                
                <div className="space-y-2">
                  <Label htmlFor="xml">XML Feed URL</Label>
                  <div className="flex gap-2">
                    <Input 
                      id="xml" 
                      value={xmlFeedUrl} 
                      onChange={(e) => setXmlFeedUrl(e.target.value)}
                      placeholder="https://..."
                      className="flex-1 font-mono text-sm"
                    />
                    <Button 
                      variant="secondary"
                      onClick={handleSaveDealer}
                      disabled={updateDealer.isPending}
                    >
                      Save URL
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="bg-secondary/50 rounded-lg p-6 border border-border">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                      <h4 className="font-medium text-foreground">Manual Sync</h4>
                      <p className="text-sm text-muted-foreground mt-1">Force an immediate pull from the XML feed.</p>
                    </div>
                    <Button 
                      onClick={handleSync} 
                      disabled={syncFeed.isPending || !dealer?.xmlFeedUrl}
                      className="whitespace-nowrap"
                    >
                      {syncFeed.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4 mr-2" />
                      )}
                      Sync Inventory
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-border/50">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Status</p>
                      <div className="flex items-center gap-2">
                        {dealer?.lastSyncStatus === 'success' ? (
                          <><CheckCircle2 className="w-4 h-4 text-green-500" /><span className="text-sm font-medium">Success</span></>
                        ) : dealer?.lastSyncStatus === 'error' ? (
                          <><AlertCircle className="w-4 h-4 text-destructive" /><span className="text-sm font-medium">Failed</span></>
                        ) : (
                          <span className="text-sm font-medium text-muted-foreground">Never</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Last Sync</p>
                      <p className="text-sm font-medium">{formatDate(dealer?.lastSyncAt) || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Total Imported</p>
                      <p className="text-sm font-medium text-primary">{dealer?.totalVehiclesImported || 0}</p>
                    </div>
                  </div>

                  {dealer?.lastError && (
                    <Alert variant="destructive" className="mt-4 bg-destructive/10 border-destructive/20 text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Last Sync Failed</AlertTitle>
                      <AlertDescription className="text-xs mt-1 opacity-90 font-mono break-all">
                        {dealer.lastError}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </AppLayout>
  );
}
