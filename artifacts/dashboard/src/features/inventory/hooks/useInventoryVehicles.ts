import { useGetVehicleStats, useListVehicles, type ListVehiclesSort } from "../api/inventoryApi";

export function useInventoryVehicles({
  dealerId,
  search,
  statusFilter,
  sortOrder,
  location,
}: {
  dealerId: number;
  search: string;
  statusFilter: string;
  sortOrder: ListVehiclesSort;
  location: string | undefined;
}) {
  const statsQuery = useGetVehicleStats({ dealerId, location });
  const vehiclesQuery = useListVehicles({
    dealerId,
    q: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    sort: sortOrder,
    location,
  });

  return {
    stats: statsQuery.data,
    statsLoading: statsQuery.isLoading,
    vehiclesData: vehiclesQuery.data,
    vehiclesLoading: vehiclesQuery.isLoading,
  };
}
