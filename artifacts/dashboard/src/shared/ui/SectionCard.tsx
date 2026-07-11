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

export function SectionCard({
  title,
  description,
  icon,
  action,
  children,
  module,
  className,
  contentClassName,
}: SectionCardProps) {
  const theme = module ? getModuleTheme(module) : null;

  return (
    <div className={cn("border border-white/[0.05] bg-white/[0.01] rounded-xl overflow-hidden", className)}>
      {(title || action || icon) && (
        <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {icon && (
              <span className={cn("shrink-0", theme ? theme.textAccent : "text-white/22")}>
                {renderIcon(icon, "w-4 h-4")}
              </span>
            )}
            <div>
              {title && (
                <h2 className="text-[13px] font-semibold text-white/75">{title}</h2>
              )}
              {description && (
                <p className="text-[11px] text-white/28 mt-0.5">{description}</p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn("p-5", contentClassName)}>{children}</div>
    </div>
  );
}
