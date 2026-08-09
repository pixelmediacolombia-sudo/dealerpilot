export const motion = {
  fast: "duration-100",
  normal: "duration-200",
  slow: "duration-300",
  easing: "ease-out",
} as const;

export const spacing = {
  pageGutter: "p-4 sm:p-6",
  sectionGap: "space-y-6",
  cardPadding: "p-5",
  cardPaddingCompact: "p-4",
  headerGap: "pb-5",
} as const;

export const radius = {
  card: "rounded-lg",
  cardLarge: "rounded-xl",
  cardHero: "rounded-xl",
  icon: "rounded-md",
  iconLarge: "rounded-lg",
  pill: "rounded-full",
  badge: "rounded-md",
} as const;

export const shadow = {
  card: "shadow-sm",
  cardHover: "shadow-md",
  glow: "shadow-md",
} as const;
