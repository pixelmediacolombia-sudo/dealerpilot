import { Car } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreativeRenderSpec } from "@workspace/api-client-react";

export type CreativeFormat = "cover" | "story" | "feed";

const ASPECT: Record<CreativeFormat, string> = {
  cover: "aspect-square",
  story: "aspect-[9/16]",
  feed: "aspect-square",
};

const FORMAT_LABEL: Record<CreativeFormat, string> = {
  cover: "Marketplace Cover · 1080×1080",
  story: "Story · 1080×1920",
  feed: "Facebook Feed · 1200×1200",
};

function backgroundLayer(spec: CreativeRenderSpec) {
  const { colors, backgroundStyle } = spec;
  switch (backgroundStyle) {
    case "Dark Studio":
      return `radial-gradient(circle at 50% 20%, ${colors.secondary}, #050505 75%)`;
    case "Clean Light":
      return `linear-gradient(160deg, #ffffff 0%, ${colors.secondary} 100%)`;
    case "Showroom":
      return `linear-gradient(180deg, ${colors.secondary} 0%, ${colors.primary} 140%)`;
    case "Outdoor":
      return `linear-gradient(180deg, ${colors.accent} -40%, ${colors.primary} 60%, #050505 120%)`;
    default:
      return `linear-gradient(160deg, ${colors.primary}, #050505)`;
  }
}

function isLightBackground(spec: CreativeRenderSpec) {
  return spec.backgroundStyle === "Clean Light";
}

export function CreativePreview({
  spec,
  format,
  className,
}: {
  spec: CreativeRenderSpec;
  format: CreativeFormat;
  className?: string;
}) {
  const light = isLightBackground(spec);
  const fg = light ? "#0a0a0a" : "#ffffff";
  const muted = light ? "rgba(10,10,10,0.65)" : "rgba(255,255,255,0.75)";
  const isStory = format === "story";

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-xl border border-border shadow-lg",
        ASPECT[format],
        className,
      )}
      style={{
        background: backgroundLayer(spec),
        fontFamily: `${spec.font}, ui-sans-serif, system-ui, sans-serif`,
        color: fg,
        containerType: "inline-size",
      }}
    >
      {/* Vehicle image */}
      <div className={cn("absolute inset-x-0", isStory ? "top-[18%] h-[42%]" : "top-[20%] h-[48%]")}>
        {spec.vehicleImageUrl ? (
          <img
            src={spec.vehicleImageUrl}
            alt={spec.headline}
            className="w-full h-full object-contain drop-shadow-2xl"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car className="w-1/3 h-1/3" style={{ color: muted }} />
          </div>
        )}
      </div>

      {/* Accent bar */}
      <div className="absolute top-0 inset-x-0 h-1.5" style={{ background: spec.colors.accent }} />

      {/* Header: dealer + logo */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between p-[5%]">
        <div className="flex items-center gap-2">
          {spec.logoUrl ? (
            <img src={spec.logoUrl} alt={spec.dealerName} className="h-[6cqw] w-auto object-contain" />
          ) : (
            <div
              className="rounded-md font-bold flex items-center justify-center"
              style={{
                background: spec.colors.accent,
                color: "#ffffff",
                width: "9%",
                aspectRatio: "1",
                fontSize: "3.2cqw",
                minWidth: "28px",
              }}
            >
              {spec.dealerName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <span className="font-semibold tracking-tight" style={{ fontSize: "3.4cqw" }}>
            {spec.dealerName}
          </span>
        </div>
        <span
          className="uppercase tracking-widest font-medium"
          style={{ fontSize: "2.2cqw", color: muted }}
        >
          {spec.brandStyle}
        </span>
      </div>

      {/* Footer content */}
      <div className="absolute bottom-0 inset-x-0 p-[6%] flex flex-col gap-[2.5%]">
        <h2 className="font-extrabold leading-[1.05] tracking-tight" style={{ fontSize: "6.2cqw" }}>
          {spec.headline}
        </h2>
        <p style={{ fontSize: "3cqw", color: muted }} className="leading-snug">
          {spec.subline}
        </p>
        <div className="flex items-center justify-between mt-[2%]">
          <div
            className="rounded-lg font-bold"
            style={{
              background: spec.colors.primary,
              color: "#ffffff",
              padding: "1.6cqw 3.2cqw",
              fontSize: "5cqw",
            }}
          >
            {spec.price}
          </div>
          <div
            className="rounded-full font-semibold inline-flex items-center"
            style={{
              background: spec.colors.accent,
              color: "#ffffff",
              padding: "1.6cqw 3.6cqw",
              fontSize: "2.8cqw",
            }}
          >
            {spec.cta}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CreativePreviewCard({
  spec,
  format,
}: {
  spec: CreativeRenderSpec;
  format: CreativeFormat;
}) {
  return (
    <div className="space-y-2">
      <CreativePreview spec={spec} format={format} />
      <p className="text-xs text-muted-foreground text-center">{FORMAT_LABEL[format]}</p>
    </div>
  );
}
