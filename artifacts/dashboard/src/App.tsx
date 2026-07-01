import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { SalesHub } from "@/pages/SalesHub";
import { InventoryDashboard } from "@/pages/Inventory";
import { VehicleDetail } from "@/pages/Inventory/VehicleDetail";
import { ListingsWorkspace } from "@/pages/Listings";
import { ListingDetail } from "@/pages/Listings/ListingDetail";
import { ProductionReadiness } from "@/pages/Listings/ProductionReadiness";
import { PublishingQueue } from "@/pages/Publishing";
import { CreativeStudio } from "@/pages/CreativeStudio";
import { CreativeDetail } from "@/pages/CreativeStudio/CreativeDetail";
import { DealerDna } from "@/pages/DealerDna";
import { Settings } from "@/pages/Settings";
import { SalesAIWorkspace } from "@/pages/SalesAI";
import { ConversationDetail } from "@/pages/SalesAI/ConversationDetail";
import { LeadsCRM } from "@/pages/SalesAI/LeadsCRM";
import { LeadDetail } from "@/pages/SalesAI/LeadDetail";
import { MarketplaceIntelligence } from "@/pages/MarketplaceIntelligence";

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
      <Route path="/" component={SalesHub} />

      <Route path="/inventory" component={InventoryDashboard} />
      <Route path="/inventory/:id" component={VehicleDetail} />

      <Route path="/listings/readiness" component={ProductionReadiness} />
      <Route path="/listings" component={ListingsWorkspace} />
      <Route path="/listings/:id" component={ListingDetail} />
      <Route path="/publishing" component={PublishingQueue} />

      <Route path="/creative-studio" component={CreativeStudio} />
      <Route path="/creative-studio/:id" component={CreativeDetail} />

      {/* Sales AI */}
      <Route path="/sales-ai" component={SalesAIWorkspace} />
      <Route path="/conversations/:id" component={ConversationDetail} />
      <Route path="/leads" component={LeadsCRM} />
      <Route path="/leads/:id" component={LeadDetail} />

      {/* Marketplace Intelligence */}
      <Route path="/marketplace-intelligence" component={MarketplaceIntelligence} />

      <Route path="/dealer-dna" component={DealerDna} />
      <Route path="/connection-center">
        <Redirect to="/" />
      </Route>
      <Route path="/settings" component={Settings} />

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
