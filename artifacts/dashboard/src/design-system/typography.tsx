import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TypographyProps {
  children: ReactNode;
  className?: string;
}

export function Display({ children, className }: TypographyProps) {
  return <h1 className={cn("text-4xl font-semibold leading-tight tracking-[-0.03em] text-foreground", className)}>{children}</h1>;
}

export function PageTitle({ children, className }: TypographyProps) {
  return <h1 className={cn("text-3xl font-semibold tracking-[-0.025em] text-foreground", className)}>{children}</h1>;
}

export function SectionTitle({ children, className }: TypographyProps) {
  return <h2 className={cn("text-base font-semibold tracking-tight text-foreground", className)}>{children}</h2>;
}

export function CardTitle({ children, className }: TypographyProps) {
  return <h3 className={cn("text-sm font-semibold text-foreground", className)}>{children}</h3>;
}

export function Body({ children, className }: TypographyProps) {
  return <p className={cn("text-sm leading-relaxed text-muted-foreground", className)}>{children}</p>;
}

export function BodySmall({ children, className }: TypographyProps) {
  return <p className={cn("text-xs leading-relaxed text-muted-foreground", className)}>{children}</p>;
}

export function Caption({ children, className }: TypographyProps) {
  return <span className={cn("text-xs font-medium tracking-wide text-muted-foreground", className)}>{children}</span>;
}

export function Metric({ children, className }: TypographyProps) {
  return <span className={cn("text-3xl font-semibold tracking-tight tabular-nums text-foreground", className)}>{children}</span>;
}

export function MetricLarge({ children, className }: TypographyProps) {
  return <span className={cn("text-4xl font-semibold leading-none tracking-[-0.03em] tabular-nums text-foreground", className)}>{children}</span>;
}

export function Eyebrow({ children, className }: TypographyProps) {
  return <div className={cn("text-xs font-medium tracking-wide text-primary", className)}>{children}</div>;
}
