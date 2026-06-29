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
import { Search, Car, Image as ImageIcon, Loader2, Gauge, Wand2, Clock } from "lucide-react";

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

function creativeStatusClass(status: string) {
  switch (status) {
    case "Approved":
      return "bg-green-500/10 text-green-500";
    case "Generated":
      return "bg-primary/10 text-primary";
    case "Generating":
    case "Queued":
      return "bg-blue-500/10 text-blue-500";
    case "Failed":
      return "bg-destructive/10 text-destructive";
    default:
      return "bg-secondary text-muted-foreground";
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
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Creative Studio</h1>
            <p className="text-muted-foreground mt-1">
              Generate on-brand Marketplace creatives from your Dealer Brand DNA.
            </p>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Vehicles</p>
                    <h3 className="text-2xl font-bold">{vehicles.length}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                    <Car className="w-5 h-5 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Creatives</p>
                    <h3 className="text-2xl font-bold text-primary">{totalCreatives}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <ImageIcon className="w-5 h-5 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Ready</p>
                    <h3 className="text-2xl font-bold text-green-500">{readyCount}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                    <Gauge className="w-5 h-5 text-green-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">In Queue</p>
                    <h3 className="text-2xl font-bold text-blue-500">{activeJobs.length}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <Loader2
                      className={cn(
                        "w-5 h-5 text-blue-500",
                        activeJobs.length > 0 && "animate-spin",
                      )}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Generation Queue */}
          {recentJobs.length > 0 && (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-semibold">Generation Queue</h3>
                </div>
                <div className="space-y-3">
                  {recentJobs.map((job) => (
                    <div key={job.id} className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate">
                            {job.vehicleLabel || `Vehicle #${job.vehicleId}`}
                          </span>
                          <Badge
                            variant="secondary"
                            className={cn("ml-2 shrink-0", jobStatusClass(job.status))}
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
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-4 rounded-lg border border-border">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search VIN, make, model..."
                className="pl-9 bg-background/50 border-0"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[200px] bg-background/50 border-0">
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
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : vehicles.length === 0 ? (
            <div className="text-center py-20 bg-card rounded-lg border border-border">
              <Wand2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">No vehicles found</h3>
              <p className="text-muted-foreground mt-1">Try adjusting your search or filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {vehicles.map((v) => (
                <Link key={v.vehicleId} href={`/creative-studio/${v.vehicleId}`}>
                  <Card className="overflow-hidden hover:border-primary/50 transition-colors cursor-pointer group bg-card border-border">
                    <div className="aspect-[4/3] bg-secondary relative">
                      {v.primaryImageUrl ? (
                        <img
                          src={v.primaryImageUrl}
                          alt={v.label}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Car className="w-12 h-12 text-muted-foreground/30" />
                        </div>
                      )}
                      <div className="absolute top-2 left-2 flex gap-2">
                        <Badge
                          variant="secondary"
                          className={cn("backdrop-blur-md", creativeStatusClass(v.creativeStatus))}
                        >
                          {(v.creativeStatus === "Generating" || v.creativeStatus === "Queued") && (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          )}
                          {creativeStatusLabel(v.creativeStatus)}
                        </Badge>
                      </div>
                    </div>
                    <CardContent className="p-4">
                      <div className="font-semibold text-lg truncate mb-1">{v.label}</div>
                      <div className="text-muted-foreground text-sm truncate mb-4">
                        {v.bodyStyle || "Vehicle"} • {v.versionCount} creative
                        {v.versionCount === 1 ? "" : "s"}
                      </div>
                      <div className="flex items-end justify-between">
                        <div className="font-bold text-primary">{formatCurrency(v.price)}</div>
                        {v.creativeScore != null ? (
                          <Badge variant="secondary" className={cn(ratingClass(v.creativeRating))}>
                            <Gauge className="w-3 h-3 mr-1" />
                            {v.creativeScore}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">No score yet</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
