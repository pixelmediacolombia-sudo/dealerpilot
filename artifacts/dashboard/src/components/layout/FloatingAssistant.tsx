import { useState } from "react";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "What should I work on first?",
  "Publish everything ready.",
  "Generate creatives for new vehicles.",
  "Show vehicles needing attention.",
  "How many buyers are waiting?",
];

export function FloatingAssistant() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-80 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="glass-panel rounded-2xl border border-white/10 overflow-hidden shadow-2xl shadow-black/60">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-widest text-primary">
                    DealerPilot AI
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Ask anything about your inventory
                  </div>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>

            {/* Input area */}
            <div className="p-4">
              <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-muted-foreground">
                <span className="flex-1 text-white/30 text-[13px]">Ask DealerPilot...</span>
                <div className="w-6 h-6 rounded-lg bg-primary/20 flex items-center justify-center">
                  <ArrowRight className="w-3 h-3 text-primary" />
                </div>
              </div>
            </div>

            {/* Example prompts */}
            <div className="px-4 pb-4 space-y-1.5">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-0.5">
                Suggested
              </div>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-[13px] text-white/60 hover:text-white hover:bg-white/[0.05] transition-colors flex items-center gap-2 group"
                >
                  <Sparkles className="w-3 h-3 text-primary/50 group-hover:text-primary shrink-0 transition-colors" />
                  {ex}
                </button>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-white/5 text-[10px] text-muted-foreground/50 text-center">
              AI responses coming soon · visual preview only
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-2xl transition-all duration-300",
          "bg-gradient-to-r from-primary to-accent text-white",
          "hover:shadow-primary/30 hover:shadow-xl hover:scale-105 active:scale-95",
          open && "opacity-0 pointer-events-none scale-90",
        )}
      >
        <div className="w-5 h-5 relative">
          <Sparkles className="w-5 h-5" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-white rounded-full animate-ping opacity-60" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-white rounded-full" />
        </div>
        <span className="text-[13px] font-semibold tracking-wide">Ask DealerPilot</span>
      </button>
    </>
  );
}
