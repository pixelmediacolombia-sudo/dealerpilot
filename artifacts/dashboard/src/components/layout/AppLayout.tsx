import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { GlobalHeader } from "./GlobalHeader";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground overflow-hidden selection:bg-primary/30 selection:text-white">
      {/* Ambient background glows */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] rounded-full bg-accent/5 blur-[120px]" />
      </div>

      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden relative z-10 min-w-0">
        <GlobalHeader />
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
