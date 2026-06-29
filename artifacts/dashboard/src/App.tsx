import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { ComingSoon } from "@/pages/ComingSoon";
import { InventoryDashboard } from "@/pages/Inventory";
import { VehicleDetail } from "@/pages/Inventory/VehicleDetail";
import { ListingsWorkspace } from "@/pages/Listings";
import { ListingDetail } from "@/pages/Listings/ListingDetail";
import { PublishingQueue } from "@/pages/Publishing";
import { ConnectionCenter } from "@/pages/ConnectionCenter";
import { Settings } from "@/pages/Settings";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      {/* Functional Routes */}
      <Route path="/inventory" component={InventoryDashboard} />
      <Route path="/inventory/:id" component={VehicleDetail} />
      <Route path="/listings" component={ListingsWorkspace} />
      <Route path="/listings/:id" component={ListingDetail} />
      <Route path="/publishing" component={PublishingQueue} />
      <Route path="/connection-center" component={ConnectionCenter} />
      <Route path="/settings" component={Settings} />

      {/* Coming Soon Routes */}
      <Route path="/" component={ComingSoon} />
      <Route path="/leads" component={ComingSoon} />
      <Route path="/ai-studio" component={ComingSoon} />
      <Route path="/dealer-dna" component={ComingSoon} />

      {/* Fallback */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
