import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps {
  children: ReactNode;
  className?: string;
}

const base = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border leading-none";

export function SuccessBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", className)}>
      {children}
    </span>
  );
}

export function WarningBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-amber-500/10 text-amber-400 border-amber-500/20", className)}>
      {children}
    </span>
  );
}

export function ErrorBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-red-500/10 text-red-400 border-red-500/20", className)}>
      {children}
    </span>
  );
}

export function InfoBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-blue-500/10 text-blue-400 border-blue-500/20", className)}>
      {children}
    </span>
  );
}

export function NeutralBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-white/[0.06] text-white/60 border-white/10", className)}>
      {children}
    </span>
  );
}

export function LiveBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", className)}>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
      </span>
      {children}
    </span>
  );
}

export function ProcessingBadge({ children, className }: BadgeProps) {
  return (
    <span className={cn(base, "bg-blue-500/10 text-blue-400 border-blue-500/20", className)}>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-50" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400" />
      </span>
      {children}
    </span>
  );
}
