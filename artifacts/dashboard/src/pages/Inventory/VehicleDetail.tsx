import { useRoute, Link, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { 
  useGetVehicle, 
  useUpdateVehicleStatus,
  getGetVehicleQueryKey,
  getGetVehicleStatsQueryKey,
  getListVehiclesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatMileage, formatDate } from "@/lib/format";
import { 
  ChevronLeft, 
  ExternalLink, 
  Car, 
  CheckCircle2, 
  Archive, 
  UploadCloud, 
  Wand2,
  Clock,
  Code
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";

export function VehicleDetail() {
  const [match, params] = useRoute("/inventory/:id");
  const id = params?.id ? parseInt(params.id, 10) : 0;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetVehicle(id, {
    query: { enabled: !!id, queryKey: getGetVehicleQueryKey(id) }
  });

  const updateStatus = useUpdateVehicleStatus();

  const handleStatusUpdate = (status: string) => {
    updateStatus.mutate({ id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetVehicleQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetVehicleStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
        toast({
          title: "Status Updated",
          description: `Vehicle status changed to ${status}`,
        });
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to update status",
          variant: "destructive",
        });
      }
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex-1 p-8 flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  if (!data?.vehicle) {
    return (
      <AppLayout>
        <div className="flex-1 p-8 flex flex-col items-center justify-center">
          <Car className="w-12 h-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-bold">Vehicle Not Found</h2>
          <Link href="/inventory" className="text-primary hover:underline mt-2">
            Back to Inventory
          </Link>
        </div>
      </AppLayout>
    );
  }

  const { vehicle, images, changes, sourceRaw } = data;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-5xl mx-auto space-y-8">
          
          {/* Header */}
          <div>
            <Link href="/inventory" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
              <ChevronLeft className="w-4 h-4 mr-1" /> Back to Inventory
            </Link>
            
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-3xl font-bold tracking-tight">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </h1>
                  <Badge variant="outline" className="text-sm px-2 py-0.5 border-primary/50 text-primary bg-primary/10">
                    {vehicle.status}
                  </Badge>
                </div>
                <p className="text-lg text-muted-foreground">
                  {vehicle.trim || "Base"} • VIN: {vehicle.vin}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="gap-2" disabled>
                  <Wand2 className="w-4 h-4" /> Generate Listing
                </Button>
                <Button variant="outline" className="gap-2" disabled>
                  <UploadCloud className="w-4 h-4" /> Queue for Publishing
                </Button>
                {vehicle.status !== "Ready to Publish" && (
                  <Button 
                    className="gap-2"
                    onClick={() => handleStatusUpdate("Ready to Publish")}
                    disabled={updateStatus.isPending}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Mark Ready
                  </Button>
                )}
                {vehicle.status !== "Archived" && (
                  <Button 
                    variant="destructive" 
                    className="gap-2"
                    onClick={() => handleStatusUpdate("Archived")}
                    disabled={updateStatus.isPending}
                  >
                    <Archive className="w-4 h-4" /> Archive
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left Column - Details */}
            <div className="lg:col-span-2 space-y-8">
              
              {/* Image Gallery */}
              {images.length > 0 ? (
                <div className="space-y-4">
                  <div className="aspect-[16/9] rounded-xl overflow-hidden bg-secondary border border-border">
                    <img 
                      src={images[0].url} 
                      alt="Primary" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {images.length > 1 && (
                    <div className="grid grid-cols-4 gap-4">
                      {images.slice(1, 5).map((img, i) => (
                        <div key={img.id} className="aspect-[4/3] rounded-lg overflow-hidden bg-secondary border border-border relative">
                          <img 
                            src={img.url} 
                            alt={`Gallery ${i}`} 
                            className="w-full h-full object-cover"
                          />
                          {i === 3 && images.length > 5 && (
                            <div className="absolute inset-0 bg-background/80 flex items-center justify-center font-bold text-lg">
                              +{images.length - 5}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="aspect-[16/9] rounded-xl bg-secondary border border-border flex flex-col items-center justify-center text-muted-foreground">
                  <Car className="w-16 h-16 mb-4 opacity-50" />
                  <p>No images available</p>
                </div>
              )}

              {/* Specifications */}
              <Card>
                <CardHeader>
                  <CardTitle>Specifications</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-6">
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Price</dt>
                      <dd className="text-xl font-semibold text-primary">{formatCurrency(vehicle.price)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Mileage</dt>
                      <dd className="text-lg font-medium">{formatMileage(vehicle.mileage)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Stock Number</dt>
                      <dd className="text-lg font-medium">{vehicle.stockNumber || "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Exterior</dt>
                      <dd className="text-base font-medium">{vehicle.exteriorColor || "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Interior</dt>
                      <dd className="text-base font-medium">{vehicle.interiorColor || "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Body Style</dt>
                      <dd className="text-base font-medium">{vehicle.bodyStyle || "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Transmission</dt>
                      <dd className="text-base font-medium">{vehicle.transmission || "N/A"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">Fuel Type</dt>
                      <dd className="text-base font-medium">{vehicle.fuelType || "N/A"}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              {/* Description */}
              {vehicle.description && (
                <Card>
                  <CardHeader>
                    <CardTitle>Description</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-invert max-w-none">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{vehicle.description}</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Raw XML Collapsible */}
              {sourceRaw && (
                <Collapsible>
                  <Card>
                    <CollapsibleTrigger className="w-full flex items-center justify-between p-6 hover:bg-secondary/50 transition-colors">
                      <div className="flex items-center gap-2">
                        <Code className="w-5 h-5 text-muted-foreground" />
                        <CardTitle className="text-base">Raw XML Source Data</CardTitle>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="pt-0">
                        <pre className="bg-secondary p-4 rounded-md text-xs font-mono overflow-x-auto text-muted-foreground border border-border">
                          {sourceRaw}
                        </pre>
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              )}
            </div>

            {/* Right Column - Meta & History */}
            <div className="space-y-6">
              
              <Card>
                <CardHeader>
                  <CardTitle>Links & Sync</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {vehicle.vdpUrl ? (
                    <a 
                      href={vehicle.vdpUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="w-4 h-4" /> View Dealer Listing (VDP)
                    </a>
                  ) : (
                    <p className="text-sm text-muted-foreground">No VDP URL provided</p>
                  )}
                  
                  <Separator />
                  
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Last Synced</p>
                    <p className="text-sm flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      {formatDate(vehicle.lastSyncAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Added to System</p>
                    <p className="text-sm">{formatDate(vehicle.createdAt)}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Change History */}
              <Card>
                <CardHeader>
                  <CardTitle>History</CardTitle>
                  <CardDescription>Recent updates from feed syncs</CardDescription>
                </CardHeader>
                <CardContent>
                  {changes.length > 0 ? (
                    <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
                      {changes.map((change) => (
                        <div key={change.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                          {/* Icon */}
                          <div className="flex items-center justify-center w-10 h-10 rounded-full border border-border bg-card shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm relative z-10 text-muted-foreground">
                            {change.changeType === 'created' ? <UploadCloud className="w-4 h-4" /> :
                             change.changeType === 'updated' ? <Clock className="w-4 h-4" /> :
                             <Archive className="w-4 h-4" />}
                          </div>
                          {/* Card */}
                          <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded border border-border bg-secondary/50">
                            <div className="flex items-center justify-between mb-1">
                              <div className="font-bold text-foreground text-sm capitalize">{change.changeType}</div>
                              <time className="text-xs font-medium text-muted-foreground">{formatDate(change.createdAt)}</time>
                            </div>
                            {change.field && (
                              <div className="text-sm mt-2">
                                <span className="text-muted-foreground font-medium">{change.field}:</span>{' '}
                                <span className="line-through text-muted-foreground">{change.oldValue || 'none'}</span>{' '}
                                <span className="text-foreground">→</span>{' '}
                                <span className="text-primary font-medium">{change.newValue || 'none'}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">No history recorded yet.</p>
                  )}
                </CardContent>
              </Card>

            </div>

          </div>
        </div>
      </div>
    </AppLayout>
  );
}
