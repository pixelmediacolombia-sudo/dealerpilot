import { createContext, useContext, useState, type ReactNode } from "react";

// "" means "All locations" (no filter applied to API calls)
export type DealerLocation = "Manassas" | "Fredericksburg" | "";

interface LocationContextValue {
  selectedLocation: DealerLocation;
  setSelectedLocation: (loc: DealerLocation) => void;
}

const STORAGE_KEY = "dp_location";
const DEFAULT_LOCATION: DealerLocation = "";

const LocationContext = createContext<LocationContextValue>({
  selectedLocation: DEFAULT_LOCATION,
  setSelectedLocation: () => {},
});

export function LocationProvider({ children }: { children: ReactNode }) {
  const [selectedLocation, setLocationState] = useState<DealerLocation>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "Manassas" || v === "Fredericksburg" || v === "") return v as DealerLocation;
    } catch {}
    return DEFAULT_LOCATION;
  });

  function setSelectedLocation(loc: DealerLocation) {
    setLocationState(loc);
    try {
      localStorage.setItem(STORAGE_KEY, loc);
    } catch {}
  }

  return (
    <LocationContext.Provider value={{ selectedLocation, setSelectedLocation }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useDealerLocation() {
  return useContext(LocationContext);
}
