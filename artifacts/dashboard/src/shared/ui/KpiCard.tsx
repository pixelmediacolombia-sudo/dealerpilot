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

export function KpiCard({ title, label, value, formatValue, trend, delta, valueColor, isLoading, className, onClick }: KpiCardProps) {
  const heading = title ?? label ?? "";
  const movement = trend ?? delta;
  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      data-kpi-card="true"
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-border bg-card px-5 py-4 text-left text-card-foreground shadow-sm",
        onClick && "cursor-pointer transition-[border-color,box-shadow] hover:border-primary/25 hover:shadow-md",
        className,
      )}
    >
      <div className="mb-3 text-xs font-medium text-muted-foreground">{heading}</div>
      <div data-kpi-value="true" className={cn("text-[30px] font-semibold leading-none tracking-[-0.025em] tabular-nums text-foreground", valueColor?.replace(/text-(blue|cyan|violet|purple)-400/g, "text-primary"))}>
        {isLoading ? (
          <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
        ) : typeof value === "number" ? (
          <AnimatedCounter value={value} format={formatValue} />
        ) : (
          value
        )}
      </div>
      {movement ? (
        <div className="mt-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{movement.isPositive ? "+" : ""}{movement.value}%</span>
          {movement.label ? <span className="ml-1">{movement.label}</span> : null}
        </div>
      ) : null}
    </Wrapper>
  );
}
