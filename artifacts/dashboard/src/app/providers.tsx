import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { LocationProvider } from "@/context/LocationContext";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { Toaster } from "@/shared/ui/toaster";

const ThemeProvider = NextThemesProvider as unknown as (
  props: PropsWithChildren<{
    attribute: "class";
    defaultTheme: string;
    enableSystem: boolean;
    storageKey: string;
  }>,
) => ReactElement;

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
        <LocationProvider>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster />
          </TooltipProvider>
        </LocationProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
