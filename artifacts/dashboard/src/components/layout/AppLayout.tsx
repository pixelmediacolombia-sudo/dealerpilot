import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { GlobalHeader } from "./GlobalHeader";
import { FloatingAssistant } from "./FloatingAssistant";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex h-[100dvh] bg-[#06040d] text-foreground overflow-hidden selection:bg-primary/30 selection:text-white">

      {/* Deep cockpit ambient */}
      <div className="fixed inset-0 pointer-events-none z-0">
        {/* Base graphite */}
        <div className="absolute inset-0 bg-[#06040d]" />
        {/* Top-left blue glow — subtle system pulse */}
        <div className="absolute top-[-80px] left-[120px] w-[700px] h-[500px] rounded-full bg-blue-500/[0.032] blur-[180px]" />
        {/* Bottom-right violet glow — ambient depth */}
        <div className="absolute bottom-[-100px] right-[-50px] w-[500px] h-[400px] rounded-full bg-violet-500/[0.022] blur-[140px]" />
      </div>

      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden relative z-10 min-w-0">
        <GlobalHeader />
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>

      <FloatingAssistant />
    </div>
  );
}
