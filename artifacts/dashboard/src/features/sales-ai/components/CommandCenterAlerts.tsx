import { useEffect, useState } from "react";
import { AlertTriangle, ArrowUpRight, Clock3, ExternalLink, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/lib/utils";

export type CommandCenterAlert = {
  id: string;
  kind: "marketplace_cleanup" | "publishing_stalled";
  severity: "critical" | "warning";
  title: string;
  message: string;
  vehicleId?: number;
  vehicleLabel?: string;
  stockNumber?: string | null;
  listingUrl?: string | null;
  detectedAt?: string | null;
  actionPath: string;
  eligibleVehicleCount?: number;
  extensionOnline?: boolean;
};

type AlertsResponse = {
  alerts: CommandCenterAlert[];
  summary: { marketplaceCleanupCount: number; publishingStalled: boolean };
};

export function useCommandCenterAlerts(dealerId: number | undefined, location?: string) {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!dealerId) return;
    let cancelled = false;
    const controller = new AbortController();
    const params = new URLSearchParams({ dealerId: String(dealerId) });
    if (location) params.set("location", location);

    const load = (signal?: AbortSignal) =>
      fetch(`/api/command-center/alerts?${params.toString()}`, {
        signal,
        headers: { Accept: "application/json" },
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Failed to load operational alerts");
          return (await response.json()) as AlertsResponse;
        })
        .then((next) => {
          if (!cancelled) {
            setData(next);
            setError(false);
          }
        })
        .catch(() => {
          if (!cancelled && !signal?.aborted) setError(true);
        });

    void load(controller.signal);
    const refresh = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(refresh);
    };
  }, [dealerId, location]);

  return { data, error };
}

function relativeTime(value: string | null | undefined): string {
  if (!value) return "sin fecha";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `hace ${minutes || 1} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

export function CommandCenterAlerts({
  alerts,
  error,
  onNavigate,
}: {
  alerts: CommandCenterAlert[];
  error: boolean;
  onNavigate: (path: string) => void;
}) {
  if (error && alerts.length === 0) {
    return (
      <div className="mb-6 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5" />
        No se pudo actualizar el estado operativo. Intenta de nuevo en unos segundos.
      </div>
    );
  }
  if (alerts.length === 0) return null;

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-warning/25 bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_12px_rgb(15_23_42/0.035)]" aria-live="polite">
      <div className="flex items-center gap-3 border-b border-warning/15 bg-warning/[0.045] px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-warning/12 text-warning">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Atención ahora</p>
          <p className="text-xs text-muted-foreground">Hay {alerts.length} asunto{alerts.length === 1 ? "" : "s"} que requiere{alerts.length === 1 ? "" : "n"} atención operativa.</p>
        </div>
        <span className="rounded-full bg-warning/10 px-2 py-1 text-[11px] font-semibold tabular-nums text-warning">{alerts.length}</span>
      </div>

      <div className="divide-y divide-border/70">
        {alerts.slice(0, 6).map((alert) => (
          <div key={alert.id} className="flex items-start gap-3 px-4 py-3.5">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", alert.severity === "critical" ? "bg-destructive" : "bg-warning")} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-[13px] font-semibold text-foreground">{alert.title}</p>
                {alert.kind === "publishing_stalled" && !alert.extensionOnline ? <WifiOff className="h-3.5 w-3.5 text-destructive" aria-label="Extensión desconectada" /> : null}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{alert.message}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/70">
                {alert.vehicleLabel ? <span className="font-medium text-foreground/75">{alert.vehicleLabel}</span> : null}
                {alert.stockNumber ? <span>#{alert.stockNumber}</span> : null}
                {alert.detectedAt ? <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{relativeTime(alert.detectedAt)}</span> : null}
                {alert.eligibleVehicleCount != null ? <span>{alert.eligibleVehicleCount} listos para publicar</span> : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {alert.listingUrl ? (
                <a href={alert.listingUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">
                  <ExternalLink className="h-3 w-3" /> Abrir
                </a>
              ) : null}
              <Button size="sm" variant="outline" className="h-8 gap-1.5 border-border px-2.5 text-xs" onClick={() => onNavigate(alert.actionPath)}>
                Resolver <ArrowUpRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
