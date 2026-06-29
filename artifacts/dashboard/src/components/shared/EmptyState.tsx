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
    <div
      className={cn(
        "flex flex-col items-center justify-center p-12 text-center border border-dashed border-white/10 rounded-2xl bg-white/[0.02]",
        className,
      )}
    >
      <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mb-6 shadow-inner border border-white/5 text-muted-foreground">
        {renderIcon(icon, "w-8 h-8 text-muted-foreground")}
      </div>
      <h3 className="text-xl font-semibold text-white mb-2 tracking-tight">{title}</h3>
      <p className="text-muted-foreground max-w-sm mb-6 text-sm">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
}
