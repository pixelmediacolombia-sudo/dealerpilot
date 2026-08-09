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
      <div className="w-11 h-11 rounded-xl border border-border bg-muted flex items-center justify-center mb-5">
        {renderIcon(icon, "w-5 h-5 text-muted-foreground")}
      </div>
      <h3 className="text-[14px] font-semibold text-muted-foreground mb-1.5">{title}</h3>
      <p className="text-[12px] text-muted-foreground max-w-xs leading-relaxed">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
