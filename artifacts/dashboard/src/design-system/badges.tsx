import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps {
  children: ReactNode;
  className?: string;
}

const base = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border leading-none";

export function SuccessBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-success/10 text-success border-success/20", className)}>
      {children}
    </span>
  );
}

export function WarningBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-warning/10 text-warning border-warning/20", className)}>
      {children}
    </span>
  );
}

export function ErrorBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-destructive/10 text-destructive border-destructive/20", className)}>
      {children}
    </span>
  );
}

export function InfoBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-primary/10 text-primary border-primary/20", className)}>
      {children}
    </span>
  );
}

export function NeutralBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-muted text-muted-foreground border-border", className)}>
      {children}
    </span>
  );
}

export function LiveBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-success/10 text-success border-success/20", className)}>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
      </span>
      {children}
    </span>
  );
}

export function ProcessingBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-primary/10 text-primary border-primary/20", className)}>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-50" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
      </span>
      {children}
    </span>
  );
}
