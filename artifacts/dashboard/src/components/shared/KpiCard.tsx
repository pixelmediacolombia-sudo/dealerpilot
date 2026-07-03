import { cn } from "@/lib/utils";
import { AnimatedCounter } from "./AnimatedCounter";
import { renderIcon, type IconLike } from "./renderIcon";
import { type ModuleKey, getModuleTheme } from "@/design-system/module-themes";

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
  module?: ModuleKey;
  accentColor?: "blue" | "green" | "orange" | "purple" | "cyan" | "amber" | "violet";
  valueColor?: string;
  iconClassName?: string;
  isLoading?: boolean;
  className?: string;
}

const legacyColorMap: Record<string, string> = {
  blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  green: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  orange: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  purple: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  cyan: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  violet: "text-violet-400 bg-violet-500/10 border-violet-500/20",
};

export function KpiCard({
  title,
  label,
  value,
  icon,
  formatValue,
  trend,
  delta,
  module,
  accentColor,
  valueColor,
  iconClassName,
  isLoading,
  className,
}: KpiCardProps) {
  const heading = title ?? label ?? "";
  const movement = trend ?? delta;

  const theme = module ? getModuleTheme(module) : null;
  const iconContainerClass = theme
    ? theme.iconContainer
    : legacyColorMap[accentColor ?? "blue"];
  const glowClass = theme ? theme.glowBg : (legacyColorMap[accentColor ?? "blue"].split(" ")[1] ?? "");

  return (
    <div
      className={cn(
        "glass-panel hover-lift p-6 rounded-xl flex flex-col relative overflow-hidden group",
        className,
      )}
    >
      <div className={cn("absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl -z-10 transition-opacity opacity-10 group-hover:opacity-25", glowClass)} />
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-sm font-medium text-muted-foreground">{heading}</h3>
        {icon && (
          <div className={cn("p-2.5 rounded-lg border", iconContainerClass, iconClassName)}>
            {renderIcon(icon, "w-5 h-5")}
          </div>
        )}
      </div>
      <div className="mt-auto">
        <div className={cn("text-3xl font-bold tracking-tight text-white mb-2 tabular-nums", valueColor)}>
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
            <span className={cn("font-medium", movement.isPositive ? "text-emerald-400" : "text-red-400")}>
              {movement.isPositive ? "+" : "-"}{movement.value}%
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
