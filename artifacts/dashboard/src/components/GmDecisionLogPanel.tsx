import { useState } from "react";
import { format } from "date-fns";
import { Brain, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useListGmDecisions } from "@workspace/api-client-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function RecBadge({ rec }: { rec: string }) {
  if (rec === "PUBLISH")
    return <span className="text-[9px] font-black text-emerald-400 uppercase tracking-wider">Publish</span>;
  if (rec === "HOLD")
    return <span className="text-[9px] font-black text-red-400 uppercase tracking-wider">Hold</span>;
  return <span className="text-[9px] font-black text-amber-400 uppercase tracking-wider">Reconsider</span>;
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, { label: string; color: string }> = {
    confirmed_publish: { label: "Confirmed", color: "text-emerald-400" },
    held: { label: "Held", color: "text-red-400" },
    overridden: { label: "Overrode GM", color: "text-amber-400" },
    batch_blocked: { label: "Batch Blocked", color: "text-red-400/70" },
    batch_published: { label: "Batch Published", color: "text-emerald-400/70" },
  };
  const entry = map[action] ?? { label: action, color: "text-white/30" };
  return <span className={cn("text-[9px] font-bold uppercase tracking-wider", entry.color)}>{entry.label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "published")
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400 uppercase tracking-wider">
        <span className="w-[5px] h-[5px] rounded-full bg-emerald-400 shrink-0" />
        Published
      </span>
    );
  if (status === "held")
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-red-400/70 uppercase tracking-wider">
        <span className="w-[5px] h-[5px] rounded-full bg-red-400/60 shrink-0" />
        Held
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-white/25 uppercase tracking-wider">
      <span className="w-[5px] h-[5px] rounded-full bg-white/20 shrink-0" />
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
          <Brain className="w-3 h-3 text-blue-400/40 shrink-0" />
          <p className="text-[9px] font-black text-white/18 uppercase tracking-[0.22em]">
            GM Decision Log
          </p>
          {decisions.length > 0 && (
            <span className="text-[9px] font-bold text-blue-400/38 font-mono">
              {decisions.length} entr{decisions.length !== 1 ? "ies" : "y"}
            </span>
          )}
          <div className="flex-1 h-px bg-white/[0.04]" />
        </button>
        <button
          className="p-1 rounded hover:bg-white/[0.04] transition-colors shrink-0"
          onClick={() => refetch()}
          title="Refresh"
        >
          <RefreshCw className={cn("w-2.5 h-2.5 text-white/18", isFetching && "animate-spin")} />
        </button>
        <button
          className="shrink-0"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronUp className="w-3 h-3 text-white/18" />
          ) : (
            <ChevronDown className="w-3 h-3 text-white/18" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] overflow-hidden">
          {isLoading ? (
            <div className="space-y-px">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-white/[0.015] animate-pulse" />
              ))}
            </div>
          ) : decisions.length === 0 ? (
            <div className="py-10 text-center">
              <Brain className="w-5 h-5 text-white/8 mx-auto mb-2" />
              <p className="text-[11px] text-white/18">No GM decisions recorded yet</p>
              <p className="text-[10px] text-white/10 mt-1">
                Decisions are logged when you confirm or hold a vehicle in GM Coach.
              </p>
            </div>
          ) : (
            <>
              {/* Header row */}
              <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr_1fr_1fr] gap-x-4 px-4 py-2 border-b border-white/[0.04]">
                {["Vehicle", "GM Rec", "Confidence", "Decision", "Override", "Status", "Time"].map((h) => (
                  <span key={h} className="text-[8px] font-black text-white/18 uppercase tracking-[0.16em] truncate">
                    {h}
                  </span>
                ))}
              </div>
              {/* Data rows */}
              <div className="divide-y divide-white/[0.025]">
                {decisions.map((d) => (
                  <div
                    key={d.id}
                    className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr_1fr_1fr] gap-x-4 px-4 py-2.5 hover:bg-white/[0.015] transition-colors"
                  >
                    {/* Vehicle */}
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-white/65 truncate leading-tight">
                        {d.vehicleLabel}
                      </p>
                      <p className="text-[9px] text-white/20 font-mono">#{d.vehicleId}</p>
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
                              ? "text-emerald-400"
                              : d.gmConfidence >= 60
                                ? "text-amber-400"
                                : "text-red-400",
                          )}
                        >
                          {d.gmConfidence}%
                        </span>
                      ) : (
                        <span className="text-[10px] text-white/18">—</span>
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
                          "text-[10px] font-bold",
                          d.overridden ? "text-amber-400" : "text-white/20",
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
                      <span className="text-[9px] text-white/20 font-mono tabular-nums">
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
