import { useRoute, Link } from "wouter";
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
  Code,
  Info,
  Calendar,
  Settings2,
  Tag,
  Palette
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { SectionCard, PageHeader, StatusPulse } from "@/components/shared";
import { cn } from "@/lib/utils";

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
        <div className="flex-1 p-8 flex flex-col items-center justify-center h-full">
          <div className="glass-panel p-12 rounded-2xl flex flex-col items-center text-center max-w-md">
            <Car className="w-16 h-16 text-muted-foreground/50 mb-6" />
            <h2 className="text-2xl font-bold tracking-tight mb-2">Vehicle Not Found</h2>
            <p className="text-muted-foreground mb-8">The vehicle you're looking for doesn't exist or has been removed.</p>
            <Link href="/inventory">
              <Button className="premium-gradient-btn px-8">
                Back to Inventory
              </Button>
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  const { vehicle, images, changes, sourceRaw } = data;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Active": return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case "Ready to Publish": return "bg-primary/10 text-primary border-primary/20";
      case "Published": return "bg-success/10 text-success border-success/20";
      case "Archived":
      case "Sold/Removed": return "bg-muted text-muted-foreground border-border";
      default: return "bg-secondary text-secondary-foreground border-border";
    }
  };

  const getPulseColor = (status: string) => {
    switch (status) {
      case "Active": return "blue";
      case "Ready to Publish": return "primary";
      case "Published": return "success";
      default: return "muted";
    }
  };

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-8 max-w-[1400px] mx-auto space-y-8 animate-in fade-in duration-500">
          
          {/* Header */}
          <div className="space-y-4">
            <Link href="/inventory" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary transition-colors font-medium">
              <ChevronLeft className="w-4 h-4 mr-1" /> Back to Inventory
            </Link>
            
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
              <div>
                <div className="flex items-center gap-4 mb-2">
                  <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </h1>
                  <Badge variant="outline" className={cn("px-3 py-1 text-sm font-medium", getStatusColor(vehicle.status))}>
                    <StatusPulse color={getPulseColor(vehicle.status) as any} className="mr-2" />
                    {vehicle.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground font-medium">
                  <span className="text-foreground">{vehicle.trim || "Base"}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-border" />
                  <span className="font-mono text-sm tracking-wide">VIN: {vehicle.vin}</span>
                  {vehicle.stockNumber && (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-border" />
                      <span className="font-mono text-sm tracking-wide">Stock: #{vehicle.stockNumber}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 glass-panel p-2 rounded-xl">
                <Button variant="ghost" className="gap-2 hover:bg-primary/10 hover:text-primary transition-colors" disabled>
                  <Wand2 className="w-4 h-4" /> AI Generate
                </Button>
                <div className="w-px h-8 bg-border self-center" />
                <Button variant="ghost" className="gap-2 hover:bg-success/10 hover:text-success transition-colors" disabled>
                  <UploadCloud className="w-4 h-4" /> Queue Publish
                </Button>
                
                <div className="w-px h-8 bg-border self-center" />
                
                {vehicle.status !== "Ready to Publish" && (
                  <Button 
                    variant="outline"
                    className="gap-2 border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground"
                    onClick={() => handleStatusUpdate("Ready to Publish")}
                    disabled={updateStatus.isPending}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Mark Ready
                  </Button>
                )}
                {vehicle.status !== "Archived" && (
                  <Button 
                    variant="ghost" 
                    className="gap-2 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleStatusUpdate("Archived")}
                    disabled={updateStatus.isPending}
                  >
                    <Archive className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left Column - Details */}
            <div className="lg:col-span-2 space-y-8">
              
              {/* Image Gallery */}
              <div className="glass-panel p-2 rounded-2xl">
                {images.length > 0 ? (
                  <div className="space-y-2">
                    <div className="aspect-[21/9] rounded-xl overflow-hidden bg-secondary relative group">
                      <img 
                        src={images[0].url} 
                        alt="Primary" 
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    {images.length > 1 && (
                      <div className="grid grid-cols-4 gap-2">
                        {images.slice(1, 5).map((img, i) => (
                          <div key={img.id} className="aspect-[4/3] rounded-lg overflow-hidden bg-secondary relative group cursor-pointer">
                            <img 
                              src={img.url} 
                              alt={`Gallery ${i}`} 
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                            />
                            <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors" />
                            {i === 3 && images.length > 5 && (
                              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center font-bold text-xl text-white">
                                +{images.length - 5}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="aspect-[21/9] rounded-xl bg-secondary/50 border border-border/50 flex flex-col items-center justify-center text-muted-foreground">
                    <Car className="w-16 h-16 mb-4 opacity-30" />
                    <p className="font-medium">No images available</p>
                  </div>
                )}
              </div>

              {/* Specifications */}
              <SectionCard title="Vehicle Specifications" icon={<Settings2 className="w-5 h-5 text-primary" />}>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-8 p-2">
                  <div className="space-y-1.5">
                    <dt className="text-sm font-medium text-muted-foreground flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" /> Price</dt>
                    <dd className="text-2xl font-bold text-foreground">{formatCurrency(vehicle.price)}</dd>
                  </div>
                  <div className="space-y-1.5">
                    <dt className="text-sm font-medium text-muted-foreground flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Mileage</dt>
                    <dd className="text-xl font-semibold">{formatMileage(vehicle.mileage)}</dd>
                  </div>
                  <div className="space-y-1.5">
                    <dt className="text-sm font-medium text-muted-foreground flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Year</dt>
                    <dd className="text-xl font-semibold">{vehicle.year}</dd>
                  </div>
                  <div className="space-y-1.5">
                    <dt className="text-sm font-medium text-muted-foreground flex items-center gap-1.5"><Car className="w-3.5 h-3.5" /> Body Style</dt>
                    <dd className="text-lg font-medium">{vehicle.bodyStyle || "N/A"}</dd>
                  </div>
                  
                  <div className="col-span-full h-px bg-border/50" />
                  
                  <div className="space-y-1.5">
                    <dt className="text-sm font-medium text-muted-foreground flex items-center gap-1.5"><Palette className="w-3.5 h-3.5" /> Exterior</dt>
                    <dd className="text-base font-medium">{vehicle.exteriorColor || "N/A"}</dd>
                  </div>
                  <div className="space-y-1.5">
                    <dt className="text-sm font-medium text-muted-foreground">Interior</dt>
                    <dd className="text-base font-medium">{vehicle.interiorColor || "N/A"}</dd>
                  </div>
                  <div className="space-y-1.5">
                    <dt className="text-sm font-medium text-muted-foreground">Transmission</dt>
                    <dd className="text-base font-medium">{vehicle.transmission || "N/A"}</dd>
                  </div>
                  <div className="space-y-1.5">
                    <dt className="text-sm font-medium text-muted-foreground">Fuel Type</dt>
                    <dd className="text-base font-medium">{vehicle.fuelType || "N/A"}</dd>
                  </div>
                </dl>
              </SectionCard>

              {/* Description */}
              {vehicle.description && (
                <SectionCard title="Dealer Description" icon={<Info className="w-5 h-5 text-primary" />}>
                  <div className="p-4 bg-secondary/20 rounded-lg border border-border/50">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground font-medium">
                      {vehicle.description}
                    </p>
                  </div>
                </SectionCard>
              )}
            </div>

            {/* Right Column - Meta & History */}
            <div className="space-y-8">
              
              <SectionCard title="Sync Information">
                <div className="space-y-6">
                  {vehicle.vdpUrl ? (
                    <a 
                      href={vehicle.vdpUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-4 rounded-xl bg-primary/5 hover:bg-primary/10 border border-primary/20 text-primary transition-colors group"
                    >
                      <span className="font-medium">View Dealer Listing</span>
                      <ExternalLink className="w-4 h-4 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                    </a>
                  ) : (
                    <div className="p-4 rounded-xl bg-secondary/50 border border-border/50 text-sm text-muted-foreground flex items-center gap-2">
                      <Info className="w-4 h-4" /> No VDP URL provided in feed
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-secondary/30 border border-border/50">
                      <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Last Synced</p>
                      <p className="text-sm font-medium flex items-center gap-2">
                        {formatDate(vehicle.lastSyncAt)}
                      </p>
                    </div>
                    <div className="p-4 rounded-xl bg-secondary/30 border border-border/50">
                      <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Added</p>
                      <p className="text-sm font-medium">{formatDate(vehicle.createdAt)}</p>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* Raw XML Collapsible */}
              {sourceRaw && (
                <Collapsible>
                  <div className="glass-panel rounded-xl overflow-hidden">
                    <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                          <Code className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <span className="font-medium">Raw XML Source Data</span>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="p-4 pt-0">
                        <pre className="bg-black/50 p-4 rounded-lg text-xs font-mono overflow-x-auto text-muted-foreground border border-border/50 max-h-[300px] overflow-y-auto">
                          {sourceRaw}
                        </pre>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              )}

              {/* Change History */}
              <SectionCard title="Data Timeline" description="Recent updates from feed syncs">
                {changes.length > 0 ? (
                  <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-primary/50 before:via-border before:to-transparent pt-2">
                    {changes.map((change, i) => (
                      <div key={change.id} className="relative flex items-start gap-4 group">
                        {/* Icon */}
                        <div className={cn(
                          "flex items-center justify-center w-10 h-10 rounded-full border-2 shrink-0 shadow-sm relative z-10 transition-colors",
                          change.changeType === 'created' ? "bg-primary/20 border-primary text-primary" :
                          change.changeType === 'updated' ? "bg-secondary border-border text-foreground group-hover:border-primary/50" :
                          "bg-muted border-border text-muted-foreground"
                        )}>
                          {change.changeType === 'created' ? <UploadCloud className="w-4 h-4" /> :
                           change.changeType === 'updated' ? <Clock className="w-4 h-4" /> :
                           <Archive className="w-4 h-4" />}
                        </div>
                        {/* Content */}
                        <div className="flex-1 pt-1.5">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="font-semibold text-foreground text-sm capitalize flex items-center gap-2">
                              {change.changeType}
                              {i === 0 && <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20">Latest</Badge>}
                            </div>
                            <time className="text-xs font-medium text-muted-foreground">{formatDate(change.createdAt)}</time>
                          </div>
                          {change.field && (
                            <div className="text-sm bg-secondary/30 rounded-md p-2.5 border border-border/50 inline-block mt-1">
                              <span className="text-muted-foreground font-medium mr-2">{change.field}</span>
                              <span className="line-through text-muted-foreground/70">{change.oldValue || 'none'}</span>
                              <span className="text-muted-foreground mx-2">→</span>
                              <span className="text-foreground font-medium">{change.newValue || 'none'}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground font-medium">No history recorded yet.</p>
                  </div>
                )}
              </SectionCard>

            </div>

          </div>
        </div>
      </div>
    </AppLayout>
  );
}
