import type { PublishingJob } from "@workspace/db";

export type JobExtras = {
  vehicleLabel: string | null;
  dealerName: string | null;
  listingTitle: string | null;
};

export function toJob(
  job: PublishingJob,
  extras: JobExtras = {
    vehicleLabel: null,
    dealerName: null,
    listingTitle: null,
  },
) {
  return {
    id: job.id,
    listingVersionId: job.listingVersionId,
    vehicleId: job.vehicleId,
    dealerId: job.dealerId,
    mode: job.mode,
    status: job.status,
    currentStep: job.currentStep ?? null,
    progressPercent: job.progressPercent,
    priority: job.priority,
    scheduledAt: job.scheduledAt ? job.scheduledAt.toISOString() : null,
    claimedByExtension: job.claimedByExtension ?? null,
    assignedExtensionId: job.assignedExtensionId ?? null,
    assignedAt: job.assignedAt ? job.assignedAt.toISOString() : null,
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    failedReason: job.failedReason ?? null,
    listingUrl: job.listingUrl ?? null,
    needsReview: job.needsReview,
    reviewReason: job.reviewReason ?? null,
    attempts: job.attempts,
    source: job.source ?? null,
    approvedByUser: job.approvedByUser ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    ...extras,
  };
}
