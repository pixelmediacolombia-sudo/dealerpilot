import { AppLayout } from "@/components/layout/AppLayout";
import { useLocation } from "wouter";

export function ComingSoon() {
  const [location] = useLocation();
  
  const getPageName = () => {
    switch (location) {
      case "/": return "Sales Hub";
      case "/publishing": return "Publishing";
      case "/leads": return "Leads";
      case "/ai-studio": return "AI Studio";
      case "/dealer-dna": return "Dealer DNA";
      default: return "This feature";
    }
  };

  return (
    <AppLayout>
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 bg-secondary rounded-2xl flex items-center justify-center mb-6">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">{getPageName()}</h1>
        <p className="text-muted-foreground max-w-md">
          This module is currently in development. We are building the next generation of automotive retail tools. Check back soon.
        </p>
      </div>
    </AppLayout>
  );
}
