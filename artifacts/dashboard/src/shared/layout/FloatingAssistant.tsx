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
      {open ? (
        <button
          type="button"
          aria-label="Close DealerPilot assistant"
          className="fixed inset-0 z-40 cursor-default bg-foreground/5"
          onClick={() => setOpen(false)}
        />
      ) : null}

      {open ? (
        <section
          aria-label="DealerPilot assistant"
          className="fixed bottom-[76px] left-3 right-3 z-50 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-overlay)] sm:bottom-20 sm:left-auto sm:right-6 sm:w-[360px]"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">DealerPilot assistant</h2>
                <p className="truncate text-xs text-muted-foreground">Ask about inventory and operations</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close assistant"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="p-4">
            <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40">
              <span className="flex-1">Ask DealerPilot…</span>
              <ArrowRight className="h-4 w-4 text-primary" aria-hidden="true" />
            </button>
          </div>

          <div className="px-4 pb-4">
            <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">Suggested questions</p>
            <div className="space-y-1">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  {example}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Open DealerPilot assistant"
        className={cn(
          "fixed bottom-[76px] right-3 z-30 flex min-h-11 items-center gap-2 rounded-lg border border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-md transition-[background-color,box-shadow,opacity] hover:bg-primary/90 hover:shadow-lg md:bottom-6 md:right-6",
          open && "pointer-events-none opacity-0",
        )}
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Ask DealerPilot</span>
      </button>
    </>
  );
}
