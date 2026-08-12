import { cn } from "@/lib/utils";
import { AnimatedCounter } from "./AnimatedCounter";
import { type ModuleKey } from "@/design-system/module-themes";

interface KpiTrend {
  value: number;
  label?: string;
  isPositive: boolean;
}

interface KpiCardProps {
  title?: string;
  label?: string;
  value: number | string;
  icon?: React.ReactNode;
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

export function KpiCard({ title, label, value, formatValue, trend, delta, icon, module, valueColor, isLoading, className, onClick }: KpiCardProps) {
  const heading = title ?? label ?? "";
  const movement = trend ?? delta;
  const Wrapper = onClick ? "button" : "div";
  const tone = "primary";

  return (
    <Wrapper
      data-kpi-card="true"
      data-kpi-tone={tone}
      onClick={onClick}
      className={cn(
        "theme-kpi-primary gymove-kpi-card flex min-w-0 flex-col rounded-2xl border px-5 py-4 text-left shadow-[0_5px_16px_rgb(15_23_42/0.045)]",
        onClick && "cursor-pointer transition-[border-color,box-shadow] hover:border-primary/25 hover:shadow-md",
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="text-xs font-medium text-primary-foreground/78">{heading}</div>
        {icon ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary-foreground/20 bg-primary-foreground/15 text-primary-foreground shadow-sm">{icon}</span> : null}
      </div>
      <div data-kpi-value="true" className="text-[30px] font-semibold leading-none tracking-[-0.025em] tabular-nums text-primary-foreground">
        {isLoading ? (
          <div className="h-8 w-16 animate-pulse rounded-md bg-primary-foreground/20" />
        ) : typeof value === "number" ? (
          <AnimatedCounter value={value} format={formatValue} />
        ) : (
          value
        )}
      </div>
      {movement ? (
        <div className="mt-2 text-xs text-primary-foreground/78">
          <span className="tabular-nums">{movement.isPositive ? "+" : ""}{movement.value}%</span>
          {movement.label ? <span className="ml-1">{movement.label}</span> : null}
        </div>
      ) : null}
    </Wrapper>
  );
}
