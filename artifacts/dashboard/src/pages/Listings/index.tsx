import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListListingWorkspaces } from "@workspace/api-client-react";
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
import { Search, Car, Sparkles, Loader2, Gauge, FileText, CheckCircle2 } from "lucide-react";

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

function aiStatusClass(status: string) {
  switch (status) {
    case "AI Generated":
      return "bg-primary/10 text-primary";
    default:
      return "bg-secondary text-muted-foreground";
  }
}

function publishStatusClass(status: string) {
  switch (status) {
    case "Published":
      return "bg-green-500/10 text-green-500";
    case "Queued":
    case "Publishing":
      return "bg-blue-500/10 text-blue-500";
    case "Failed":
      return "bg-destructive/10 text-destructive";
    default:
      return "bg-secondary text-muted-foreground";
  }
}

export function ListingsWorkspace() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading } = useListListingWorkspaces({
    q: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const workspaces = data?.workspaces ?? [];
  const generatedCount = workspaces.filter((w) => w.aiStatus === "AI Generated").length;
  const readyCount = workspaces.filter(
    (w) => w.publishStatus === "Queued" || w.publishStatus === "Approved",
  ).length;
  const publishedCount = workspaces.filter((w) => w.publishStatus === "Published").length;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Listings</h1>
            <p className="text-muted-foreground mt-1">
              Generate AI-optimized Marketplace listings for every vehicle.
            </p>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Vehicles</p>
                    <h3 className="text-2xl font-bold">{workspaces.length}</h3>
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
                    <p className="text-sm font-medium text-muted-foreground mb-1">AI Generated</p>
                    <h3 className="text-2xl font-bold text-primary">{generatedCount}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Ready / Queued</p>
                    <h3 className="text-2xl font-bold text-blue-500">{readyCount}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-blue-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Published</p>
                    <h3 className="text-2xl font-bold text-green-500">{publishedCount}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

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
                <SelectItem value="AI Generated">AI Generated</SelectItem>
                <SelectItem value="Approved">Approved</SelectItem>
                <SelectItem value="Queued">Queued</SelectItem>
                <SelectItem value="Published">Published</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Grid */}
          {isLoading ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : workspaces.length === 0 ? (
            <div className="text-center py-20 bg-card rounded-lg border border-border">
              <Sparkles className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">No vehicles found</h3>
              <p className="text-muted-foreground mt-1">Try adjusting your search or filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {workspaces.map((w) => (
                <Link key={w.vehicleId} href={`/listings/${w.vehicleId}`}>
                  <Card className="overflow-hidden hover:border-primary/50 transition-colors cursor-pointer group bg-card border-border">
                    <div className="aspect-[4/3] bg-secondary relative">
                      {w.primaryImageUrl ? (
                        <img
                          src={w.primaryImageUrl}
                          alt={w.label}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Car className="w-12 h-12 text-muted-foreground/30" />
                        </div>
                      )}
                      <div className="absolute top-2 left-2 flex gap-2">
                        <Badge variant="secondary" className={cn("backdrop-blur-md", aiStatusClass(w.aiStatus))}>
                          <Sparkles className="w-3 h-3 mr-1" />
                          {w.aiStatus}
                        </Badge>
                      </div>
                      {w.publishStatus !== "Not Queued" && (
                        <div className="absolute top-2 right-2">
                          <Badge variant="secondary" className={cn("backdrop-blur-md", publishStatusClass(w.publishStatus))}>
                            {w.publishStatus}
                          </Badge>
                        </div>
                      )}
                    </div>
                    <CardContent className="p-4">
                      <div className="font-semibold text-lg truncate mb-1">{w.label}</div>
                      <div className="text-muted-foreground text-sm truncate mb-4">
                        {w.bodyStyle || "Vehicle"} • {w.versionCount} version{w.versionCount === 1 ? "" : "s"}
                      </div>
                      <div className="flex items-end justify-between">
                        <div className="font-bold text-primary">{formatCurrency(w.price)}</div>
                        {w.listingScore != null ? (
                          <Badge variant="secondary" className={cn(ratingClass(w.listingRating))}>
                            <Gauge className="w-3 h-3 mr-1" />
                            {w.listingScore}
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
