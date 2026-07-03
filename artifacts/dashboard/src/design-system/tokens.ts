export const motion = {
  fast: "duration-150",
  normal: "duration-250",
  slow: "duration-400",
  easing: "ease-out",
} as const;

export const spacing = {
  pageGutter: "p-8",
  sectionGap: "space-y-8",
  cardPadding: "p-6",
  cardPaddingCompact: "p-4",
  headerGap: "pb-6",
} as const;

export const radius = {
  card: "rounded-xl",
  cardLarge: "rounded-2xl",
  cardHero: "rounded-3xl",
  icon: "rounded-lg",
  iconLarge: "rounded-xl",
  pill: "rounded-full",
  badge: "rounded-md",
} as const;

export const shadow = {
  card: "shadow-sm",
  cardHover: "shadow-md shadow-black/20",
  glow: "shadow-xl",
} as const;
