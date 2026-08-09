import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { type ModuleKey, getModuleTheme } from "@/design-system/module-themes";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  icon?: unknown;
  module?: ModuleKey;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, description, eyebrow, module, action, children, className }: PageHeaderProps) {
  const sub = subtitle ?? description;
  const theme = module ? getModuleTheme(module) : null;

  return (
    <header className={cn("border-b border-border pb-5", className)}>
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end sm:gap-6">
        <div className="min-w-0">
          {eyebrow ? <p className={cn("mb-2 text-xs font-medium tracking-wide text-muted-foreground", theme?.eyebrow)}>{eyebrow}</p> : null}
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.025em] text-foreground">{title}</h1>
          {sub ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{sub}</p> : null}
        </div>
        {(children || action) ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
            {children}
            {action}
          </div>
        ) : null}
      </div>
    </header>
  );
}
