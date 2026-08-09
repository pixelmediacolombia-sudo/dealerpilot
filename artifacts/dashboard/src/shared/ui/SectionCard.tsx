import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { renderIcon, type IconLike } from "./renderIcon";
import { type ModuleKey, getModuleTheme } from "@/design-system/module-themes";

interface SectionCardProps {
  title?: ReactNode;
  description?: string;
  icon?: IconLike;
  action?: ReactNode;
  children: ReactNode;
  module?: ModuleKey;
  className?: string;
  contentClassName?: string;
}

export function SectionCard({ title, description, icon, action, children, module, className, contentClassName }: SectionCardProps) {
  const theme = module ? getModuleTheme(module) : null;

  return (
    <section className={cn("overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm", className)}>
      {(title || action || icon) ? (
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {icon ? (
              <span className={cn("shrink-0 text-muted-foreground", theme?.textAccent)}>
                {renderIcon(icon, "h-4 w-4")}
              </span>
            ) : null}
            <div className="min-w-0">
              {title ? <h2 className="text-sm font-semibold text-foreground">{title}</h2> : null}
              {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn("p-5", contentClassName)}>{children}</div>
    </section>
  );
}
