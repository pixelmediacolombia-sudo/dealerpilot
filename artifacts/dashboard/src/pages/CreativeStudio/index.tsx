import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListCreativeStudio,
  getListCreativeStudioQueryKey,
  useListCreativeJobs,
  getListCreativeJobsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
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
import { Search, Car, Image as ImageIcon, Loader2, Gauge, Wand2, Clock, Sparkles } from "lucide-react";
import { PageHeader, KpiCard, AnimatedCounter, EmptyState, StatusPulse, SectionCard } from "@/components/shared";

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

function creativeStatusClass(status: string) {
  switch (status) {
    case "Approved":
      return "bg-green-500/10 text-green-500 border-green-500/20";
    case "Generated":
      return "bg-primary/10 text-primary border-primary/20";
    case "Generating":
    case "Queued":
      return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    case "Failed":
      return "bg-amber-500/10 text-amber-500 border-amber-500/20";
    default:
      return "bg-secondary text-muted-foreground border-border";
  }
}

function creativeStatusLabel(status: string) {
  return status === "None" ? "No Creative" : status;
}

function jobStatusClass(status: string) {
  switch (status) {
    case "Completed":
      return "bg-green-500/10 text-green-500";
    case "Generating":
      return "bg-blue-500/10 text-blue-500";
    case "Queued":
      return "bg-amber-500/10 text-amber-500";
    case "Failed":
      return "bg-amber-500/10 text-amber-500";
    default:
      return "bg-secondary text-muted-foreground";
  }
}

export function CreativeStudio() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

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
            eyebrow="CREATIVE INTELLIGENCE"
            title="Creative Studio"
            description="DealerPilot is ready to generate on-brand Marketplace creatives from your vehicle photos."
            icon={Sparkles}
          />

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <KpiCard 
              label="DealerPilot tracks"
              value={vehicles.length}
              icon={Car}
            />
            <KpiCard 
              label="DealerPilot generated"
              value={totalCreatives}
              icon={ImageIcon}
              valueColor="text-primary"
            />
            <KpiCard 
              label="DealerPilot found"
              value={readyCount}
              icon={Gauge}
              valueColor="text-green-500"
            />
            <KpiCard 
              label="DealerPilot is generating"
              value={activeJobs.length}
              icon={Loader2}
              valueColor="text-blue-500"
              iconClassName={activeJobs.length > 0 ? "animate-spin" : ""}
            />
          </div>

          {/* Active Jobs Live Progress */}
          {activeJobs.length > 0 && (
            <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent opacity-50 animate-pulse" />
              <h3 className="text-primary text-[10px] font-bold uppercase tracking-widest mb-6 relative z-10 flex items-center gap-2">
                <StatusPulse color="blue" /> 
                DealerPilot is generating creatives — {activeJobs.length} active job{activeJobs.length === 1 ? '' : 's'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
                {activeJobs.map((job) => (
                  <div key={job.id} className="bg-card/80 backdrop-blur-md rounded-xl p-4 border border-primary/20 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold truncate text-foreground/90">
                        {job.vehicleLabel || `Vehicle #${job.vehicleId}`}
                      </span>
                      <Badge variant="outline" className={cn("shrink-0 uppercase text-[9px] tracking-wider", jobStatusClass(job.status))}>
                        {job.status === "Generating" && job.step ? job.step : job.status}
                      </Badge>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden relative">
                       {job.status === "Queued" ? (
                          <div className="absolute inset-0 bg-primary/20">
                            <div className="h-full w-1/3 bg-primary/40 animate-pulse rounded-full" />
                          </div>
                       ) : (
                         <div
                          className="h-full rounded-full bg-primary transition-all duration-500 relative"
                          style={{ width: `${job.progress}%` }}
                        >
                          <div className="absolute inset-0 bg-white/20 animate-pulse" />
                        </div>
                       )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 items-center pt-4">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Ask DealerPilot to find a VIN, make, or model..."
                className="pl-11 h-12 bg-card/60 backdrop-blur-xl border-border/50 focus-visible:ring-primary/50 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
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
          </div>

          {/* Grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pt-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="aspect-[4/3] rounded-xl bg-secondary/50 animate-pulse" />
              ))}
            </div>
          ) : vehicles.length === 0 ? (
            <EmptyState
              icon={Wand2}
              title="No vehicles found"
              description="DealerPilot couldn't find any vehicles matching your search criteria."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 pt-4">
              {vehicles.map((v, i) => (
                <Link key={v.vehicleId} href={`/creative-studio/${v.vehicleId}`}>
                  <div 
                    className="group glass-panel rounded-2xl overflow-hidden hover-lift cursor-pointer flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 shadow-sm hover:shadow-primary/5 border border-white/5 hover:border-primary/20"
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
                      
                      {/* Statuses are INSIDE the image overlay */}
                      <div className="absolute top-4 left-4 flex flex-wrap gap-2 z-10">
                        <Badge
                          variant="outline"
                          className={cn("backdrop-blur-md font-medium uppercase text-[10px] tracking-widest px-2.5 py-1 border-white/10", creativeStatusClass(v.creativeStatus))}
                        >
                          {(v.creativeStatus === "Generating" || v.creativeStatus === "Queued") && (
                            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                          )}
                          {creativeStatusLabel(v.creativeStatus)}
                        </Badge>
                      </div>
                      
                      <div className="absolute bottom-4 right-4 z-10">
                         {v.creativeScore != null && (
                          <Badge variant="outline" className={cn("backdrop-blur-md font-bold text-[10px] uppercase tracking-widest px-2.5 py-1 border-white/10", ratingClass(v.creativeRating))}>
                            <Gauge className="w-3 h-3 mr-1.5" />
                            {v.creativeScore} SCORE
                          </Badge>
                        )}
                      </div>
                    </div>
                    
                    <div className="p-6 flex flex-col flex-1 bg-card/40 backdrop-blur-xl">
                      <div className="text-primary text-[10px] font-bold uppercase tracking-widest mb-2">
                        {v.vin.slice(-6)}
                      </div>
                      <div className="font-bold tracking-tight text-xl truncate mb-1 text-foreground/90 group-hover:text-primary transition-colors">
                        {v.label}
                      </div>
                      <div className="text-muted-foreground text-sm truncate mb-6">
                        {v.bodyStyle || "Vehicle"} • {v.versionCount} AI creative{v.versionCount === 1 ? "" : "s"}
                      </div>
                      <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between">
                        <div className="font-bold text-foreground/90 text-lg">{formatCurrency(v.price)}</div>
                        <div className="text-xs font-semibold text-primary/80 group-hover:text-primary flex items-center gap-1 uppercase tracking-widest transition-colors">
                          View Details
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
