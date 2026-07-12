import { useState } from "react";
import { SectionCard } from "@/shared/ui/SectionCard";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import {
  useListPublishingBatches,
  useUpdatePublishingBatch,
  getListPublishingBatchesQueryKey,
  type PublishingBatch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  Layers,
  Loader2,
  Play,
  XCircle,
  AlertTriangle,
  SkipForward,
  Trash2,
  Ban,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

function batchStatusClass(status: string) {
  switch (status) {
    case "Active":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "Completed":
      return "bg-success/10 text-success border-success/20";
    case "Scheduled":
      return "bg-purple-500/10 text-purple-400 border-purple-500/20";
    case "Preparing":
      return "bg-warning/10 text-warning border-warning/20";
    case "Failed":
    case "Cancelled":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "Paused":
      return "bg-secondary/50 text-muted-foreground border-border";
    default:
      return "bg-secondary/50 text-muted-foreground border-border";
  }
}

function BatchStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "Active":
      return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
    case "Completed":
      return <CheckCircle2 className="w-3.5 h-3.5" />;
    case "Scheduled":
      return <Clock className="w-3.5 h-3.5" />;
    case "Preparing":
      return <Play className="w-3.5 h-3.5" />;
    case "Failed":
    case "Cancelled":
      return <XCircle className="w-3.5 h-3.5" />;
    default:
      return null;
  }
}

interface BatchCardProps {
  batch: PublishingBatch & { progressPercent?: number; currentStep?: string | null };
  onCancel: (id: number) => void;
  onDismiss: (id: number) => void;
  isMutating: boolean;
}

function BatchCard({ batch, onCancel, onDismiss, isMutating }: BatchCardProps) {
  const doneCount = batch.completedCount + batch.failedCount + batch.skippedCount;
  const terminalProgress =
    batch.totalVehicles > 0 ? Math.round((doneCount / batch.totalVehicles) * 100) : 0;
  const liveVehicleProgress = Math.max(0, Math.min(100, batch.progressPercent ?? 0));
  const progress = batch.totalVehicles > 0
    ? Math.max(terminalProgress, Math.round(((doneCount * 100) + liveVehicleProgress) / batch.totalVehicles))
    : 0;

  const scheduledTime = batch.scheduledAt
    ? new Date(batch.scheduledAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const isActive = ["Active", "Preparing", "Scheduled"].includes(batch.status);
  const isDone = ["Completed", "Failed", "Cancelled"].includes(batch.status);

  return (
    <div className="rounded-xl border border-border/40 bg-card/50 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-semibold text-sm">Batch #{batch.batchNumber}</span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 flex items-center gap-1",
                batchStatusClass(batch.status),
              )}
            >
              <BatchStatusIcon status={batch.status} />
              {batch.status}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-bold tracking-widest uppercase px-2 py-0.5",
                batch.mode === "Controlled"
                  ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                  : "bg-blue-500/10 text-blue-400 border-blue-500/20",
              )}
            >
              {batch.mode}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Layers className="w-3 h-3" />
              {batch.totalVehicles} vehicle{batch.totalVehicles !== 1 ? "s" : ""}
            </span>
            {scheduledTime && (
              <>
                <span className="w-1 h-1 rounded-full bg-border" />
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {scheduledTime}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-mono text-muted-foreground mr-1">
            {doneCount}/{batch.totalVehicles}
          </span>
          {isActive && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-destructive/70 hover:text-destructive hover:bg-destructive/10 gap-1"
              disabled={isMutating}
              onClick={() => onCancel(batch.id)}
              title="Cancel batch"
            >
              <Ban className="w-3 h-3" />
              Cancel
            </Button>
          )}
          {isDone && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
              onClick={() => onDismiss(batch.id)}
              title="Remove from view"
            >
              <Trash2 className="w-3 h-3" />
              Remove
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="h-2 bg-secondary/50 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-700",
              batch.status === "Completed"
                ? "bg-success"
                : batch.status === "Failed" || batch.status === "Cancelled"
                  ? "bg-destructive"
                  : "bg-primary",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {batch.currentStep && !isDone && (
            <span className="truncate max-w-[55%]">{batch.currentStep}</span>
          )}
          {batch.completedCount > 0 && (
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="w-3 h-3" />
              {batch.completedCount} published
            </span>
          )}
          {batch.failedCount > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <XCircle className="w-3 h-3" />
              {batch.failedCount} failed
            </span>
          )}
          {batch.skippedCount > 0 && (
            <span className="flex items-center gap-1">
              <SkipForward className="w-3 h-3" />
              {batch.skippedCount} skipped
            </span>
          )}
          {batch.needsReviewCount > 0 && (
            <span className="flex items-center gap-1 text-warning">
              <AlertTriangle className="w-3 h-3" />
              {batch.needsReviewCount} needs review
            </span>
          )}
          <span className="ml-auto font-semibold">{progress}%</span>
        </div>
      </div>
    </div>
  );
}

interface BatchProgressCardProps {
  dealerId: number;
  refreshKey?: number;
  location?: string;
}

export function BatchProgressCard({ dealerId, refreshKey, location }: BatchProgressCardProps) {
  const qc = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const { data, isLoading } = useListPublishingBatches(
    { dealerId, location },
    {
      query: {
        queryKey: [...getListPublishingBatchesQueryKey({ dealerId, location }), refreshKey],
        refetchInterval: 8000,
      },
    },
  );

  const updateBatch = useUpdatePublishingBatch({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPublishingBatchesQueryKey({ dealerId, location }) });
        toast({ title: "Batch cancelled", description: "Publishing batch has been cancelled." });
      },
      onError: () => toast({ title: "Error", description: "Failed to cancel batch", variant: "destructive" }),
    },
  });

  const handleCancel = (id: number) => setConfirmCancel(id);

  const handleDismiss = (id: number) => {
    setDismissed((prev) => new Set([...prev, id]));
  };

  const handleClearCompleted = () => {
    const completedIds = batches.filter((b) => b.status === "Completed").map((b) => b.id);
    setDismissed((prev) => new Set([...prev, ...completedIds]));
  };

  const handleClearFailed = () => {
    const failedIds = batches
      .filter((b) => b.status === "Failed")
      .map((b) => b.id);
    setDismissed((prev) => new Set([...prev, ...failedIds]));
  };

  const allBatches = data?.batches ?? [];
  const batches = allBatches.filter((b) => b.status !== "Cancelled" && !dismissed.has(b.id));

  const activeBatches = batches.filter(
    (b) => b.status === "Active" || b.status === "Preparing" || b.status === "Scheduled",
  );
  const recentCompleted = batches
    .filter((b) => b.status === "Completed" || b.status === "Failed")
    .slice(0, 3);

  const shown = [...activeBatches, ...recentCompleted].slice(0, 5);

  const completedCount = batches.filter((b) => b.status === "Completed").length;
  const failedCount = batches.filter((b) => b.status === "Failed").length;

  if (isLoading || shown.length === 0) return null;

  return (
    <>
      <SectionCard
        title={
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            Publishing Batches
            {activeBatches.length > 0 && (
              <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] font-bold tracking-wider px-2">
                {activeBatches.length} ACTIVE
              </Badge>
            )}
          </div>
        }
        action={
          <div className="flex items-center gap-2">
            {completedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground gap-1.5 h-7"
                onClick={handleClearCompleted}
              >
                <RotateCcw className="w-3 h-3" />
                Clear Completed
              </Button>
            )}
            {failedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-destructive/60 hover:text-destructive gap-1.5 h-7"
                onClick={handleClearFailed}
              >
                <Trash2 className="w-3 h-3" />
                Clear Failed
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground h-7"
              onClick={() => qc.invalidateQueries({ queryKey: getListPublishingBatchesQueryKey({ dealerId, location }) })}
            >
              Refresh
            </Button>
          </div>
        }
        className="border-border/50"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {shown.map((b) => (
            <BatchCard
              key={b.id}
              batch={b}
              onCancel={handleCancel}
              onDismiss={handleDismiss}
              isMutating={updateBatch.isPending}
            />
          ))}
        </div>
      </SectionCard>

      {/* Cancel confirmation */}
      <AlertDialog open={confirmCancel !== null} onOpenChange={(open) => !open && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Publishing Batch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop all pending publishing jobs in this batch. Jobs already in progress may still complete. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (confirmCancel === null) return;
                updateBatch.mutate({ id: confirmCancel, data: { status: "Cancelled" } });
                setConfirmCancel(null);
              }}
            >
              Cancel Batch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
