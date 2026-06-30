import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Car,
  MessageCircle,
  Users,
  Calendar,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  RotateCcw,
  Tag,
  RefreshCw,
  Trash2,
  Archive,
  Zap,
} from "lucide-react";
import { Link } from "wouter";
import type { ListingWorkspace } from "@workspace/api-client-react";

type PublishedCardProps = {
  workspace: ListingWorkspace;
  tab: string;
  onMarkSold: (vehicleId: number) => void;
  onRenew: (vehicleId: number) => void;
  onUpdateListing: (vehicleId: number) => void;
  onRemoveFromMarketplace: (vehicleId: number) => void;
  onArchive: (vehicleId: number) => void;
};

function EngagementBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  switch (status) {
    case "Strong":
      return (
        <Badge className="gap-1 bg-success/20 text-success border-success/30 text-[10px] font-bold uppercase tracking-widest">
          <TrendingUp className="w-3 h-3" /> Strong
        </Badge>
      );
    case "Normal":
      return (
        <Badge className="gap-1 bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px] font-bold uppercase tracking-widest">
          <Minus className="w-3 h-3" /> Normal
        </Badge>
      );
    case "Weak":
      return (
        <Badge className="gap-1 bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] font-bold uppercase tracking-widest">
          <TrendingDown className="w-3 h-3" /> Weak
        </Badge>
      );
    case "No engagement yet":
      return (
        <Badge className="gap-1 bg-muted/50 text-muted-foreground border-border text-[10px] font-bold uppercase tracking-widest">
          No Engagement
        </Badge>
      );
    case "Needs Update":
      return (
        <Badge className="gap-1 bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] font-bold uppercase tracking-widest">
          <AlertTriangle className="w-3 h-3" /> Needs Update
        </Badge>
      );
    case "Sold":
      return (
        <Badge className="gap-1 bg-destructive/20 text-destructive border-destructive/30 text-[10px] font-bold uppercase tracking-widest">
          SOLD
        </Badge>
      );
    default:
      return null;
  }
}

function liveBadgeClass(tab: string, engagementStatus: string | null | undefined): string {
  if (tab === "sold") return "bg-destructive/90 text-white";
  if (tab === "needs-update") return "bg-amber-500/90 text-white";
  if (engagementStatus === "Weak") return "bg-amber-500/90 text-white";
  return "bg-success/90 text-white";
}

function liveBadgeLabel(tab: string, engagementStatus: string | null | undefined): string {
  if (tab === "sold") return "SOLD";
  if (tab === "needs-update") return "NEEDS UPDATE";
  if (engagementStatus === "Weak") return "⚠ WEAK";
  return "● LIVE";
}

export function PublishedCard({ workspace: w, tab, onMarkSold, onRenew, onUpdateListing, onRemoveFromMarketplace, onArchive }: PublishedCardProps) {
  return (
    <div className="rounded-xl bg-card border border-border/40 hover:border-primary/30 transition-all duration-300 overflow-hidden hover-lift flex flex-col h-full">
      {/* Image */}
      <div className="aspect-[16/10] bg-secondary/30 relative overflow-hidden flex-shrink-0 group">
        {w.primaryImageUrl ? (
          <img
            src={w.primaryImageUrl}
            alt={w.label}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-secondary/50 to-background">
            <Car className="w-12 h-12 text-muted-foreground/20" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

        {/* Status badge */}
        <Badge
          className={cn(
            "absolute top-3 right-3 z-10 uppercase text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full border-0",
            liveBadgeClass(tab, w.engagementStatus),
          )}
        >
          {liveBadgeLabel(tab, w.engagementStatus)}
        </Badge>

        {/* Price overlay */}
        <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end text-white z-10">
          <div className="font-bold text-xl drop-shadow-md">{formatCurrency(w.price)}</div>
          {w.downPayment && (
            <div className="text-xs font-medium bg-black/40 backdrop-blur-md px-2 py-1 rounded-md border border-white/10">
              ${(w.downPayment / 100).toFixed(0)}K down
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col flex-1">
        <Link href={`/listings/${w.vehicleId}`}>
          <div className="font-bold text-base leading-tight mb-1 hover:text-primary transition-colors cursor-pointer line-clamp-1">
            {w.label}
          </div>
        </Link>

        {/* Engagement row */}
        <div className="flex items-center gap-2 mb-3">
          <EngagementBadge status={w.engagementStatus} />
          {w.daysLive != null && w.daysLive >= 0 && (
            <span className="text-xs text-muted-foreground">
              {w.daysLive === 0 ? "Live today" : `${w.daysLive}d live`}
            </span>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm mb-3">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MessageCircle className="w-3.5 h-3.5 text-primary/60" />
            <span className="font-medium text-foreground">{w.messageCount ?? 0}</span>
            <span className="text-xs">msgs</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="w-3.5 h-3.5 text-primary/60" />
            <span className="font-medium text-foreground">{w.leadCount ?? 0}</span>
            <span className="text-xs">leads</span>
          </div>
          {w.publishedAt && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Calendar className="w-3.5 h-3.5 text-primary/60" />
              <span className="text-xs">{formatDate(w.publishedAt)}</span>
            </div>
          )}
        </div>

        {/* Recommendation */}
        {w.recommendation && (
          <div className={cn(
            "text-xs px-2.5 py-2 rounded-lg border mb-3 flex items-start gap-2",
            w.engagementStatus === "Strong"
              ? "bg-success/10 border-success/20 text-success"
              : w.engagementStatus === "Weak" || w.engagementStatus === "Needs Update"
                ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                : w.engagementStatus === "Sold"
                  ? "bg-destructive/10 border-destructive/20 text-destructive"
                  : "bg-secondary/50 border-border text-muted-foreground",
          )}>
            <Zap className="w-3 h-3 mt-0.5 flex-shrink-0" />
            {w.recommendation}
          </div>
        )}

        {/* Marketplace URL */}
        {w.marketplaceUrl && (
          <a
            href={w.marketplaceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary mb-3 truncate transition-colors"
          >
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">View on Marketplace</span>
          </a>
        )}

        {/* CTAs */}
        <div className="mt-auto pt-3 border-t border-border/50 flex items-center gap-2 flex-wrap">
          {tab === "published" && (
            <>
              <Link href={`/listings/${w.vehicleId}`}>
                <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 gap-1.5 border-border/60 hover:border-primary/50 hover:text-primary">
                  <TrendingUp className="w-3 h-3" /> Performance
                </Button>
              </Link>
              <Button size="sm" variant="outline" onClick={() => onRenew(w.vehicleId)} className="h-7 text-xs px-2.5 gap-1.5 border-border/60 hover:border-blue-500/50 hover:text-blue-400">
                <RotateCcw className="w-3 h-3" /> Renew
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onMarkSold(w.vehicleId)} className="h-7 text-xs px-2 gap-1 text-muted-foreground hover:text-amber-400">
                <Tag className="w-3 h-3" /> Mark Sold
              </Button>
            </>
          )}
          {tab === "needs-update" && (
            <>
              <Button size="sm" variant="outline" onClick={() => onUpdateListing(w.vehicleId)} className="h-7 text-xs px-2.5 gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10">
                <RefreshCw className="w-3 h-3" /> Update Price
              </Button>
              <Button size="sm" variant="outline" onClick={() => onRenew(w.vehicleId)} className="h-7 text-xs px-2.5 gap-1.5 border-border/60 hover:border-primary/50 hover:text-primary">
                <RotateCcw className="w-3 h-3" /> Renew
              </Button>
            </>
          )}
          {tab === "sold" && (
            <>
              <Button size="sm" variant="outline" onClick={() => onRemoveFromMarketplace(w.vehicleId)} className="h-7 text-xs px-2.5 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10">
                <Trash2 className="w-3 h-3" /> Remove
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onArchive(w.vehicleId)} className="h-7 text-xs px-2 gap-1 text-muted-foreground hover:text-foreground">
                <Archive className="w-3 h-3" /> Archive
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
