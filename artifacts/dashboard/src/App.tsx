import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { TestVehicleCard } from "@/components/TestVehicleCard";
import { TestLeads } from "@/components/TestLeads";
import { MessengerSimulator } from "@/components/MessengerSimulator";

const queryClient = new QueryClient();

function Dashboard() {
  return (
    <div className="min-h-screen bg-background pb-12">
      {/* Header */}
      <header className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg leading-none tracking-tighter">A</span>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">Marketplace AI</h1>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Alpha Motorsport Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>
              Systems Operational
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column - Vehicle & Simulator */}
          <div className="lg:col-span-5 flex flex-col gap-8">
            <section>
              <TestVehicleCard />
            </section>
            <section>
              <MessengerSimulator />
            </section>
          </div>

          {/* Right Column - Leads CRM */}
          <div className="lg:col-span-7">
            <section className="h-full">
              <TestLeads />
            </section>
          </div>

        </div>
      </main>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
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
