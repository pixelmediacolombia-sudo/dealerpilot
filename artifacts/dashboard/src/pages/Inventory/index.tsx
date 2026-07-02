import { useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetVehicleStats,
  useListVehicles,
  useBulkVehicleAction,
  useBulkGenerateCreative,
  useBulkSchedulePublishing,
  useUpdateVehicleStatus,
  getListVehiclesQueryKey,
  getGetVehicleStatsQueryKey,
  ListVehiclesSort,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Search, Car, Tag, Activity, Share, Filter, LayoutGrid, CheckSquare, MapPin } from "lucide-react";
import { PageHeader, KpiCard, AnimatedCounter, EmptyState } from "@/components/shared";
import { VehicleCard } from "@/components/inventory/VehicleCard";
import { FloatingBulkBar } from "@/components/inventory/FloatingBulkBar";
import { ScheduleModal, type ScheduleOpts } from "@/components/inventory/ScheduleModal";
import { useVehicleSelection } from "@/hooks/useVehicleSelection";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function InventoryDashboard() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<ListVehiclesSort>(ListVehiclesSort.newest);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"mark_sold" | "archive" | null>(null);

  const queryClient = useQueryClient();
  const selection = useVehicleSelection();

  const { data: stats, isLoading: statsLoading } = useGetVehicleStats();
  const { data: vehiclesData, isLoading: vehiclesLoading } = useListVehicles({
    q: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    sort: sortOrder,
  });

  const allVisibleIds = (vehiclesData?.vehicles ?? []).map((v) => v.id);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetVehicleStatsQueryKey() });
  }, [queryClient]);

  const bulkStatus = useBulkVehicleAction({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Done", description: `Updated ${data.updated} vehicle${data.updated !== 1 ? "s" : ""}` });
        selection.clear();
        invalidate();
      },
      onError: () => toast({ title: "Error", description: "Bulk action failed", variant: "destructive" }),
    },
  });

  const bulkCreative = useBulkGenerateCreative({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Creative jobs enqueued", description: `${data.enqueued} jobs started${data.skipped ? `, ${data.skipped} skipped` : ""}` });
        selection.clear();
      },
      onError: () => toast({ title: "Error", description: "Failed to enqueue creative jobs", variant: "destructive" }),
    },
  });

  const bulkSchedule = useBulkSchedulePublishing({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Publishing scheduled", description: `${data.enqueued} job${data.enqueued !== 1 ? "s" : ""} queued${data.skipped ? `, ${data.skipped} skipped` : ""}` });
        selection.clear();
        invalidate();
      },
      onError: () => toast({ title: "Error", description: "Failed to schedule publishing", variant: "destructive" }),
    },
  });

  const singleStatus = useUpdateVehicleStatus({
    mutation: {
      onSuccess: () => { invalidate(); },
      onError: () => toast({ title: "Error", description: "Status update failed", variant: "destructive" }),
    },
  });

  const isLoading = bulkStatus.isPending || bulkCreative.isPending || bulkSchedule.isPending;

  const handleBulkMarkReady = () => {
    bulkStatus.mutate({ data: { vehicleIds: selection.selectedIdsArray, action: "mark_ready" } });
  };

  const handleBulkCreative = () => {
    bulkCreative.mutate({ data: { vehicleIds: selection.selectedIdsArray } });
  };

  const handleBulkScheduleConfirm = (opts: ScheduleOpts) => {
    bulkSchedule.mutate({
      data: {
        vehicleIds: selection.selectedIdsArray,
        scheduledAt: opts.scheduledAt,
        spacingMinutes: opts.spacingMinutes,
        priority: opts.priority,
        notes: opts.notes,
      },
    });
    setScheduleOpen(false);
  };

  const handleBulkMarkSold = () => setConfirmAction("mark_sold");
  const handleBulkArchive = () => setConfirmAction("archive");

  const handleConfirmDestructive = () => {
    if (!confirmAction) return;
    bulkStatus.mutate({ data: { vehicleIds: selection.selectedIdsArray, action: confirmAction } });
    setConfirmAction(null);
  };

  // Per-card single action handler
  const handleCardAction = (action: string, vehicleId: number) => {
    switch (action) {
      case "mark_ready":
        singleStatus.mutate({ id: vehicleId, data: { status: "Ready to Publish" } });
        break;
      case "mark_sold":
        singleStatus.mutate({ id: vehicleId, data: { status: "Sold/Removed" } });
        break;
      case "archive":
        singleStatus.mutate({ id: vehicleId, data: { status: "Archived" } });
        break;
      case "generate_creative":
        bulkCreative.mutate({ data: { vehicleIds: [vehicleId] } });
        break;
      case "schedule":
      case "publish":
        selection.selectAll([vehicleId]);
        setScheduleOpen(true);
        break;
      default:
        break;
    }
  };

  const isSelectAll = allVisibleIds.length > 0 && allVisibleIds.every((id) => selection.isSelected(id));

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto bg-background/50">
        <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">

          <PageHeader
            eyebrow="Intelligence Engine"
            title="Vehicle Intelligence"
            description="DealerPilot AI analyzed your catalog and identified these vehicles for review."
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
              title="DealerPilot Catalog"
              value={stats?.total || 0}
              icon={<Car className="w-4 h-4" />}
              isLoading={statsLoading}
            />
            <KpiCard
              title="AI Active Inventory"
              value={stats?.active || 0}
              icon={<Activity className="w-4 h-4" />}
              trend={{ value: 12, isPositive: true }}
              isLoading={statsLoading}
            />
            <KpiCard
              title="AI Ready to Publish"
              value={stats?.readyToPublish || 0}
              icon={<Tag className="w-4 h-4 text-primary" />}
              isLoading={statsLoading}
            />
            <KpiCard
              title="Live on Marketplace"
              value={stats?.published || 0}
              icon={<Share className="w-4 h-4 text-success" />}
              isLoading={statsLoading}
            />
          </div>

          {/* Active dealer badge */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-green-500/[0.06] border border-green-500/20">
              <MapPin className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <div>
                <div className="text-[10px] font-bold text-green-400 uppercase tracking-widest">Active Dealer</div>
                <div className="text-sm font-bold text-white leading-tight">Alpha Motorsport</div>
              </div>
            </div>
          </div>

          {/* Filters + selection toolbar */}
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
            <div className="flex gap-3 w-full md:w-auto items-center">
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

              {/* Select All toggle */}
              {allVisibleIds.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => isSelectAll ? selection.clear() : selection.selectAll(allVisibleIds)}
                  className={cn(
                    "gap-2 border-border/60 text-xs h-9",
                    selection.selectionMode && "border-primary/50 text-primary bg-primary/5",
                  )}
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  {isSelectAll ? "Clear All" : selection.selectionMode ? `${selection.count} selected` : "Select All"}
                </Button>
              )}
            </div>
          </div>

          {/* Vehicle grid */}
          {vehiclesLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-24">
              {vehiclesData?.vehicles.map((vehicle) => (
                <VehicleCard
                  key={vehicle.id}
                  vehicle={vehicle}
                  selectionMode={selection.selectionMode}
                  isSelected={selection.isSelected(vehicle.id)}
                  onToggle={selection.toggle}
                  onAction={handleCardAction}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Floating bulk bar */}
      <FloatingBulkBar
        count={selection.count}
        onClear={selection.clear}
        onMarkReady={handleBulkMarkReady}
        onGenerateCreative={handleBulkCreative}
        onSchedule={() => setScheduleOpen(true)}
        onMarkSold={handleBulkMarkSold}
        onArchive={handleBulkArchive}
        isLoading={isLoading}
      />

      {/* Schedule modal */}
      <ScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        vehicleCount={selection.count}
        onConfirm={handleBulkScheduleConfirm}
        isLoading={bulkSchedule.isPending}
      />

      {/* Destructive confirmation */}
      <AlertDialog open={!!confirmAction} onOpenChange={(v) => !v && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "archive" ? "Archive vehicles?" : "Mark as Sold?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will update {selection.count} vehicle{selection.count !== 1 ? "s" : ""} to{" "}
              <strong>{confirmAction === "archive" ? "Archived" : "Sold/Removed"}</strong>.
              {confirmAction === "archive" && " Archived vehicles are hidden from publishing queues."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDestructive}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmAction === "archive" ? "Archive" : "Mark Sold"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
