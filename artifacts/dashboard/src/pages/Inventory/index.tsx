import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { 
  useGetVehicleStats, 
  useListVehicles, 
  ListVehiclesSort 
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatMileage } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { Search, Car, Tag, Activity, Loader2, Share, Filter, LayoutGrid } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader, KpiCard, AnimatedCounter, EmptyState } from "@/components/shared";

export function InventoryDashboard() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<ListVehiclesSort>(ListVehiclesSort.newest);

  const { data: stats, isLoading: statsLoading } = useGetVehicleStats();
  const { data: vehiclesData, isLoading: vehiclesLoading } = useListVehicles({
    q: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    sort: sortOrder
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Active": return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case "Ready to Publish": return "bg-primary/10 text-primary border-primary/20";
      case "Published": return "bg-success/10 text-success border-success/20";
      case "Archived":
      case "Sold/Removed": return "bg-muted text-muted-foreground border-border";
      default: return "bg-secondary text-secondary-foreground border-border";
    }
  };

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
          
          <PageHeader 
            title="Vehicle Intelligence" 
            description="Manage and track your vehicle catalog with AI insights."
            action={
              <div className="flex items-center gap-2">
                <div className="bg-secondary/50 rounded-lg p-1 border border-border/50 flex">
                  <div className="px-3 py-1.5 bg-card rounded-md shadow-sm border border-border text-sm font-medium flex items-center gap-2">
                    <LayoutGrid className="w-4 h-4 text-primary" /> Grid
                  </div>
                </div>
              </div>
            }
          />

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard 
              title="Total Vehicles"
              value={stats?.total || 0}
              icon={<Car className="w-4 h-4" />}
              isLoading={statsLoading}
            />
            <KpiCard 
              title="Active Inventory"
              value={stats?.active || 0}
              icon={<Activity className="w-4 h-4" />}
              trend={{ value: 12, isPositive: true }}
              isLoading={statsLoading}
            />
            <KpiCard 
              title="Ready to Publish"
              value={stats?.readyToPublish || 0}
              icon={<Tag className="w-4 h-4 text-primary" />}
              isLoading={statsLoading}
            />
            <KpiCard 
              title="Published"
              value={stats?.published || 0}
              icon={<Share className="w-4 h-4 text-success" />}
              isLoading={statsLoading}
            />
          </div>

          {/* Filters */}
          <div className="glass-panel p-4 rounded-xl flex flex-col md:flex-row gap-4 items-center justify-between z-10 sticky top-0">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Search VIN, stock, make, model..." 
                className="pl-9 bg-background/50 border-border/50 focus-visible:ring-primary/30"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-3 w-full md:w-auto">
              <div className="flex items-center gap-2 text-sm text-muted-foreground px-2">
                <Filter className="w-4 h-4" /> Filters:
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px] bg-background/50 border-border/50">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Ready to Publish">Ready to Publish</SelectItem>
                  <SelectItem value="Published">Published</SelectItem>
                  <SelectItem value="Archived">Archived</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as ListVehiclesSort)}>
                <SelectTrigger className="w-[160px] bg-background/50 border-border/50">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ListVehiclesSort.newest}>Newest First</SelectItem>
                  <SelectItem value={ListVehiclesSort.price_high}>Price: High to Low</SelectItem>
                  <SelectItem value={ListVehiclesSort.price_low}>Price: Low to High</SelectItem>
                  <SelectItem value={ListVehiclesSort.mileage_low}>Mileage: Lowest</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* List */}
          {vehiclesLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[1,2,3,4,5,6,7,8].map(i => (
                <div key={i} className="rounded-xl bg-card border border-border/50 h-[320px] animate-pulse">
                  <div className="h-[200px] bg-secondary/50 rounded-t-xl" />
                  <div className="p-4 space-y-3">
                    <div className="h-5 bg-secondary/80 rounded w-2/3" />
                    <div className="h-4 bg-secondary/50 rounded w-1/3" />
                    <div className="flex justify-between pt-2">
                      <div className="h-5 bg-secondary/80 rounded w-1/4" />
                      <div className="h-5 bg-secondary/50 rounded w-1/4" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : vehiclesData?.vehicles.length === 0 ? (
            <EmptyState 
              icon={<Car className="w-8 h-8" />}
              title="No vehicles found"
              description="Try adjusting your search or filters to find what you're looking for."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {vehiclesData?.vehicles.map((vehicle, index) => (
                <Link key={vehicle.id} href={`/inventory/${vehicle.id}`}>
                  <Card className="overflow-hidden hover-lift cursor-pointer group bg-card border-border/40 hover:border-primary/30 transition-all duration-500 h-full flex flex-col"
                    style={{ animationDelay: `${index * 50}ms` }}>
                    <div className="aspect-[4/3] bg-secondary/30 relative overflow-hidden">
                      {vehicle.primaryImageUrl ? (
                        <img 
                          src={vehicle.primaryImageUrl} 
                          alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`} 
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-secondary/50 to-background">
                          <Car className="w-12 h-12 text-muted-foreground/20" />
                        </div>
                      )}
                      
                      {/* Gradient Overlay for bottom of image */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-300" />
                      
                      <div className="absolute top-3 right-3 flex flex-col gap-2 items-end">
                        <Badge variant="outline" className={cn("backdrop-blur-xl font-medium px-2.5 py-1", getStatusColor(vehicle.status))}>
                          {vehicle.status}
                        </Badge>
                      </div>
                      
                      <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end text-white">
                         <div className="font-bold text-xl drop-shadow-md">
                          {formatCurrency(vehicle.price)}
                        </div>
                        <div className="text-xs font-medium bg-black/40 backdrop-blur-md px-2 py-1 rounded-md border border-white/10">
                          {formatMileage(vehicle.mileage)}
                        </div>
                      </div>
                    </div>
                    
                    <CardContent className="p-5 flex-1 flex flex-col">
                      <div className="font-bold text-lg leading-tight mb-1 group-hover:text-primary transition-colors">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </div>
                      <div className="text-muted-foreground text-sm flex items-center gap-2 mb-4">
                        <span className="truncate max-w-[120px]">{vehicle.trim || "Base"}</span>
                        <span className="w-1 h-1 rounded-full bg-border" />
                        <span className="font-mono text-xs">{vehicle.stockNumber ? `#${vehicle.stockNumber}` : "No Stock #"}</span>
                      </div>
                      
                      <div className="mt-auto pt-4 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <div className={cn("w-2 h-2 rounded-full", vehicle.imageCount > 0 ? "bg-primary" : "bg-muted")} />
                          {vehicle.imageCount} Photos
                        </div>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity text-primary font-medium flex items-center gap-1">
                          View Details &rarr;
                        </div>
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
