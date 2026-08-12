export interface DealerThemePayload {
  dealerId?: number;
  dealerName?: string | null;
  primaryColors?: string[];
  secondaryColors?: string[];
  accentColors?: string[];
  logoUrl?: string | null;
  preferredFont?: string | null;
  updatedAt?: string | null;
}

export const DEALER_THEME_UPDATED_EVENT = "dealerpilot:theme-updated";

const FALLBACK_THEME: Required<Pick<DealerThemePayload, "primaryColors" | "secondaryColors" | "accentColors">> = {
  primaryColors: ["#7658d6"],
  secondaryColors: ["#f3f4f8"],
  accentColors: ["#42b883"],
};

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1]!.toLowerCase();
  return `#${hex.length === 3 ? hex.split("").map((channel) => channel + channel).join("") : hex}`;
}

function firstColor(value: unknown, fallback: string): string {
  if (!Array.isArray(value)) return fallback;
  return value.map(normalizeHexColor).find((color): color is string => color !== null) ?? fallback;
}

function hexToHsl(hex: string): [number, number, number] {
  const values = [0, 2, 4].map((offset) => parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255);
  const [r, g, b] = values;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) return [0, 0, lightness];

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [hue / 6, saturation, lightness];
}

function hslChannel(hex: string, lightnessOverride?: number): string {
  const [hue, saturation, lightness] = hexToHsl(hex);
  const lightnessValue = lightnessOverride ?? lightness;
  return `${Math.round(hue * 360)} ${Math.round(saturation * 100)}% ${Math.round(lightnessValue * 100)}%`;
}

function readableForeground(hex: string): string {
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(1 + offset, 3 + offset), 16));
  const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
  return luminance > 150 ? "215 28% 16%" : "0 0% 100%";
}

function darkSurface(hex: string, lightness: number): string {
  return hslChannel(hex, lightness);
}

function lightTint(hex: string, lightness: number): string {
  const [hue, saturation] = hexToHsl(hex);
  return `${Math.round(hue * 360)} ${Math.round(Math.min(100, saturation * 100))}% ${Math.round(lightness * 100)}%`;
}

export function applyDealerTheme(payload: DealerThemePayload): void {
  if (typeof document === "undefined") return;

  const primary = firstColor(payload.primaryColors, FALLBACK_THEME.primaryColors[0]);
  const secondary = firstColor(payload.secondaryColors, FALLBACK_THEME.secondaryColors[0]);
  const accent = firstColor(payload.accentColors, FALLBACK_THEME.accentColors[0]);
  const primaryForeground = readableForeground(primary);
  const secondaryForeground = readableForeground(secondary);
  const root = document.documentElement;
  const isDark = root.classList.contains("dark");
  // The shell follows Gymove's light admin grammar. Dealer colors still drive
  // brand surfaces and Dealer DNA, but the navigation chrome stays readable
  // and consistent across dealer themes.
  const sidebar = "0 0% 100%";
  const sidebarForeground = "220 18% 25%";
  const values: Record<string, string> = {
    "--background": hslChannel(secondary),
    "--foreground": secondaryForeground,
    "--card": lightTint(secondary, Math.min(0.99, hexToHsl(secondary)[2] + 0.03)),
    "--card-foreground": secondaryForeground,
    "--card-border": lightTint(secondary, Math.max(0.72, hexToHsl(secondary)[2] - 0.12)),
    "--popover": lightTint(secondary, Math.min(0.99, hexToHsl(secondary)[2] + 0.03)),
    "--popover-foreground": secondaryForeground,
    "--popover-border": lightTint(secondary, Math.max(0.7, hexToHsl(secondary)[2] - 0.14)),
    "--primary": hslChannel(primary),
    "--primary-foreground": primaryForeground,
    "--secondary": lightTint(secondary, Math.min(0.99, hexToHsl(secondary)[2] + 0.02)),
    "--secondary-foreground": secondaryForeground,
    "--muted": lightTint(secondary, Math.min(0.98, hexToHsl(secondary)[2] + 0.01)),
    "--muted-foreground": lightTint(secondary, secondaryForeground === "0 0% 100%" ? 0.72 : 0.42),
    "--accent": hslChannel(accent),
    "--accent-foreground": readableForeground(accent),
    "--success": hslChannel(accent),
    "--success-foreground": readableForeground(accent),
    "--ring": hslChannel(primary),
    "--border": lightTint(secondary, Math.max(0.7, hexToHsl(secondary)[2] - 0.12)),
    "--input": lightTint(secondary, Math.max(0.64, hexToHsl(secondary)[2] - 0.18)),
    // Keep the navigation surface white, while using the dealer primary for
    // active items and controls instead of the redesign's fixed blue.
    "--sidebar": sidebar,
    "--sidebar-foreground": sidebarForeground,
    "--sidebar-border": "220 18% 91%",
    "--sidebar-primary": hslChannel(primary),
    "--sidebar-primary-foreground": primaryForeground,
    "--sidebar-accent": lightTint(primary, 0.95),
    "--sidebar-accent-foreground": hslChannel(primary, 0.35),
    "--sidebar-ring": hslChannel(primary),
  };

  if (isDark) {
    Object.assign(values, {
      "--background": darkSurface(secondary, 0.1),
      "--foreground": "30 12% 94%",
      "--card": darkSurface(secondary, 0.13),
      "--card-foreground": "30 12% 94%",
      "--card-border": darkSurface(secondary, 0.22),
      "--popover": darkSurface(secondary, 0.14),
      "--popover-foreground": "30 12% 94%",
      "--popover-border": darkSurface(secondary, 0.24),
      "--secondary": darkSurface(secondary, 0.17),
      "--secondary-foreground": "30 10% 90%",
      "--muted": darkSurface(secondary, 0.17),
      "--muted-foreground": "220 8% 66%",
      "--border": darkSurface(secondary, 0.22),
      "--input": darkSurface(secondary, 0.25),
      "--sidebar": darkSurface(secondary, 0.08),
      "--sidebar-foreground": "30 10% 90%",
      "--sidebar-border": darkSurface(secondary, 0.21),
      "--sidebar-accent": hslChannel(primary, 0.25),
      "--sidebar-accent-foreground": primaryForeground,
    });
  }

  Object.entries(values).forEach(([name, value]) => root.style.setProperty(name, value));
  root.style.setProperty("color-scheme", isDark ? "dark" : "light");
}

export function dispatchDealerThemeUpdated(payload: DealerThemePayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DealerThemePayload>(DEALER_THEME_UPDATED_EVENT, { detail: payload }));
}
