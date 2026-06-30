import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetCreativeVehicleDetail,
  getGetCreativeVehicleDetailQueryKey,
  useGenerateCreative,
  useApproveCreativeVersion,
  useSetDefaultCreativeVersion,
  useListCreativeTemplates,
  type CreativeVersion,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatMileage, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CreativePreviewCard } from "@/components/CreativePreview";
import { PhotoEnhancerPanel } from "./PhotoEnhancerPanel";
import {
  ArrowLeft,
  Wand2,
  Loader2,
  Gauge,
  Car,
  History,
  CheckCircle2,
  Star,
  ImageIcon,
  LayoutTemplate,
  Sparkles,
  Camera,
  Megaphone,
} from "lucide-react";
import { SectionCard, EmptyState, StatusPulse } from "@/components/shared";

function ratingClass(rating: string | null | undefined) {
  switch (rating) {
    case "Excellent":
      return "bg-green-500/10 text-green-500 border-green-500/20";
    case "Good":
      return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    case "Needs Improvement":
      return "bg-amber-500/10 text-amber-500 border-amber-500/20";
    default:
      return "bg-secondary text-muted-foreground border-border";
  }
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest mb-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-1000",
            value >= 80 ? "bg-green-500" : value >= 60 ? "bg-blue-500" : "bg-amber-500",
          )}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

function AdCreativeView({
  version,
  onApprove,
  onSetDefault,
  approving,
  settingDefault,
}: {
  version: CreativeVersion;
  onApprove: () => void;
  onSetDefault: () => void;
  approving: boolean;
  settingDefault: boolean;
}) {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center gap-6 p-5 rounded-2xl glass-panel border border-white/5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className="bg-secondary/50 text-muted-foreground uppercase text-[10px] tracking-widest px-3 py-1">
            {version.templateKey}
          </Badge>
          <Badge variant="outline" className="bg-secondary/50 text-muted-foreground uppercase text-[10px] tracking-widest px-3 py-1">
            {version.brandStyle}
          </Badge>
          <Badge variant="outline" className="bg-secondary/50 text-muted-foreground uppercase text-[10px] tracking-widest px-3 py-1">
            {version.backgroundStyle}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "uppercase text-[10px] tracking-widest px-3 py-1",
              version.status === "Approved"
                ? "bg-green-500/10 text-green-500 border-green-500/20"
                : "bg-secondary/50 text-muted-foreground",
            )}
          >
            {version.status}
          </Badge>
          {version.isDefault && (
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 uppercase text-[10px] tracking-widest px-3 py-1">
              <Star className="w-3.5 h-3.5 mr-1.5 fill-primary" /> Default
            </Badge>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="gap-2 border-border/50 hover:bg-secondary h-10 px-5 text-xs font-bold uppercase tracking-widest"
            onClick={onSetDefault}
            disabled={settingDefault || version.isDefault}
          >
            {settingDefault ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
            {version.isDefault ? "Default Version" : "Set as Default"}
          </Button>
          <Button
            className={cn(
              "gap-2 h-10 px-6 text-xs font-bold uppercase tracking-widest transition-all",
              version.status === "Approved" ? "bg-green-500/10 text-green-500 hover:bg-green-500/20 border border-green-500/20" : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
            onClick={onApprove}
            disabled={approving || version.status === "Approved"}
            variant={version.status === "Approved" ? "outline" : "default"}
          >
            {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {version.status === "Approved" ? "Approved" : "Approve Creative"}
          </Button>
        </div>
      </div>

      {/* Ad Creative previews — promotional layouts with brand overlays */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        <div className="animate-in slide-in-from-bottom-4" style={{ animationDelay: "100ms" }}>
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 pl-2">Cover Ad · 1080×1080</div>
          <CreativePreviewCard spec={version.renderSpec} format="cover" />
        </div>
        <div className="animate-in slide-in-from-bottom-4" style={{ animationDelay: "200ms" }}>
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 pl-2">Story Ad · 1080×1920</div>
          <CreativePreviewCard spec={version.renderSpec} format="story" />
        </div>
        <div className="animate-in slide-in-from-bottom-4" style={{ animationDelay: "300ms" }}>
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 pl-2">Feed Ad · 1200×1200</div>
          <CreativePreviewCard spec={version.renderSpec} format="feed" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-4">
        <SectionCard title="Export Outputs" icon={ImageIcon} className="border-white/5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {version.outputs.map((o) => (
              <div key={o.format} className="rounded-xl border border-white/5 bg-secondary/30 p-5 hover:bg-secondary/50 transition-colors group cursor-pointer">
                <div className="font-bold tracking-tight text-foreground/90 group-hover:text-primary transition-colors">{o.label}</div>
                <div className="text-[10px] font-bold text-muted-foreground/60 mt-2 uppercase tracking-widest">
                  {o.format} · {o.width}×{o.height}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {version.score && (
          <SectionCard
            title="AI Creative Score"
            icon={Gauge}
            className="border-white/5"
            action={
              <Badge variant="outline" className={cn("ml-2 font-bold px-3 py-1.5 uppercase text-[10px] tracking-widest", ratingClass(version.score.rating))}>
                {version.score.overall} SCORE
              </Badge>
            }
          >
            <div className="space-y-6">
              <ScoreBar label="Brand Consistency" value={version.score.brandConsistency} />
              <ScoreBar label="Vehicle Visibility" value={version.score.vehicleVisibility} />
              <ScoreBar label="Lighting" value={version.score.lighting} />
              <ScoreBar label="Composition" value={version.score.composition} />
              <ScoreBar label="CTR Prediction" value={version.score.ctrPrediction} />
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}

export function CreativeDetail() {
  const params = useParams();
  const id = Number(params.id);
  const queryClient = useQueryClient();
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null);
  const [templateKey, setTemplateKey] = useState<string>("");
  const [studioMode, setStudioMode] = useState<"enhancer" | "ad-creative">("enhancer");

  const { data, isLoading } = useGetCreativeVehicleDetail(id, {
    query: {
      queryKey: getGetCreativeVehicleDetailQueryKey(id),
      enabled: !Number.isNaN(id),
      refetchInterval: 4000,
    },
  });

  const { data: templatesData } = useListCreativeTemplates();
  const templates = templatesData?.templates ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetCreativeVehicleDetailQueryKey(id) });

  const generate = useGenerateCreative({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({
          title: "DealerPilot started generation",
          description: "A new AI ad creative is being generated in the background.",
        });
      },
      onError: (err) =>
        toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
    },
  });

  const approve = useApproveCreativeVersion({
    mutation: {
      onSuccess: (v) => {
        invalidate();
        toast({ title: "Creative approved", description: `DealerPilot marked Version ${v.version} as approved.` });
      },
      onError: (err) =>
        toast({ title: "Approve failed", description: err.message, variant: "destructive" }),
    },
  });

  const setDefault = useSetDefaultCreativeVersion({
    mutation: {
      onSuccess: (v) => {
        invalidate();
        toast({ title: "Default updated", description: `DealerPilot set Version ${v.version} as the default.` });
      },
      onError: (err) =>
        toast({ title: "Update failed", description: err.message, variant: "destructive" }),
    },
  });

  const sortedVersions = useMemo(
    () => [...(data?.versions ?? [])].sort((a, b) => b.version - a.version),
    [data?.versions],
  );

  const activeJobs = (data?.jobs ?? []).filter(
    (j) => j.status === "Queued" || j.status === "Generating",
  );

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">DealerPilot is loading...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!data) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center p-8">
          <EmptyState
            icon={Car}
            title="Vehicle not found"
            description="DealerPilot could not locate this vehicle."
            action={<Link href="/creative-studio"><Button>Back to Creative Studio</Button></Link>}
          />
        </div>
      </AppLayout>
    );
  }

  const { vehicle, images } = data;
  const selectedVersion =
    sortedVersions.find((v) => v.id === activeVersionId) ??
    data.defaultVersion ??
    sortedVersions[0] ??
    null;
  const primaryImage = images?.[0]?.url ?? vehicle.primaryImageUrl ?? null;
  const effectiveTemplateKey = templateKey || templates[0]?.key || "";

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
          <Link href="/creative-studio">
            <Button variant="ghost" size="sm" className="gap-2 -ml-4 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-full px-4 text-[10px] uppercase font-bold tracking-widest">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Creative AI
            </Button>
          </Link>

          {/* Header */}
          <div className="glass-panel p-8 rounded-3xl flex flex-col md:flex-row gap-10 border border-white/5 shadow-2xl shadow-black/20 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -z-10 pointer-events-none" />

            <div className="w-full md:w-80 aspect-[4/3] bg-muted/30 rounded-2xl overflow-hidden shrink-0 relative group shadow-inner">
              {primaryImage ? (
                <>
                  <img
                    src={primaryImage}
                    alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  {(images?.length ?? 0) > 1 && (
                    <div className="absolute bottom-3 right-3 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-lg backdrop-blur-sm flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" />
                      {images!.length} photos
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Car className="w-12 h-12 text-muted-foreground/30" />
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col z-10">
              <div className="text-primary text-[10px] font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" /> Creative AI Subject
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground/90">
                {vehicle.year} {vehicle.make} <span className="text-primary">{vehicle.model}</span>
              </h1>
              <p className="text-muted-foreground mt-3 text-lg font-medium">
                {vehicle.trim || "Base"} • {vehicle.bodyStyle || "Vehicle"}
              </p>

              <div className="flex flex-wrap gap-x-12 gap-y-6 mt-8">
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-1.5">Price</p>
                  <p className="text-2xl font-bold text-foreground/90">{formatCurrency(vehicle.price)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-1.5">Mileage</p>
                  <p className="text-2xl font-semibold text-foreground/80">{formatMileage(vehicle.mileage)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-1.5">VIN</p>
                  <p className="text-2xl font-semibold text-foreground/80">{vehicle.vin.slice(-8)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-1.5">Photos</p>
                  <p className="text-2xl font-semibold text-foreground/80">{images?.length ?? 0}</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Mode toggle ── */}
          <div className="flex items-center gap-2 p-1 rounded-xl bg-card/60 border border-white/5 w-fit">
            <button
              onClick={() => setStudioMode("enhancer")}
              className={cn(
                "flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all duration-200",
                studioMode === "enhancer"
                  ? "bg-success/20 text-success shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Camera className="w-4 h-4" />
              Marketplace Photo Enhancer
            </button>
            <button
              onClick={() => setStudioMode("ad-creative")}
              className={cn(
                "flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all duration-200",
                studioMode === "ad-creative"
                  ? "bg-primary/20 text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Megaphone className="w-4 h-4" />
              Ad Creative Generator
            </button>
          </div>

          {/* ── Marketplace Photo Enhancer ── */}
          {studioMode === "enhancer" && (
            <PhotoEnhancerPanel
              images={images ?? []}
              vehicleName={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            />
          )}

          {/* ── Ad Creative Generator ── */}
          {studioMode === "ad-creative" && (
            <div className="space-y-8">
              {/* Generate controls */}
              <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl bg-card/40 border border-white/5">
                <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  <Megaphone className="w-3.5 h-3.5" />
                  Promotional Ad Creative
                </div>
                <div className="flex-1" />
                <Select value={effectiveTemplateKey} onValueChange={setTemplateKey}>
                  <SelectTrigger className="w-[200px] h-10 bg-secondary/50 border-white/10 rounded-xl text-sm font-medium">
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() =>
                    generate.mutate({
                      id: vehicle.id,
                      data: effectiveTemplateKey ? { templateKey: effectiveTemplateKey } : {},
                    })
                  }
                  disabled={generate.isPending || activeJobs.length > 0}
                  className="gap-2 h-10 px-6 rounded-xl font-bold text-[11px] uppercase tracking-widest premium-gradient-btn"
                >
                  {generate.isPending || activeJobs.length > 0 ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Wand2 className="w-4 h-4" />
                  )}
                  {activeJobs.length > 0
                    ? "Generating..."
                    : sortedVersions.length === 0
                      ? "Generate Ad Creative"
                      : "New Variation"}
                </Button>
              </div>

              {/* Active job progress */}
              {activeJobs.length > 0 && (
                <div className="space-y-4">
                  {activeJobs.map((job) => (
                    <div key={job.id} className="glass-panel p-6 rounded-2xl border border-primary/20 bg-primary/5 relative overflow-hidden">
                      <div className="absolute inset-0 bg-primary/5 animate-pulse pointer-events-none" />
                      <div className="relative z-10 flex items-center justify-between mb-4">
                        <span className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 text-primary">
                          <StatusPulse color="blue" />
                          {job.status === "Generating" && job.step ? job.step : "DealerPilot is queuing your job..."}
                        </span>
                        <span className="text-[10px] font-bold text-primary uppercase tracking-widest">{job.progress}% Complete</span>
                      </div>
                      <div className="h-2 rounded-full bg-secondary/50 overflow-hidden relative z-10">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500 relative"
                          style={{ width: `${job.progress}%` }}
                        >
                          <div className="absolute inset-0 bg-white/20 animate-pulse" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Version history */}
              {sortedVersions.length === 0 ? (
                <EmptyState
                  icon={LayoutTemplate}
                  title="No ad creatives generated yet"
                  description="Generate a promotional ad creative with your Brand DNA — includes price, CTA, and dealer branding. Keep this separate from Marketplace listing photos."
                />
              ) : (
                <div className="space-y-8">
                  <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-2">
                    <History className="w-3.5 h-3.5" />
                    Version History
                  </div>

                  <Tabs
                    value={String(selectedVersion?.id)}
                    onValueChange={(v) => setActiveVersionId(Number(v))}
                    className="w-full"
                  >
                    <TabsList className="flex-wrap h-auto bg-card/40 p-1.5 border border-white/5 rounded-xl">
                      {sortedVersions.map((v) => (
                        <TabsTrigger
                          key={v.id}
                          value={String(v.id)}
                          className="gap-2 px-5 py-2.5 rounded-lg data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-bold text-xs transition-all"
                        >
                          v{v.version}
                          {v.isDefault && (
                            <Star className="w-3.5 h-3.5 fill-primary text-primary" />
                          )}
                        </TabsTrigger>
                      ))}
                    </TabsList>

                    {sortedVersions.map((v) => (
                      <TabsContent key={v.id} value={String(v.id)} className="mt-8 outline-none">
                        <div className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-6 flex items-center gap-3 pl-2">
                          <span className="text-primary">{v.templateKey}</span>
                          <span className="w-1 h-1 rounded-full bg-white/20" />
                          <span>Generated {formatDate(v.createdAt)}</span>
                        </div>
                        <AdCreativeView
                          version={v}
                          onApprove={() => approve.mutate({ id: v.id })}
                          onSetDefault={() => setDefault.mutate({ id: v.id })}
                          approving={approve.isPending}
                          settingDefault={setDefault.isPending}
                        />
                      </TabsContent>
                    ))}
                  </Tabs>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
