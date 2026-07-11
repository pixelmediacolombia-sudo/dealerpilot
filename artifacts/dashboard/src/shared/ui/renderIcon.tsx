import { isValidElement, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type IconLike = LucideIcon | ReactNode;

export function renderIcon(icon: IconLike | undefined, className?: string): ReactNode {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  const Icon = icon as LucideIcon;
  return <Icon className={className} />;
}
