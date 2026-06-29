import { cn } from "@/lib/utils";
import {
  useGetConnectionStatus,
  useListFeedRuns,
  useListCreativeJobs,
  useListDealers,
  getGetConnectionStatusQueryKey,
  getListFeedRunsQueryKey,
  getListCreativeJobsQueryKey,
} from "@workspace/api-client-react";

function statusToDot(s: string | undefined): string {
  if (!s) return "bg-muted-foreground";
  const v = s.toLowerCase();
  if (v === "healthy" || v === "connected" || v === "active") return "bg-success";
  if (v === "degraded" || v === "warning") return "bg-warning";
  if (v === "error" || v === "disconnected" || v === "offline") return "bg-destructive";
  return "bg-muted-foreground";
}

function Pill({
  label,
  rawStatus,
  detail,
}: {
  label: string;
  rawStatus: string | undefined;
  detail?: string;
}) {
  const dot = statusToDot(rawStatus);
  const v = rawStatus?.toLowerCase() ?? "";
  const isGood = v === "healthy" || v === "connected" || v === "active";
  const isBad = v === "error" || v === "disconnected" || v === "offline";

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07] transition-colors">
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {isGood && (
          <span
            className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-60",
              dot,
            )}
          />
        )}
        <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", dot)} />
      </span>
      <span className="text-[10px] font-medium text-white/50 whitespace-nowrap">{label}</span>
      {detail && (
        <span
          className={cn(
            "text-[10px] font-semibold whitespace-nowrap",
            isGood ? "text-success/80" : isBad ? "text-destructive/80" : "text-warning/80",
          )}
        >
          {detail}
        </span>
      )}
    </div>
  );
}

export function GlobalHeader() {
  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers[0]?.id;

  const { data: connStatus } = useGetConnectionStatus({
    query: { queryKey: getGetConnectionStatusQueryKey(), refetchInterval: 15000 },
  });

  const { data: feedRunsData } = useListFeedRuns(dealerId ?? 1, {
    query: {
      queryKey: getListFeedRunsQueryKey(dealerId ?? 1),
      enabled: true,
      staleTime: 60000,
    },
  });

  const { data: jobsData } = useListCreativeJobs(undefined, {
    query: { queryKey: getListCreativeJobsQueryKey(), refetchInterval: 10000 },
  });

  // Facebook
  const fbStatus = connStatus?.facebookSession?.status;
  const fbGood = fbStatus?.toLowerCase() === "connected" || fbStatus?.toLowerCase() === "active";

  // Extension
  const extStatus = connStatus?.chromeExtension?.status;
  const extGood =
    extStatus?.toLowerCase() === "connected" || extStatus?.toLowerCase() === "active";

  // Last sync
  const lastRun = feedRunsData?.feedRuns?.[0];
  let syncDetail = "NEVER";
  let syncStatus = "unknown";
  if (lastRun?.finishedAt) {
    const mins = Math.round((Date.now() - new Date(lastRun.finishedAt).getTime()) / 60000);
    syncDetail =
      mins < 1
        ? "JUST NOW"
        : mins < 60
          ? `${mins}m AGO`
          : `${Math.round(mins / 60)}h AGO`;
    syncStatus = lastRun.status === "success" ? "healthy" : "error";
  }

  // AI
  const jobs = jobsData?.jobs ?? [];
  const activeJobs = jobs.filter(
    (j) => j.status === "Queued" || j.status === "Generating",
  ).length;
  const aiStatus = activeJobs > 0 ? "active" : "healthy";
  const aiDetail = activeJobs > 0 ? `${activeJobs} ACTIVE` : "IDLE";

  return (
    <header className="h-10 border-b border-white/[0.05] bg-background/80 backdrop-blur-sm flex items-center justify-end gap-1.5 px-5 shrink-0 relative z-30">
      <Pill label="Facebook" rawStatus={fbGood ? "connected" : (fbStatus ?? "unknown")} detail={fbGood ? "CONNECTED" : "OFFLINE"} />
      <Pill label="Extension" rawStatus={extGood ? "connected" : (extStatus ?? "unknown")} detail={extGood ? "ONLINE" : "OFFLINE"} />
      <Pill label="Last Sync" rawStatus={syncStatus} detail={syncDetail} />
      <Pill label="AI" rawStatus={aiStatus} detail={aiDetail} />
    </header>
  );
}
