import { useState, useCallback } from "react";

export function useVehicleSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggle = useCallback((id: number, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: number[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const isSelected = useCallback(
    (id: number) => selectedIds.has(id),
    [selectedIds],
  );

  return {
    selectedIds,
    selectedIdsArray: Array.from(selectedIds),
    toggle,
    selectAll,
    clear,
    isSelected,
    count: selectedIds.size,
    selectionMode: selectedIds.size > 0,
  };
}
