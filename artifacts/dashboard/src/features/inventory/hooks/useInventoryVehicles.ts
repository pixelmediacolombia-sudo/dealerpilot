import { useGetVehicleStats, useListVehicles, type ListVehiclesSort } from "../api/inventoryApi";

export function useInventoryVehicles({
  search,
  statusFilter,
  sortOrder,
  location,
}: {
  search: string;
  statusFilter: string;
  sortOrder: ListVehiclesSort;
  location: string | undefined;
}) {
  const statsQuery = useGetVehicleStats({ location });
  const vehiclesQuery = useListVehicles({
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
