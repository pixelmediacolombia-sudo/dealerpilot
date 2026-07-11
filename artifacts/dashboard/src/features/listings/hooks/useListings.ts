import { useMemo } from "react";
import {
  getListVehiclePhotoScoresQueryKey,
  useListListingWorkspaces,
  useListMarketplaceRecommendations,
  useListPublishingJobs,
  useListVehiclePhotoScores,
} from "../api/listingsApi";

const DEALER_ID = 1;

export function useListings({
  search,
  statusFilter,
  location,
}: {
  search: string;
  statusFilter: string;
  location: string | undefined;
}) {
  const workspacesQuery = useListListingWorkspaces({
    q: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    location,
  });

  const jobsQuery = useListPublishingJobs(
    { location },
    { query: { refetchInterval: 5000 } as never },
  );

  const photoScoresQuery = useListVehiclePhotoScores(
    { dealerId: DEALER_ID },
    { query: { queryKey: getListVehiclePhotoScoresQueryKey({ dealerId: DEALER_ID }) } },
  );

  const intelligenceQuery = useListMarketplaceRecommendations({ location });

  const photoScoreByVehicle = useMemo(
    () => new Map((photoScoresQuery.data?.scores ?? []).map((score) => [score.vehicleId, score])),
    [photoScoresQuery.data],
  );

  const intelligenceMap = useMemo(() => {
    const m = new Map<number, {
      strategyName: string | null;
      recommendedDownPayment: number | null;
      reason: string | null;
      supportingSignals?: string[] | null;
      expectedImpact?: string | null;
      actionCta?: string | null;
    }>();

    for (const rec of intelligenceQuery.data?.recommendations ?? []) {
      m.set(rec.vehicleId, {
        strategyName: rec.strategyName ?? null,
        recommendedDownPayment: rec.recommendedDownPayment ?? null,
        reason: rec.reason ?? null,
        supportingSignals: rec.supportingSignals ?? null,
        expectedImpact: rec.expectedImpact ?? null,
        actionCta: rec.actionCta ?? null,
      });
    }

    return m;
  }, [intelligenceQuery.data]);

  return {
    workspacesData: workspacesQuery.data,
    workspacesLoading: workspacesQuery.isLoading,
    jobsData: jobsQuery.data,
    jobsLoading: jobsQuery.isLoading,
    photoScoreByVehicle,
    intelligenceMap,
    recommendations: intelligenceQuery.data?.recommendations ?? [],
  };
}
