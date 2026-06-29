import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetListingDetail,
  getGetListingDetailQueryKey,
  useGenerateListing,
  useQueueListingVersion,
  type ListingVersion,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

function VersionView({ version }: { version: ListingVersion }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card/50">
          <CardContent className="p-4 flex items-center gap-3">
            <Target className="w-5 h-5 text-muted-foreground shrink-0" />
            <div>
              <div className="text-xs text-muted-foreground">Buyer Profile</div>
              <div className="font-medium">{version.buyerProfile || "N/A"}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4 flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-muted-foreground shrink-0" />
            <div>
              <div className="text-xs text-muted-foreground">Suggested Down Payment</div>
              <div className="font-medium">{formatCurrency(version.downPayment)}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4 flex items-center gap-3">
            <Flag className="w-5 h-5 text-muted-foreground shrink-0" />
            <div>
              <div className="text-xs text-muted-foreground">Priority</div>
              <div className="font-medium">{version.priority || "N/A"}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4 flex items-center gap-3">
            <Globe className="w-5 h-5 text-muted-foreground shrink-0" />
            <div>
              <div className="text-xs text-muted-foreground">Language</div>
              <div className="font-medium">{version.language}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Title</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-medium">{version.title}</p>
          <p className="text-xs text-muted-foreground mt-2">{version.title.length} / 100 characters</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              English Description
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
              {version.descriptionEn || "N/A"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Descripción en Español</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
              {version.descriptionEs || "N/A"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Megaphone className="w-4 h-4" /> Call to Action
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{version.callToAction || "N/A"}</p>
        </CardContent>
      </Card>

      {version.score && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="w-4 h-4" /> Listing Score
              <Badge variant="secondary" className={cn("ml-2", ratingClass(version.score.rating))}>
                {version.score.overall} · {version.score.rating}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ScoreBar label="Title Quality" value={version.score.titleQuality} />
            <ScoreBar label="Description Quality" value={version.score.descriptionQuality} />
            <ScoreBar label="Price Strategy" value={version.score.priceStrategy} />
            <ScoreBar label="Down Payment Strategy" value={version.score.downPaymentStrategy} />
            <ScoreBar label="Photos" value={version.score.photoScore} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ListingDetail() {
  const params = useParams();
  const id = Number(params.id);
  const queryClient = useQueryClient();
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null);

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
        toast({ title: "Listing generated", description: `Version ${v.version} created.` });
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
          <p className="text-muted-foreground">Listing not found.</p>
          <Link href="/listings">
            <Button variant="outline">Back to Listings</Button>
          </Link>
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
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-6xl mx-auto space-y-6">
          <Link href="/listings">
            <Button variant="ghost" size="sm" className="gap-2 -ml-2">
              <ArrowLeft className="w-4 h-4" /> Back to Listings
            </Button>
          </Link>

          {/* Header */}
          <div className="flex flex-col md:flex-row gap-6">
            <div className="w-full md:w-64 aspect-[4/3] bg-secondary rounded-lg overflow-hidden shrink-0">
              {primaryImage ? (
                <img src={primaryImage} alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`} className="w-full h-full object-cover" />
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
                  <span className="text-muted-foreground">Status: </span>
                  <span className="font-medium">{vehicle.status}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 mt-6">
                <Button onClick={() => generate.mutate({ id: vehicle.id })} disabled={generate.isPending} className="gap-2">
                  {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {versions.length === 0 ? "Generate Listing" : "Regenerate"}
                </Button>
                {selectedVersion && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => queue.mutate({ id: selectedVersion.id, data: { priority: 5 } })}
                    disabled={queue.isPending}
                  >
                    {queue.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Queue for Publishing
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Versions */}
          {sortedVersions.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Sparkles className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
                <h3 className="text-lg font-medium">No listing generated yet</h3>
                <p className="text-muted-foreground mt-1 max-w-md mx-auto">
                  Generate an AI-optimized, bilingual Marketplace listing grounded entirely in this vehicle's
                  inventory data.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <History className="w-4 h-4" />
                Version history (latest never overwrites earlier versions)
              </div>
              <Tabs
                value={String(selectedVersion?.id)}
                onValueChange={(v) => setActiveVersionId(Number(v))}
              >
                <TabsList className="flex-wrap h-auto">
                  {sortedVersions.map((v) => (
                    <TabsTrigger key={v.id} value={String(v.id)} className="gap-2">
                      v{v.version}
                      {v.isCurrent && <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px] px-1.5">current</Badge>}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {sortedVersions.map((v) => (
                  <TabsContent key={v.id} value={String(v.id)} className="mt-6">
                    <div className="text-xs text-muted-foreground mb-4">
                      Generated by {v.generatedBy} • {formatDate(v.createdAt)}
                    </div>
                    <VersionView version={v} />
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
