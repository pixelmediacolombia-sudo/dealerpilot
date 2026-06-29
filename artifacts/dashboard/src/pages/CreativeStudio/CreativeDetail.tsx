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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";

function ratingClass(rating: string | null | undefined) {
  switch (rating) {
    case "Excellent":
      return "bg-green-500/10 text-green-500";
    case "Good":
      return "bg-blue-500/10 text-blue-500";
    case "Needs Improvement":
      return "bg-amber-500/10 text-amber-500";
    default:
      return "bg-secondary text-muted-foreground";
  }
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full",
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary" className="bg-secondary text-muted-foreground">
          {version.templateKey}
        </Badge>
        <Badge variant="secondary" className="bg-secondary text-muted-foreground">
          {version.brandStyle}
        </Badge>
        <Badge variant="secondary" className="bg-secondary text-muted-foreground">
          {version.backgroundStyle}
        </Badge>
        <Badge
          variant="secondary"
          className={cn(
            version.status === "Approved"
              ? "bg-green-500/10 text-green-500"
              : "bg-secondary text-muted-foreground",
          )}
        >
          {version.status}
        </Badge>
        {version.isDefault && (
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            <Star className="w-3 h-3 mr-1" /> Default
          </Badge>
        )}
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={onSetDefault}
          disabled={settingDefault || version.isDefault}
        >
          {settingDefault ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
          {version.isDefault ? "Default" : "Set as Default"}
        </Button>
        <Button
          size="sm"
          className="gap-2"
          onClick={onApprove}
          disabled={approving || version.status === "Approved"}
        >
          {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {version.status === "Approved" ? "Approved" : "Approve"}
        </Button>
      </div>

      {/* Creative previews */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <CreativePreviewCard spec={version.renderSpec} format="cover" />
        <CreativePreviewCard spec={version.renderSpec} format="story" />
        <CreativePreviewCard spec={version.renderSpec} format="feed" />
      </div>

      {/* Export outputs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ImageIcon className="w-4 h-4" /> Export Outputs
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {version.outputs.map((o) => (
            <div key={o.format} className="rounded-lg border border-border bg-card/50 p-3">
              <div className="font-medium text-sm">{o.label}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {o.format} · {o.width}×{o.height}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Score */}
      {version.score && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="w-4 h-4" /> Creative Score
              <Badge variant="secondary" className={cn("ml-2", ratingClass(version.score.rating))}>
                {version.score.overall} · {version.score.rating}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ScoreBar label="Brand Consistency" value={version.score.brandConsistency} />
            <ScoreBar label="Vehicle Visibility" value={version.score.vehicleVisibility} />
            <ScoreBar label="Lighting" value={version.score.lighting} />
            <ScoreBar label="Composition" value={version.score.composition} />
            <ScoreBar label="CTR Prediction" value={version.score.ctrPrediction} />
          </CardContent>
        </Card>
      )}
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
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!data) {
    return (
      <AppLayout>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground">Vehicle not found.</p>
          <Link href="/creative-studio">
            <Button variant="outline">Back to Creative Studio</Button>
          </Link>
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
        <div className="p-8 max-w-6xl mx-auto space-y-6">
          <Link href="/creative-studio">
            <Button variant="ghost" size="sm" className="gap-2 -ml-2">
              <ArrowLeft className="w-4 h-4" /> Back to Creative Studio
            </Button>
          </Link>

          {/* Header */}
          <div className="flex flex-col md:flex-row gap-6">
            <div className="w-full md:w-64 aspect-[4/3] bg-secondary rounded-lg overflow-hidden shrink-0">
              {primaryImage ? (
                <img
                  src={primaryImage}
                  alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Car className="w-12 h-12 text-muted-foreground/30" />
                </div>
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold tracking-tight">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h1>
              <p className="text-muted-foreground mt-1">
                {vehicle.trim || "Base"} • {vehicle.bodyStyle || "Vehicle"} • VIN {vehicle.vin}
              </p>
              <div className="flex flex-wrap gap-4 mt-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Price: </span>
                  <span className="font-semibold text-primary">{formatCurrency(vehicle.price)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Mileage: </span>
                  <span className="font-medium">{formatMileage(vehicle.mileage)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Photos: </span>
                  <span className="font-medium">{vehicle.imageCount}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-6">
                <Select value={effectiveTemplateKey} onValueChange={setTemplateKey}>
                  <SelectTrigger className="w-[220px]">
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
                  className="gap-2"
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
          {activeJobs.map((job) => (
            <Card key={job.id} className="border-blue-500/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    {job.status === "Generating" && job.step ? job.step : "Queued"}
                  </span>
                  <span className="text-sm text-muted-foreground">{job.progress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Versions */}
          {sortedVersions.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Wand2 className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
                <h3 className="text-lg font-medium">No creative generated yet</h3>
                <p className="text-muted-foreground mt-1 max-w-md mx-auto">
                  Pick a template and generate an on-brand Marketplace creative built from your
                  Dealer Brand DNA and this vehicle's photos.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <History className="w-4 h-4" />
                Version history (new creatives never overwrite earlier ones)
              </div>
              <Tabs
                value={String(selectedVersion?.id)}
                onValueChange={(v) => setActiveVersionId(Number(v))}
              >
                <TabsList className="flex-wrap h-auto">
                  {sortedVersions.map((v) => (
                    <TabsTrigger key={v.id} value={String(v.id)} className="gap-2">
                      v{v.version}
                      {v.isDefault && (
                        <Badge
                          variant="secondary"
                          className="bg-primary/10 text-primary text-[10px] px-1.5"
                        >
                          default
                        </Badge>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {sortedVersions.map((v) => (
                  <TabsContent key={v.id} value={String(v.id)} className="mt-6">
                    <div className="text-xs text-muted-foreground mb-4">
                      {v.templateKey} • {formatDate(v.createdAt)}
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
