import { Redirect, Route, Router as WouterRouter, Switch } from "wouter";
import NotFound from "@/pages/not-found";
import { SalesHub } from "@/features/sales-ai/pages/SalesHub";
import { InventoryDashboard } from "@/features/inventory/pages";
import { VehicleDetail } from "@/features/inventory/pages/VehicleDetail";
import { ListingsWorkspace } from "@/features/listings/pages/ListingsWorkspace";
import { ListingDetail } from "@/features/listings/components/ListingDetail";
import { ProductionReadiness } from "@/features/listings/components/ProductionReadiness";
import { PublishingQueue } from "@/features/publishing/pages/PublishingQueue";
import { CreativeDetail } from "@/features/photo-studio/pages/CreativeDetail";
import { DealerDna } from "@/pages/DealerDna";
import { ConnectionCenter } from "@/features/connection/pages/ConnectionCenter";
import { Settings } from "@/pages/Settings";
import { SalesAIWorkspace } from "@/features/sales-ai/pages";
import { ConversationDetail } from "@/features/sales-ai/pages/ConversationDetail";
import { LeadsCRM } from "@/features/sales-ai/pages/LeadsCRM";
import { LeadDetail } from "@/features/sales-ai/pages/LeadDetail";
import { MarketplaceListings } from "@/features/sales-ai/pages/MarketplaceListings";
import { InventoryEngine } from "@/features/inventory/pages/InventoryEngine";
import { AIPhotoStudio } from "@/features/photo-studio/pages/AIPhotoStudio";
import MarketIntelligencePage from "@/features/marketplace-intelligence/pages/MarketplaceIntelligencePage";
import { PublishingConflictsPage } from "@/features/marketplace-intelligence/pages/PublishingConflicts";
import { PagesWorkspace } from "@/features/pages/pagesWorkspace";
import { useAccount } from "@/app/AuthGate";
import { useGetDealer, getGetDealerQueryKey } from "@workspace/api-client-react";

function PageRoute() {
  const { dealerId } = useAccount();
  const { data: dealer, isLoading } = useGetDealer(dealerId!, {
    query: { enabled: !!dealerId, queryKey: getGetDealerQueryKey(dealerId!) },
  });

  if (isLoading || !dealer) return null;
  if (dealer.plan === "basic") return <Redirect to="/listings" />;
  return <PagesWorkspace />;
}

function DashboardRoutes() {
  return (
    <Switch>
      <Route path="/" component={SalesHub} />

      <Route path="/inventory" component={InventoryDashboard} />
      <Route path="/inventory/:id" component={VehicleDetail} />

      <Route path="/listings/readiness" component={ProductionReadiness} />
      <Route path="/listings" component={ListingsWorkspace} />
      <Route path="/pages" component={PageRoute} />
      <Route path="/listings/:id" component={ListingDetail} />
      <Route path="/publishing" component={PublishingQueue} />

      <Route path="/creative-studio/:id" component={CreativeDetail} />
      <Route path="/creative-studio">
        <Redirect to="/ai-photo-studio" />
      </Route>

      <Route path="/sales-ai" component={SalesAIWorkspace} />
      <Route path="/sales-ai/marketplace-listings" component={MarketplaceListings} />
      <Route path="/conversations/:id" component={ConversationDetail} />
      <Route path="/leads" component={LeadsCRM} />
      <Route path="/leads/:id" component={LeadDetail} />

      <Route path="/marketplace-intelligence/publishing-conflicts" component={PublishingConflictsPage} />
      <Route path="/marketplace-intelligence" component={MarketIntelligencePage} />

      <Route path="/inventory-engine" component={InventoryEngine} />
      <Route path="/ai-photo-studio" component={AIPhotoStudio} />

      <Route path="/dealer-dna" component={DealerDna} />
      <Route path="/connection-center" component={ConnectionCenter} />
      <Route path="/settings" component={Settings} />

      <Route component={NotFound} />
    </Switch>
  );
}

export function AppRouter() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <DashboardRoutes />
    </WouterRouter>
  );
}
