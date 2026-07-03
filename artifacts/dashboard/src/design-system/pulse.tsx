import { cn } from "@/lib/utils";

interface PulseProps {
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

function PulseDot({
  colorClasses,
  label,
  size = "md",
  className,
}: PulseProps & { colorClasses: string }) {
  const dotSize = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className={cn("relative flex", dotSize)}>
        <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-60", colorClasses)} />
        <span className={cn("relative inline-flex rounded-full", dotSize, colorClasses)} />
      </span>
      {label && (
        <span className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
          {label}
        </span>
      )}
    </span>
  );
}

export function LivePulse({ label = "Live", size, className }: PulseProps) {
  return <PulseDot colorClasses="bg-emerald-400" label={label} size={size} className={className} />;
}

export function AIProcessingPulse({ label = "Processing", size, className }: PulseProps) {
  return <PulseDot colorClasses="bg-blue-400" label={label} size={size} className={className} />;
}

export function PublishingPulse({ label = "Publishing", size, className }: PulseProps) {
  return <PulseDot colorClasses="bg-green-400" label={label} size={size} className={className} />;
}

export function SyncPulse({ label = "Syncing", size, className }: PulseProps) {
  return <PulseDot colorClasses="bg-cyan-400" label={label} size={size} className={className} />;
}

export function IdlePulse({ label, size, className }: PulseProps) {
  return <PulseDot colorClasses="bg-white/20" label={label} size={size} className={className} />;
}
