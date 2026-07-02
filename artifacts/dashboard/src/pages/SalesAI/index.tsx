import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Car,
  Loader2,
  Radio,
  ShoppingCart,
  ChevronRight,
  Inbox,
  Flame,
  Thermometer,
  Snowflake,
  AlertTriangle,
  XCircle,
  Bot,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = "/api";
const DEALER_ID = 1;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ListingVehicle {
  id: number;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  price: number | null;
  mileage: number | null;
  stockNumber: string | null;
  status: string;
}

interface MarketplaceListing {
  id: number;
  vehicleId: number;
  dealerId: number;
  listingUrl: string | null;
  publishedAt: string | null;
  status: string;
  messagesReceived: number;
  unreadMessages: number;
  lastMessageAt: string | null;
  assignedTo: string | null;
  leadQuality: string | null;
  notes: string | null;
  vehicle: ListingVehicle;
  thumbnailUrl: string | null;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchListings(): Promise<{ listings: MarketplaceListing[] }> {
  const r = await fetch(`${API_BASE}/marketplace-listings?dealerId=${DEALER_ID}`);
  if (!r.ok) throw new Error("Failed to fetch listings");
  return r.json() as Promise<{ listings: MarketplaceListing[] }>;
}

async function patchListing(id: number, body: { status?: string }) {
  const r = await fetch(`${API_BASE}/marketplace-listings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Update failed");
  return r.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(p: number | null) {
  if (!p) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(p);
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function LeadBadge({ q }: { q: string | null }) {
  if (!q) return null;
  const map: Record<string, { cls: string; icon: React.ElementType }> = {
    Hot: { cls: "bg-red-500/10 text-red-400 border-red-500/20", icon: Flame },
    Warm: { cls: "bg-orange-500/10 text-orange-400 border-orange-500/20", icon: Thermometer },
    Cold: { cls: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: Snowflake },
  };
  const cfg = map[q] ?? map["Cold"]!;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide", cfg.cls)}>
      <Icon className="w-2.5 h-2.5" />{q}
    </span>
  );
}

// ── CRM Listing Card ──────────────────────────────────────────────────────────

function CrmCard({
  listing,
  onMarkAppointment,
  onMarkSold,
  busy,
}: {
  listing: MarketplaceListing;
  onMarkAppointment: () => void;
  onMarkSold: () => void;
  busy: boolean;
}) {
  const { vehicle } = listing;
  const vehicleName = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ");
  const [, navigate] = useLocation();

  return (
    <div className="flex gap-3 p-4 rounded-xl bg-card border border-white/[0.06] hover:border-white/10 transition-colors">
      {/* Thumbnail */}
      <div className="w-20 h-16 rounded-lg bg-white/[0.02] border border-white/[0.04] overflow-hidden shrink-0">
        {listing.thumbnailUrl ? (
          <img src={listing.thumbnailUrl} alt={vehicleName} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car className="w-6 h-6 text-muted-foreground/20" />
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{vehicleName}</div>
            <div className="text-xs text-muted-foreground/70">{fmtPrice(vehicle.price)}{vehicle.mileage ? ` · ${vehicle.mileage.toLocaleString()} mi` : ""}</div>
          </div>
          <LeadBadge q={listing.leadQuality} />
        </div>

        {/* Message row */}
        <div className="flex items-center gap-2 text-[11px]">
          {listing.unreadMessages > 0 ? (
            <span className="flex items-center gap-1 font-bold text-blue-400">
              <MessageSquare className="w-3 h-3" />
              {listing.unreadMessages} unread
            </span>
          ) : listing.messagesReceived > 0 ? (
            <span className="flex items-center gap-1 text-green-400/80">
              <MessageSquare className="w-3 h-3" />
              {listing.messagesReceived} message{listing.messagesReceived !== 1 ? "s" : ""}
            </span>
          ) : null}
          {listing.lastMessageAt && (
            <span className="text-muted-foreground/50">{fmtRelative(listing.lastMessageAt)}</span>
          )}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
          <span className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            Published {fmtDate(listing.publishedAt)}
          </span>
          {listing.assignedTo && (
            <span className="flex items-center gap-1">→ {listing.assignedTo}</span>
          )}
        </div>

        {/* Action row */}
        <div className="flex items-center gap-1.5 pt-0.5">
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px] font-bold uppercase tracking-wide border-white/10 hover:bg-white/[0.04]"
            onClick={() => navigate(`/conversations?vehicleId=${vehicle.id}`)}
          >
            <MessageSquare className="w-2.5 h-2.5 mr-1" />
            Conversation
          </Button>
          {listing.listingUrl && (
            <a href={listing.listingUrl} target="_blank" rel="noopener noreferrer">
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px] font-bold uppercase tracking-wide border-white/10 hover:bg-white/[0.04]"
              >
                <ExternalLink className="w-2.5 h-2.5 mr-1" />
                Listing
              </Button>
            </a>
          )}
          {listing.status !== "Appointment" && listing.status !== "Sold" && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px] font-bold uppercase tracking-wide border-green-500/20 text-green-400/80 hover:bg-green-500/[0.06]"
              onClick={onMarkAppointment}
              disabled={busy}
            >
              {busy ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Calendar className="w-2.5 h-2.5 mr-1" />}
              Appointment
            </Button>
          )}
          {listing.status !== "Sold" && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px] font-bold uppercase tracking-wide border-primary/25 text-primary/80 hover:bg-primary/[0.06]"
              onClick={onMarkSold}
              disabled={busy}
            >
              {busy ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <ShoppingCart className="w-2.5 h-2.5 mr-1" />}
              Sold
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function CrmSection({
  title,
  icon,
  accent,
  listings,
  onMarkAppointment,
  onMarkSold,
  busyId,
}: {
  title: string;
  icon: React.ElementType;
  accent: string;
  listings: MarketplaceListing[];
  onMarkAppointment: (id: number) => void;
  onMarkSold: (id: number) => void;
  busyId: number | null;
}) {
  const Icon = icon;
  if (listings.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className={cn("w-5 h-5 rounded flex items-center justify-center", accent)}>
          <Icon className="w-3 h-3" />
        </div>
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{title}</span>
        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", accent)}>{listings.length}</span>
        <div className="flex-1 h-px bg-white/[0.04]" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
        {listings.map((l) => (
          <CrmCard
            key={l.id}
            listing={l}
            onMarkAppointment={() => onMarkAppointment(l.id)}
            onMarkSold={() => onMarkSold(l.id)}
            busy={busyId === l.id}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SalesAIWorkspace() {
  const [busyId, setBusyId] = useState<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["marketplace-listings"],
    queryFn: fetchListings,
    refetchInterval: 30_000,
  });

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => patchListing(id, { status }),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: (_, { status }) => {
      toast({ title: status === "Sold" ? "Marked as Sold" : "Appointment set" });
      void qc.invalidateQueries({ queryKey: ["marketplace-listings"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    onSettled: () => setBusyId(null),
  });

  const all = data?.listings ?? [];

  // ── CRM sections ─────────────────────────────────────────────────────────────
  const newMessages  = all.filter((l) => l.unreadMessages > 0);
  const needsFollowUp = all.filter((l) => l.messagesReceived > 0 && l.unreadMessages === 0 && l.status !== "Appointment" && l.status !== "Sold");
  const appointments = all.filter((l) => l.status === "Appointment");
  const sold         = all.filter((l) => l.status === "Sold");
  const liveCount    = all.filter((l) => l.status === "Live" || l.status === "Appointment").length;

  const hasAny = all.length > 0;
  const hasEngagement = newMessages.length + needsFollowUp.length + appointments.length + sold.length > 0;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto animate-in fade-in duration-500">
        <div className="p-6 max-w-7xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">SALES AI</div>
                  <h1 className="text-xl font-semibold text-white tracking-tight leading-none">Marketplace CRM</h1>
                </div>
              </div>
              <p className="text-sm text-muted-foreground ml-10">
                DealerPilot monitors your Marketplace listings and buyer conversations 24/7.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5 border-white/10 hover:bg-white/[0.04]"
                onClick={() => navigate("/leads")}
              >
                <ChevronRight className="w-3.5 h-3.5" />
                Leads CRM
              </Button>
            </div>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Live Listings", value: liveCount, icon: Radio, color: "text-green-400" },
              { label: "New Messages", value: newMessages.length, icon: MessageSquare, color: newMessages.length > 0 ? "text-blue-400" : "text-muted-foreground" },
              { label: "Appointments", value: appointments.length, icon: Calendar, color: appointments.length > 0 ? "text-amber-400" : "text-muted-foreground" },
              { label: "Sold", value: sold.length, icon: CheckCircle2, color: sold.length > 0 ? "text-primary" : "text-muted-foreground" },
            ].map((kpi) => (
              <div key={kpi.label} className="bg-card border border-white/[0.06] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wide">{kpi.label}</span>
                  <kpi.icon className={cn("w-4 h-4", kpi.color)} />
                </div>
                <div className={cn("text-2xl font-bold tabular-nums", kpi.color)}>{kpi.value}</div>
              </div>
            ))}
          </div>

          {/* Body */}
          {isLoading ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading…
            </div>
          ) : isError ? (
            <div className="flex items-center justify-center py-24 text-red-400">
              <XCircle className="w-5 h-5 mr-2" />Failed to load listings
            </div>
          ) : !hasAny ? (
            // Big empty state — no published vehicles yet
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-6">
                <Radio className="w-8 h-8 text-muted-foreground/20" />
              </div>
              <div className="text-lg font-semibold text-white/70 mb-2">
                No Marketplace conversations yet.
              </div>
              <div className="text-sm text-muted-foreground/60 max-w-sm mb-6">
                Publish your first vehicle. DealerPilot will automatically create
                conversations as buyers begin messaging your Marketplace listings.
              </div>
              <Button
                variant="outline"
                className="gap-2 border-white/10 hover:bg-white/[0.04]"
                onClick={() => navigate("/listings")}
              >
                <ChevronRight className="w-4 h-4" />
                Open Marketplace AI
              </Button>
            </div>
          ) : !hasEngagement ? (
            // Has listings but no engagement yet
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-xl bg-green-500/[0.06] border border-green-500/15 flex items-center justify-center mb-4">
                <Radio className="w-6 h-6 text-green-400/60" />
              </div>
              <div className="text-base font-semibold text-white/60 mb-2">
                {liveCount} listing{liveCount !== 1 ? "s" : ""} live — waiting for messages
              </div>
              <div className="text-xs text-muted-foreground/50 max-w-xs">
                Buyer conversations will appear here automatically as they message your Marketplace listings.
              </div>
            </div>
          ) : (
            // CRM sections
            <div className="space-y-8">
              <CrmSection
                title="New Messages"
                icon={MessageSquare}
                accent="bg-blue-500/10 text-blue-400"
                listings={newMessages}
                onMarkAppointment={(id) => mutation.mutate({ id, status: "Appointment" })}
                onMarkSold={(id) => mutation.mutate({ id, status: "Sold" })}
                busyId={busyId}
              />
              <CrmSection
                title="Needs Follow-Up"
                icon={AlertTriangle}
                accent="bg-amber-500/10 text-amber-400"
                listings={needsFollowUp}
                onMarkAppointment={(id) => mutation.mutate({ id, status: "Appointment" })}
                onMarkSold={(id) => mutation.mutate({ id, status: "Sold" })}
                busyId={busyId}
              />
              <CrmSection
                title="Appointments"
                icon={Calendar}
                accent="bg-green-500/10 text-green-400"
                listings={appointments}
                onMarkAppointment={(id) => mutation.mutate({ id, status: "Appointment" })}
                onMarkSold={(id) => mutation.mutate({ id, status: "Sold" })}
                busyId={busyId}
              />
              <CrmSection
                title="Sold"
                icon={CheckCircle2}
                accent="bg-primary/10 text-primary"
                listings={sold}
                onMarkAppointment={(id) => mutation.mutate({ id, status: "Appointment" })}
                onMarkSold={(id) => mutation.mutate({ id, status: "Sold" })}
                busyId={busyId}
              />
            </div>
          )}

          {/* Quick nav footer */}
          {hasAny && (
            <div className="flex items-center gap-3 pt-2 border-t border-white/[0.04]">
              <span className="text-[10px] text-muted-foreground/40 uppercase tracking-widest">Also</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground/60 hover:text-white/70" onClick={() => navigate("/leads")}>
                <Inbox className="w-3 h-3 mr-1.5" /> Leads CRM
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground/60 hover:text-white/70" onClick={() => navigate("/sales-ai/marketplace-listings")}>
                <Radio className="w-3 h-3 mr-1.5" /> All Listings
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
