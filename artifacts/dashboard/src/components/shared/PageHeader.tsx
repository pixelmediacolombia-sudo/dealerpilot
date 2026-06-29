import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { renderIcon, type IconLike } from "./renderIcon";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  icon?: IconLike;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  description,
  eyebrow,
  icon,
  action,
  children,
  className,
}: PageHeaderProps) {
  const sub = subtitle ?? description;
  return (
    <div
      className={cn(
        "flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6",
        className,
      )}
    >
      <div className="flex items-start gap-4">
        {icon && (
          <div className="p-2.5 rounded-xl border border-primary/20 bg-primary/10 text-primary shrink-0">
            {renderIcon(icon, "w-6 h-6")}
          </div>
        )}
        <div className="space-y-1.5">
          {eyebrow && (
            <div className="text-sm font-medium text-primary uppercase tracking-wider">
              {eyebrow}
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
          {sub && <div className="text-muted-foreground text-sm max-w-2xl">{sub}</div>}
        </div>
      </div>
      {(children || action) && (
        <div className="flex items-center gap-3">
          {children}
          {action}
        </div>
      )}
    </div>
  );
}
