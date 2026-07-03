import { useRoute, Link } from "wouter";
import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { 
  useGetVehicle, 
  useUpdateVehicleStatus,
  useGetVehicleIntelligence,
  getGetVehicleQueryKey,
  getGetVehicleIntelligenceQueryKey,
  getGetVehicleStatsQueryKey,
  getListVehiclesQueryKey
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { VehiclePhotoStudio, fetchPhotoSet, PHOTO_SET_QUERY_KEY } from "./VehiclePhotoStudio";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatMileage, formatDate } from "@/lib/format";
import { 
  ChevronLeft,
  ChevronRight,
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
  Palette,
  Brain,
  Camera,
  Sparkles,
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

  const { data: intelData } = useGetVehicleIntelligence(id, {
    query: { enabled: !!id, queryKey: getGetVehicleIntelligenceQueryKey(id) },
  });
  const intel = intelData?.intelligence;

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [photoMode, setPhotoMode] = useState<"original" | "ai">("original");

  const { data: photoSetData } = useQuery({
    queryKey: PHOTO_SET_QUERY_KEY(id),
    queryFn: () => fetchPhotoSet(id),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.set?.status;
      const aiStatus = query.state.data?.vehicle?.aiPhotoStatus;
      if (status === "Processing") return 3000;
      if (!status && (aiStatus === "Processing" || aiStatus === "Queued")) return 3000;
      return false;
    },
  });

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

  const photoSetReady =
    photoSetData?.set?.status === "Ready" ||
    photoSetData?.set?.status === "Needs Review";
  const aiDisplayImages =
    photoSetData?.images?.map((img) => ({
      id: img.id,
      url: img.compositedUrl ?? img.processedUrl ?? img.originalUrl,
      category: img.classification,
      isPrimary: img.position === 0,
    })) ?? [];
  const displayImages =
    photoMode === "ai" && photoSetReady && aiDisplayImages.length > 0
      ? aiDisplayImages
      : images;

  const clampIdx = (i: number) => Math.max(0, Math.min(i, displayImages.length - 1));

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Published": return { label: "LIVE", className: "bg-success/80 text-success-foreground border-success/20" };
      case "Ready to Publish": return { label: "READY", className: "bg-blue-500/80 text-white border-blue-500/20" };
      case "AI Generated": return { label: "AI", className: "bg-accent/80 text-accent-foreground border-accent/20" };
      case "Active": return { label: "ACTIVE", className: "bg-secondary/80 text-secondary-foreground border-secondary/20" };
      case "Archived":
      case "Sold/Removed": return { label: "SOLD", className: "bg-destructive/80 text-destructive-foreground border-destructive/20" };
      default: return { label: status.toUpperCase(), className: "bg-secondary/80 text-secondary-foreground border-secondary/20" };
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
            <Link href="/inventory" className="inline-flex items-center text-sm text-cyan-400/60 hover:text-cyan-400 transition-colors font-medium">
              <ChevronLeft className="w-4 h-4 mr-1" /> Back to Inventory
            </Link>
            
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
              <div>
                <div className="flex items-center gap-4 mb-2">
                  <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </h1>
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

              <div className="flex flex-wrap gap-2 glass-panel p-2 rounded-xl">
                {vehicle.status !== "Ready to Publish" && (
                  <Button 
                    className="gap-2 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold"
                    onClick={() => handleStatusUpdate("Ready to Publish")}
                    disabled={updateStatus.isPending}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Mark Ready
                  </Button>
                )}
                <Button variant="ghost" className="gap-2 hover:bg-success/10 hover:text-success transition-colors" disabled>
                  <UploadCloud className="w-4 h-4" /> Queue Publish
                </Button>
                <Button variant="ghost" className="gap-2 hover:bg-cyan-500/10 hover:text-cyan-400 transition-colors" disabled>
                  <Wand2 className="w-4 h-4" /> Generate Photos
                </Button>
                <div className="w-px h-8 bg-border self-center" />
                {vehicle.status !== "Archived" && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="gap-1.5 text-xs hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
                    onClick={() => handleStatusUpdate("Archived")}
                    disabled={updateStatus.isPending}
                  >
                    <Archive className="w-3.5 h-3.5" /> Archive
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left Column - Details */}
            <div className="lg:col-span-2 space-y-8">
              
              {/* Image Gallery */}
              <div className="glass-panel p-2 rounded-2xl space-y-2">
                {displayImages.length > 0 ? (
                  <>
                    {/* Header bar */}
                    <div className="flex items-center justify-between px-1 py-0.5">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                        <Camera className="w-4 h-4" />
                        <span>{displayImages.length} Photos</span>
                        {displayImages[selectedIdx]?.category && (
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wider capitalize px-2">
                            {displayImages[selectedIdx].category}
                          </Badge>
                        )}
                        {photoMode === "ai" && (
                          <span className="flex items-center gap-0.5 text-[10px] font-bold text-primary uppercase tracking-wide">
                            <Sparkles className="w-3 h-3" /> AI
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                        <button
                          onClick={() => setSelectedIdx(clampIdx(selectedIdx - 1))}
                          disabled={selectedIdx === 0}
                          className="p-1.5 rounded-lg hover:bg-secondary disabled:opacity-30 transition-colors"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="min-w-[3rem] text-center">{selectedIdx + 1} / {displayImages.length}</span>
                        <button
                          onClick={() => setSelectedIdx(clampIdx(selectedIdx + 1))}
                          disabled={selectedIdx === displayImages.length - 1}
                          className="p-1.5 rounded-lg hover:bg-secondary disabled:opacity-30 transition-colors"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Photo mode toggle — only visible when AI set is ready */}
                    {photoSetReady && (
                      <div className="flex p-0.5 bg-white/[0.04] border border-white/[0.08] rounded-lg mx-1">
                        <button
                          onClick={() => { setPhotoMode("original"); setSelectedIdx(0); }}
                          className={cn(
                            "flex-1 py-1 text-[10px] font-semibold rounded-md transition-all",
                            photoMode === "original"
                              ? "bg-white/10 text-white shadow-sm"
                              : "text-muted-foreground hover:text-white/70",
                          )}
                        >
                          Original
                        </button>
                        <button
                          onClick={() => { setPhotoMode("ai"); setSelectedIdx(0); }}
                          className={cn(
                            "flex-1 py-1 text-[10px] font-semibold rounded-md transition-all flex items-center justify-center gap-0.5",
                            photoMode === "ai"
                              ? "bg-primary/20 text-primary shadow-sm border border-primary/20"
                              : "text-muted-foreground hover:text-white/70",
                          )}
                        >
                          <Sparkles className="w-2.5 h-2.5" /> AI Enhanced
                        </button>
                      </div>
                    )}

                    {/* Primary / selected image */}
                    <div className="aspect-video rounded-xl overflow-hidden bg-secondary relative group">
                      <div className="absolute top-3 right-3 z-10">
                        <Badge variant="outline" className={cn("backdrop-blur-sm px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase border", getStatusBadge(vehicle.status).className)}>
                          {getStatusBadge(vehicle.status).label}
                        </Badge>
                      </div>
                      <img
                        key={displayImages[selectedIdx].url}
                        src={displayImages[selectedIdx].url}
                        alt={`Photo ${selectedIdx + 1}`}
                        className="w-full h-full object-cover transition-opacity duration-300"
                      />
                    </div>

                    {/* Scrollable thumbnail strip — ALL images */}
                    {displayImages.length > 1 && (
                      <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5 max-h-52 overflow-y-auto pr-0.5 pt-0.5">
                        {displayImages.map((img, i) => (
                          <button
                            key={img.id}
                            onClick={() => setSelectedIdx(i)}
                            className={cn(
                              "aspect-square rounded-lg overflow-hidden relative group transition-all duration-150 focus:outline-none",
                              i === selectedIdx
                                ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
                                : "opacity-70 hover:opacity-100"
                            )}
                          >
                            <img
                              src={img.url}
                              alt={`Thumbnail ${i + 1}`}
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                            {img.isPrimary && i !== selectedIdx && (
                              <div className="absolute bottom-0.5 left-0.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary shadow" />
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="aspect-video rounded-xl bg-secondary/50 border border-border/50 flex flex-col items-center justify-center text-muted-foreground">
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

              {/* AI Photo Studio panel */}
              <VehiclePhotoStudio
                vehicleId={id}
                photoMode={photoMode}
                onPhotoModeChange={(mode) => { setPhotoMode(mode); setSelectedIdx(0); }}
              />
              
              {/* Strategy */}
              {intel && (
                <SectionCard
                  title="Strategy"
                  module="inventory"
                  icon={Brain}
                >
                  <div className="space-y-4">
                    {/* Opportunity Score — primary metric */}
                    {intel.opportunityScore != null && (
                      <div className="flex items-center justify-between p-3 rounded-xl border bg-white/[0.02]"
                        style={{
                          borderColor: intel.opportunityScore >= 80
                            ? "rgba(34,197,94,0.2)"
                            : intel.opportunityScore >= 70
                            ? "rgba(245,158,11,0.2)"
                            : "rgba(255,255,255,0.06)",
                        }}
                      >
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Opportunity Score</p>
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-3xl font-black leading-none",
                              intel.opportunityScore >= 80 ? "text-green-400"
                              : intel.opportunityScore >= 70 ? "text-amber-400"
                              : "text-white/40",
                            )}>
                              {intel.opportunityScore}
                            </span>
                            <span className={cn(
                              "text-[9px] font-black px-2 py-0.5 rounded border uppercase tracking-widest",
                              intel.opportunityScore >= 80
                                ? "bg-green-500/15 border-green-500/25 text-green-400"
                                : intel.opportunityScore >= 70
                                ? "bg-amber-500/15 border-amber-500/25 text-amber-400"
                                : "bg-white/[0.06] border-white/10 text-white/35",
                            )}>
                              {intel.opportunityScore >= 80 ? "HOT" : intel.opportunityScore >= 70 ? "WARM" : "WATCH"}
                            </span>
                          </div>
                        </div>
                        {intel.primarySegment && intel.primarySegment !== "General" && (
                          <div className="text-right">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">Buyer Segment</p>
                            <p className="text-sm font-bold text-white/70">{intel.primarySegment}</p>
                            <span className={cn(
                              "text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide",
                              intel.suggestedLanguage === "Spanish-first"
                                ? "bg-orange-500/15 text-orange-400 border-orange-500/25"
                                : intel.suggestedLanguage === "Bilingual"
                                ? "bg-teal-500/15 text-teal-400 border-teal-500/25"
                                : "bg-white/[0.05] text-white/30 border-white/10",
                            )}>
                              {intel.suggestedLanguage}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Ad Angle */}
                    {intel.adAngle && (
                      <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1">Suggested Ad Angle</p>
                        <p className="text-sm text-white/65 font-medium italic">"{intel.adAngle}"</p>
                      </div>
                    )}

                    {/* Confidence */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Strategy Confidence</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              intel.confidenceScore >= 80
                                ? "bg-success"
                                : intel.confidenceScore >= 60
                                  ? "bg-yellow-400"
                                  : "bg-muted-foreground",
                            )}
                            style={{ width: `${intel.confidenceScore}%` }}
                          />
                        </div>
                        <span
                          className={cn(
                            "font-medium text-xs",
                            intel.confidenceScore >= 80
                              ? "text-success"
                              : intel.confidenceScore >= 60
                                ? "text-yellow-400"
                                : "text-muted-foreground",
                          )}
                        >
                          {intel.confidenceScore}%
                        </span>
                      </div>
                    </div>

                    {/* Strategy rows */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Price Strategy</div>
                        <div className="text-sm font-medium text-white capitalize">
                          {intel.recommendedPriceStrategy.replace(/_/g, " ")}
                        </div>
                      </div>
                      {intel.recommendedDownPayment != null && (
                        <div className="p-3 rounded-lg bg-primary/5 border border-primary/15">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Rec. Down</div>
                          <div className="text-sm font-medium text-primary">
                            {formatCurrency(intel.recommendedDownPayment)}
                          </div>
                        </div>
                      )}
                      <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Photo Strategy</div>
                        <div className="text-sm font-medium text-white capitalize">
                          {intel.recommendedPhotoStrategy.replace(/_/g, " ")}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Post When</div>
                        <div className="text-sm font-medium text-white">
                          {intel.recommendedDayLabel} {intel.recommendedTimeLabel}
                        </div>
                      </div>
                    </div>

                    {/* Expected lead quality */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Expected Lead Quality</span>
                      <Badge
                        className={cn(
                          "text-xs",
                          intel.expectedLeadQuality === "hot"
                            ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                            : intel.expectedLeadQuality === "warm"
                              ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                              : "bg-white/5 text-muted-foreground border-white/10",
                        )}
                      >
                        {intel.expectedLeadQuality === "hot"
                          ? "🔥 Hot"
                          : intel.expectedLeadQuality === "warm"
                            ? "🌡 Warm"
                            : "❄ Cold"}
                      </Badge>
                    </div>

                    {/* Explanation */}
                    {intel.explanation && (
                      <div className="text-xs text-muted-foreground p-3 bg-white/[0.02] border border-white/[0.05] rounded-lg leading-relaxed">
                        {intel.explanation}
                      </div>
                    )}
                  </div>
                </SectionCard>
              )}

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
