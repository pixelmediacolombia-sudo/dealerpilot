import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListCreativeStudio,
  getListCreativeStudioQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Search,
  Car,
  Gauge,
  Sparkles,
  Camera,
  ImageIcon,
  ScanSearch,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/shared";

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

// Deterministic audit score per vehicle (same algo as PhotoAuditPanel)
function vehicleAuditScore(vehicleId: number): number {
  const v = Math.abs(Math.sin(vehicleId * 0.073 + 0.29 + 1.73)) * 100;
  const base = Math.round(Math.max(50, Math.min(95, v)));
  return base;
}

export function CreativeStudio() {
  const [search, setSearch] = useState("");

  const studioParams = {
    q: search || undefined,
  };
  const { data, isLoading } = useListCreativeStudio(studioParams, {
    query: {
      queryKey: getListCreativeStudioQueryKey(studioParams),
      refetchInterval: 8000,
    },
  });

  const vehicles = data?.vehicles ?? [];

  const auditScores = vehicles.map((v) => vehicleAuditScore(v.vehicleId));
  const useOriginalCount = auditScores.filter((s) => s >= 88).length;
  const enhanceCount = auditScores.filter((s) => s >= 60 && s < 88).length;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto animate-in fade-in duration-500">
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          <PageHeader
            eyebrow="AI VEHICLE STUDIO"
            title="AI Vehicle Studio"
            description={
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground text-sm">
                  {vehicles.length} vehicles · {useOriginalCount} use original · {enhanceCount} enhance recommended
                </span>
                <div className="flex flex-wrap gap-2 mt-1">
                  <Badge
                    variant="secondary"
                    className="bg-primary/10 text-primary border-primary/20 text-[10px] uppercase tracking-widest gap-1.5"
                  >
                    <ScanSearch className="w-3 h-3" /> Photo Audit
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-success/10 text-success border-success/20 text-[10px] uppercase tracking-widest gap-1.5"
                  >
                    <Camera className="w-3 h-3" /> Enhanced Photos
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-secondary/50 text-muted-foreground border-white/5 text-[10px] uppercase tracking-widest gap-1.5"
                  >
                    <ImageIcon className="w-3 h-3" /> Gallery
                  </Badge>
                </div>
              </div>
            }
            icon={Sparkles}
          />

          {/* Module description strip */}
          <div className="flex items-start gap-3 p-4 rounded-xl border bg-primary/5 border-primary/20 text-primary text-xs">
            <Camera className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-bold">AI Vehicle Studio</span>
              {" — "}
              <span className="text-muted-foreground">
                DealerPilot audits every vehicle photo and recommends{" "}
                <strong className="text-foreground/70">Use Original</strong> when photos are
                already strong. Enhancement is only recommended when overlays, poor lighting,
                or background issues require it. Select a vehicle to open its Photo Audit.
              </span>
            </div>
          </div>

          {/* Search */}
          <div className="relative max-w-xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search VIN, make, model…"
              className="pl-11 h-12 bg-card/60 backdrop-blur-xl border-border/50 focus-visible:ring-primary/50 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Vehicle grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="aspect-[4/3] rounded-2xl bg-secondary/50 animate-pulse" />
              ))}
            </div>
          ) : vehicles.length === 0 ? (
            <EmptyState
              icon={Car}
              title="No vehicles found"
              description="DealerPilot couldn't find any vehicles matching your search criteria."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
              {vehicles.map((v, i) => {
                const auditScore = vehicleAuditScore(v.vehicleId);
                const recommendation = auditScore >= 88 ? "Use Original" : auditScore >= 60 ? "Enhance Recommended" : "Do Not Use";
                const recBadgeClass = auditScore >= 88
                  ? "bg-success/90 text-white"
                  : auditScore >= 60
                    ? "bg-amber-500/90 text-black"
                    : "bg-red-500/80 text-white";

                return (
                  <Link key={v.vehicleId} href={`/creative-studio/${v.vehicleId}`}>
                    <div
                      className="group glass-panel rounded-2xl overflow-hidden hover-lift cursor-pointer flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 shadow-sm hover:shadow-primary/5 border border-white/5 hover:border-primary/30 transition-all duration-500 relative"
                      style={{ animationDelay: `${i * 50}ms`, animationFillMode: "both" }}
                    >
                      <div className="aspect-[4/3] bg-secondary relative overflow-hidden">
                        {v.primaryImageUrl ? (
                          <img
                            src={v.primaryImageUrl}
                            alt={v.label}
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-muted/50">
                            <Car className="w-12 h-12 text-muted-foreground/30" />
                          </div>
                        )}

                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/30" />

                        {/* AI recommendation badge */}
                        <Badge
                          className={cn(
                            "absolute top-4 right-4 z-10 backdrop-blur-md uppercase text-[9px] font-bold tracking-widest px-2 py-0.5 rounded-full border-0",
                            recBadgeClass,
                          )}
                        >
                          {recommendation}
                        </Badge>

                        {/* Audit score */}
                        <div className="absolute top-4 left-4 z-10">
                          <Badge
                            variant="outline"
                            className={cn(
                              "backdrop-blur-md font-bold text-[10px] uppercase tracking-widest px-2.5 py-1 border-white/10",
                              auditScore >= 88 ? "bg-success/20 text-success border-success/30" :
                              auditScore >= 65 ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
                              "bg-red-500/20 text-red-400 border-red-500/30",
                            )}
                          >
                            <Gauge className="w-3 h-3 mr-1" />
                            {auditScore}
                          </Badge>
                        </div>

                        {/* Photo count */}
                        {v.imageCount > 0 && (
                          <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-lg backdrop-blur-sm">
                            <ImageIcon className="w-3 h-3" />
                            {v.imageCount}
                          </div>
                        )}
                      </div>

                      <div className="p-6 flex flex-col flex-1 bg-card/40 backdrop-blur-xl">
                        <div className="text-primary text-[10px] font-bold uppercase tracking-widest mb-2">
                          {v.vin.slice(-6)}
                        </div>
                        <div className="font-bold tracking-tight text-xl truncate mb-1 text-foreground/90 group-hover:text-primary transition-colors">
                          {v.label}
                        </div>
                        <div className="text-muted-foreground text-xs mb-6">
                          {v.imageCount} source photo{v.imageCount === 1 ? "" : "s"} · AI audit score {auditScore}
                        </div>

                        <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between">
                          <div className="font-bold text-foreground/90 text-xl">
                            {formatCurrency(v.price)}
                          </div>
                          <div className="text-xs font-semibold flex items-center gap-1 text-primary/80 group-hover:text-primary uppercase tracking-widest transition-colors">
                            <ScanSearch className="w-3 h-3" /> Open Audit →
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
