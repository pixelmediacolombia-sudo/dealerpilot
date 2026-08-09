import { AppLayout } from "@/shared/layout/AppLayout";
import { useLocation } from "wouter";

const moduleMap: Record<string, { name: string; eyebrow: string; accent: string }> = {
  "/publishing": { name: "Publishing", eyebrow: "Marketplace · Sprint 2", accent: "text-success/30" },
  "/leads": { name: "Leads", eyebrow: "Sales AI · Sprint 2", accent: "text-primary/30" },
  "/ai-studio": { name: "AI Studio", eyebrow: "Creative Intelligence · Sprint 2", accent: "text-warning/30" },
  "/dealer-dna": { name: "Dealer DNA", eyebrow: "Brand Intelligence · Sprint 2", accent: "text-orange-400/30" },
  "/marketplace-intelligence": { name: "Market Intel", eyebrow: "Marketplace · Sprint 2", accent: "text-success/30" },
};

export function ComingSoon() {
  const [location] = useLocation();
  const meta = moduleMap[location] ?? { name: "Coming Soon", eyebrow: "DealerPilot AI", accent: "text-muted-foreground" };

  return (
    <AppLayout>
      <div className="h-full flex items-center justify-center animate-in fade-in duration-500">
        <div className="text-center max-w-xs px-8">
          <p className={`text-[11px] font-semibold  tracking-wide mb-7 ${meta.accent}`}>
            {meta.eyebrow}
          </p>
          <h1 className="text-[30px] font-semibold tracking-tight text-muted-foreground mb-3 leading-none">
            {meta.name}
          </h1>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            This module is in active development — part of the next generation of automotive retail intelligence.
          </p>
          <div className="flex items-center justify-center gap-2 mt-10">
            <span className="w-1 h-1 rounded-full bg-primary/25 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-primary/40 animate-pulse [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-primary/25 animate-pulse [animation-delay:300ms]" />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
