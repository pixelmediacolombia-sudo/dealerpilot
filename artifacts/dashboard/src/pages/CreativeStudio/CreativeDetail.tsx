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
  LayoutTemplate
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
      <div className="flex justify-between text-xs font-medium uppercase tracking-wider mb-2">
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

function VersionView({
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
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl glass-panel">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="bg-secondary/50 text-muted-foreground uppercase text-[10px] tracking-wider">
            {version.templateKey}
          </Badge>
          <Badge variant="outline" className="bg-secondary/50 text-muted-foreground uppercase text-[10px] tracking-wider">
            {version.brandStyle}
          </Badge>
          <Badge variant="outline" className="bg-secondary/50 text-muted-foreground uppercase text-[10px] tracking-wider">
            {version.backgroundStyle}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "uppercase text-[10px] tracking-wider",
              version.status === "Approved"
                ? "bg-green-500/10 text-green-500 border-green-500/20"
                : "bg-secondary/50 text-muted-foreground",
            )}
          >
            {version.status}
          </Badge>
          {version.isDefault && (
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 uppercase text-[10px] tracking-wider">
              <Star className="w-3 h-3 mr-1 fill-primary" /> Default
            </Badge>
          )}
        </div>
        
        <div className="flex-1" />
        
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-border/50 hover:bg-secondary"
            onClick={onSetDefault}
            disabled={settingDefault || version.isDefault}
          >
            {settingDefault ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
            {version.isDefault ? "Default" : "Set as Default"}
          </Button>
          <Button
            size="sm"
            className={cn(
              "gap-2", 
              version.status === "Approved" ? "bg-green-500/10 text-green-500 hover:bg-green-500/20 hover:text-green-500 border border-green-500/20" : ""
            )}
            onClick={onApprove}
            disabled={approving || version.status === "Approved"}
            variant={version.status === "Approved" ? "outline" : "default"}
          >
            {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {version.status === "Approved" ? "Approved" : "Approve"}
          </Button>
        </div>
      </div>

      {/* Creative previews */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="animate-in slide-in-from-bottom-4" style={{ animationDelay: "100ms" }}>
          <CreativePreviewCard spec={version.renderSpec} format="cover" />
        </div>
        <div className="animate-in slide-in-from-bottom-4" style={{ animationDelay: "200ms" }}>
          <CreativePreviewCard spec={version.renderSpec} format="story" />
        </div>
        <div className="animate-in slide-in-from-bottom-4" style={{ animationDelay: "300ms" }}>
          <CreativePreviewCard spec={version.renderSpec} format="feed" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Export outputs */}
        <SectionCard title="Export Outputs" icon={ImageIcon}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {version.outputs.map((o) => (
              <div key={o.format} className="rounded-lg border border-border/50 bg-secondary/30 p-4 hover:bg-secondary/50 transition-colors">
                <div className="font-semibold tracking-tight">{o.label}</div>
                <div className="text-xs font-medium text-muted-foreground/80 mt-1 uppercase tracking-wider">
                  {o.format} · {o.width}×{o.height}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Score */}
        {version.score && (
          <SectionCard 
            title="Creative Score" 
            icon={Gauge}
            action={
              <Badge variant="outline" className={cn("ml-2 font-bold px-3 py-1", ratingClass(version.score.rating))}>
                {version.score.overall} · {version.score.rating}
              </Badge>
            }
          >
            <div className="space-y-5">
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
          title: "Generation started",
          description: "A new creative is being generated in the background.",
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
        toast({ title: "Creative approved", description: `Version ${v.version} approved.` });
      },
      onError: (err) =>
        toast({ title: "Approve failed", description: err.message, variant: "destructive" }),
    },
  });

  const setDefault = useSetDefaultCreativeVersion({
    mutation: {
      onSuccess: (v) => {
        invalidate();
        toast({ title: "Default updated", description: `Version ${v.version} is now the default.` });
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
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
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
            description="The requested vehicle could not be found or has been removed."
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
            <Button variant="ghost" size="sm" className="gap-2 -ml-3 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" /> Back to Studio
            </Button>
          </Link>

          {/* Header */}
          <div className="glass-panel p-6 rounded-2xl flex flex-col md:flex-row gap-8">
            <div className="w-full md:w-72 aspect-[4/3] bg-muted/30 rounded-xl overflow-hidden shrink-0 relative group">
              {primaryImage ? (
                <>
                  <img
                    src={primaryImage}
                    alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Car className="w-12 h-12 text-muted-foreground/30" />
                </div>
              )}
            </div>
            
            <div className="flex-1 flex flex-col">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground/90">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h1>
              <p className="text-muted-foreground mt-2 text-lg">
                {vehicle.trim || "Base"} • {vehicle.bodyStyle || "Vehicle"}
              </p>
              
              <div className="flex flex-wrap gap-x-8 gap-y-4 mt-6">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Price</p>
                  <p className="text-xl font-bold text-primary">{formatCurrency(vehicle.price)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">Mileage</p>
                  <p className="text-xl font-semibold text-foreground/80">{formatMileage(vehicle.mileage)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">VIN</p>
                  <p className="text-xl font-semibold text-foreground/80">{vehicle.vin.slice(-8)}</p>
                </div>
              </div>
              
              <div className="mt-auto pt-8 flex flex-wrap items-center gap-3">
                <Select value={effectiveTemplateKey} onValueChange={setTemplateKey}>
                  <SelectTrigger className="w-[220px] bg-secondary/50 border-border/50">
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
                  className="gap-2 premium-gradient-btn"
                >
                  {generate.isPending || activeJobs.length > 0 ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Wand2 className="w-4 h-4" />
                  )}
                  {activeJobs.length > 0
                    ? "Generating..."
                    : sortedVersions.length === 0
                      ? "Generate Creative"
                      : "Generate Again"}
                </Button>
              </div>
            </div>
          </div>

          {/* Active job progress */}
          {activeJobs.length > 0 && (
            <div className="space-y-3">
              {activeJobs.map((job) => (
                <div key={job.id} className="glass-panel p-4 rounded-xl border border-primary/20 bg-primary/5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium flex items-center gap-2 text-primary">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {job.status === "Generating" && job.step ? job.step : "Queued"}
                    </span>
                    <span className="text-sm font-bold text-primary">{job.progress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
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

          {/* Versions */}
          {sortedVersions.length === 0 ? (
            <EmptyState
              icon={LayoutTemplate}
              title="No creative generated yet"
              description="Pick a template and generate an on-brand Marketplace creative built from your Dealer Brand DNA and this vehicle's photos."
            />
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
                <History className="w-4 h-4" />
                Version History
              </div>
              
              <Tabs
                value={String(selectedVersion?.id)}
                onValueChange={(v) => setActiveVersionId(Number(v))}
                className="w-full"
              >
                <TabsList className="flex-wrap h-auto bg-card/60 p-1 border border-border/50">
                  {sortedVersions.map((v) => (
                    <TabsTrigger 
                      key={v.id} 
                      value={String(v.id)} 
                      className="gap-2 px-4 py-2 data-[state=active]:bg-secondary data-[state=active]:text-foreground"
                    >
                      v{v.version}
                      {v.isDefault && (
                        <Star className="w-3 h-3 fill-primary text-primary" />
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
                
                {sortedVersions.map((v) => (
                  <TabsContent key={v.id} value={String(v.id)} className="mt-8 outline-none">
                    <div className="text-xs font-medium text-muted-foreground/60 uppercase tracking-widest mb-6 flex items-center gap-2">
                      <span className="text-foreground/80">{v.templateKey}</span> 
                      <span>•</span> 
                      <span>{formatDate(v.createdAt)}</span>
                    </div>
                    <VersionView
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
      </div>
    </AppLayout>
  );
}
