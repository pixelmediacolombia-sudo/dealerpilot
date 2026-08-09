import { useState } from "react";
import { format } from "date-fns";
import { Brain, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useListGmDecisions } from "@workspace/api-client-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function RecBadge({ rec }: { rec: string }) {
  if (rec === "PUBLISH")
    return <span className="text-[11px] font-semibold text-success  tracking-wider">Publish</span>;
  if (rec === "HOLD")
    return <span className="text-[11px] font-semibold text-destructive  tracking-wider">Hold</span>;
  return <span className="text-[11px] font-semibold text-warning  tracking-wider">Reconsider</span>;
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, { label: string; color: string }> = {
    confirmed_publish: { label: "Confirmed", color: "text-success" },
    held: { label: "Held", color: "text-destructive" },
    overridden: { label: "Overrode GM", color: "text-warning" },
    batch_blocked: { label: "Batch Blocked", color: "text-destructive/70" },
    batch_published: { label: "Batch Published", color: "text-success/70" },
  };
  const entry = map[action] ?? { label: action, color: "text-muted-foreground" };
  return <span className={cn("text-[11px] font-bold  tracking-wider", entry.color)}>{entry.label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "published")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-success  tracking-wider">
        <span className="w-[5px] h-[5px] rounded-full bg-success shrink-0" />
        Published
      </span>
    );
  if (status === "held")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-destructive/70  tracking-wider">
        <span className="w-[5px] h-[5px] rounded-full bg-destructive/60 shrink-0" />
        Held
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground  tracking-wider">
      <span className="w-[5px] h-[5px] rounded-full bg-muted shrink-0" />
      Blocked
    </span>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function GmDecisionLogPanel() {
  const [expanded, setExpanded] = useState(true);
  const { data, isLoading, refetch, isFetching } = useListGmDecisions({ limit: 30 });

  const decisions = data?.decisions ?? [];

  return (
    <div className="mb-8">
      {/* Section header */}
      <div className="flex items-center gap-2 w-full mb-3">
        <button
          className="flex items-center gap-2 flex-1 min-w-0"
          onClick={() => setExpanded((v) => !v)}
        >
          <Brain className="w-3 h-3 text-primary/40 shrink-0" />
          <p className="text-[11px] font-semibold text-muted-foreground  tracking-wide">
            GM Decision Log
          </p>
          {decisions.length > 0 && (
            <span className="text-[11px] font-bold text-primary/38 font-mono">
              {decisions.length} entr{decisions.length !== 1 ? "ies" : "y"}
            </span>
          )}
          <div className="flex-1 h-px bg-muted" />
        </button>
        <button
          className="p-1 rounded hover:bg-muted transition-colors shrink-0"
          onClick={() => refetch()}
          title="Refresh"
        >
          <RefreshCw className={cn("w-2.5 h-2.5 text-muted-foreground", isFetching && "animate-spin")} />
        </button>
        <button
          className="shrink-0"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronUp className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="rounded-xl border border-border bg-muted overflow-hidden">
          {isLoading ? (
            <div className="space-y-px">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted animate-pulse" />
              ))}
            </div>
          ) : decisions.length === 0 ? (
            <div className="py-10 text-center">
              <Brain className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
              <p className="text-[11px] text-muted-foreground">No GM decisions recorded yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Decisions are logged when you confirm or hold a vehicle in GM Coach.
              </p>
            </div>
          ) : (
            <>
              {/* Header row */}
              <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr_1fr_1fr] gap-x-4 px-4 py-2 border-b border-border">
                {["Vehicle", "GM Rec", "Confidence", "Decision", "Override", "Status", "Time"].map((h) => (
                  <span key={h} className="text-[11px] font-semibold text-muted-foreground  tracking-wide truncate">
                    {h}
                  </span>
                ))}
              </div>
              {/* Data rows */}
              <div className="divide-y divide-white/[0.025]">
                {decisions.map((d) => (
                  <div
                    key={d.id}
                    className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr_1fr_1fr] gap-x-4 px-4 py-2.5 hover:bg-muted transition-colors"
                  >
                    {/* Vehicle */}
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-muted-foreground truncate leading-tight">
                        {d.vehicleLabel}
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono">#{d.vehicleId}</p>
                    </div>

                    {/* GM Rec */}
                    <div className="flex items-center">
                      <RecBadge rec={d.gmRecommendation} />
                    </div>

                    {/* Confidence */}
                    <div className="flex items-center">
                      {d.gmConfidence != null ? (
                        <span
                          className={cn(
                            "text-[11px] font-bold",
                            d.gmConfidence >= 80
                              ? "text-success"
                              : d.gmConfidence >= 60
                                ? "text-warning"
                                : "text-destructive",
                          )}
                        >
                          {d.gmConfidence}%
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>

                    {/* Operator decision */}
                    <div className="flex items-center">
                      <ActionBadge action={d.operatorAction} />
                    </div>

                    {/* Override */}
                    <div className="flex items-center">
                      <span
                        className={cn(
                          "text-xs font-bold",
                          d.overridden ? "text-warning" : "text-muted-foreground",
                        )}
                      >
                        {d.overridden ? "Yes" : "No"}
                      </span>
                    </div>

                    {/* Final status */}
                    <div className="flex items-center">
                      <StatusBadge status={d.finalPublishStatus} />
                    </div>

                    {/* Timestamp */}
                    <div className="flex items-center">
                      <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                        {format(new Date(d.createdAt), "MM/dd HH:mm")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
