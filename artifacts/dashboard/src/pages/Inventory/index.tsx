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
import { Search, Car, Tag, Activity, Share, Filter, LayoutGrid, CheckSquare, MapPin, Image as ImageIcon } from "lucide-react";
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

          {/* Vehicle catalog — flat telemetry list */}
          {vehiclesLoading ? (
            <div className="border border-white/[0.05] rounded-xl overflow-hidden">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3.5 border-b border-white/[0.04] last:border-0 animate-pulse">
                  <div className="w-5 h-5 rounded bg-white/[0.04] shrink-0" />
                  <div className="w-[72px] h-[52px] rounded-lg bg-white/[0.04] shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 bg-white/[0.04] rounded w-2/5" />
                    <div className="h-3 bg-white/[0.03] rounded w-1/4" />
                  </div>
                  <div className="w-20 h-5 bg-white/[0.04] rounded" />
                  <div className="w-24 h-5 bg-white/[0.04] rounded" />
                  <div className="w-20 h-7 bg-white/[0.04] rounded" />
                </div>
              ))}
            </div>
          ) : vehiclesData?.vehicles.length === 0 ? (
            <EmptyState
              icon={<Car className="w-8 h-8" />}
              title="No vehicles found"
              description="Try adjusting your search or filters."
            />
          ) : (
            <div className="border border-white/[0.05] bg-white/[0.005] rounded-xl overflow-hidden pb-24">
              {/* List header */}
              <div className="flex items-center gap-4 px-5 py-2.5 border-b border-white/[0.05] text-[9px] font-black uppercase tracking-[0.18em] text-white/18">
                <div className="w-5 shrink-0" />
                <div className="w-[72px] shrink-0">Photo</div>
                <div className="flex-1 min-w-0">Vehicle</div>
                <div className="w-[90px] shrink-0 hidden md:block">Status</div>
                <div className="w-[100px] shrink-0 hidden lg:block">Price</div>
                <div className="w-[90px] shrink-0 hidden xl:block">Mileage</div>
                <div className="w-[120px] shrink-0 text-right">Actions</div>
              </div>
              {vehiclesData?.vehicles.map((vehicle, idx) => {
                const isSelected = selection.isSelected(vehicle.id);
                return (
                  <div
                    key={vehicle.id}
                    onClick={() => selection.selectionMode && selection.toggle(vehicle.id)}
                    className={cn(
                      "flex items-center gap-4 px-5 py-3 border-b border-white/[0.03] last:border-0 transition-colors hover:bg-white/[0.015] cursor-default",
                      isSelected && "bg-cyan-500/[0.04] border-l-2 border-l-cyan-500/40",
                    )}
                  >
                    <div className="w-5 shrink-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => selection.toggle(vehicle.id)}
                        className="accent-cyan-400 w-3.5 h-3.5 cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <div className="w-[72px] h-[52px] shrink-0 rounded-lg overflow-hidden bg-white/[0.03] border border-white/[0.05]">
                      {vehicle.primaryImageUrl ? (
                        <img src={vehicle.primaryImageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Car className="w-4 h-4 text-white/10" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <a href={`/inventory/${vehicle.id}`} className="text-[13px] font-semibold text-white/75 hover:text-white transition-colors truncate block">
                        {vehicle.year} {vehicle.make} {vehicle.model}{vehicle.trim ? ` ${vehicle.trim}` : ""}
                      </a>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-white/22">
                        {vehicle.vin && <span className="font-mono">{vehicle.vin.slice(-6)}</span>}
                        {vehicle.bodyStyle && <><span>·</span><span>{vehicle.bodyStyle}</span></>}
                        {(vehicle.imageCount ?? 0) > 0 && (
                          <span className="flex items-center gap-0.5"><ImageIcon className="w-3 h-3" />{vehicle.imageCount}</span>
                        )}
                      </div>
                    </div>
                    <div className="w-[90px] shrink-0 hidden md:block">
                      <span className={cn(
                        "text-[9px] font-black uppercase tracking-[0.14em] px-1.5 py-0.5 rounded",
                        vehicle.status === "Active" ? "bg-cyan-500/10 text-cyan-400" :
                        vehicle.status === "Published" ? "bg-green-500/10 text-green-400" :
                        vehicle.status === "Sold/Removed" ? "bg-white/[0.04] text-white/22" :
                        "bg-white/[0.04] text-white/35"
                      )}>
                        {vehicle.status}
                      </span>
                    </div>
                    <div className="w-[100px] shrink-0 hidden lg:block">
                      <span className="text-[13px] font-bold text-white/65">
                        {vehicle.price ? `$${vehicle.price.toLocaleString()}` : "—"}
                      </span>
                    </div>
                    <div className="w-[90px] shrink-0 hidden xl:block">
                      <span className="text-[12px] text-white/35">
                        {vehicle.mileage ? `${vehicle.mileage.toLocaleString()} mi` : "—"}
                      </span>
                    </div>
                    <div className="w-[120px] shrink-0 flex justify-end">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCardAction("mark_ready", vehicle.id); }}
                        className="h-7 px-3 text-[11px] font-semibold rounded-lg border border-white/[0.08] text-white/40 hover:text-cyan-400 hover:border-cyan-500/30 transition-colors"
                      >
                        Mark Ready
                      </button>
                    </div>
                  </div>
                );
              })}
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
