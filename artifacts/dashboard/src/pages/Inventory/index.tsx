import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { 
  useGetVehicleStats, 
  useListVehicles, 
  ListVehiclesSort 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatMileage, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { Search, Car, Tag, Clock, Activity, Loader2, Share } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function InventoryDashboard() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<ListVehiclesSort>(ListVehiclesSort.newest);

  // Stats
  const { data: stats, isLoading: statsLoading } = useGetVehicleStats();

  // Search debounce
  // Basic implementation to avoid extra hook
  // In a real app we'd use useDebounce
  
  const { data: vehiclesData, isLoading: vehiclesLoading } = useListVehicles({
    q: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    sort: sortOrder
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Active": return "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20";
      case "Ready to Publish": return "bg-primary/10 text-primary hover:bg-primary/20";
      case "Published": return "bg-green-500/10 text-green-500 hover:bg-green-500/20";
      case "Archived":
      case "Sold/Removed": return "bg-muted text-muted-foreground";
      default: return "bg-secondary text-secondary-foreground";
    }
  };

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
              <p className="text-muted-foreground mt-1">Manage and track your vehicle catalog.</p>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Total Vehicles</p>
                    <h3 className="text-2xl font-bold">{stats?.total || 0}</h3>
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
                    <p className="text-sm font-medium text-muted-foreground mb-1">Active</p>
                    <h3 className="text-2xl font-bold text-blue-500">{stats?.active || 0}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-blue-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Ready to Publish</p>
                    <h3 className="text-2xl font-bold text-primary">{stats?.readyToPublish || 0}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Tag className="w-5 h-5 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Published</p>
                    <h3 className="text-2xl font-bold text-green-500">{stats?.published || 0}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                    <Share className="w-5 h-5 text-green-500" />
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
                placeholder="Search VIN, stock, make, model..." 
                className="pl-9 bg-background/50 border-0"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-4 w-full sm:w-auto">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px] bg-background/50 border-0">
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
                <SelectTrigger className="w-[180px] bg-background/50 border-0">
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
            <div className="py-20 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : vehiclesData?.vehicles.length === 0 ? (
            <div className="text-center py-20 bg-card rounded-lg border border-border">
              <Car className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">No vehicles found</h3>
              <p className="text-muted-foreground mt-1">Try adjusting your search or filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {vehiclesData?.vehicles.map((vehicle) => (
                <Link key={vehicle.id} href={`/inventory/${vehicle.id}`}>
                  <Card className="overflow-hidden hover:border-primary/50 transition-colors cursor-pointer group bg-card border-border">
                    <div className="aspect-[4/3] bg-secondary relative">
                      {vehicle.primaryImageUrl ? (
                        <img 
                          src={vehicle.primaryImageUrl} 
                          alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Car className="w-12 h-12 text-muted-foreground/30" />
                        </div>
                      )}
                      <div className="absolute top-2 right-2">
                        <Badge variant="secondary" className={cn("backdrop-blur-md", getStatusColor(vehicle.status))}>
                          {vehicle.status}
                        </Badge>
                      </div>
                    </div>
                    <CardContent className="p-4">
                      <div className="font-semibold text-lg truncate mb-1">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </div>
                      <div className="text-muted-foreground text-sm truncate mb-4">
                        {vehicle.trim || "Base"} • {vehicle.stockNumber ? `#${vehicle.stockNumber}` : "No Stock #"}
                      </div>
                      <div className="flex items-end justify-between">
                        <div className="font-bold text-primary">
                          {formatCurrency(vehicle.price)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatMileage(vehicle.mileage)}
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
