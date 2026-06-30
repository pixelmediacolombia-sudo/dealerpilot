import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListCreativeStudio,
  getListCreativeStudioQueryKey,
  useListCreativeJobs,
  getListCreativeJobsQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Search,
  Car,
  Loader2,
  Gauge,
  Wand2,
  Sparkles,
  Camera,
  Megaphone,
  ImageIcon,
} from "lucide-react";
import { PageHeader, EmptyState, StatusPulse } from "@/components/shared";

type StudioMode = "enhancer" | "ad-creative";

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

function getEtaText(progress: number) {
  if (progress < 20) return "~30 sec";
  if (progress < 60) return "~18 sec";
  if (progress < 90) return "~8 sec";
  return "almost done";
}

export function CreativeStudio() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [mode, setMode] = useState<StudioMode>("enhancer");

  const studioParams = {
    q: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
  };
  const { data, isLoading } = useListCreativeStudio(studioParams, {
    query: {
      queryKey: getListCreativeStudioQueryKey(studioParams),
      refetchInterval: 5000,
    },
  });

  const { data: jobsData } = useListCreativeJobs(undefined, {
    query: {
      queryKey: getListCreativeJobsQueryKey(undefined),
      refetchInterval: 5000,
    },
  });

  const vehicles = data?.vehicles ?? [];
  const activeJobs = (jobsData?.jobs ?? []).filter(
    (j) => j.status === "Queued" || j.status === "Generating",
  );

  const readyCount = vehicles.filter(
    (v) => v.creativeStatus === "Generated" || v.creativeStatus === "Approved",
  ).length;
  const totalCreatives = vehicles.reduce((sum, v) => sum + v.versionCount, 0);

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto animate-in fade-in duration-500">
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          <PageHeader
            eyebrow="CREATIVE AI"
            title="Creative Studio"
            description={
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground text-sm">
                  {vehicles.length} vehicles · {totalCreatives} ad creatives · {readyCount} ready
                </span>
                <div className="flex flex-wrap gap-2 mt-1">
                  <Badge variant="secondary" className="bg-success/10 text-success border-success/20 text-[10px] uppercase tracking-widest">
                    Photo Enhancer Active
                  </Badge>
                  <Badge variant="secondary" className="bg-secondary/50 text-muted-foreground border-white/5 text-[10px] uppercase tracking-widest">
                    Ad Creative Generator
                  </Badge>
                </div>
              </div>
            }
            icon={Sparkles}
          />

          {/* ── Mode selector ── */}
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={() => setMode("enhancer")}
              className={cn(
                "flex-1 flex items-start gap-4 p-5 rounded-2xl border-2 text-left transition-all duration-200 cursor-pointer",
                mode === "enhancer"
                  ? "border-success/50 bg-success/5 shadow-lg shadow-success/5"
                  : "border-border/30 bg-card/30 hover:border-border hover:bg-card/60",
              )}
            >
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all",
                mode === "enhancer" ? "bg-success/20" : "bg-secondary",
              )}>
                <Camera className={cn("w-5 h-5", mode === "enhancer" ? "text-success" : "text-muted-foreground")} />
              </div>
              <div>
                <div className={cn(
                  "font-bold text-sm mb-1",
                  mode === "enhancer" ? "text-success" : "text-foreground",
                )}>
                  Marketplace Photo Enhancer
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  Take the original vehicle photo, remove or replace the background, improve
                  lighting and sharpness. Output: a clean, realistic listing photo with no text
                  overlays, no price, no CTA.
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {["Background Removal", "Studio Background", "Lighting Enhancement", "No Overlays"].map((t) => (
                    <span key={t} className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-secondary/80 text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              {mode === "enhancer" && (
                <div className="ml-auto">
                  <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                </div>
              )}
            </button>

            <button
              onClick={() => setMode("ad-creative")}
              className={cn(
                "flex-1 flex items-start gap-4 p-5 rounded-2xl border-2 text-left transition-all duration-200 cursor-pointer",
                mode === "ad-creative"
                  ? "border-primary/50 bg-primary/5 shadow-lg shadow-primary/5"
                  : "border-border/30 bg-card/30 hover:border-border hover:bg-card/60",
              )}
            >
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all",
                mode === "ad-creative" ? "bg-primary/20" : "bg-secondary",
              )}>
                <Megaphone className={cn("w-5 h-5", mode === "ad-creative" ? "text-primary" : "text-muted-foreground")} />
              </div>
              <div>
                <div className={cn(
                  "font-bold text-sm mb-1",
                  mode === "ad-creative" ? "text-primary" : "text-foreground",
                )}>
                  Ad Creative Generator
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  Generate branded promotional ads for Facebook Feed, Stories, and Marketplace
                  covers. Includes price badge, CTA, dealer branding, and Brand DNA styling.
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {["Brand DNA", "Price Badge", "CTA Button", "Dealer Logo", "Feed/Story"].map((t) => (
                    <span key={t} className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-secondary/80 text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              {mode === "ad-creative" && (
                <div className="ml-auto">
                  <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                </div>
              )}
            </button>
          </div>

          {/* Mode description strip */}
          <div className={cn(
            "flex items-start gap-3 p-4 rounded-xl border text-xs",
            mode === "enhancer"
              ? "bg-success/5 border-success/20 text-success"
              : "bg-primary/5 border-primary/20 text-primary",
          )}>
            {mode === "enhancer" ? (
              <Camera className="w-4 h-4 mt-0.5 flex-shrink-0" />
            ) : (
              <Megaphone className="w-4 h-4 mt-0.5 flex-shrink-0" />
            )}
            <div>
              <span className="font-bold">
                {mode === "enhancer" ? "Marketplace Photo Enhancer active" : "Ad Creative Generator active"}
              </span>
              {" — "}
              <span className="text-muted-foreground">
                {mode === "enhancer"
                  ? "Select a vehicle to open its photos. Choose a photo, then generate Enhanced, Background Removed, Studio Background, or Original outputs. No promotional elements."
                  : "Select a vehicle to open the ad generator. Choose a template and generate branded promotional ads with price, CTA, and Brand DNA styling for Facebook and Marketplace."}
              </span>
            </div>
          </div>

          {/* AI Generation Queue (ad-creative mode only) */}
          {mode === "ad-creative" && activeJobs.length > 0 && (
            <div className="bg-card/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 relative overflow-hidden">
              <div className="flex items-center gap-3 mb-6">
                <StatusPulse color="blue" />
                <h3 className="text-primary text-xs font-bold uppercase tracking-widest">
                  AI GENERATION QUEUE
                </h3>
                <span className="text-muted-foreground text-sm ml-2">
                  {activeJobs.length} ad creative{activeJobs.length === 1 ? "" : "s"} generating
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeJobs.map((job) => {
                  const progress = job.progress || 0;
                  return (
                    <div key={job.id} className="bg-background/40 border border-white/5 rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/80" />
                      <div className="flex items-center justify-between pl-2">
                        <span className="text-sm font-semibold truncate text-foreground">
                          {job.vehicleLabel || `Vehicle #${job.vehicleId}`}
                        </span>
                        <Badge variant="outline" className="uppercase text-[9px] tracking-wider border-primary/20 text-primary bg-primary/10">
                          {job.status === "Generating" && job.step ? job.step : job.status}
                        </Badge>
                      </div>
                      <div className="pl-2 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">ETA: {getEtaText(progress)}</span>
                          <span className="text-primary font-mono">{progress}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-500 animate-pulse relative"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search VIN, make, model..."
                className="pl-11 h-12 bg-card/60 backdrop-blur-xl border-border/50 focus-visible:ring-primary/50 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {mode === "ad-creative" && (
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[240px] h-12 bg-card/60 backdrop-blur-xl border-border/50 focus:ring-primary/50">
                  <SelectValue placeholder="Filter by AI Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All AI Statuses</SelectItem>
                  <SelectItem value="None">No Creative</SelectItem>
                  <SelectItem value="Generating">Generating</SelectItem>
                  <SelectItem value="Generated">Generated</SelectItem>
                  <SelectItem value="Approved">Approved</SelectItem>
                </SelectContent>
              </Select>
            )}
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
              icon={Wand2}
              title="No vehicles found"
              description="DealerPilot couldn't find any vehicles matching your search criteria."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
              {vehicles.map((v, i) => {
                let badgeNode = null;

                if (mode === "enhancer") {
                  badgeNode = (
                    <Badge className="absolute top-4 right-4 z-10 backdrop-blur-md uppercase text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full text-white bg-success/90 border-0 flex items-center gap-1.5">
                      <Camera className="w-3 h-3" /> ENHANCE
                    </Badge>
                  );
                } else {
                  if (v.creativeStatus === "Approved")
                    badgeNode = <Badge className="absolute top-4 right-4 z-10 backdrop-blur-md uppercase text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full text-white bg-success/90 border-0 hover:bg-success/90">APPROVED</Badge>;
                  else if (v.creativeStatus === "Generated")
                    badgeNode = <Badge className="absolute top-4 right-4 z-10 backdrop-blur-md uppercase text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full text-white bg-primary/90 border-0 hover:bg-primary/90">READY</Badge>;
                  else if (v.creativeStatus === "Generating" || v.creativeStatus === "Queued")
                    badgeNode = (
                      <Badge className="absolute top-4 right-4 z-10 backdrop-blur-md uppercase text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full text-white bg-warning/80 border-0 flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" /> GENERATING
                      </Badge>
                    );
                }

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

                        {badgeNode}

                        <div className="absolute top-4 left-4 flex flex-col gap-2 z-10">
                          {mode === "ad-creative" && v.creativeScore != null && (
                            <Badge variant="outline" className={cn("backdrop-blur-md font-bold text-[10px] uppercase tracking-widest px-2.5 py-1 border-white/10", ratingClass(v.creativeRating))}>
                              <Gauge className="w-3 h-3 mr-1.5" />
                              {v.creativeScore} SCORE
                            </Badge>
                          )}
                        </div>

                        {/* Photo count badge */}
                        {v.imageCount > 1 && (
                          <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-lg backdrop-blur-sm">
                            <ImageIcon className="w-3 h-3" />
                            {v.imageCount}
                          </div>
                        )}
                      </div>

                      <div className="p-8 flex flex-col flex-1 bg-card/40 backdrop-blur-xl">
                        <div className="text-primary text-[10px] font-bold uppercase tracking-widest mb-2">
                          {v.vin.slice(-6)}
                        </div>
                        <div className="font-bold tracking-tight text-xl truncate mb-2 text-foreground/90 group-hover:text-primary transition-colors">
                          {v.label}
                        </div>
                        <div className="text-muted-foreground text-sm truncate mb-8">
                          {mode === "enhancer"
                            ? `${v.imageCount} photos available for enhancement`
                            : `${v.bodyStyle || "Vehicle"} • ${v.versionCount} AI creative${v.versionCount === 1 ? "" : "s"}`}
                        </div>
                        <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between">
                          <div className="font-bold text-foreground/90 text-xl">{formatCurrency(v.price)}</div>
                          <div className={cn(
                            "text-xs font-semibold flex items-center gap-1 uppercase tracking-widest transition-colors",
                            mode === "enhancer" ? "text-success/80 group-hover:text-success" : "text-primary/80 group-hover:text-primary",
                          )}>
                            {mode === "enhancer" ? (
                              <><Camera className="w-3 h-3" /> Enhance Photos &rarr;</>
                            ) : (
                              <>View Studio &rarr;</>
                            )}
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
