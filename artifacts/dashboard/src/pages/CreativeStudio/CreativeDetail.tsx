import { useState } from "react";
import { Link, useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetCreativeVehicleDetail,
  getGetCreativeVehicleDetailQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatMileage } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PhotoEnhancerPanel } from "./PhotoEnhancerPanel";
import { PhotoAuditPanel } from "./PhotoAuditPanel";
import { GalleryPanel } from "./GalleryPanel";
import {
  ArrowLeft,
  Car,
  ImageIcon,
  Sparkles,
  Camera,
  ScanSearch,
  LayoutGrid,
} from "lucide-react";
import { EmptyState } from "@/components/shared";

export function CreativeDetail() {
  const params = useParams();
  const id = Number(params.id);
  const [activeTab, setActiveTab] = useState<"audit" | "enhanced" | "gallery">("audit");

  const { data, isLoading } = useGetCreativeVehicleDetail(id, {
    query: {
      queryKey: getGetCreativeVehicleDetailQueryKey(id),
      enabled: !Number.isNaN(id),
      refetchInterval: 10000,
    },
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              DealerPilot is loading…
            </p>
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
            action={
              <Link href="/creative-studio">
                <Button>Back to AI Vehicle Studio</Button>
              </Link>
            }
          />
        </div>
      </AppLayout>
    );
  }

  const { vehicle, images } = data;
  const primaryImage = images?.[0]?.url ?? vehicle.primaryImageUrl ?? null;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">

          {/* Back */}
          <Link href="/creative-studio">
            <Button
              variant="ghost" size="sm"
              className="gap-2 -ml-4 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-full px-4 text-[10px] uppercase font-bold tracking-widest"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to AI Vehicle Studio
            </Button>
          </Link>

          {/* ── Vehicle header ── */}
          <div className="glass-panel p-8 rounded-3xl flex flex-col md:flex-row gap-10 border border-white/5 shadow-2xl shadow-black/20 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -z-10 pointer-events-none" />

            {/* Primary photo */}
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

            {/* Info */}
            <div className="flex-1 flex flex-col z-10">
              <div className="text-primary text-[10px] font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" /> AI Vehicle Studio
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground/90">
                {vehicle.year} {vehicle.make}{" "}
                <span className="text-primary">{vehicle.model}</span>
              </h1>
              <p className="text-muted-foreground mt-3 text-lg font-medium">
                {vehicle.trim || "Base"} · {vehicle.bodyStyle || "Vehicle"}
              </p>

              <div className="flex flex-wrap gap-x-12 gap-y-6 mt-8">
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                    Price
                  </p>
                  <p className="text-2xl font-bold text-foreground/90">
                    {formatCurrency(vehicle.price)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                    Mileage
                  </p>
                  <p className="text-2xl font-semibold text-foreground/80">
                    {formatMileage(vehicle.mileage)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                    VIN
                  </p>
                  <p className="text-2xl font-semibold text-foreground/80">
                    {vehicle.vin.slice(-8)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                    Photos
                  </p>
                  <p className="text-2xl font-semibold text-foreground/80">
                    {images?.length ?? 0}
                  </p>
                </div>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap gap-2 mt-6">
                <Badge
                  variant="outline"
                  className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px] font-bold uppercase tracking-widest"
                >
                  Dealer Overlays Detected
                </Badge>
                <Badge
                  variant="outline"
                  className="border-primary/30 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest"
                >
                  {images?.length ?? 0} Source Photos
                </Badge>
              </div>
            </div>
          </div>

          {/* ── Tab navigation ── */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as typeof activeTab)}
            className="w-full"
          >
            <TabsList className="bg-card/60 border border-white/5 p-1.5 rounded-xl gap-1 h-auto">
              <TabsTrigger
                value="audit"
                className={cn(
                  "flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all duration-200",
                  "data-[state=active]:bg-primary/20 data-[state=active]:text-primary",
                  "data-[state=inactive]:text-muted-foreground",
                )}
              >
                <ScanSearch className="w-4 h-4" />
                Photo Audit
              </TabsTrigger>
              <TabsTrigger
                value="enhanced"
                className={cn(
                  "flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all duration-200",
                  "data-[state=active]:bg-success/20 data-[state=active]:text-success",
                  "data-[state=inactive]:text-muted-foreground",
                )}
              >
                <Camera className="w-4 h-4" />
                Enhanced Photos
              </TabsTrigger>
              <TabsTrigger
                value="gallery"
                className={cn(
                  "flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all duration-200",
                  "data-[state=active]:bg-secondary/80 data-[state=active]:text-foreground",
                  "data-[state=inactive]:text-muted-foreground",
                )}
              >
                <LayoutGrid className="w-4 h-4" />
                Gallery
                {(images?.length ?? 0) > 0 && (
                  <span className="ml-1 bg-secondary text-muted-foreground rounded-full px-1.5 py-0.5 text-[9px] font-bold">
                    {images!.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Photo Audit */}
            <TabsContent value="audit" className="mt-8 outline-none">
              <PhotoAuditPanel
                images={images ?? []}
                vehicleId={vehicle.id}
                vehicleName={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              />
            </TabsContent>

            {/* Enhanced Photos */}
            <TabsContent value="enhanced" className="mt-8 outline-none">
              <PhotoEnhancerPanel
                images={images ?? []}
                vehicleName={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              />
            </TabsContent>

            {/* Gallery */}
            <TabsContent value="gallery" className="mt-8 outline-none">
              <GalleryPanel
                images={images ?? []}
                vehicleName={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
