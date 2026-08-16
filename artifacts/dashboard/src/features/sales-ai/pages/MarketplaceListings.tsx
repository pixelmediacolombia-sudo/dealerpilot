import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDealerLocation } from "@/context/LocationContext";
import { Link } from "wouter";
import { AppLayout } from "@/shared/layout/AppLayout";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/lib/utils";
import {
  ExternalLink,
  MessageSquare,
  Car,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Loader2,
  ChevronLeft,
  Inbox,
  Eye,
  ShoppingCart,
  Flame,
  Thermometer,
  Snowflake,
  Radio,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatMileage } from "@/lib/format";

const API_BASE = "/api";
const DEALER_ID = 1;

// ── Types ────────────────────────────────────────────────────────────────────

interface ListingVehicle {
  id: number;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  price: number | null;
  mileage: number | null;
  stockNumber: string | null;
  vin: string;
  bodyStyle: string | null;
  status: string;
}

interface MarketplaceListing {
  id: number;
  vehicleId: number;
  dealerId: number;
  listingUrl: string | null;
  facebookListingId: string | null;
  publishedAt: string | null;
  status: string;
  messagesReceived: number;
  unreadMessages: number;
  lastMessageAt: string | null;
  assignedTo: string | null;
  leadQuality: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  vehicle: ListingVehicle;
  thumbnailUrl: string | null;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchListings(location?: string): Promise<{ listings: MarketplaceListing[] }> {
  const params = new URLSearchParams({ dealerId: String(DEALER_ID) });
  if (location) params.set("location", location);
  const r = await fetch(`${API_BASE}/marketplace-listings?${params.toString()}`);
  if (!r.ok) throw new Error("Failed to fetch marketplace listings");
  return r.json() as Promise<{ listings: MarketplaceListing[] }>;
}

async function patchListing(
  id: number,
  body: { status?: string; assignedTo?: string; leadQuality?: string },
): Promise<MarketplaceListing> {
  const r = await fetch(`${API_BASE}/marketplace-listings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? "Update failed");
  }
  return r.json() as Promise<MarketplaceListing>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(p: number | null) {
  if (!p) return "—";
  return formatCurrency(p);
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string; icon: React.ComponentType<{ className?: string }> }> = {
  Live: {
    label: "Live",
    color: "text-success bg-success/10 border-success/20",
    dot: "bg-success",
    icon: Radio,
  },
  "Needs Review": {
    label: "Needs Review",
    color: "text-warning bg-warning/10 border-warning/20",
    dot: "bg-warning",
    icon: AlertTriangle,
  },
  Sold: {
    label: "Sold",
    color: "text-primary bg-primary/10 border-primary/20",
    dot: "bg-primary",
    icon: CheckCircle2,
  },
  Failed: {
    label: "Failed",
    color: "text-destructive bg-destructive/10 border-destructive/20",
    dot: "bg-destructive",
    icon: XCircle,
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["Live"]!;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border", cfg.color)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function LeadQualityBadge({ quality }: { quality: string | null }) {
  if (!quality) return null;
  if (quality === "Hot") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/10 border border-destructive/20 text-destructive">
      <Flame className="w-3 h-3" /> Hot
    </span>
  );
  if (quality === "Warm") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-500/10 border border-orange-500/20 text-orange-400">
      <Thermometer className="w-3 h-3" /> Warm
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 border border-primary/20 text-primary">
      <Snowflake className="w-3 h-3" /> Cold
    </span>
  );
}

// ── Listing Card ──────────────────────────────────────────────────────────────

function ListingCard({
  listing,
  onMarkSold,
  markingSold,
}: {
  listing: MarketplaceListing;
  onMarkSold: (id: number) => void;
  markingSold: boolean;
}) {
  const { vehicle } = listing;
  const vehicleName = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter(Boolean)
    .join(" ");

  const hasUnread = listing.unreadMessages > 0;
  const noMessages = listing.messagesReceived === 0;
  const isInventoryRemoved = vehicle.status === "Sold/Removed";

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:border-border transition-colors">
      {/* Thumbnail */}
      <div className="relative h-44 bg-muted overflow-hidden">
        {listing.thumbnailUrl ? (
          <img
            src={listing.thumbnailUrl}
            alt={vehicleName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car className="w-12 h-12 text-muted-foreground/20" />
          </div>
        )}
        {/* Status overlay */}
        <div className="absolute top-2 left-2">
          <StatusBadge status={listing.status} />
        </div>
        {isInventoryRemoved && (
          <div className="absolute bottom-2 left-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning/90 text-foreground shadow">
              <AlertTriangle className="w-3 h-3" />
              Inventory removed
            </span>
          </div>
        )}
        {/* Unread badge */}
        {hasUnread && (
          <div className="absolute top-2 right-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-primary text-foreground shadow">
              {listing.unreadMessages} unread
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Vehicle name + price */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-foreground text-sm leading-tight">{vehicleName}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {vehicle.mileage != null ? formatMileage(vehicle.mileage) : ""}
              {vehicle.stockNumber ? ` · #${vehicle.stockNumber}` : ""}
            </div>
          </div>
          <div className="text-base font-bold text-foreground whitespace-nowrap shrink-0">
            {formatPrice(vehicle.price)}
          </div>
        </div>

        {/* Published info */}
        <div className="text-[11px] text-muted-foreground/70 flex items-center gap-1.5">
          <Clock className="w-3 h-3 shrink-0" />
          Published {formatDate(listing.publishedAt)}
        </div>

        {/* Lead quality */}
        {listing.leadQuality && (
          <div>
            <LeadQualityBadge quality={listing.leadQuality} />
          </div>
        )}

        {isInventoryRemoved && (
          <div className="text-xs px-3 py-2 rounded-lg border bg-warning/10 border-warning/20 text-warning">
            Vehicle is Sold/Removed in inventory while the Marketplace listing is still tracked as live.
          </div>
        )}

        {/* Messages row */}
        <div className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-xs",
          noMessages
            ? "bg-muted border border-border"
            : hasUnread
              ? "bg-primary/[0.06] border border-primary/15"
              : "bg-success/[0.04] border border-success/10",
        )}>
          <MessageSquare className={cn("w-3.5 h-3.5 shrink-0", noMessages ? "text-muted-foreground/40" : hasUnread ? "text-primary" : "text-success")} />
          <div className="flex-1 min-w-0">
            {noMessages ? (
              <span className="text-muted-foreground/50">Messages: Not connected</span>
            ) : (
              <span className={hasUnread ? "text-primary" : "text-foreground"}>
                Messages: <span className="font-medium">{listing.messagesReceived}</span>
                {hasUnread ? (
                  <> · <span className="font-bold text-primary">{listing.unreadMessages} unread</span></>
                ) : null}
              </span>
            )}
          </div>
          {listing.lastMessageAt && (
            <span className="text-muted-foreground/50 shrink-0">
              {formatRelativeTime(listing.lastMessageAt)}
            </span>
          )}
        </div>

        {/* Assignee */}
        {listing.assignedTo && (
          <div className="text-[11px] text-muted-foreground/60">
            Assigned: <span className="text-foreground">{listing.assignedTo}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {listing.listingUrl ? (
            <a
              href={listing.listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1"
            >
              <Button variant="outline" size="sm" className="w-full text-xs gap-1.5 border-border hover:bg-muted">
                <ExternalLink className="w-3.5 h-3.5" />
                Open Listing
              </Button>
            </a>
          ) : (
            <Button variant="outline" size="sm" className="flex-1 text-xs gap-1.5 border-border opacity-40 cursor-not-allowed" disabled>
              <ExternalLink className="w-3.5 h-3.5" />
              No URL
            </Button>
          )}

          <Link href="/sales-ai" className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs gap-1.5 border-border hover:bg-muted">
              <Eye className="w-3.5 h-3.5" />
              Conversations
            </Button>
          </Link>

          {listing.status !== "Sold" && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1.5 border-primary/25 text-primary/80 hover:bg-primary/10 hover:text-primary hover:border-primary/40 shrink-0"
              onClick={() => onMarkSold(listing.id)}
              disabled={markingSold}
            >
              {markingSold ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShoppingCart className="w-3.5 h-3.5" />
              )}
              Sold
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

type FilterKey = "all" | "live" | "needs-followup" | "no-messages" | "sold" | "failed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "needs-followup", label: "Needs Follow-up" },
  { key: "no-messages", label: "No Messages Yet" },
  { key: "sold", label: "Sold" },
  { key: "failed", label: "Failed" },
];

function applyFilter(listings: MarketplaceListing[], filter: FilterKey): MarketplaceListing[] {
  switch (filter) {
    case "live": return listings.filter((l) => l.status === "Live");
    case "needs-followup": return listings.filter((l) => l.unreadMessages > 0);
    case "no-messages": return listings.filter((l) => l.messagesReceived === 0);
    case "sold": return listings.filter((l) => l.status === "Sold");
    case "failed": return listings.filter((l) => l.status === "Failed");
    default: return listings;
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function MarketplaceListings() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [markingSoldId, setMarkingSoldId] = useState<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { selectedLocation } = useDealerLocation();

  const locationFilter = selectedLocation || undefined;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["marketplace-listings", locationFilter],
    queryFn: () => fetchListings(locationFilter),
    refetchInterval: 30_000,
  });

  const markSoldMutation = useMutation({
    mutationFn: (id: number) => patchListing(id, { status: "Sold" }),
    onMutate: (id) => { setMarkingSoldId(id); },
    onSuccess: () => {
      toast({ title: "Marked as Sold" });
      void qc.invalidateQueries({ queryKey: ["marketplace-listings"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
    onSettled: () => { setMarkingSoldId(null); },
  });

  const allListings = data?.listings ?? [];
  const filtered = applyFilter(allListings, filter);

  // KPI counts
  const liveCount = allListings.filter((l) => l.status === "Live").length;
  const unreadCount = allListings.reduce((s, l) => s + l.unreadMessages, 0);
  const soldCount = allListings.filter((l) => l.status === "Sold").length;
  const totalMessages = allListings.reduce((s, l) => s + l.messagesReceived, 0);

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <Link href="/sales-ai" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3 transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" />
              Sales AI
            </Link>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-success/10 border border-success/20 flex items-center justify-center">
                <Radio className="w-4 h-4 text-success" />
              </div>
              <h1 className="text-xl font-semibold text-foreground tracking-tight">Marketplace Listings</h1>
              {liveCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/20  tracking-wide">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
                  </span>
                  {liveCount} Live
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground ml-11">
              Published vehicles on Facebook Marketplace — track messages, leads, and sales.
            </p>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Live Listings", value: liveCount, color: "text-success", icon: Radio },
            { label: "Unread Messages", value: unreadCount, color: "text-primary", icon: MessageSquare },
            { label: "Total Messages", value: totalMessages, color: "text-foreground", icon: Inbox },
            { label: "Vehicles Sold", value: soldCount, color: "text-primary", icon: CheckCircle2 },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium  tracking-wide">{kpi.label}</span>
                <kpi.icon className={cn("w-4 h-4", kpi.color)} />
              </div>
              <div className={cn("text-2xl font-bold tabular-nums", kpi.color)}>{kpi.value}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-muted border border-border rounded-xl p-1 w-fit">
          {FILTERS.map((f) => {
            const count = applyFilter(allListings, f.key).length;
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition",
                  active
                    ? "bg-muted text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                {count > 0 && (
                  <span className={cn(
                    "px-1.5 py-0.5 rounded-full text-xs font-bold tabular-nums",
                    active ? "bg-muted text-foreground" : "bg-muted text-muted-foreground",
                    f.key === "needs-followup" && count > 0 && "bg-primary/20 text-primary",
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading listings…
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center py-20 text-destructive">
            <XCircle className="w-5 h-5 mr-2" />
            Failed to load listings
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 rounded-xl bg-muted border border-border flex items-center justify-center mb-4">
              <Radio className="w-6 h-6 text-muted-foreground/30" />
            </div>
            <div className="text-sm font-medium text-muted-foreground mb-1">
              {filter === "all"
                ? "No marketplace listings yet"
                : `No listings in this category`}
            </div>
            <div className="text-xs text-muted-foreground/50 max-w-xs">
              {filter === "all"
                ? "Published vehicles will appear here automatically once the Chrome extension completes a Marketplace publish."
                : "Try a different filter above."}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                onMarkSold={(id) => markSoldMutation.mutate(id)}
                markingSold={markingSoldId === listing.id}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
