import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AppLayout } from "@/shared/layout/AppLayout";
import {
  useUpdateConversationStatus,
  useUpdateConversationAutoReply,
  useUpdateLead,
  useGetConnectionStatus,
  getGetConnectionStatusQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { Switch } from "@/shared/ui/switch";
import { cn } from "@/lib/utils";
import {
  MessageSquare, Calendar, CheckCircle2, Loader2,
  Bot, User, Flame, Thermometer, Snowflake, AlertCircle,
  Search, ChevronRight, Phone, FileText, Shield,
  Copy, Check, Zap, XCircle, Clock, Car, ExternalLink,
  Send, UserCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = "/api";
const DEALER_ID = 1;
const SALES_THREAD_REFRESH_MS = 2_000;
const SALES_LIST_REFRESH_MS = 3_000;
const STORE_PHONE = "+1 703-763-4675";

// ── Types ──────────────────────────────────────────────────────────────────

interface VehicleInfo {
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

interface LeadItem {
  id: number;
  buyerName: string | null;
  temperature: string | null;
  leadScore: number | null;
  status: string | null;
  phone: string | null;
  hasId: boolean | null;
  hasProofOfIncome: boolean | null;
  appointmentIntent: boolean | null;
  buyerTimeline: string | null;
  publishedDownPayment: number | null;
  buyerAvailableDownPayment: number | null;
  suggestedReply: string | null;
}

interface MessageItem {
  id: number;
  role: string;
  content: string;
  createdAt: string;
}

interface ConvListItem {
  id: number;
  buyerName: string | null;
  status: string;
  autoReplyEnabled: boolean;
  lastMessageAt: string | null;
  vehicleType: string | null;
  detectedVehicleTitle: string | null;
  marketplaceDownPayment: number | null;
  lead: LeadItem | null;
  lastMessage: MessageItem | null;
  vehicle: VehicleInfo | null;
  listingUrl: string | null;
}

interface ConvDetail {
  conversation: {
    id: number;
    buyerName: string | null;
    status: string;
    autoReplyEnabled: boolean;
    vehicleType: string | null;
    detectedVehicleTitle: string | null;
    marketplaceDownPayment: number | null;
    language: string | null;
  };
  messages: MessageItem[];
  lead: LeadItem | null;
  vehicle: VehicleInfo | null;
  listingUrl: string | null;
}

// ── API ────────────────────────────────────────────────────────────────────

async function fetchConversations(): Promise<{ conversations: ConvListItem[] }> {
  const r = await fetch(`${API_BASE}/conversations?dealerId=${DEALER_ID}`);
  if (!r.ok) throw new Error("Failed to load conversations");
  return r.json() as Promise<{ conversations: ConvListItem[] }>;
}

async function fetchConversation(id: number): Promise<ConvDetail> {
  const r = await fetch(`${API_BASE}/conversations/${id}`);
  if (!r.ok) throw new Error("Failed to load conversation");
  return r.json() as Promise<ConvDetail>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtRelative(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function fmtPrice(p: number | null): string {
  if (!p) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(p);
}

function vehicleLabel(v: VehicleInfo | null, fallback: string | null): string {
  if (v) return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
  return fallback ?? "Vehicle not resolved";
}

function tempConfig(temp: string | null) {
  if (temp === "Hot") return { icon: Flame, badge: "text-destructive bg-destructive/10 border-destructive/20", dot: "bg-destructive", label: "Hot" };
  if (temp === "Warm") return { icon: Thermometer, badge: "text-orange-400 bg-orange-500/10 border-orange-500/20", dot: "bg-orange-400", label: "Warm" };
  return { icon: Snowflake, badge: "text-sky-400 bg-sky-500/10 border-sky-500/20", dot: "bg-sky-400", label: "Cold" };
}

function statusInfo(s: string) {
  if (s === "needs_human") return { label: "Needs Human", cls: "text-orange-400", dot: "bg-orange-400" };
  if (s === "closed") return { label: "Closed", cls: "text-muted-foreground", dot: "bg-muted" };
  return { label: "Active", cls: "text-success", dot: "bg-success" };
}

// ── Left panel: conversation row ──────────────────────────────────────────

function ConvRow({ conv, selected, onClick }: {
  conv: ConvListItem;
  selected: boolean;
  onClick: () => void;
}) {
  const lead = conv.lead;
  const displayName = lead?.buyerName ?? conv.buyerName ?? "Unknown Buyer";
  const vLabel = vehicleLabel(conv.vehicle, conv.detectedVehicleTitle);
  const needsReply = conv.lastMessage?.role === "user" && conv.status === "active";
  const { dot: tempDot, icon: TempIcon, badge: tempBadge } = tempConfig(lead?.temperature ?? null);
  const { dot: statusDot } = statusInfo(conv.status);

  return (
    <button
      onClick={onClick}
      className={cn(
        "sales-row-enter w-full text-left px-4 py-4 border-b border-border transition-[background-color,transform] group relative",
        selected
          ? "bg-primary/[0.10] border-l-[3px] border-l-primary"
          : "hover:bg-muted border-l-[3px] border-l-transparent",
      )}
    >
      {needsReply && (
        <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary animate-pulse" />
      )}
      <div className="flex items-start gap-3">
        {/* Temp avatar */}
        <div className={cn(
          "w-9 h-9 rounded-full flex items-center justify-center shrink-0 border text-xs font-semibold",
          tempBadge,
        )}>
          <TempIcon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0 pr-3">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className={cn(
              "text-[13px] font-semibold truncate",
              selected ? "text-primary" : needsReply ? "text-foreground" : "text-foreground",
            )}>
              {displayName}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">{fmtRelative(conv.lastMessageAt)}</span>
          </div>
          <div className="text-[11px] text-muted-foreground truncate mb-1.5 font-medium">{vLabel}</div>
          {conv.lastMessage && (
            <div className={cn(
              "text-[11px] truncate leading-relaxed",
              needsReply ? "text-primary/90 font-medium" : "text-muted-foreground",
            )}>
              {conv.lastMessage.role === "assistant" && <span className="text-primary/50 mr-1 text-xs">AI ↩</span>}
              {conv.lastMessage.content.slice(0, 68)}
            </div>
          )}
          {conv.vehicle?.price && (
            <div className="text-xs text-muted-foreground mt-1">{fmtPrice(conv.vehicle.price)}{conv.vehicle.mileage ? ` · ${conv.vehicle.mileage.toLocaleString()} mi` : ""}</div>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Center: reply box ──────────────────────────────────────────────────────

function ReplyBox({ aiReply, convId }: { aiReply: string | undefined; convId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { mutateAsync: updateStatus } = useUpdateConversationStatus();
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const userEdited = useRef(false);

  // Reset when convId changes
  useEffect(() => {
    setText("");
    userEdited.current = false;
  }, [convId]);

  // Pre-fill with AI reply when it arrives
  useEffect(() => {
    if (!userEdited.current && aiReply) setText(aiReply);
  }, [aiReply]);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Reply copied — paste into Messenger" });
    // Mark conversation as replied
    await updateStatus({ id: convId, data: { status: "active" } });
    void qc.invalidateQueries({ queryKey: ["conversations", DEALER_ID] });
  }

  return (
    <div className="shrink-0 border-t border-border bg-card px-5 py-4 shadow-[0_-8px_22px_rgb(15_23_42/0.035)]">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-5 h-5 rounded bg-primary/20 border border-primary/25 flex items-center justify-center">
          <Zap className="w-3 h-3 text-primary" />
        </div>
        <span className="text-xs font-bold text-primary/70  tracking-wide flex-1">
          AI Suggested Reply
        </span>
        <a
          href={`tel:${STORE_PHONE}`}
          className="flex items-center gap-1.5 text-xs font-bold text-success/70 hover:text-success transition-colors px-2 py-1 rounded border border-success/15 hover:border-success/30"
        >
          <Phone className="w-3 h-3" />
          Call Store
        </a>
      </div>
      <Textarea
        value={text}
        onChange={(e) => { setText(e.target.value); userEdited.current = true; }}
        placeholder="AI reply will appear here…"
        className="min-h-[72px] max-h-[120px] text-[13px] bg-primary/[0.04] border-primary/15 text-foreground placeholder:text-muted-foreground resize-none mb-3 leading-relaxed"
      />
      <div className="flex items-center gap-2">
        <Button
          onClick={() => void handleCopy()}
          disabled={!text}
          className="flex-1 gap-2 h-9 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-[12px] transition-transform hover:-translate-y-px"
        >
          {copied ? <><Check className="w-3.5 h-3.5" />Copied!</> : <><Send className="w-3.5 h-3.5" />Copy &amp; Send</>}
        </Button>
        <Button
          variant="outline"
          onClick={() => void handleCopy()}
          disabled={!text}
          className="gap-2 h-9 px-3 border-border text-muted-foreground hover:text-foreground text-[11px]"
        >
          <Copy className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Center panel: thread ───────────────────────────────────────────────────

function ThreadPanel({ convId }: { convId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["conversation", convId],
    queryFn: () => fetchConversation(convId),
    refetchInterval: SALES_THREAD_REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  const { mutateAsync: updateStatus } = useUpdateConversationStatus();
  const { mutateAsync: updateAutoReply } = useUpdateConversationAutoReply();

  const conv = data?.conversation;
  const messages = data?.messages ?? [];
  const lastReply = messages.filter((m) => m.role === "assistant").slice(-1)[0]?.content;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleAutoReply(enabled: boolean) {
    if (!conv) return;
    await updateAutoReply({ id: conv.id, data: { enabled } });
    toast({ title: enabled ? "Auto-reply on" : "Auto-reply paused" });
    void qc.invalidateQueries({ queryKey: ["conversations", DEALER_ID] });
    void qc.invalidateQueries({ queryKey: ["conversation", convId] });
  }

  async function handleStatus(status: string) {
    if (!conv) return;
    await updateStatus({ id: conv.id, data: { status } });
    toast({ title: status === "closed" ? "Conversation closed" : "Escalated to human" });
    void qc.invalidateQueries({ queryKey: ["conversations", DEALER_ID] });
    void qc.invalidateQueries({ queryKey: ["conversation", convId] });
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary/30" />
      </div>
    );
  }
  if (!conv) return null;

  const displayName = data?.lead?.buyerName ?? conv.buyerName ?? "Unknown Buyer";
  const vLabel = vehicleLabel(data?.vehicle ?? null, conv.detectedVehicleTitle);
  const si = statusInfo(conv.status);

  return (
    <div className="sales-panel-enter flex-1 flex flex-col overflow-hidden">

      {/* Thread header */}
      <div className="shrink-0 border-b border-primary/15 bg-primary/[0.07] px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center">
              <User className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="text-[16px] font-bold text-foreground leading-tight">{displayName}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={cn("text-xs font-bold  tracking-wide", si.cls)}>{si.label}</span>
                <span className="text-muted-foreground text-xs">·</span>
                <span className="text-[11px] text-muted-foreground truncate max-w-[260px]">{vLabel}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-2 mr-1">
              <span className={cn("text-xs font-bold  tracking-wide", conv.autoReplyEnabled ? "text-primary" : "text-muted-foreground")}>
                Auto
              </span>
              <Switch checked={conv.autoReplyEnabled} onCheckedChange={(v) => void handleAutoReply(v)} className="scale-[0.85]" />
            </div>
            {conv.status === "active" && (
              <Button size="sm" variant="outline"
                onClick={() => void handleStatus("needs_human")}
                className="h-7 px-3 text-xs font-bold border-orange-500/20 text-orange-400 hover:bg-orange-500/10  tracking-wide"
              >
                <AlertCircle className="w-3 h-3 mr-1.5" />Escalate
              </Button>
            )}
            {conv.status !== "closed" && (
              <Button size="sm" variant="ghost"
                onClick={() => void handleStatus("closed")}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-muted-foreground"
              >
                Close
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
        {messages.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground mt-16">No messages yet</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn("flex gap-3", m.role === "assistant" ? "flex-row-reverse" : "flex-row")}>
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 border",
                m.role === "assistant"
                  ? "bg-primary/15 border-primary/25"
                  : "bg-muted border-border",
              )}>
                {m.role === "assistant"
                  ? <Bot className="w-4 h-4 text-primary" />
                  : <User className="w-4 h-4 text-muted-foreground" />}
              </div>
              <div className={cn(
                "sales-message-enter max-w-[72%] px-4 py-3.5 rounded-xl text-[13px] leading-relaxed shadow-[0_4px_14px_rgb(15_23_42/0.04)]",
                m.role === "assistant"
                  ? "bg-primary border border-primary text-primary-foreground rounded-tr-sm"
                  : "bg-muted border border-border text-foreground rounded-tl-sm",
              )}>
                {m.role === "assistant" && (
                  <div className="text-[11px] font-semibold text-primary-foreground/70 tracking-wide mb-2">
                    DealerPilot AI
                  </div>
                )}
                {m.content}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply box */}
      <ReplyBox aiReply={lastReply} convId={convId} />
    </div>
  );
}

// ── Right panel: lead + vehicle ────────────────────────────────────────────

function LeadPanel({ convId }: { convId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["conversation", convId],
    queryFn: () => fetchConversation(convId),
  });

  const { mutateAsync: updateLead } = useUpdateLead();

  const lead = data?.lead;
  const vehicle = data?.vehicle;
  const conv = data?.conversation;
  const listingUrl = data?.listingUrl;

  async function handleAction(status: string, label: string) {
    if (!lead) return;
    await updateLead({ id: lead.id, data: { status } });
    toast({ title: label });
    void qc.invalidateQueries({ queryKey: ["conversations", DEALER_ID] });
    void qc.invalidateQueries({ queryKey: ["conversation", convId] });
  }

  const { icon: TempIcon, badge: tempBadge } = tempConfig(lead?.temperature ?? null);

  const qualItems = [
    { label: "Timeline", value: lead?.buyerTimeline ?? null, icon: Clock },
    { label: "Down payment", value: lead?.buyerAvailableDownPayment != null ? fmtPrice(lead.buyerAvailableDownPayment) : null, icon: FileText },
    { label: "Photo ID", value: lead?.hasId != null ? (lead.hasId ? "Confirmed" : "No ID") : null, icon: Shield },
    { label: "Income proof", value: lead?.hasProofOfIncome != null ? (lead.hasProofOfIncome ? "Yes" : "None") : null, icon: FileText },
    { label: "Appointment", value: lead?.appointmentIntent != null ? (lead.appointmentIntent ? "Interested" : "Not ready") : null, icon: Calendar },
  ];
  const completedCount = qualItems.filter((q) => q.value !== null).length;

  return (
    <div className="h-full overflow-y-auto flex flex-col">

      {/* Vehicle card */}
      <div className="px-4 pt-5 pb-4 border-b border-border">
        <div className="text-[11px] font-bold text-muted-foreground  tracking-wide mb-3">Vehicle</div>
        <div className="rounded-xl bg-muted border border-border overflow-hidden">
          <div className="flex h-24 items-center justify-center border-b border-border bg-muted/60">
            {vehicle ? (
              <div className="text-center">
                <Car className="w-8 h-8 text-primary/30 mx-auto mb-1" />
                <div className="text-xs text-muted-foreground">{vehicle.year} {vehicle.make}</div>
              </div>
            ) : (
              <Car className="w-10 h-10 text-muted-foreground" />
            )}
          </div>
          <div className="p-3">
            {vehicle ? (
              <>
                <div className="text-[13px] font-bold text-foreground leading-tight mb-1">
                  {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")}
                  {vehicle.trim && <span className="text-muted-foreground font-normal"> {vehicle.trim}</span>}
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-success font-bold">{fmtPrice(vehicle.price)}</span>
                  <span className="text-muted-foreground">{vehicle.mileage?.toLocaleString()} mi</span>
                </div>
                {vehicle.stockNumber && (
                  <div className="text-xs text-muted-foreground mt-1">Stock #{vehicle.stockNumber}</div>
                )}
                {conv?.marketplaceDownPayment && (
                  <div className="mt-2 px-2 py-1.5 rounded-lg bg-primary/[0.08] border border-primary/10 text-[11px] text-primary/70">
                    Down: <span className="font-bold text-primary">{fmtPrice(conv.marketplaceDownPayment)}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-[12px] text-muted-foreground">
                {conv?.detectedVehicleTitle ?? "Vehicle not resolved"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lead identity */}
      <div className="px-4 py-4 border-b border-border space-y-3">
        <div className="text-[11px] font-bold text-muted-foreground  tracking-wide">Buyer</div>
        <div className="flex items-center justify-between">
          <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-bold", tempBadge)}>
            <TempIcon className="w-3 h-3" />
            {lead?.temperature ?? "Unknown"}
          </div>
          {lead?.leadScore != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground  tracking-wide">Score</span>
              <span className="text-lg font-semibold text-foreground">{lead.leadScore}</span>
            </div>
          )}
        </div>
        <div>
          <div className="text-[15px] font-bold text-foreground">{lead?.buyerName ?? "Unknown Buyer"}</div>
          {lead?.phone ? (
            <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-[12px] text-success/80 hover:text-success mt-1 transition-colors">
              <Phone className="w-3 h-3" />
              {lead.phone}
            </a>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
              <Phone className="w-3 h-3" />
              Phone not captured
            </div>
          )}
        </div>
        {lead?.status && (
          <div className="text-xs font-bold px-2 py-1 rounded bg-muted text-muted-foreground inline-block">
            {lead.status}
          </div>
        )}
      </div>

      {/* Qualification checklist */}
      <div className="px-4 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-bold text-muted-foreground  tracking-wide">Qualification</div>
          <div className={cn("text-xs font-bold", completedCount === qualItems.length ? "text-success" : "text-warning/60")}>
            {completedCount}/{qualItems.length}
          </div>
        </div>
        <div className="space-y-1">
          {qualItems.map((item) => {
            const Icon = item.icon;
            const done = item.value !== null;
            return (
              <div key={item.label} className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] border",
                done ? "bg-success/[0.05] border-success/10 text-success/75"
                  : "bg-muted border-border text-muted-foreground",
              )}>
                <Icon className="w-3 h-3 shrink-0" />
                <span className="flex-1 font-medium">{item.label}</span>
                <span className={cn("text-xs truncate max-w-[65px]", done ? "text-muted-foreground" : "text-muted-foreground")}>
                  {done ? item.value : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-4 space-y-2">
        <div className="text-[11px] font-bold text-muted-foreground  tracking-wide mb-3">Actions</div>

        <Button
          className="w-full gap-2 h-9 bg-warning/10 hover:bg-warning/20 text-warning border border-warning/20 font-semibold text-[12px] justify-start"
          onClick={() => void handleAction("Appointment", "Appointment set")}
          disabled={!lead}
        >
          <Calendar className="w-4 h-4" />
          Set Appointment
        </Button>

        <Button
          className="w-full gap-2 h-9 bg-success/10 hover:bg-success/20 text-success border border-success/20 font-semibold text-[12px] justify-start"
          onClick={() => void handleAction("Sold", "Marked as Sold")}
          disabled={!lead}
        >
          <CheckCircle2 className="w-4 h-4" />
          Mark Sold
        </Button>

        {listingUrl ? (
          <a href={listingUrl} target="_blank" rel="noopener noreferrer" className="block">
            <Button
              className="w-full gap-2 h-9 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 font-semibold text-[12px] justify-start"
            >
              <ExternalLink className="w-4 h-4" />
              Send Listing
            </Button>
          </a>
        ) : (
          <Button
            className="w-full gap-2 h-9 bg-primary/10 text-primary/40 border border-primary/10 font-semibold text-[12px] justify-start cursor-not-allowed"
            disabled
          >
            <ExternalLink className="w-4 h-4" />
            Send Listing
          </Button>
        )}

        <Button
          className="w-full gap-2 h-9 bg-muted hover:bg-muted text-muted-foreground border border-border hover:text-foreground font-semibold text-[12px] justify-start"
          onClick={() => void handleAction("Contacted", "Marked as contacted")}
          disabled={!lead}
        >
          <UserCheck className="w-4 h-4" />
          Mark Contacted
        </Button>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyPane() {
  const [, navigate] = useLocation();
  const { data: connectionStatus } = useGetConnectionStatus({
    query: {
      queryKey: getGetConnectionStatusQueryKey(),
      refetchInterval: 8000,
      refetchOnWindowFocus: "always",
    },
  });
  const extStatus = (connectionStatus?.chromeExtension as { status?: string } | null | undefined)?.status?.toLowerCase() ?? "";
  const extOnline = extStatus === "connected" || extStatus === "online";
  const fbLoggedIn = (connectionStatus?.facebookSession as { fbLoggedIn?: boolean | null } | undefined)?.fbLoggedIn === true;
  const mktConnected = (connectionStatus?.marketplace as { marketplaceConnected?: boolean | null } | undefined)?.marketplaceConnected === true;
  const facebookReady = extOnline && fbLoggedIn && mktConnected;

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
      {/* Icon */}
      <div className={cn(
        "w-20 h-20 rounded-xl border flex items-center justify-center mb-6",
        facebookReady
          ? "bg-success/[0.06] border-success/15"
          : "bg-primary/[0.06] border-primary/10",
      )}>
        {facebookReady
          ? <CheckCircle2 className="w-10 h-10 text-success/35" />
          : <MessageSquare className="w-10 h-10 text-primary/25" />}
      </div>

      {/* Headline */}
      <p className={cn(
        "text-[11px] font-semibold  tracking-wide mb-3",
        facebookReady ? "text-success/50" : "text-primary/40",
      )}>
        {facebookReady ? "Facebook Connected" : "Sales AI · Inbox"}
      </p>
      <div className="text-[17px] font-semibold text-muted-foreground mb-3">
        {facebookReady ? "Waiting for the first buyer message" : "No buyer conversations yet"}
      </div>
      <div className="text-[13px] text-muted-foreground max-w-[320px] leading-relaxed mb-8">
        {facebookReady
          ? "Your Chrome extension, Facebook session, and Marketplace access are ready. DealerPilot will display buyers here as soon as a real Marketplace message is received."
          : "DealerPilot will automatically display Marketplace buyers once your Facebook account is connected and your first message is received."}
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        {facebookReady ? (
          <a href="https://www.facebook.com/marketplace/you/selling" target="_blank" rel="noopener noreferrer">
            <Button
              className="gap-2 bg-success hover:bg-success text-foreground text-sm h-9 px-4"
            >
              <ExternalLink className="w-4 h-4" />
              Open Marketplace
            </Button>
          </a>
        ) : (
          <Button
            className="gap-2 bg-primary hover:bg-primary text-foreground text-sm h-9 px-4"
            onClick={() => navigate("/connection-center")}
          >
            <ExternalLink className="w-4 h-4" />
            Connect Facebook
          </Button>
        )}
        <Button
          variant="outline"
          className="gap-2 border-border text-muted-foreground hover:bg-muted hover:text-muted-foreground text-sm h-9 px-4"
          onClick={() => navigate("/connection-center")}
        >
          <FileText className="w-4 h-4" />
          View setup guide
        </Button>
      </div>

      {/* Separator */}
      <div className="mt-10 pt-8 border-t border-border w-full max-w-xs">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Conversations are sourced exclusively from real Facebook Marketplace
          messages. No data is fabricated.
        </p>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export function SalesAIWorkspace() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "needs_human" | "closed">("all");
  const hasAutoOpened = useRef(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["conversations", DEALER_ID],
    queryFn: fetchConversations,
    refetchInterval: SALES_LIST_REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  const conversations = data?.conversations ?? [];

  // Sort: most recently active first, oldest at the bottom
  const filtered = conversations
    .filter((c) => {
      const matchStatus = statusFilter === "all" || c.status === statusFilter;
      const q = search.toLowerCase();
      const matchSearch = !q
        || (c.lead?.buyerName ?? c.buyerName ?? "").toLowerCase().includes(q)
        || (c.detectedVehicleTitle ?? "").toLowerCase().includes(q)
        || (c.vehicle ? [c.vehicle.make, c.vehicle.model].join(" ").toLowerCase().includes(q) : false);
      return matchStatus && matchSearch;
    })
    .sort((a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime());

  // Auto-open most recent conversation
  useEffect(() => {
    if (!hasAutoOpened.current && conversations.length > 0) {
      hasAutoOpened.current = true;
      const sorted = [...conversations].sort(
        (a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime(),
      );
      setSelectedId(sorted[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length]);

  const needsReplyCount = conversations.filter((c) => c.lastMessage?.role === "user" && c.status === "active").length;
  const needsHumanCount = conversations.filter((c) => c.status === "needs_human").length;
  const activeCount = conversations.filter((c) => c.status === "active").length;

  return (
    <AppLayout>
      <div className="flex h-full overflow-hidden">

        {/* ── LEFT: Conversation list ──────────────────────────────────── */}
        <div className="w-[280px] flex flex-col border-r border-border overflow-hidden shrink-0 bg-card">

          {/* Panel header */}
          <div className="border-b border-primary/15 bg-primary/[0.05] px-4 pb-4 pt-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-primary" />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-primary/50  tracking-wide">Sales AI</div>
                <div className="text-[15px] font-bold text-foreground leading-none">Command Inbox</div>
              </div>
            </div>

            {/* Live stats strip */}
            <div className="flex items-center gap-3 mb-4">
              {[
                { label: "Active", value: activeCount, cls: "text-success" },
                { label: "Need Reply", value: needsReplyCount, cls: "text-primary" },
                { label: "Human", value: needsHumanCount, cls: "text-orange-400" },
              ].map((s) => (
                <div key={s.label} className={cn("flex items-center gap-1 text-xs font-bold transition-opacity", s.value > 0 ? s.cls : "text-muted-foreground opacity-40")}>
                  {s.value > 0 && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                  <span className="font-semibold text-[12px]">{s.value}</span>
                  <span className="font-medium text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search buyers, vehicles…"
                className="h-8 pl-7 pr-3 text-xs bg-muted border-border text-foreground placeholder:text-muted-foreground rounded-lg"
              />
            </div>
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
            {(["all", "active", "needs_human", "closed"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "text-[11px] font-bold  tracking-wide px-2.5 py-1 rounded-md whitespace-nowrap transition-colors",
                  statusFilter === s ? "bg-primary/15 text-primary border border-primary/20" : "text-muted-foreground hover:text-muted-foreground",
                )}
              >
                {s === "needs_human" ? "Human" : s}
              </button>
            ))}
          </div>

          {/* Conversation rows */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-4 h-4 animate-spin text-primary/30" />
              </div>
            ) : isError ? (
              <div className="flex items-center justify-center py-16 gap-2 text-xs text-destructive/50">
                <XCircle className="w-3.5 h-3.5" /> Failed to load
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-16 px-4">
                {conversations.length === 0 ? "No conversations yet" : "No matches"}
              </div>
            ) : (
              filtered.map((c) => (
                <ConvRow
                  key={c.id}
                  conv={c}
                  selected={selectedId === c.id}
                  onClick={() => setSelectedId(c.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── CENTER: Thread ───────────────────────────────────────────── */}
        <div className="flex-1 flex overflow-hidden bg-card">
          {selectedId
            ? <ThreadPanel convId={selectedId} />
            : conversations.length === 0 && !isLoading
              ? <EmptyPane />
              : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <MessageSquare className="w-8 h-8 text-primary/20 mx-auto mb-3" />
                    <div className="text-sm text-muted-foreground">Select a conversation</div>
                  </div>
                </div>
              )
          }
        </div>

        {/* ── RIGHT: Lead + vehicle panel ──────────────────────────────── */}
        {selectedId && (
          <div className="w-[256px] border-l border-border overflow-hidden shrink-0 bg-card">
            <LeadPanel convId={selectedId} />
          </div>
        )}

      </div>
    </AppLayout>
  );
}
