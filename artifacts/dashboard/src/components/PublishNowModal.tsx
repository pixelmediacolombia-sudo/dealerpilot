import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  usePublishNow,
  useGetPublishingJobProgress,
  getGetPublishingJobProgressQueryKey,
} from "@workspace/api-client-react";
import {
  ExternalLink,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Circle,
} from "lucide-react";

interface PublishNowModalProps {
  vehicleId: number | null;
  vehicleLabel?: string | null;
  onClose: () => void;
  onSuccess?: (jobId: number, listingUrl: string | null) => void;
}

// 11 granular steps aligned with the extension's event flow
const PUBLISH_STEPS = [
  { label: "Job created",             minPct: 0   },
  { label: "Extension connected",     minPct: 8   },
  { label: "Opening Facebook",        minPct: 10  },
  { label: "Downloading photos",      minPct: 12  },
  { label: "Uploading to Facebook",   minPct: 28  },
  { label: "Waiting for thumbnails",  minPct: 48  },
  { label: "Filling vehicle details", minPct: 55  },
  { label: "Clicking Next",           minPct: 76  },
  { label: "Publishing",              minPct: 82  },
  { label: "Capturing listing URL",   minPct: 95  },
  { label: "Published!",              minPct: 100 },
];

function StepRow({ label, state }: {
  label: string;
  state: "done" | "active" | "waiting";
}) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
        {state === "done" ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        ) : state === "active" ? (
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        ) : (
          <Circle className="w-4 h-4 text-white/20" />
        )}
      </span>
      <span className={[
        "text-xs leading-tight",
        state === "done"    ? "text-emerald-400"       :
        state === "active"  ? "text-foreground font-semibold" :
                              "text-muted-foreground/60",
      ].join(" ")}>
        {label}
      </span>
    </div>
  );
}

export function PublishNowModal({ vehicleId, vehicleLabel, onClose, onSuccess }: PublishNowModalProps) {
  const isOpen = vehicleId !== null;
  const [jobId, setJobId] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // After the job is created, try to wake the extension immediately via
  // chrome.runtime.sendMessage (requires externally_connectable in the manifest).
  // Falls back silently to alarm polling if the extension is not connected.
  async function tryWakeExtension() {
    try {
      const status = await fetch("/api/extension/connect-status")
        .then((r) => r.json())
        .catch(() => null);
      const extId: string | undefined = status?.extensionId;
      if (!extId) return;
      // chrome.runtime is available in Chrome when externally_connectable is configured
      const cr = (window as { chrome?: { runtime?: { sendMessage?: Function; lastError?: unknown } } })
        .chrome?.runtime;
      if (!cr?.sendMessage) return;
      cr.sendMessage(extId, { type: "POLL_NOW" }, () => {
        // Suppress "Could not establish connection" — extension may be unloaded
        void cr.lastError;
      });
    } catch {
      // Non-critical — alarm polling is the fallback
    }
  }

  const { mutate: publishNow, isPending: isCreating } = usePublishNow({
    mutation: {
      onSuccess: (data) => {
        setJobId(data.jobId ?? null);
        setCreateError(null);
        // Instant wake: tell the extension to poll now instead of waiting for the alarm
        void tryWakeExtension();
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to create publishing job";
        setCreateError(msg);
      },
    },
  });

  useEffect(() => {
    if (isOpen && vehicleId != null) {
      setJobId(null);
      setCreateError(null);
      publishNow({ data: { vehicleId } });
    }
  }, [isOpen, vehicleId, retryKey]);

  const { data: progress } = useGetPublishingJobProgress(jobId ?? 0, {
    query: {
      queryKey: getGetPublishingJobProgressQueryKey(jobId ?? 0),
      enabled: !!jobId,
      refetchInterval: 1500,
    },
  });

  const isDone   = progress?.status === "Published";
  const isFailed = progress?.status === "Failed" || progress?.status === "Cancelled";

  const pct = progress?.progressPercent ?? (isCreating ? 0 : jobId ? 5 : 0);
  const currentStepLabel = progress?.currentStep
    ?? (isCreating ? "Creating job…" : jobId ? "Waiting for extension…" : "");

  // Determine which step is active based on progress %
  const activeStepIdx = PUBLISH_STEPS.reduce((last, s, i) => (pct >= s.minPct ? i : last), 0);

  useEffect(() => {
    if (isDone && jobId && onSuccess) {
      onSuccess(jobId, progress?.listingUrl ?? null);
    }
  }, [isDone]);

  function handleRetry() {
    setJobId(null);
    setCreateError(null);
    setRetryKey((k) => k + 1);
  }

  function handleClose() {
    setJobId(null);
    setCreateError(null);
    onClose();
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <SheetContent
        side="right"
        className="w-[360px] sm:w-[400px] bg-[#0b1220] border-white/[0.08] flex flex-col gap-0 p-0"
      >
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <SheetTitle className="text-sm font-semibold">
            {isDone ? "✓ Published to Marketplace" : isFailed ? "Publish Failed" : "Publishing Now…"}
          </SheetTitle>
          {vehicleLabel && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{vehicleLabel}</p>
          )}
          {jobId && !isDone && !isFailed && (
            <p className="text-[10px] text-muted-foreground/50 mt-0.5">Job #{jobId}</p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Error: job creation failed */}
          {createError && !jobId && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-300">{createError}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleRetry} className="gap-1.5">
                  <RefreshCw className="w-3 h-3" /> Retry
                </Button>
                <Button size="sm" variant="ghost" onClick={handleClose}>Close</Button>
              </div>
            </div>
          )}

          {/* In-progress state */}
          {!createError && !isDone && !isFailed && (
            <>
              {/* Progress bar + live status */}
              <div className="space-y-2">
                <Progress
                  value={pct}
                  className="h-1.5 bg-white/10 [&>div]:bg-primary [&>div]:transition-all [&>div]:duration-500"
                />
                <div className="flex items-center gap-1.5 min-h-[18px]">
                  {(isCreating || (!!jobId && !isDone && !isFailed)) && (
                    <Loader2 className="w-3 h-3 animate-spin text-primary flex-shrink-0" />
                  )}
                  <p className="text-[11px] text-muted-foreground truncate">
                    {currentStepLabel || "Waiting for extension…"}
                  </p>
                </div>
              </div>

              {/* Granular step list */}
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 space-y-0.5">
                {PUBLISH_STEPS.map((step, i) => {
                  const stepState =
                    (isDone || i < activeStepIdx)  ? "done"    :
                    i === activeStepIdx             ? "active"  :
                                                      "waiting";
                  return (
                    <StepRow key={step.label} label={step.label} state={stepState} />
                  );
                })}
              </div>
            </>
          )}

          {/* Success state */}
          {isDone && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs text-emerald-300 font-medium">Vehicle published to Marketplace</p>
                  {progress?.listingUrl && (
                    <a
                      href={progress.listingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      View listing <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              </div>
              <Button size="sm" onClick={handleClose} className="w-full">Close</Button>
            </div>
          )}

          {/* Failure state */}
          {isFailed && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs text-red-300 font-medium">Auto-publish failed</p>
                  {progress?.failedReason && (
                    <p className="text-[11px] text-red-300/80">{progress.failedReason}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleRetry} className="gap-1.5 flex-1">
                  <RefreshCw className="w-3 h-3" /> Retry
                </Button>
                <Button size="sm" variant="ghost" onClick={handleClose}>Close</Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
