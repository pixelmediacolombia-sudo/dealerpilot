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

const names: Record<ModuleKey, string> = {
  "command-center": "Command center",
  marketplace: "Marketplace",
  inventory: "Inventory",
  "photo-studio": "Photo studio",
  "sales-ai": "Sales",
  "dealer-dna": "Dealer DNA",
};

const sharedTheme = {
  textAccent: "text-primary",
  bgAccentSoft: "bg-accent",
  borderAccent: "border-primary/20",
  glowBg: "bg-accent",
  iconContainer: "border border-primary/15 bg-accent text-primary",
  eyebrow: "text-primary",
  badgeClasses: "border-primary/15 bg-accent text-accent-foreground",
  ringAccent: "ring-primary/30",
  dotColor: "bg-primary",
};

export function getModuleTheme(module: ModuleKey): ModuleTheme {
  return { name: names[module], ...sharedTheme };
}
