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
      return "bg-destructive/10 text-destructive border-destructive/20";
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
      return "bg-destructive/10 text-destructive";
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
  const recentJobs = (jobsData?.jobs ?? []).slice(0, 6);

  const readyCount = vehicles.filter(
    (v) => v.creativeStatus === "Generated" || v.creativeStatus === "Approved",
  ).length;
  const totalCreatives = vehicles.reduce((sum, v) => sum + v.versionCount, 0);

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto animate-in fade-in duration-500">
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          <PageHeader 
            title="Creative Studio"
            description="Generate on-brand Marketplace creatives from your Dealer Brand DNA."
            icon={Sparkles}
          />

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard 
              label="Vehicles"
              value={vehicles.length}
              icon={Car}
            />
            <KpiCard 
              label="Creatives"
              value={totalCreatives}
              icon={ImageIcon}
              valueColor="text-primary"
            />
            <KpiCard 
              label="Ready"
              value={readyCount}
              icon={Gauge}
              valueColor="text-green-500"
            />
            <KpiCard 
              label="In Queue"
              value={activeJobs.length}
              icon={Loader2}
              valueColor="text-blue-500"
              iconClassName={activeJobs.length > 0 ? "animate-spin" : ""}
            />
          </div>

          {/* Generation Queue */}
          {recentJobs.length > 0 && (
            <SectionCard title="Generation Queue" icon={Clock} className="border-border">
              <div className="space-y-4">
                {recentJobs.map((job) => (
                  <div key={job.id} className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium truncate flex items-center gap-2">
                          <StatusPulse 
                            status={job.status === "Completed" ? "success" : job.status === "Failed" ? "error" : "warning"}
                          />
                          {job.vehicleLabel || `Vehicle #${job.vehicleId}`}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn("ml-2 shrink-0 font-normal uppercase text-[10px] tracking-wider", jobStatusClass(job.status))}
                        >
                          {job.status === "Generating" && job.step
                            ? `${job.step} · ${job.progress}%`
                            : job.status}
                        </Badge>
                      </div>
                      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            job.status === "Failed" ? "bg-destructive" : "bg-primary",
                          )}
                          style={{ width: `${job.status === "Completed" ? 100 : job.progress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 items-center p-1">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search VIN, make, model..."
                className="pl-9 bg-card/60 backdrop-blur-xl border-border/50 focus-visible:ring-primary/50"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[200px] bg-card/60 backdrop-blur-xl border-border/50 focus:ring-primary/50">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="None">No Creative</SelectItem>
                <SelectItem value="Generating">Generating</SelectItem>
                <SelectItem value="Generated">Generated</SelectItem>
                <SelectItem value="Approved">Approved</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Grid */}
          {isLoading ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : vehicles.length === 0 ? (
            <EmptyState
              icon={Wand2}
              title="No vehicles found"
              description="Try adjusting your search or filters to find what you're looking for."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {vehicles.map((v, i) => (
                <Link key={v.vehicleId} href={`/creative-studio/${v.vehicleId}`}>
                  <div 
                    className="group glass-panel rounded-xl overflow-hidden hover-lift cursor-pointer flex flex-col h-full animate-in fade-in slide-in-from-bottom-4"
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
                      
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
                      
                      <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                        <Badge
                          variant="outline"
                          className={cn("backdrop-blur-md font-medium uppercase text-[10px] tracking-wider", creativeStatusClass(v.creativeStatus))}
                        >
                          {(v.creativeStatus === "Generating" || v.creativeStatus === "Queued") && (
                            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                          )}
                          {creativeStatusLabel(v.creativeStatus)}
                        </Badge>
                      </div>
                      
                      <div className="absolute bottom-3 right-3">
                         {v.creativeScore != null && (
                          <Badge variant="outline" className={cn("backdrop-blur-md font-bold text-xs", ratingClass(v.creativeRating))}>
                            <Gauge className="w-3 h-3 mr-1" />
                            {v.creativeScore}
                          </Badge>
                        )}
                      </div>
                    </div>
                    
                    <div className="p-5 flex flex-col flex-1">
                      <div className="font-semibold tracking-tight text-lg truncate mb-1 text-foreground/90 group-hover:text-primary transition-colors">
                        {v.label}
                      </div>
                      <div className="text-muted-foreground text-sm truncate mb-4">
                        {v.bodyStyle || "Vehicle"} • {v.versionCount} creative
                        {v.versionCount === 1 ? "" : "s"}
                      </div>
                      <div className="mt-auto pt-2 border-t border-border/40 flex items-center justify-between">
                        <div className="font-bold text-foreground/80">{formatCurrency(v.price)}</div>
                        <span className="text-xs font-medium text-muted-foreground/60 uppercase tracking-widest">
                          {v.vin.slice(-6)}
                        </span>
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
