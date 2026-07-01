import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  usePublishNow,
  useGetPublishingJobProgress,
  getGetPublishingJobProgressQueryKey,
  useGetConnectionStatus,
  getGetConnectionStatusQueryKey,
} from "@workspace/api-client-react";
import { ExternalLink, Loader2, CheckCircle2, XCircle, RefreshCw, AlertTriangle, Puzzle, Wifi } from "lucide-react";

interface PublishNowModalProps {
  vehicleId: number | null;
  vehicleLabel?: string | null;
  onClose: () => void;
  onSuccess?: (jobId: number, listingUrl: string | null) => void;
}

const STEPS = [
  { label: "Job created",          minProgress: 0 },
  { label: "Extension active",     minProgress: 10 },
  { label: "Opening Facebook",     minProgress: 15 },
  { label: "Filling vehicle details", minProgress: 35 },
  { label: "All fields filled",    minProgress: 65 },
  { label: "Starting auto-publish",minProgress: 75 },
  { label: "Clicking Next",        minProgress: 82 },
  { label: "Clicking Publish",     minProgress: 92 },
  { label: "Published!",           minProgress: 100 },
];

function StepBubble({ label, done, active, index }: {
  label: string;
  done: boolean;
  active: boolean;
  index: number;
}) {
  return (
    <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
      <div
        className={[
          "w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold transition-all duration-300",
          done
            ? "bg-emerald-500 text-white"
            : active
              ? "bg-primary text-white ring-2 ring-primary/40 scale-110"
              : "bg-white/10 text-muted-foreground",
        ].join(" ")}
      >
        {done ? "✓" : index + 1}
      </div>
      <span className={[
        "text-[9px] text-center leading-tight truncate w-full text-center",
        active ? "text-primary font-semibold" : done ? "text-emerald-400" : "text-muted-foreground",
      ].join(" ")}>
        {label}
      </span>
    </div>
  );
}

// ─── Readiness check helpers ─────────────────────────────────────────────────
function deriveReadiness(data: { chromeExtension?: unknown; facebookSession?: unknown; marketplace?: unknown } | null | undefined): {
  ready: boolean;
  missingStep: string | null;
} {
  if (!data) return { ready: false, missingStep: "Loading connection status…" };
  const extStatus = (data.chromeExtension as { status?: string } | null | undefined)?.status;
  const extOnline = extStatus === "connected" || extStatus === "online";
  if (!extOnline) return { ready: false, missingStep: "Chrome extension is not connected — open the extension popup and log in." };
  const fbLoggedIn = (data.facebookSession as { fbLoggedIn?: boolean | null } | undefined)?.fbLoggedIn;
  if (fbLoggedIn === false) return { ready: false, missingStep: "Not logged into Facebook — open a Facebook tab and log in." };
  const mktConnected = (data.marketplace as { marketplaceConnected?: boolean | null } | undefined)?.marketplaceConnected;
  if (mktConnected === false) return { ready: false, missingStep: "Marketplace not verified — visit Facebook Marketplace in the extension." };
  return { ready: true, missingStep: null };
}

export function PublishNowModal({ vehicleId, vehicleLabel, onClose, onSuccess }: PublishNowModalProps) {
  const isOpen = vehicleId !== null;
  const [jobId, setJobId] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [overrideReadiness, setOverrideReadiness] = useState(false);

  const { data: connStatus } = useGetConnectionStatus({
    query: { queryKey: getGetConnectionStatusQueryKey(), enabled: isOpen, refetchInterval: 10_000 },
  });
  const { ready: publishingReady, missingStep } = deriveReadiness(connStatus);
  const blockedByReadiness = !publishingReady && !overrideReadiness && !jobId;

  const { mutate: publishNow, isPending: isCreating } = usePublishNow({
    mutation: {
      onSuccess: (data) => {
        setJobId(data.jobId ?? null);
        setCreateError(null);
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to create publishing job";
        setCreateError(msg);
      },
    },
  });

  useEffect(() => {
    if (isOpen && vehicleId != null && !blockedByReadiness) {
      setJobId(null);
      setCreateError(null);
      publishNow({ data: { vehicleId } });
    }
  }, [isOpen, vehicleId, retryKey, overrideReadiness]);

  const { data: progress } = useGetPublishingJobProgress(jobId ?? 0, {
    query: {
      queryKey: getGetPublishingJobProgressQueryKey(jobId ?? 0),
      enabled: !!jobId,
      refetchInterval: 2000,
    },
  });

  const isDone = progress?.status === "Published";
  const isFailed =
    progress?.status === "Failed" || progress?.status === "Cancelled";

  const pct = progress?.progressPercent ?? (isCreating ? 0 : jobId ? 5 : 0);
  const currentStepLabel = progress?.currentStep ?? (isCreating ? "Creating job…" : jobId ? "Extension picking up job…" : "");

  const activeStepIdx = STEPS.reduce((last, s, i) => (pct >= s.minProgress ? i : last), 0);

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
    setOverrideReadiness(false);
    onClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="sm:max-w-md bg-[#0f1117] border-white/[0.08] text-foreground">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-foreground">
            {blockedByReadiness
              ? "Not Ready to Publish"
              : isDone
                ? "✓ Published"
                : isFailed
                  ? "Publish Failed"
                  : "Publishing Now…"}
          </DialogTitle>
          {vehicleLabel && (
            <p className="text-xs text-muted-foreground mt-0.5">{vehicleLabel}</p>
          )}
        </DialogHeader>

        {/* Readiness gate — extension not connected / not logged in */}
        {blockedByReadiness && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/8 p-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="text-xs text-amber-300 font-medium">Extension not ready</p>
                <p className="text-[11px] text-amber-400/70">{missingStep}</p>
              </div>
            </div>
            <div className="space-y-1.5 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <Puzzle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Open the DealerPilot Chrome extension and sign in</span>
              </div>
              <div className="flex items-center gap-2">
                <Wifi className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Visit Facebook in the browser tab controlled by the extension</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-muted-foreground hover:text-white"
                onClick={() => setOverrideReadiness(true)}
              >
                Publish anyway
              </Button>
              <Button size="sm" variant="ghost" onClick={handleClose}>Close</Button>
            </div>
          </div>
        )}

        {/* Error state: job creation failed */}
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

        {/* Progress state */}
        {!createError && !isDone && !isFailed && (
          <div className="space-y-4">
            {/* Step bubbles */}
            <div className="flex items-start gap-0.5">
              {STEPS.map((step, i) => (
                <StepBubble
                  key={step.label}
                  label={step.label}
                  index={i}
                  done={i < activeStepIdx}
                  active={i === activeStepIdx}
                />
              ))}
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <Progress value={pct} className="h-1.5 bg-white/10 [&>div]:bg-primary [&>div]:transition-all [&>div]:duration-700" />
              <div className="flex items-center gap-1.5 min-h-[18px]">
                {(isCreating || (!!jobId && !isDone && !isFailed)) && (
                  <Loader2 className="w-3 h-3 animate-spin text-primary flex-shrink-0" />
                )}
                <p className="text-[11px] text-muted-foreground truncate">
                  {currentStepLabel || "Waiting for extension…"}
                </p>
              </div>
            </div>

            {jobId && (
              <p className="text-[10px] text-muted-foreground/60">
                Job #{jobId} · Extension will execute automatically
              </p>
            )}
          </div>
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
      </DialogContent>
    </Dialog>
  );
}
