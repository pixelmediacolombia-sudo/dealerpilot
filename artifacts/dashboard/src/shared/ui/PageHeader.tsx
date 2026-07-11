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

export function PageHeader({
  title,
  subtitle,
  description,
  eyebrow,
  module,
  action,
  children,
  className,
}: PageHeaderProps) {
  const sub = subtitle ?? description;
  const theme = module ? getModuleTheme(module) : null;
  const eyebrowColor = theme ? theme.eyebrow : "text-white/18";

  return (
    <div className={cn("pb-6 border-b border-white/[0.04]", className)}>
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          {eyebrow && (
            <p className={cn("text-[9px] font-black uppercase tracking-[0.26em] mb-3", eyebrowColor)}>
              {eyebrow}
            </p>
          )}
          <h1 className="text-[26px] font-black tracking-tight text-white leading-none">
            {title}
          </h1>
          {sub && (
            <p className="text-[13px] text-white/30 mt-2 max-w-2xl leading-relaxed">
              {sub}
            </p>
          )}
        </div>
        {(children || action) && (
          <div className="flex items-center gap-2 shrink-0 pb-0.5">
            {children}
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
