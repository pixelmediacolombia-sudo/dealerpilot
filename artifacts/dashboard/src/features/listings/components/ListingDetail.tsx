import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/shared/layout/AppLayout";
import {
  useGetListingDetail,
  getGetListingDetailQueryKey,
  useGenerateListing,
  useQueueListingVersion,
  type ListingVersion,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatMileage, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  Gauge,
  Send,
  Car,
  History,
  Target,
  DollarSign,
  Megaphone,
  Globe,
  Flag,
  FileText,
  Activity,
  UploadCloud,
  MoreHorizontal,
} from "lucide-react";
import { PageHeader, SectionCard, StatusPulse } from "@/shared/ui";
import { PublishNowModal } from "@/features/publishing/components/PublishNowModal";

function ratingClass(rating: string | null | undefined) {
  switch (rating) {
    case "Excellent":
      return "bg-success/10 text-success border-success/20";
    case "Good":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "Needs Improvement":
      return "bg-warning/10 text-warning border-warning/20";
    default:
      return "bg-secondary text-muted-foreground border-border";
  }
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-secondary/30 p-3 rounded-lg border border-border/50">
      <div className="flex justify-between text-sm mb-2">
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className="font-bold text-foreground">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden shadow-inner">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-1000 ease-out",
            value >= 80 ? "bg-success" : value >= 60 ? "bg-blue-500" : "bg-warning"
          )}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

function VersionView({ version }: { version: ListingVersion }) {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="glass-panel p-4 rounded-xl border border-border/50 flex flex-col gap-2 col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-xs font-medium uppercase tracking-wider">Copy Angle</span>
          </div>
          {version.copyAngle ? (
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 w-fit text-xs font-bold capitalize">
              {version.copyAngle}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          )}
        </div>
        <div className="glass-panel p-4 rounded-xl border border-border/50 flex flex-col gap-2 col-span-2 md:col-span-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Target className="w-4 h-4 text-primary" />
            <span className="text-xs font-medium uppercase tracking-wider">Buyer Profile</span>
          </div>
          <div className="font-semibold text-sm leading-snug">{version.buyerProfile || "N/A"}</div>
        </div>
        <div className="glass-panel p-4 rounded-xl border border-border/50 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <DollarSign className="w-4 h-4 text-success" />
            <span className="text-xs font-medium uppercase tracking-wider">Down Payment</span>
          </div>
          <div className="font-semibold">{formatCurrency(version.downPayment)}</div>
        </div>
        <div className="glass-panel p-4 rounded-xl border border-border/50 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Flag className="w-4 h-4 text-warning" />
            <span className="text-xs font-medium uppercase tracking-wider">Priority</span>
          </div>
          <div className="font-semibold">{version.priority || "N/A"}</div>
        </div>
      </div>

      <SectionCard title="Generated Content" icon={<FileText className="w-5 h-5 text-primary" />}>
        <div className="space-y-6 p-2">
          <div className="space-y-3">
            <div className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              <span>Title</span>
              <Badge variant="outline" className={cn(
                "bg-secondary/50",
                version.title.length > 80 ? "text-warning border-warning/30" : "text-success border-success/30"
              )}>
                {version.title.length} / 100 chars
              </Badge>
            </div>
            <div className="text-xl font-bold bg-secondary/20 p-4 rounded-lg border border-border/50">
              {version.title}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="text-sm font-medium text-muted-foreground">English Description</div>
              <div className="bg-secondary/20 p-4 rounded-lg border border-border/50 h-full">
                <p className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed font-medium">
                  {version.descriptionEn || "N/A"}
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="text-sm font-medium text-muted-foreground">Descripción en Español</div>
              <div className="bg-secondary/20 p-4 rounded-lg border border-border/50 h-full">
                <p className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed font-medium">
                  {version.descriptionEs || "N/A"}
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border/50">
            <div className="flex items-start gap-4 bg-primary/5 p-4 rounded-lg border border-primary/20">
              <div className="mt-1 bg-primary/20 p-2 rounded-full">
                <Megaphone className="w-4 h-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-medium text-primary mb-1">Call to Action</div>
                <p className="text-sm font-medium">{version.callToAction || "N/A"}</p>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      {version.score && (
        <SectionCard 
          title="Listing Performance Score" 
          icon={<Activity className="w-5 h-5 text-primary" />}
          action={
            <Badge variant="outline" className={cn("px-3 py-1 font-bold text-sm", ratingClass(version.score.rating))}>
              {version.score.overall} / 100 · {version.score.rating}
            </Badge>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-2">
            <ScoreBar label="Title Quality" value={version.score.titleQuality} />
            <ScoreBar label="Description Quality" value={version.score.descriptionQuality} />
            <ScoreBar label="Price Strategy" value={version.score.priceStrategy} />
            <ScoreBar label="Down Payment Strategy" value={version.score.downPaymentStrategy} />
            <ScoreBar label="Photos & Visuals" value={version.score.photoScore} />
          </div>
        </SectionCard>
      )}
    </div>
  );
}

export function ListingDetail() {
  const params = useParams();
  const id = Number(params.id);
  const queryClient = useQueryClient();
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null);
  const [publishNowOpen, setPublishNowOpen] = useState(false);

  const { data, isLoading } = useGetListingDetail(id, {
    query: { queryKey: getGetListingDetailQueryKey(id), enabled: !Number.isNaN(id) },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetListingDetailQueryKey(id) });

  const generate = useGenerateListing({
    mutation: {
      onSuccess: (v) => {
        setActiveVersionId(v.id);
        invalidate();
        toast({ title: "Listing generated", description: `Version ${v.version} created successfully.` });
      },
      onError: (err) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
    },
  });

  const queue = useQueueListingVersion({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Queued for publishing", description: "The listing was added to the publishing queue." });
      },
      onError: (err) => toast({ title: "Queue failed", description: err.message, variant: "destructive" }),
    },
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center bg-background/50">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 border-4 border-secondary rounded-full" />
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin absolute inset-0" />
            </div>
            <p className="text-muted-foreground font-medium animate-pulse">Loading workspace...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!data) {
    return (
      <AppLayout>
        <div className="flex-1 flex flex-col items-center justify-center bg-background/50 h-full p-8">
          <div className="glass-panel p-12 rounded-2xl flex flex-col items-center text-center max-w-md">
            <FileText className="w-16 h-16 text-muted-foreground/50 mb-6" />
            <h2 className="text-2xl font-bold tracking-tight mb-2">Workspace Not Found</h2>
            <p className="text-muted-foreground mb-8">This listing workspace doesn't exist or you don't have access.</p>
            <Link href="/listings">
              <Button className="premium-gradient-btn px-8">Back to Marketplace AI</Button>
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  const { vehicle, images, versions } = data;
  const sortedVersions = [...versions].sort((a, b) => b.version - a.version);
  const selectedVersion =
    sortedVersions.find((v) => v.id === activeVersionId) ??
    data.currentVersion ??
    sortedVersions[0] ??
    null;
  const primaryImage = images?.[0]?.url ?? null;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-8 max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500">
          
          <div>
            <Link href="/listings" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary transition-colors font-medium mb-6">
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Marketplace AI
            </Link>

            {/* Header Card */}
            <div className="glass-panel rounded-2xl overflow-hidden border border-border/50">
              <div className="flex flex-col md:flex-row">
                <div className="w-full md:w-80 aspect-[4/3] md:aspect-auto bg-secondary relative overflow-hidden shrink-0">
                  {primaryImage ? (
                    <img 
                      src={primaryImage} 
                      alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`} 
                      className="w-full h-full object-cover" 
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-secondary to-background">
                      <Car className="w-16 h-16 text-muted-foreground/20" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent md:bg-gradient-to-r" />
                  <div className="absolute bottom-4 left-4 right-4 md:hidden">
                    <Badge variant="outline" className="bg-black/40 backdrop-blur-md text-white border-white/20 mb-2">
                      <StatusPulse color="blue" className="mr-2" />
                      {vehicle.status}
                    </Badge>
                  </div>
                </div>
                
                <div className="p-6 md:p-8 flex-1 flex flex-col justify-center bg-card/40">
                  <div className="hidden md:flex mb-3">
                    <Badge variant="outline" className="bg-secondary/50 text-foreground border-border">
                      <StatusPulse color={vehicle.status === 'Active' ? 'blue' : 'primary'} className="mr-2" />
                      {vehicle.status}
                    </Badge>
                  </div>
                  
                  <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </h1>
                  
                  <div className="flex items-center gap-3 text-muted-foreground font-medium mb-6">
                    <span className="text-foreground">{vehicle.trim || "Base"}</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-border" />
                    <span>{vehicle.bodyStyle || "Vehicle"}</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-border" />
                    <span className="font-mono text-sm">VIN: {vehicle.vin}</span>
                  </div>
                  
                  <div className="grid grid-cols-2 md:flex md:flex-wrap gap-4 md:gap-8 mb-8">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Asking Price</div>
                      <div className="text-2xl font-bold text-primary">{formatCurrency(vehicle.price)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Mileage</div>
                      <div className="text-xl font-semibold">{formatMileage(vehicle.mileage)}</div>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-3 mt-auto items-center">
                    <Button
                      onClick={() => setPublishNowOpen(true)}
                      className="gap-2 px-6 premium-gradient-btn"
                    >
                      <UploadCloud className="w-4 h-4" />
                      Publish Now
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="gap-2 px-4 border-border/60">
                          <MoreHorizontal className="w-4 h-4" />
                          More
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem
                          onClick={() => generate.mutate({ id: vehicle.id })}
                          disabled={generate.isPending}
                          className="gap-2 cursor-pointer"
                        >
                          {generate.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4 text-primary" />
                          )}
                          {versions.length === 0 ? "Generate AI Listing" : "Regenerate Listing"}
                        </DropdownMenuItem>
                        {selectedVersion && (
                          <DropdownMenuItem
                            onClick={() => queue.mutate({ id: selectedVersion.id, data: { priority: 5 } })}
                            disabled={queue.isPending}
                            className="gap-2 cursor-pointer"
                          >
                            {queue.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4 text-success" />
                            )}
                            Queue for Publishing
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Versions Area */}
          {sortedVersions.length === 0 ? (
            <div className="glass-panel border-border/50 rounded-2xl p-12 text-center max-w-2xl mx-auto mt-12 animate-in fade-in duration-700 delay-200 fill-mode-both">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-2xl font-bold mb-3">No listing generated yet</h3>
              <p className="text-muted-foreground font-medium mb-8 leading-relaxed">
                Generate an AI-optimized, bilingual Marketplace listing grounded entirely in this vehicle's 
                inventory data, market comparables, and your dealership's DNA.
              </p>
              <Button 
                onClick={() => generate.mutate({ id: vehicle.id })} 
                disabled={generate.isPending} 
                className="premium-gradient-btn px-8 py-6 text-lg"
              >
                {generate.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Generating Magic...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 mr-2" />
                    Generate First Listing
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <History className="w-5 h-5 text-primary" />
                  Listing Versions
                </h3>
                <p className="text-sm text-muted-foreground font-medium hidden sm:block">
                  Latest generations never overwrite previous work
                </p>
              </div>
              
              <Tabs
                value={String(selectedVersion?.id)}
                onValueChange={(v) => setActiveVersionId(Number(v))}
                className="w-full"
              >
                <div className="overflow-x-auto pb-2 -mx-2 px-2 scrollbar-none">
                  <TabsList className="bg-secondary/50 border border-border/50 p-1 inline-flex h-auto w-auto min-w-full sm:min-w-0">
                    {sortedVersions.map((v) => (
                      <TabsTrigger 
                        key={v.id} 
                        value={String(v.id)} 
                        className="gap-2 px-4 py-2 rounded-md data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all whitespace-nowrap"
                      >
                        <span className="font-semibold">v{v.version}</span>
                        {v.isCurrent && (
                          <Badge variant="secondary" className="bg-primary/10 text-primary border-0 text-[10px] px-1.5 py-0 uppercase tracking-wider font-bold">
                            Active
                          </Badge>
                        )}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                
                <div className="mt-6 bg-card border border-border/40 rounded-2xl p-6 md:p-8 shadow-sm">
                  {sortedVersions.map((v) => (
                    <TabsContent key={v.id} value={String(v.id)} className="m-0 focus-visible:outline-none focus-visible:ring-0">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-border/50">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="font-bold text-primary">v{v.version}</span>
                          </div>
                          <div>
                            <div className="font-bold text-lg">Listing Version {v.version}</div>
                            <div className="text-sm text-muted-foreground font-medium">
                              Generated by {v.generatedBy} • {formatDate(v.createdAt)}
                            </div>
                          </div>
                        </div>
                        
                        {v.id === selectedVersion?.id && (
                          <Button
                            variant="outline"
                            className="gap-2 border-success/30 text-success hover:bg-success hover:text-success-foreground self-start sm:self-auto"
                            onClick={() => queue.mutate({ id: v.id, data: { priority: 5 } })}
                            disabled={queue.isPending}
                          >
                            {queue.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            Publish This Version
                          </Button>
                        )}
                      </div>
                      <VersionView version={v} />
                    </TabsContent>
                  ))}
                </div>
              </Tabs>
            </div>
          )}
        </div>
      </div>

      <PublishNowModal
        vehicleId={publishNowOpen ? vehicle.id : null}
        vehicleLabel={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
        onClose={() => { setPublishNowOpen(false); invalidate(); }}
      />
    </AppLayout>
  );
}
