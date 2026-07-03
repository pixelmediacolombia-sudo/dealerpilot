import { cn } from "@/lib/utils";

interface StatusPulseProps {
  color?: string;
  status?: string;
  label?: string;
  className?: string;
}

const colorMap: Record<string, string> = {
  primary: "bg-blue-400",
  blue: "bg-blue-400",
  info: "bg-blue-400",
  success: "bg-emerald-400",
  green: "bg-emerald-400",
  online: "bg-emerald-400",
  healthy: "bg-emerald-400",
  connected: "bg-emerald-400",
  warning: "bg-amber-400",
  orange: "bg-amber-400",
  degraded: "bg-amber-400",
  pending: "bg-amber-400",
  destructive: "bg-red-400",
  red: "bg-red-400",
  error: "bg-red-400",
  offline: "bg-red-400",
  muted: "bg-white/20",
  unknown: "bg-white/20",
};

export function StatusPulse({ color, status, label, className }: StatusPulseProps) {
  const key = (status ?? color ?? "primary").toLowerCase();
  const bgClass = colorMap[key] ?? "bg-blue-400";

  const dot = (
    <span className={cn("relative flex h-[6px] w-[6px]", !label && className)}>
      <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-40", bgClass)} />
      <span className={cn("relative inline-flex rounded-full h-[6px] w-[6px]", bgClass)} />
    </span>
  );

  if (!label) return dot;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {dot}
      <span className="text-[11px] text-white/40">{label}</span>
    </span>
  );
}
