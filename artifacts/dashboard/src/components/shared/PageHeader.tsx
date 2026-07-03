import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { renderIcon, type IconLike } from "./renderIcon";
import { type ModuleKey, getModuleTheme } from "@/design-system/module-themes";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  icon?: IconLike;
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
  icon,
  module,
  action,
  children,
  className,
}: PageHeaderProps) {
  const sub = subtitle ?? description;
  const theme = module ? getModuleTheme(module) : null;

  const iconContainerClass = theme
    ? theme.iconContainer
    : "border border-white/10 bg-white/[0.04] text-white/50";

  const eyebrowClass = theme ? theme.eyebrow : "text-muted-foreground/60";

  return (
    <div
      className={cn(
        "flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6",
        className,
      )}
    >
      <div className="flex items-start gap-4">
        {icon && (
          <div className={cn("p-2.5 rounded-xl shrink-0 relative", iconContainerClass)}>
            {theme && (
              <div className={cn("absolute inset-0 rounded-xl blur-xl opacity-30", theme.glowBg)} />
            )}
            <span className="relative">{renderIcon(icon, "w-6 h-6")}</span>
          </div>
        )}
        <div className="space-y-1">
          {eyebrow && (
            <div className={cn("text-[10px] font-bold uppercase tracking-widest", eyebrowClass)}>
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
