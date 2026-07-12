export type PublishingBatchStatus = "Scheduled" | "Preparing" | "Active" | "Paused" | "Completed" | "Failed" | "Cancelled";

export function getInitialBatchTiming(baseTime: Date, nowMs = Date.now()): {
  status: PublishingBatchStatus;
  startedAt: Date | null;
} {
  const startsInFuture = baseTime.getTime() > nowMs;
  return {
    status: startsInFuture ? "Scheduled" : "Active",
    startedAt: startsInFuture ? null : new Date(nowMs),
  };
}

export function deriveBatchProgress(input: {
  completed: number;
  failed: number;
  skipped: number;
  needsReview?: number;
  totalVehicles: number;
}): {
  completed: number;
  failed: number;
  skipped: number;
  needsReview: number;
  terminal: number;
  isDone: boolean;
  status: PublishingBatchStatus;
} {
  const completed = Math.max(0, Number(input.completed) || 0);
  const failed = Math.max(0, Number(input.failed) || 0);
  const skipped = Math.max(0, Number(input.skipped) || 0);
  const needsReview = Math.max(0, Number(input.needsReview) || 0);
  const totalVehicles = Math.max(0, Number(input.totalVehicles) || 0);
  const terminal = completed + failed + skipped + needsReview;
  const isDone = totalVehicles > 0 && terminal >= totalVehicles;

  return {
    completed,
    failed,
    skipped,
    needsReview,
    terminal,
    isDone,
    status: isDone ? (failed > 0 ? "Failed" : "Completed") : "Active",
  };
}
