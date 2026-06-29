import { cn } from "@/lib/utils";
import { AnimatedCounter } from "./AnimatedCounter";
import { renderIcon, type IconLike } from "./renderIcon";

interface KpiTrend {
  value: number;
  label?: string;
  isPositive: boolean;
}

interface KpiCardProps {
  title?: string;
  label?: string;
  value: number | string;
  icon?: IconLike;
  formatValue?: (val: number) => string;
  trend?: KpiTrend;
  delta?: KpiTrend;
  accentColor?: "blue" | "green" | "orange" | "purple";
  valueColor?: string;
  iconClassName?: string;
  isLoading?: boolean;
  className?: string;
}

export function KpiCard({
  title,
  label,
  value,
  icon,
  formatValue,
  trend,
  delta,
  accentColor = "blue",
  valueColor,
  iconClassName,
  isLoading,
  className,
}: KpiCardProps) {
  const heading = title ?? label ?? "";
  const movement = trend ?? delta;

  const colorMap = {
    blue: "text-primary bg-primary/10 border-primary/20",
    green: "text-success bg-success/10 border-success/20",
    orange: "text-warning bg-warning/10 border-warning/20",
    purple: "text-accent bg-accent/10 border-accent/20",
  };

  const iconColorClass = colorMap[accentColor];

  return (
    <div
      className={cn(
        "glass-panel hover-lift p-6 rounded-xl flex flex-col relative overflow-hidden group",
        className,
      )}
    >
      <div
        className={cn(
          "absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl -z-10 transition-opacity opacity-20 group-hover:opacity-40",
          iconColorClass.split(" ")[1],
        )}
      />
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-sm font-medium text-muted-foreground">{heading}</h3>
        {icon && (
          <div className={cn("p-2.5 rounded-lg border", iconColorClass, iconClassName)}>
            {renderIcon(icon, "w-5 h-5")}
          </div>
        )}
      </div>
      <div className="mt-auto">
        <div
          className={cn("text-3xl font-bold tracking-tight text-white mb-2", valueColor)}
        >
          {isLoading ? (
            <div className="h-8 w-20 rounded-md bg-white/10 animate-pulse" />
          ) : typeof value === "number" ? (
            <AnimatedCounter value={value} format={formatValue} />
          ) : (
            value
          )}
        </div>
        {movement && (
          <div className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                "font-medium",
                movement.isPositive ? "text-success" : "text-destructive",
              )}
            >
              {movement.isPositive ? "+" : "-"}
              {movement.value}%
            </span>
            {movement.label && (
              <span className="text-muted-foreground">{movement.label}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
