import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useListPublishingBatches,
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
} from "lucide-react";
import { cn } from "@/lib/utils";

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

function BatchCard({ batch }: { batch: PublishingBatch }) {
  const doneCount = batch.completedCount + batch.failedCount + batch.skippedCount;
  const progress =
    batch.totalVehicles > 0 ? Math.round((doneCount / batch.totalVehicles) * 100) : 0;

  const scheduledTime = batch.scheduledAt
    ? new Date(batch.scheduledAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="rounded-xl border border-border/40 bg-card/50 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
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
        <div className="text-right text-xs font-mono text-muted-foreground">
          {doneCount}/{batch.totalVehicles}
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
                : batch.status === "Failed"
                ? "bg-destructive"
                : "bg-primary",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
}

export function BatchProgressCard({ dealerId, refreshKey }: BatchProgressCardProps) {
  const qc = useQueryClient();
  const { data, isLoading } = useListPublishingBatches(
    { dealerId },
    {
      query: {
        queryKey: [...getListPublishingBatchesQueryKey({ dealerId }), refreshKey],
        refetchInterval: 8000,
      },
    },
  );

  const batches = data?.batches ?? [];
  const activeBatches = batches.filter(
    (b) => b.status === "Active" || b.status === "Preparing" || b.status === "Scheduled",
  );
  const recentCompleted = batches
    .filter((b) => b.status === "Completed" || b.status === "Failed")
    .slice(0, 3);

  const shown = [...activeBatches, ...recentCompleted].slice(0, 4);

  if (isLoading || shown.length === 0) return null;

  return (
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
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={() => qc.invalidateQueries({ queryKey: getListPublishingBatchesQueryKey({ dealerId }) })}
        >
          Refresh
        </Button>
      }
      className="border-border/50"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {shown.map((b) => (
          <BatchCard key={b.id} batch={b} />
        ))}
      </div>
    </SectionCard>
  );
}
