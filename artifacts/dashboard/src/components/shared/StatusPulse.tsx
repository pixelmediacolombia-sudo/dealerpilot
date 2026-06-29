import { cn } from "@/lib/utils";

interface StatusPulseProps {
  color?: string;
  status?: string;
  label?: string;
  className?: string;
}

const colorMap: Record<string, string> = {
  primary: "bg-primary",
  blue: "bg-primary",
  info: "bg-primary",
  success: "bg-success",
  green: "bg-success",
  online: "bg-success",
  healthy: "bg-success",
  connected: "bg-success",
  warning: "bg-warning",
  orange: "bg-warning",
  degraded: "bg-warning",
  pending: "bg-warning",
  destructive: "bg-destructive",
  red: "bg-destructive",
  error: "bg-destructive",
  offline: "bg-destructive",
  muted: "bg-muted-foreground",
  unknown: "bg-muted-foreground",
};

export function StatusPulse({ color, status, label, className }: StatusPulseProps) {
  const key = (status ?? color ?? "primary").toLowerCase();
  const bgClass = colorMap[key] ?? "bg-primary";

  const dot = (
    <span className={cn("relative flex h-3 w-3", !label && className)}>
      <span
        className={cn(
          "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
          bgClass,
        )}
      />
      <span className={cn("relative inline-flex rounded-full h-3 w-3", bgClass)} />
    </span>
  );

  if (!label) return dot;

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {dot}
      <span className="text-sm text-muted-foreground">{label}</span>
    </span>
  );
}
