import { cn } from "@/lib/utils";
import { formatCurrency, formatMileage } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Car,
  MoreVertical,
  Eye,
  Wand2,
  UploadCloud,
  Tag,
  Archive,
  CheckCircle2,
  RotateCcw,
  CalendarClock,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import type { Vehicle } from "@workspace/api-client-react";

type VehicleCardProps = {
  vehicle: Vehicle;
  selectionMode: boolean;
  isSelected: boolean;
  onToggle: (id: number, e: React.MouseEvent) => void;
  onAction: (action: string, vehicleId: number) => void;
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  Published: { label: "LIVE", className: "bg-success/80 text-success-foreground border-success/20" },
  "Ready to Publish": { label: "READY", className: "bg-blue-500/80 text-white border-blue-500/20" },
  "AI Generated": { label: "AI", className: "bg-accent/80 text-accent-foreground border-accent/20" },
  Active: { label: "ACTIVE", className: "bg-secondary/80 text-secondary-foreground border-secondary/20" },
  "Price Changed": { label: "PRICE ↓", className: "bg-amber-500/80 text-white border-amber-500/20" },
  "New": { label: "NEW", className: "bg-primary/80 text-primary-foreground border-primary/20" },
  Archived: { label: "ARCHIVED", className: "bg-muted/80 text-muted-foreground border-muted/20" },
  "Sold/Removed": { label: "SOLD", className: "bg-destructive/80 text-destructive-foreground border-destructive/20" },
};

function primaryAction(status: string): { label: string; icon: React.ReactNode; action: string } {
  switch (status) {
    case "Published":
      return { label: "Renew", icon: <RotateCcw className="w-3.5 h-3.5" />, action: "renew" };
    case "Ready to Publish":
      return { label: "Publish", icon: <UploadCloud className="w-3.5 h-3.5" />, action: "publish" };
    case "Price Changed":
      return { label: "Update Listing", icon: <Tag className="w-3.5 h-3.5" />, action: "mark_ready" };
    default:
      return { label: "Mark Ready", icon: <CheckCircle2 className="w-3.5 h-3.5" />, action: "mark_ready" };
  }
}

export function VehicleCard({ vehicle, selectionMode, isSelected, onToggle, onAction }: VehicleCardProps) {
  const [, navigate] = useLocation();
  const badge = STATUS_BADGE[vehicle.status] ?? { label: vehicle.status.toUpperCase(), className: "bg-secondary/80 text-secondary-foreground border-secondary/20" };
  const primary = primaryAction(vehicle.status);

  const handleCardClick = (e: React.MouseEvent) => {
    if (selectionMode) {
      onToggle(vehicle.id, e);
      return;
    }
    navigate(`/inventory/${vehicle.id}`);
  };

  return (
    <div
      onClick={handleCardClick}
      className={cn(
        "group relative overflow-hidden rounded-xl bg-card border transition-all duration-300 cursor-pointer flex flex-col h-full",
        isSelected
          ? "border-primary ring-2 ring-primary/40 ring-offset-1 ring-offset-background"
          : "border-border/40 hover:border-primary/30 hover-lift",
      )}
    >
      {/* Image area */}
      <div className="aspect-[4/3] bg-secondary/30 relative overflow-hidden flex-shrink-0">
        {vehicle.primaryImageUrl ? (
          <img
            src={vehicle.primaryImageUrl}
            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-secondary/50 to-background">
            <Car className="w-12 h-12 text-muted-foreground/20" />
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {/* Checkbox — hover on desktop, always when selection mode */}
        <div
          className={cn(
            "absolute top-3 left-3 z-20 transition-all duration-200",
            selectionMode ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          onClick={(e) => onToggle(vehicle.id, e)}
        >
          <div className="bg-background/80 backdrop-blur-sm rounded-md p-0.5 border border-border/50">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => {}}
              className="w-4 h-4 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            />
          </div>
        </div>

        {/* Status badge + overflow menu */}
        <div className="absolute top-3 right-3 flex items-center gap-2 z-20">
          <Badge
            variant="outline"
            className={cn("backdrop-blur-sm px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase border", badge.className)}
          >
            {badge.label}
          </Badge>
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="bg-black/50 backdrop-blur-sm rounded-md p-1 text-white/80 hover:text-white hover:bg-black/70 transition-colors border border-white/10">
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => navigate(`/inventory/${vehicle.id}`)}>
                  <Eye className="w-4 h-4 mr-2" /> View Details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction("schedule", vehicle.id)}>
                  <CalendarClock className="w-4 h-4 mr-2" /> Schedule
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onAction("generate_creative", vehicle.id)}>
                  <Wand2 className="w-4 h-4 mr-2" /> Generate Creative
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction("publish", vehicle.id)}>
                  <UploadCloud className="w-4 h-4 mr-2" /> Queue Publish
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onAction("mark_sold", vehicle.id)}>
                  <Tag className="w-4 h-4 mr-2" /> Mark Sold
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onAction("archive", vehicle.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Archive className="w-4 h-4 mr-2" /> Archive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Price + mileage */}
        <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end text-white z-10">
          <div className="font-bold text-xl drop-shadow-md">{formatCurrency(vehicle.price)}</div>
          <div className="text-xs font-medium bg-black/40 backdrop-blur-md px-2 py-1 rounded-md border border-white/10">
            {formatMileage(vehicle.mileage)}
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="p-4 flex flex-col flex-1">
        <div className="font-bold text-base leading-tight mb-1 group-hover:text-primary transition-colors line-clamp-1">
          {vehicle.year} {vehicle.make} {vehicle.model}
        </div>
        <div className="text-muted-foreground text-xs flex items-center gap-2 mb-3">
          <span className="truncate max-w-[110px]">{vehicle.trim || "Base"}</span>
          <span className="w-1 h-1 rounded-full bg-border flex-shrink-0" />
          <span className="font-mono">{vehicle.stockNumber ? `#${vehicle.stockNumber}` : "—"}</span>
        </div>

        {/* Footer */}
        <div className="mt-auto pt-3 border-t border-border/50 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className={cn("w-2 h-2 rounded-full", vehicle.imageCount > 0 ? "bg-primary" : "bg-muted")} />
            {vehicle.imageCount} Photos
          </div>
          <div onClick={(e) => { e.stopPropagation(); onAction(primary.action, vehicle.id); }}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs px-2.5 gap-1.5 border-border/60 hover:border-primary/50 hover:text-primary hover:bg-primary/5"
              disabled={vehicle.status === "Published" || vehicle.status === "Archived" || vehicle.status === "Sold/Removed"}
            >
              {primary.icon}
              {primary.label}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
