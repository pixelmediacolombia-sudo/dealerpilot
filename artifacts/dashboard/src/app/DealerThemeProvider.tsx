import { useEffect, type ReactNode } from "react";
import { useListDealers } from "@workspace/api-client-react";
import {
  applyDealerTheme,
  DEALER_THEME_UPDATED_EVENT,
  type DealerThemePayload,
} from "./dealerTheme";

const REFRESH_INTERVAL_MS = 30 * 1000;

export function DealerThemeProvider({ children }: { children: ReactNode }) {
  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers?.[0]?.id;

  useEffect(() => {
    if (!dealerId) return;

    let cancelled = false;
    const loadTheme = async () => {
      try {
        const response = await fetch(`/api/dealers/${dealerId}/theme`, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`Theme request failed: ${response.status}`);
        const theme = (await response.json()) as DealerThemePayload;
        if (!cancelled) applyDealerTheme(theme);
      } catch {
        // The static tokens remain active if the theme endpoint is temporarily unavailable.
      }
    };

    const handleThemeUpdate = (event: Event) => {
      const theme = (event as CustomEvent<DealerThemePayload>).detail;
      if (theme) applyDealerTheme(theme);
    };
    const handleFocus = () => void loadTheme();

    void loadTheme();
    const interval = window.setInterval(loadTheme, REFRESH_INTERVAL_MS);
    window.addEventListener(DEALER_THEME_UPDATED_EVENT, handleThemeUpdate);
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener(DEALER_THEME_UPDATED_EVENT, handleThemeUpdate);
      window.removeEventListener("focus", handleFocus);
    };
  }, [dealerId]);

  return children;
}
