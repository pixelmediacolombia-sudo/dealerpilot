export {
  getListListingWorkspacesQueryKey,
  getListPublishingJobsQueryKey,
  getListVehiclePhotoScoresQueryKey,
  useAssignPublishingJob,
  useBulkSchedulePublishing,
  useBulkVehicleAction,
  useCancelPublishingJob,
  useListListingWorkspaces,
  useListMarketplaceRecommendations,
  useListPublishingJobs,
  useListVehiclePhotoScores,
  useMarkListingPublished,
  useRetryPublishingJob,
} from "@workspace/api-client-react";

export async function clearPublishingQueue(olderThanMinutes: number) {
  const res = await fetch("/api/publishing/jobs/clear-queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ olderThanMinutes }),
  });

  return (await res.json()) as { cleared: number };
}

export async function reschedulePublishingJob(jobId: number, scheduledAt: string) {
  const res = await fetch(`/api/publishing/jobs/${jobId}/schedule`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduledAt }),
  });

  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error.error ?? "Failed to reschedule publishing job");
  }

  return res.json() as Promise<{ job: unknown }>;
}
