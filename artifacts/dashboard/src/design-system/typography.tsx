import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TypographyProps {
  children: ReactNode;
  className?: string;
}

export function Display({ children, className }: TypographyProps) {
  return (
    <h1 className={cn("text-5xl font-black tracking-tight text-white leading-none", className)}>
      {children}
    </h1>
  );
}

export function PageTitle({ children, className }: TypographyProps) {
  return (
    <h1 className={cn("text-3xl font-bold tracking-tight text-white", className)}>
      {children}
    </h1>
  );
}

export function SectionTitle({ children, className }: TypographyProps) {
  return (
    <h2 className={cn("text-lg font-semibold text-white tracking-tight", className)}>
      {children}
    </h2>
  );
}

export function CardTitle({ children, className }: TypographyProps) {
  return (
    <h3 className={cn("text-sm font-semibold text-white", className)}>
      {children}
    </h3>
  );
}

export function Body({ children, className }: TypographyProps) {
  return (
    <p className={cn("text-sm text-muted-foreground leading-relaxed", className)}>
      {children}
    </p>
  );
}

export function BodySmall({ children, className }: TypographyProps) {
  return (
    <p className={cn("text-xs text-muted-foreground leading-relaxed", className)}>
      {children}
    </p>
  );
}

export function Caption({ children, className }: TypographyProps) {
  return (
    <span className={cn("text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60", className)}>
      {children}
    </span>
  );
}

export function Metric({ children, className }: TypographyProps) {
  return (
    <span className={cn("text-3xl font-bold tracking-tight tabular-nums text-white", className)}>
      {children}
    </span>
  );
}

export function MetricLarge({ children, className }: TypographyProps) {
  return (
    <span className={cn("text-[2.5rem] font-black tracking-tight tabular-nums text-white leading-none", className)}>
      {children}
    </span>
  );
}

export function Eyebrow({ children, className }: TypographyProps) {
  return (
    <div className={cn("text-[10px] font-bold uppercase tracking-widest", className)}>
      {children}
    </div>
  );
}
