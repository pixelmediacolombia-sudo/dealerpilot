export type ModuleKey =
  | "command-center"
  | "marketplace"
  | "inventory"
  | "photo-studio"
  | "sales-ai"
  | "dealer-dna";

export interface ModuleTheme {
  name: string;
  textAccent: string;
  bgAccentSoft: string;
  borderAccent: string;
  glowBg: string;
  iconContainer: string;
  eyebrow: string;
  badgeClasses: string;
  ringAccent: string;
  dotColor: string;
}

const themes: Record<ModuleKey, ModuleTheme> = {
  "command-center": {
    name: "Command Center",
    textAccent: "text-blue-400",
    bgAccentSoft: "bg-blue-500/10",
    borderAccent: "border-blue-500/20",
    glowBg: "bg-blue-500/10",
    iconContainer: "bg-blue-500/10 border border-blue-500/20 text-blue-400",
    eyebrow: "text-blue-400/70",
    badgeClasses: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    ringAccent: "ring-blue-500/30",
    dotColor: "bg-blue-400",
  },
  marketplace: {
    name: "Marketplace",
    textAccent: "text-green-400",
    bgAccentSoft: "bg-green-500/10",
    borderAccent: "border-green-500/20",
    glowBg: "bg-green-500/10",
    iconContainer: "bg-green-500/10 border border-green-500/20 text-green-400",
    eyebrow: "text-green-400/70",
    badgeClasses: "bg-green-500/10 text-green-400 border-green-500/20",
    ringAccent: "ring-green-500/30",
    dotColor: "bg-green-400",
  },
  inventory: {
    name: "Inventory",
    textAccent: "text-cyan-400",
    bgAccentSoft: "bg-cyan-500/10",
    borderAccent: "border-cyan-500/20",
    glowBg: "bg-cyan-500/10",
    iconContainer: "bg-cyan-500/10 border border-cyan-500/20 text-cyan-400",
    eyebrow: "text-cyan-400/70",
    badgeClasses: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    ringAccent: "ring-cyan-500/30",
    dotColor: "bg-cyan-400",
  },
  "photo-studio": {
    name: "AI Photo Studio",
    textAccent: "text-amber-400",
    bgAccentSoft: "bg-amber-500/10",
    borderAccent: "border-amber-500/20",
    glowBg: "bg-amber-500/10",
    iconContainer: "bg-amber-500/10 border border-amber-500/20 text-amber-400",
    eyebrow: "text-amber-400/70",
    badgeClasses: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    ringAccent: "ring-amber-500/30",
    dotColor: "bg-amber-400",
  },
  "sales-ai": {
    name: "Sales AI",
    textAccent: "text-violet-400",
    bgAccentSoft: "bg-violet-500/10",
    borderAccent: "border-violet-500/20",
    glowBg: "bg-violet-500/10",
    iconContainer: "bg-violet-500/10 border border-violet-500/20 text-violet-400",
    eyebrow: "text-violet-400/70",
    badgeClasses: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    ringAccent: "ring-violet-500/30",
    dotColor: "bg-violet-400",
  },
  "dealer-dna": {
    name: "Dealer DNA",
    textAccent: "text-orange-400",
    bgAccentSoft: "bg-orange-500/10",
    borderAccent: "border-orange-500/20",
    glowBg: "bg-orange-500/10",
    iconContainer: "bg-orange-500/10 border border-orange-500/20 text-orange-400",
    eyebrow: "text-orange-400/70",
    badgeClasses: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    ringAccent: "ring-orange-500/30",
    dotColor: "bg-orange-400",
  },
};

export function getModuleTheme(module: ModuleKey): ModuleTheme {
  return themes[module];
}
