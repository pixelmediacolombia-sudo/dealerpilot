import { cn } from "@/lib/utils";
import { AnimatedCounter } from "./AnimatedCounter";
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
  icon?: unknown;
  formatValue?: (val: number) => string;
  trend?: KpiTrend;
  delta?: KpiTrend;
  module?: ModuleKey;
  accentColor?: "blue" | "green" | "orange" | "purple" | "cyan" | "amber" | "violet";
  valueColor?: string;
  iconClassName?: string;
  isLoading?: boolean;
  className?: string;
  onClick?: () => void;
}

const legacyAccentText: Record<string, string> = {
  blue: "text-blue-400",
  green: "text-emerald-400",
  orange: "text-orange-400",
  purple: "text-violet-400",
  cyan: "text-cyan-400",
  amber: "text-amber-400",
  violet: "text-violet-400",
};

export function KpiCard({
  title,
  label,
  value,
  formatValue,
  trend,
  delta,
  module,
  accentColor,
  valueColor,
  isLoading,
  className,
  onClick,
}: KpiCardProps) {
  const heading = title ?? label ?? "";
  const theme = module ? getModuleTheme(module) : null;
  const movement = trend ?? delta;

  const resolvedValueColor =
    valueColor ??
    (theme ? theme.textAccent : legacyAccentText[accentColor ?? "blue"] ?? "text-white/75");

  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        "flex flex-col border border-white/[0.05] bg-white/[0.01] rounded-xl px-5 py-4 text-left",
        onClick && "hover:border-white/[0.09] hover:bg-white/[0.025] transition-all cursor-pointer",
        className,
      )}
    >
      <div className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20 mb-3">
        {heading}
      </div>
      <div className={cn("text-[34px] font-black tracking-tight leading-none tabular-nums", resolvedValueColor)}>
        {isLoading ? (
          <div className="h-8 w-16 rounded bg-white/[0.04] animate-pulse" />
        ) : typeof value === "number" ? (
          <AnimatedCounter value={value} format={formatValue} />
        ) : (
          value
        )}
      </div>
      {movement && (
        <div className="text-[10px] mt-2">
          <span className={movement.isPositive ? "text-emerald-400" : "text-red-400"}>
            {movement.isPositive ? "+" : ""}{movement.value}%
          </span>
          {movement.label && (
            <span className="text-white/20 ml-1">{movement.label}</span>
          )}
        </div>
      )}
    </Wrapper>
  );
}
