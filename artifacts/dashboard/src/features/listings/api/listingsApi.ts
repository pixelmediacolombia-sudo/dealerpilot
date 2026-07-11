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
