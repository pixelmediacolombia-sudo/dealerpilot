import { useState } from "react";
import { SectionCard } from "@/shared/ui/SectionCard";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { Label } from "@/shared/ui/label";
import { Slider } from "@/shared/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { useDealerLocation } from "@/context/LocationContext";
import {
  useGetAutoPublishSettings,
  useUpdateAutoPublishSettings,
  useCreatePublishingBatch,
  getGetAutoPublishSettingsQueryKey,
  getListPublishingBatchesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar, Clock, Play, Settings2, ShieldCheck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface AutoPublishPlanProps {
  dealerId: number;
  onBatchCreated?: () => void;
}

export function AutoPublishPlan({ dealerId, onBatchCreated }: AutoPublishPlanProps) {
  const qc = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchSuccess, setBatchSuccess] = useState(false);

  const { selectedLocation } = useDealerLocation();

  const { data, isLoading } = useGetAutoPublishSettings(dealerId, {
    query: {
      queryKey: getGetAutoPublishSettingsQueryKey(dealerId),
      // This setting controls autonomous publishing. Never let the global
      // five-minute cache display a stale value after an external DB change.
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  });

  const { mutateAsync: updateSettings, isPending: isSaving } = useUpdateAutoPublishSettings();
  const { mutateAsync: createBatch, isPending: isCreatingBatch } = useCreatePublishingBatch();

  const settings = data?.settings;

  async function toggleEnabled() {
    if (!settings) return;
    const response = await updateSettings({ dealerId, data: { enabled: !settings.enabled } });
    qc.setQueryData(getGetAutoPublishSettingsQueryKey(dealerId), response);
    await qc.refetchQueries({
      queryKey: getGetAutoPublishSettingsQueryKey(dealerId),
      type: "active",
    });
  }

  async function saveSetting(patch: Record<string, unknown>) {
    const response = await updateSettings({ dealerId, data: patch });
    qc.setQueryData(getGetAutoPublishSettingsQueryKey(dealerId), response);
    await qc.refetchQueries({
      queryKey: getGetAutoPublishSettingsQueryKey(dealerId),
      type: "active",
    });
  }

  async function scheduleBatch() {
    setBatchError(null);
    setBatchSuccess(false);
    try {
      await createBatch({
        data: {
          dealerId,
          mode: (settings?.autoClickPublish ? "Controlled" : "Assisted") as "Assisted" | "Controlled",
          count: settings?.vehiclesPerBatch ?? 4,
          lotLocation: selectedLocation || undefined,
        },
      });
      qc.invalidateQueries({ queryKey: getListPublishingBatchesQueryKey() });
      setBatchSuccess(true);
      onBatchCreated?.();
      setTimeout(() => setBatchSuccess(false), 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create batch";
      setBatchError(msg);
    }
  }

  if (isLoading || !settings) return null;

  const frequencyLabel =
    settings.frequencyDays === 1
      ? "Daily"
      : settings.frequencyDays === 7
      ? "Weekly"
      : `Every ${settings.frequencyDays} days`;

  const modeLabel = settings.autoClickPublish ? "Controlled Auto" : "Assisted";

  return (
    <SectionCard className="border-border/50">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="font-semibold text-base">Auto Publish Plan</span>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-bold tracking-wide  px-2 py-0.5",
                  settings.enabled
                    ? "bg-success/10 text-success border-success/20"
                    : "bg-secondary/50 text-muted-foreground border-border",
                )}
              >
                {settings.enabled ? "ACTIVE" : "DISABLED"}
              </Badge>
              {settings.enabled && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs font-bold tracking-wide  px-2 py-0.5",
                    settings.autoClickPublish
                      ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                      : "bg-primary/10 text-primary border-primary/20",
                  )}
                >
                  {modeLabel}
                </Badge>
              )}
            </div>
            {settings.enabled ? (
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  {frequencyLabel}
                </span>
                <span className="w-1 h-1 rounded-full bg-border" />
                <span className="flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5" />
                  {settings.vehiclesPerBatch} vehicles/batch
                </span>
                <span className="w-1 h-1 rounded-full bg-border" />
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {settings.preferredWindowStart}–{settings.preferredWindowEnd}
                </span>
                <span className="w-1 h-1 rounded-full bg-border" />
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {settings.requireApproval ? "Approval required" : "Auto-approved"}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                DealerPilot will automatically select and queue vehicles for publishing.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <Switch
            checked={settings.enabled}
            onCheckedChange={toggleEnabled}
            disabled={isSaving}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Settings2 className="w-4 h-4 mr-1.5" />
            Configure
          </Button>
          {settings.enabled && (
            <Button
              size="sm"
              onClick={scheduleBatch}
              disabled={isCreatingBatch}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {isCreatingBatch ? "Scheduling…" : "Schedule Batch"}
            </Button>
          )}
        </div>
      </div>

      {(batchSuccess || batchError) && (
        <div
          className={cn(
            "mt-4 px-4 py-3 rounded-lg text-sm font-medium",
            batchSuccess
              ? "bg-success/10 text-success border border-success/20"
              : "bg-destructive/10 text-destructive border border-destructive/20",
          )}
        >
          {batchSuccess ? "Batch scheduled! Vehicles are queued and ready for publishing." : batchError}
        </div>
      )}

      {isExpanded && (
        <div className="mt-6 pt-6 border-t border-border/30 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Vehicles per batch */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold  tracking-wider text-muted-foreground">
              Vehicles per Batch
            </Label>
            <div className="flex items-center gap-3">
              <Slider
                min={1}
                max={10}
                step={1}
                value={[settings.vehiclesPerBatch]}
                onValueChange={([v]) => saveSetting({ vehiclesPerBatch: v })}
                className="flex-1"
              />
              <span className="text-sm font-bold w-6 text-center">{settings.vehiclesPerBatch}</span>
            </div>
          </div>

          {/* Frequency */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold  tracking-wider text-muted-foreground">
              Frequency
            </Label>
            <Select
              value={String(settings.frequencyDays)}
              onValueChange={(v) => saveSetting({ frequencyDays: Number(v) })}
            >
              <SelectTrigger className="bg-background/50 border-border/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Daily</SelectItem>
                <SelectItem value="2">Every 2 days</SelectItem>
                <SelectItem value="3">Every 3 days</SelectItem>
                <SelectItem value="7">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Max per day */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold  tracking-wider text-muted-foreground">
              Max Posts Per Day
            </Label>
            <div className="flex items-center gap-3">
              <Slider
                min={1}
                max={10}
                step={1}
                value={[settings.maxPostsPerDay]}
                onValueChange={([v]) => saveSetting({ maxPostsPerDay: v })}
                className="flex-1"
              />
              <span className="text-sm font-bold w-6 text-center">{settings.maxPostsPerDay}</span>
            </div>
          </div>

          {/* Delay between posts */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold  tracking-wider text-muted-foreground">
              Min Delay Between Posts
            </Label>
            <Select
              value={String(settings.minDelayMinutes)}
              onValueChange={(v) => saveSetting({ minDelayMinutes: Number(v) })}
            >
              <SelectTrigger className="bg-background/50 border-border/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 minutes</SelectItem>
                <SelectItem value="10">10 minutes</SelectItem>
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="20">20 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Require approval */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold  tracking-wider text-muted-foreground">
              Require Operator Approval
            </Label>
            <div className="flex items-center gap-3 h-10">
              <Switch
                checked={settings.requireApproval}
                onCheckedChange={(v) => saveSetting({ requireApproval: v })}
              />
              <span className="text-sm text-muted-foreground">
                {settings.requireApproval ? "Manual approval before publishing" : "Auto-approve jobs"}
              </span>
            </div>
          </div>

          {/* Controlled auto mode */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold  tracking-wider text-muted-foreground">
              Controlled Auto Mode
            </Label>
            <div className="flex items-center gap-3 h-10">
              <Switch
                checked={settings.autoClickPublish}
                onCheckedChange={(v) => saveSetting({ autoClickPublish: v })}
              />
              <span className="text-sm text-muted-foreground">
                {settings.autoClickPublish
                  ? "Extension auto-clicks Publish"
                  : "Operator clicks Publish (Assisted)"}
              </span>
            </div>
          </div>

          {/* Photo strategy */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold  tracking-wider text-muted-foreground">
              Photo Strategy
            </Label>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Switch
                  checked={settings.useOriginalPhotos}
                  onCheckedChange={(v) => saveSetting({ useOriginalPhotos: v })}
                />
                <span className="text-sm text-muted-foreground">Use original photos if quality is good</span>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={settings.aiCreativeIfLow}
                  onCheckedChange={(v) => saveSetting({ aiCreativeIfLow: v })}
                />
                <span className="text-sm text-muted-foreground">Generate AI Creative if score is low</span>
              </div>
            </div>
          </div>

          {/* Photo score threshold */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold  tracking-wider text-muted-foreground">
              Photo Score Threshold
            </Label>
            <div className="flex items-center gap-3">
              <Slider
                min={0}
                max={100}
                step={5}
                value={[settings.photoScoreThreshold]}
                onValueChange={([v]) => saveSetting({ photoScoreThreshold: v })}
                className="flex-1"
              />
              <span className="text-sm font-bold w-8 text-center">{settings.photoScoreThreshold}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              AI Creative generated for photos scoring below this threshold.
            </p>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
