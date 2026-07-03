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
import { useDealerLocation } from "@/context/LocationContext";
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
  const { selectedLocation } = useDealerLocation();

  const { data: stats, isLoading: statsLoading } = useGetVehicleStats({ location: selectedLocation });
  const { data: vehiclesData, isLoading: vehiclesLoading } = useListVehicles({
    q: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    sort: sortOrder,
    location: selectedLocation,
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
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-[1600px] mx-auto animate-in fade-in duration-400">

          <PageHeader
            eyebrow="Inventory"
            module="inventory"
            title="Vehicle Catalog"
            description="Complete inventory with status tracking and publishing controls."
            className="mb-6"
          />

          {/* Stats strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <KpiCard
              title="Total Catalog"
              value={stats?.total || 0}
              isLoading={statsLoading}
            />
            <KpiCard
              title="Active"
              value={stats?.active || 0}
              module="inventory"
              isLoading={statsLoading}
            />
            <KpiCard
              title="Ready to Publish"
              value={stats?.readyToPublish || 0}
              module="inventory"
              isLoading={statsLoading}
            />
            <KpiCard
              title="Live on Marketplace"
              value={stats?.published || 0}
              module="marketplace"
              isLoading={statsLoading}
            />
          </div>

          {/* Filters toolbar */}
          <div className="flex flex-col md:flex-row gap-3 items-center justify-between mb-6 py-3 border-y border-white/[0.04]">
            <div className="relative flex-1 max-w-sm w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/22" />
              <Input
                placeholder="VIN, stock, make, model…"
                className="pl-9 h-8 text-[13px] bg-transparent border-white/[0.08] focus-visible:ring-0 focus-visible:border-cyan-500/40 text-white/70 placeholder:text-white/18"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2 w-full md:w-auto items-center">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[148px] h-8 text-[12px] bg-transparent border-white/[0.08] text-white/55">
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
                <SelectTrigger className="w-[148px] h-8 text-[12px] bg-transparent border-white/[0.08] text-white/55">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ListVehiclesSort.newest}>Newest First</SelectItem>
                  <SelectItem value={ListVehiclesSort.price_high}>Price: High → Low</SelectItem>
                  <SelectItem value={ListVehiclesSort.price_low}>Price: Low → High</SelectItem>
                  <SelectItem value={ListVehiclesSort.mileage_low}>Mileage: Lowest</SelectItem>
                </SelectContent>
              </Select>
              {allVisibleIds.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => isSelectAll ? selection.clear() : selection.selectAll(allVisibleIds)}
                  className={cn(
                    "h-8 gap-1.5 text-[12px] text-white/35 hover:text-white/70",
                    selection.selectionMode && "text-cyan-400 hover:text-cyan-400",
                  )}
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  {isSelectAll ? "Clear" : selection.selectionMode ? `${selection.count} selected` : "Select All"}
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
