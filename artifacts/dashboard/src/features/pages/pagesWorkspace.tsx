import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, Facebook, Loader2, RefreshCw, Send, Settings2, Sparkles, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAuthToken, useAccount } from "@/app/AuthGate";
import { AppLayout } from "@/shared/layout/AppLayout";

type PageSettings = {
  enabled: boolean;
  vehiclesPerBatch: number;
  frequencyDays: number;
  preferredWindowStart: string;
  preferredWindowEnd: string;
  maxPostsPerDay: number;
  minDelayMinutes: number;
  requireApproval: boolean;
  useOriginalPhotos: boolean;
  aiCreativeIfLow: boolean;
  photoScoreThreshold: number;
};

type BatchVehicle = {
  id: number;
  vehicleId: number;
  status: string;
  currentStep: string | null;
  scheduledAt: string | null;
  metaPostId: string | null;
  postUrl: string | null;
  failedReason: string | null;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  price: number | null;
  stockNumber: string | null;
  vin: string;
};

type NextBatch = {
  id: number;
  batchNumber: number;
  status: string;
  scheduledAt: string | null;
  totalVehicles: number;
  completedCount: number;
  failedCount: number;
  vehicles: BatchVehicle[];
};

type PageConnection = {
  pageId: string;
  pageName: string | null;
  scopes: string[];
  status: string;
  lastValidatedAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
};

type PageConnectionResponse = {
  configured: boolean;
  connection: PageConnection | null;
};

type PageValidationResponse = {
  validation: {
    ok: boolean;
    pageName: string | null;
    grantedPermissions: string[];
    missingPermissions: string[];
    error: string | null;
  };
  connection: PageConnection | null;
};

const DEFAULT_SETTINGS: PageSettings = {
  enabled: false,
  vehiclesPerBatch: 3,
  frequencyDays: 1,
  preferredWindowStart: "09:00",
  preferredWindowEnd: "17:00",
  maxPostsPerDay: 3,
  minDelayMinutes: 30,
  requireApproval: false,
  useOriginalPhotos: true,
  aiCreativeIfLow: true,
  photoScoreThreshold: 60,
};

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; validation?: { error?: string | null } };
  if (!response.ok) throw new Error(payload.validation?.error || payload.error || `Request failed (${response.status})`);
  return payload;
}

function formatDate(value: string | null): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPrice(value: number | null): string {
  if (value == null) return "Price pending";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function statusTone(status: string): string {
  if (status === "Published") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Needs Review" || status === "Failed") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "Publishing") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-border bg-muted/40 text-muted-foreground";
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-[background-color,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        checked ? "border-primary bg-primary" : "border-border bg-muted",
      )}
    >
      <span className={cn("absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

export function PagesWorkspace() {
  const user = useAccount();
  const dealerId = user.dealerId;
  const [settings, setSettings] = useState<PageSettings>(DEFAULT_SETTINGS);
  const [configured, setConfigured] = useState(false);
  const [connection, setConnection] = useState<PageConnection | null>(null);
  const [batch, setBatch] = useState<NextBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsResponse, batchResponse, connectionResponse] = await Promise.all([
        readJson<{ configured: boolean; settings: PageSettings | null }>(`/api/pages/settings/${dealerId}`),
        readJson<{ batch: NextBatch | null }>(`/api/pages/batches/next?dealerId=${dealerId}`),
        readJson<PageConnectionResponse>(`/api/pages/connection/${dealerId}`),
      ]);
      setConfigured(settingsResponse.configured);
      setSettings(settingsResponse.settings ?? DEFAULT_SETTINGS);
      setBatch(batchResponse.batch);
      setConnection(connectionResponse.connection);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Page publishing");
    } finally {
      setLoading(false);
    }
  }, [dealerId]);

  useEffect(() => { void load(); }, [load]);

  const updateSetting = <K extends keyof PageSettings>(key: K, value: PageSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const validateConnection = async () => {
    setValidating(true);
    setError(null);
    try {
      const response = await readJson<PageValidationResponse>(`/api/pages/connection/${dealerId}/validate`, { method: "POST", body: "{}" });
      setConnection(response.connection);
      if (!response.validation.ok) setError(response.validation.error || "Meta Page validation failed");
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Unable to validate the Meta Page connection");
    } finally {
      setValidating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await readJson(`/api/pages/settings/${dealerId}`, { method: "PUT", body: JSON.stringify(settings) });
      setConfigured(true);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the plan");
    } finally {
      setSaving(false);
    }
  };

  const runWorker = async () => {
    setRunning(true);
    setError(null);
    try {
      await readJson("/api/pages/worker/run", { method: "POST" });
      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Unable to process the queue");
    } finally {
      setRunning(false);
    }
  };

  const nextVehicleLabel = useMemo(() => {
    if (!batch?.vehicles.length) return "No vehicles are queued yet";
    return `${batch.vehicles.length} vehicle${batch.vehicles.length === 1 ? "" : "s"} ready`;
  }, [batch]);

  return (
    <AppLayout>
      <div className="min-h-full bg-background px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px] space-y-5">
        <header className="flex flex-col justify-between gap-4 border-b border-border pb-5 lg:flex-row lg:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              <span className="h-1.5 w-6 rounded-full bg-primary" aria-hidden="true" />
              Meta Page
            </div>
            <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.025em] text-foreground">Direct publishing</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Schedule vehicles for your Facebook Page without depending on an extension or the DOM.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground transition-[background-color,border-color] hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden="true" />
              Refresh
            </button>
            <button type="button" onClick={() => void runWorker()} disabled={running || !settings.enabled} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-[background-color,transform] hover:bg-primary/90 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              Process queue
            </button>
          </div>
        </header>

        {error ? <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}</div> : null}

        <section className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-[10px] border border-border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_12px_rgb(15_23_42/0.035)]">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary/10 text-primary"><CalendarClock className="h-5 w-5" aria-hidden="true" /></span>
                <div><h2 className="text-base font-semibold text-foreground">Auto Publish Plan</h2><p className="text-xs text-muted-foreground">Independent queue for Page publishing</p></div>
              </div>
              <Toggle checked={settings.enabled} onChange={(value) => updateSetting("enabled", value)} label="Enable automatic Page publishing" />
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1.5 text-xs font-semibold text-muted-foreground">Vehicles per batch<input type="number" min={1} max={20} value={settings.vehiclesPerBatch} onChange={(event) => updateSetting("vehiclesPerBatch", Number(event.target.value))} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>
              <label className="space-y-1.5 text-xs font-semibold text-muted-foreground">Daily maximum<input type="number" min={1} max={50} value={settings.maxPostsPerDay} onChange={(event) => updateSetting("maxPostsPerDay", Number(event.target.value))} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>
              <label className="space-y-1.5 text-xs font-semibold text-muted-foreground">Post spacing<select value={settings.minDelayMinutes} onChange={(event) => updateSetting("minDelayMinutes", Number(event.target.value))} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"><option value={0}>No spacing</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option></select></label>
              <label className="space-y-1.5 text-xs font-semibold text-muted-foreground">Daily window<div className="flex h-10 items-center gap-1"><input type="time" value={settings.preferredWindowStart} onChange={(event) => updateSetting("preferredWindowStart", event.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary" /><span className="text-muted-foreground">–</span><input type="time" value={settings.preferredWindowEnd} onChange={(event) => updateSetting("preferredWindowEnd", event.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary" /></div></label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-600" />Published through Graph API</span><span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" />Photos managed by DealerPilot</span></div>
              <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"><Settings2 className="h-4 w-4" aria-hidden="true" />{saving ? "Saving…" : "Save plan"}</button>
            </div>
          </div>

          <aside className="rounded-[10px] border border-border bg-card p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_12px_rgb(15_23_42/0.035)]">
            <div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#1877F2]/10 text-[#1877F2]"><Facebook className="h-5 w-5" aria-hidden="true" /></span><div><h2 className="text-base font-semibold text-foreground">Page connection</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Credentials stay on the backend; this check confirms the Page and publish permission with Meta.</p></div></div>
            <div className="mt-5 flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2.5"><div><p className="text-sm font-semibold text-foreground">{connection?.pageName || "Meta Page not validated"}</p><p className="mt-0.5 text-xs text-muted-foreground">{connection?.pageId || "No Page connection found"}</p></div><span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", connection?.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : connection?.status === "error" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-border bg-muted/40 text-muted-foreground")}>{connection?.status === "active" ? "Validated" : connection?.status === "error" ? "Needs attention" : "Not validated"}</span></div>
            <button type="button" onClick={() => void validateConnection()} disabled={validating} className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50">{validating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}{validating ? "Validating with Meta…" : "Validate connection"}</button>
            <div className="mt-5 flex items-center justify-between border-t border-border pt-4"><span className="text-sm text-muted-foreground">Local plan</span><span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", settings.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-muted/40 text-muted-foreground")}>{settings.enabled ? "Active" : "Paused"}</span></div>
            <div className="mt-3 flex items-center justify-between"><span className="text-sm text-muted-foreground">Configuration saved</span><span className="text-sm font-semibold text-foreground">{configured ? "Yes" : "Pending"}</span></div>
            <div className="mt-3 flex items-center justify-between"><span className="text-sm text-muted-foreground">Publish permission</span><span className="text-sm font-semibold text-foreground">{connection?.scopes.includes("pages_manage_posts") ? "Granted" : "Pending"}</span></div>
            {connection?.lastValidatedAt ? <p className="mt-3 text-xs text-muted-foreground">Last checked {formatDate(connection.lastValidatedAt)}</p> : null}
            <p className="mt-4 rounded-md bg-muted/45 px-3 py-2.5 text-xs leading-5 text-muted-foreground">Tokens are never shown or stored in the frontend.</p>
          </aside>
        </section>

        <section className="rounded-[10px] border border-border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04),0_4px_12px_rgb(15_23_42/0.035)]">
          <div className="flex flex-col justify-between gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center"><div><div className="text-xs font-semibold uppercase tracking-[0.1em] text-primary">NEXT BATCH</div><h2 className="mt-1 text-lg font-semibold tracking-[-0.015em] text-foreground">{batch ? `Batch #${batch.batchNumber}` : "Queue is waiting for vehicles"}</h2><p className="mt-1 text-sm text-muted-foreground">{batch ? `${nextVehicleLabel} · scheduled for ${formatDate(batch.scheduledAt)}` : "When the plan is active, the worker will reserve the next batch automatically."}</p></div>{batch ? <div className="text-left sm:text-right"><span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", statusTone(batch.status))}>{batch.status}</span><p className="mt-1 text-xs text-muted-foreground">{batch.completedCount}/{batch.totalVehicles} completed</p></div> : null}</div>
          {loading ? <div className="flex items-center gap-2 px-5 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking queue…</div> : batch?.vehicles.length ? <div className="divide-y divide-border">{batch.vehicles.map((vehicle, index) => <div key={vehicle.id} className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-muted/20 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span><div className="min-w-0"><div className="truncate text-sm font-semibold text-foreground">{vehicle.year} {vehicle.make} {vehicle.model}{vehicle.trim ? ` ${vehicle.trim}` : ""}</div><div className="mt-1 text-xs text-muted-foreground">{formatPrice(vehicle.price)}{vehicle.stockNumber ? ` · Stock ${vehicle.stockNumber}` : ""} · {formatDate(vehicle.scheduledAt)}</div></div></div><div className="flex items-center gap-3 sm:shrink-0"><span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", statusTone(vehicle.status))}>{vehicle.status}</span>{vehicle.postUrl ? <a href={vehicle.postUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">View post</a> : null}</div></div>)}</div> : <div className="px-5 py-10 text-center"><p className="text-sm font-semibold text-foreground">{settings.enabled ? "No batch reserved yet" : "Enable the plan to get started"}</p><p className="mt-1 text-sm text-muted-foreground">The queue is created automatically and remains separate from Marketplace.</p></div>}
        </section>
      </div>
      </div>
    </AppLayout>
  );
}
