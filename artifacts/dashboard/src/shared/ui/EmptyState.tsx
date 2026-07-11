import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { renderIcon, type IconLike } from "./renderIcon";

interface EmptyStateProps {
  icon: IconLike;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 px-8 text-center", className)}>
      <div className="w-11 h-11 rounded-xl border border-white/[0.06] bg-white/[0.015] flex items-center justify-center mb-5">
        {renderIcon(icon, "w-5 h-5 text-white/18")}
      </div>
      <h3 className="text-[14px] font-semibold text-white/35 mb-1.5">{title}</h3>
      <p className="text-[12px] text-white/18 max-w-xs leading-relaxed">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
