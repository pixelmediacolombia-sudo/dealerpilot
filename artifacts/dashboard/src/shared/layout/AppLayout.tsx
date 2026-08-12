import { ReactNode } from "react";
import { useLocation } from "wouter";
import { Sidebar } from "./Sidebar";
import { GlobalHeader } from "./GlobalHeader";
import { FloatingAssistant } from "./FloatingAssistant";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();

  return (
    <div className="flex h-[100dvh] min-w-0 overflow-hidden bg-background text-foreground selection:bg-primary/15 selection:text-foreground">
      <a
        href="#dealerpilot-main"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-lg focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <Sidebar />
      <main id="dealerpilot-main" className="relative flex min-w-0 flex-1 flex-col overflow-hidden pb-[68px] lg:pb-0">
        <GlobalHeader />
        <div key={location} className="workspace-transition dashboard-enter flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
          {children}
        </div>
      </main>
      <FloatingAssistant />
    </div>
  );
}
