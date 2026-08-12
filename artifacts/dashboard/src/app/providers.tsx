import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { ThemeProvider } from "next-themes";
import { LocationProvider } from "@/context/LocationContext";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { Toaster } from "@/shared/ui/toaster";
import { DealerThemeProvider } from "./DealerThemeProvider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem storageKey="dealerpilot-theme">
      <QueryClientProvider client={queryClient}>
        <DealerThemeProvider>
          <LocationProvider>
            <TooltipProvider delayDuration={200}>
              {children}
              <Toaster />
            </TooltipProvider>
          </LocationProvider>
        </DealerThemeProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
