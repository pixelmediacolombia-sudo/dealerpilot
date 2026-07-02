import { useEffect, useRef, useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, XCircle, Circle, Clock, X } from "lucide-react";

const COOLDOWN_SECS = 120;
const POLL_INTERVAL_MS = 1500;
const JOB_TIMEOUT_MS = 5 * 60 * 1000;

export interface BatchVehicle {
  id: number;
  label: string;
}

type VehicleResult =
  | { status: "pending" }
  | { status: "creating" }
  | { status: "publishing"; jobId: number; pct: number; step: string | null }
  | { status: "done"; listingUrl: string | null }
  | { status: "failed"; reason: string }
  | { status: "cooldown" };

interface BatchTodayPanelProps {
  isOpen: boolean;
  vehicles: BatchVehicle[];
  onClose: () => void;
}

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export function BatchTodayPanel({ isOpen, vehicles, onClose }: BatchTodayPanelProps) {
  const [results, setResults] = useState<VehicleResult[]>(() =>
    vehicles.map(() => ({ status: "pending" } as VehicleResult)),
  );
  const [cooldownSecs, setCooldownSecs] = useState(0);
  const [batchDone, setBatchDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const updateResult = useCallback((idx: number, result: VehicleResult) => {
    setResults((prev) => {
      const next = [...prev];
      next[idx] = result;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isOpen || vehicles.length === 0) return;

    const ac = new AbortController();
    abortRef.current = ac;

    const run = async () => {
      for (let i = 0; i < vehicles.length; i++) {
        if (ac.signal.aborted) return;

        updateResult(i, { status: "creating" });

        let jobId: number;
        try {
          const res = await fetch("/api/publishing/jobs/publish-now", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vehicleId: vehicles[i].id }),
            signal: ac.signal,
          });
          const data = (await res.json()) as { jobId?: number; error?: string };
          if (!res.ok) throw new Error(data.error ?? "Failed to create job");
          if (!data.jobId) throw new Error("No job ID returned");
          jobId = data.jobId;
        } catch (err: unknown) {
          if (ac.signal.aborted) return;
          const reason =
            err instanceof Error ? err.message : "Failed to create publishing job";
          updateResult(i, { status: "failed", reason });
          return;
        }

        updateResult(i, { status: "publishing", jobId, pct: 0, step: null });

        const deadline = Date.now() + JOB_TIMEOUT_MS;
        let vehiclePublished = false;

        while (Date.now() < deadline) {
          if (ac.signal.aborted) return;
          try {
            await sleepMs(POLL_INTERVAL_MS, ac.signal);
          } catch {
            return;
          }
          if (ac.signal.aborted) return;

          let progress: Record<string, unknown>;
          try {
            const res = await fetch(`/api/publishing/jobs/${jobId}/progress`, {
              signal: ac.signal,
            });
            progress = (await res.json()) as Record<string, unknown>;
          } catch {
            if (ac.signal.aborted) return;
            continue;
          }

          updateResult(i, {
            status: "publishing",
            jobId,
            pct: (progress.progressPercent as number) ?? 0,
            step: (progress.currentStep as string | null) ?? null,
          });

          if (progress.status === "Published") {
            updateResult(i, {
              status: "done",
              listingUrl: (progress.listingUrl as string | null) ?? null,
            });
            vehiclePublished = true;
            break;
          }
          if (progress.status === "Failed" || progress.status === "Cancelled") {
            const reason =
              (progress.failedReason as string | null) ?? `Job ${progress.status}`;
            updateResult(i, { status: "failed", reason });
            return;
          }
        }

        if (!vehiclePublished) {
          updateResult(i, {
            status: "failed",
            reason: "Publishing timed out after 5 minutes",
          });
          return;
        }

        if (i < vehicles.length - 1) {
          if (i + 1 < vehicles.length) updateResult(i + 1, { status: "cooldown" });
          for (let s = COOLDOWN_SECS; s > 0; s--) {
            if (ac.signal.aborted) return;
            setCooldownSecs(s);
            try {
              await sleepMs(1000, ac.signal);
            } catch {
              return;
            }
          }
          setCooldownSecs(0);
        }
      }

      setBatchDone(true);
    };

    run().catch(() => {});

    return () => ac.abort();
  }, [isOpen, vehicles, updateResult]);

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  const hasFailed = results.some((r) => r.status === "failed");

  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 bg-background border-border/50 flex flex-col"
      >
        <SheetHeader className="p-6 pb-4 border-b border-border/40 flex-shrink-0">
          <SheetTitle className="text-foreground flex items-center gap-2">
            Publish Today's 3
            {batchDone && <CheckCircle2 className="w-4 h-4 text-success" />}
          </SheetTitle>
          <SheetDescription>
            Publishing vehicles one at a time with a 2-minute cooldown between each.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {vehicles.map((v, i) => (
            <VehicleStep
              key={v.id}
              index={i + 1}
              label={v.label}
              result={results[i] ?? { status: "pending" }}
              cooldownSecs={results[i]?.status === "cooldown" ? cooldownSecs : 0}
            />
          ))}

          {batchDone && (
            <div className="rounded-lg bg-success/10 border border-success/20 p-4 text-center mt-4">
              <CheckCircle2 className="w-6 h-6 text-success mx-auto mb-2" />
              <p className="text-sm font-bold text-success">All 3 vehicles published!</p>
              <p className="text-xs text-muted-foreground mt-1">
                Check the Published tab to see live listings.
              </p>
            </div>
          )}

          {hasFailed && !batchDone && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-center mt-4">
              <XCircle className="w-5 h-5 text-destructive mx-auto mb-2" />
              <p className="text-sm font-bold text-destructive">Batch stopped</p>
              <p className="text-xs text-muted-foreground mt-1">
                Fix the issue and retry individual vehicles from the queue.
              </p>
            </div>
          )}
        </div>

        {(batchDone || hasFailed) && (
          <div className="p-6 pt-0 flex-shrink-0">
            <Button className="w-full" variant="outline" onClick={handleClose}>
              <X className="w-4 h-4 mr-2" />
              Close
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function VehicleStep({
  index,
  label,
  result,
  cooldownSecs,
}: {
  index: number;
  label: string;
  result: VehicleResult;
  cooldownSecs: number;
}) {
  const icon = () => {
    switch (result.status) {
      case "done":
        return <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-destructive flex-shrink-0" />;
      case "creating":
      case "publishing":
        return <Loader2 className="w-5 h-5 text-primary animate-spin flex-shrink-0" />;
      case "cooldown":
        return <Clock className="w-5 h-5 text-amber-400 flex-shrink-0" />;
      default:
        return <Circle className="w-5 h-5 text-muted-foreground/30 flex-shrink-0" />;
    }
  };

  const statusContent = () => {
    switch (result.status) {
      case "pending":
        return <span className="text-xs text-muted-foreground">Waiting…</span>;
      case "creating":
        return (
          <span className="text-xs text-primary animate-pulse">Creating job…</span>
        );
      case "publishing":
        return (
          <div className="space-y-1 w-full">
            <div className="flex items-center justify-between">
              <span className="text-xs text-primary">
                {result.step ?? "Publishing…"}
              </span>
              <span className="text-[10px] text-muted-foreground">{result.pct}%</span>
            </div>
            <Progress value={result.pct} className="h-1.5" />
          </div>
        );
      case "done":
        return (
          <span className="text-xs text-success">
            Published
            {result.listingUrl && (
              <a
                href={result.listingUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-1 underline opacity-70"
              >
                ↗ View
              </a>
            )}
          </span>
        );
      case "failed":
        return (
          <span className="text-xs text-destructive line-clamp-2">{result.reason}</span>
        );
      case "cooldown":
        return (
          <span className="text-xs text-amber-400">
            Cooldown — next vehicle in {cooldownSecs}s
          </span>
        );
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-3 flex items-start gap-3 transition-colors",
        result.status === "done"
          ? "border-success/20 bg-success/5"
          : result.status === "failed"
            ? "border-destructive/20 bg-destructive/5"
            : result.status === "publishing" || result.status === "creating"
              ? "border-primary/20 bg-primary/5"
              : result.status === "cooldown"
                ? "border-amber-500/20 bg-amber-500/5"
                : "border-border/30 bg-secondary/10",
      )}
    >
      {icon()}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground mb-1.5">
          {index}. {label}
        </p>
        <div
          className={cn(
            "flex items-center",
            result.status === "publishing" ? "flex-col items-start w-full" : "",
          )}
        >
          {statusContent()}
        </div>
      </div>
    </div>
  );
}
