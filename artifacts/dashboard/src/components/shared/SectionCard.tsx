import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { renderIcon, type IconLike } from "./renderIcon";

interface SectionCardProps {
  title?: string;
  description?: string;
  icon?: IconLike;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function SectionCard({
  title,
  description,
  icon,
  action,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <div className={cn("glass-panel rounded-xl overflow-hidden flex flex-col", className)}>
      {(title || action || icon) && (
        <div className="px-6 py-5 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="p-2 rounded-lg border border-primary/20 bg-primary/10 text-primary shrink-0">
                {renderIcon(icon, "w-5 h-5")}
              </div>
            )}
            <div>
              {title && <h2 className="text-lg font-semibold text-white">{title}</h2>}
              {description && (
                <p className="text-sm text-muted-foreground mt-1">{description}</p>
              )}
            </div>
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={cn("p-6 flex-1", contentClassName)}>{children}</div>
    </div>
  );
}
