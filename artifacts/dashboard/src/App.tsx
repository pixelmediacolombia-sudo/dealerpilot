import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { SalesHub } from "@/pages/SalesHub";
import { ComingSoon } from "@/pages/ComingSoon";
import { InventoryDashboard } from "@/pages/Inventory";
import { VehicleDetail } from "@/pages/Inventory/VehicleDetail";
import { ListingsWorkspace } from "@/pages/Listings";
import { ListingDetail } from "@/pages/Listings/ListingDetail";
import { ProductionReadiness } from "@/pages/Listings/ProductionReadiness";
import { PublishingQueue } from "@/pages/Publishing";
import { CreativeStudio } from "@/pages/CreativeStudio";
import { CreativeDetail } from "@/pages/CreativeStudio/CreativeDetail";
import { DealerDna } from "@/pages/DealerDna";
import { ConnectionCenter } from "@/pages/ConnectionCenter";
import { Settings } from "@/pages/Settings";
import { SalesAI } from "@/pages/SalesAI";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

function Router() {
  return (
    <Switch>
      {/* Functional Routes */}
      <Route path="/" component={SalesHub} />
      
      <Route path="/inventory" component={InventoryDashboard} />
      <Route path="/inventory/:id" component={VehicleDetail} />
      
      <Route path="/listings" component={ListingsWorkspace} />
      <Route path="/listings/readiness" component={ProductionReadiness} />
      <Route path="/listings/:id" component={ListingDetail} />
      <Route path="/publishing" component={PublishingQueue} /> {/* Merged into Marketplace AI visually, keeping route for deep links */}
      
      <Route path="/creative-studio" component={CreativeStudio} />
      <Route path="/creative-studio/:id" component={CreativeDetail} />
      
      <Route path="/leads" component={SalesAI} /> 
      
      <Route path="/dealer-dna" component={DealerDna} />
      <Route path="/connection-center" component={ConnectionCenter} />
      <Route path="/settings" component={Settings} />

      {/* Fallback */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
