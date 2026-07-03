import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useUpdateConversationStatus,
  useUpdateConversationAutoReply,
  useUpdateLead,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
const STORE_PHONE = "703-763-4675";

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
  return fallback ?? "Vehicle inquiry";
}

function tempConfig(temp: string | null) {
  if (temp === "Hot") return { icon: Flame, badge: "text-red-400 bg-red-500/10 border-red-500/20", dot: "bg-red-400", label: "Hot" };
  if (temp === "Warm") return { icon: Thermometer, badge: "text-orange-400 bg-orange-500/10 border-orange-500/20", dot: "bg-orange-400", label: "Warm" };
  return { icon: Snowflake, badge: "text-sky-400 bg-sky-500/10 border-sky-500/20", dot: "bg-sky-400", label: "Cold" };
}

function statusInfo(s: string) {
  if (s === "needs_human") return { label: "Needs Human", cls: "text-orange-400", dot: "bg-orange-400" };
  if (s === "closed") return { label: "Closed", cls: "text-white/25", dot: "bg-white/20" };
  return { label: "Active", cls: "text-emerald-400", dot: "bg-emerald-400" };
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
        "w-full text-left px-4 py-4 border-b border-white/[0.04] transition-all group relative",
        selected
          ? "bg-violet-500/[0.10] border-l-[3px] border-l-violet-500"
          : "hover:bg-white/[0.025] border-l-[3px] border-l-transparent",
      )}
    >
      {needsReply && (
        <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
      )}
      <div className="flex items-start gap-3">
        {/* Temp avatar */}
        <div className={cn(
          "w-9 h-9 rounded-full flex items-center justify-center shrink-0 border text-[10px] font-black",
          tempBadge,
        )}>
          <TempIcon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0 pr-3">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className={cn(
              "text-[13px] font-semibold truncate",
              selected ? "text-violet-200" : needsReply ? "text-white" : "text-white/75",
            )}>
              {displayName}
            </span>
            <span className="text-[10px] text-white/25 shrink-0">{fmtRelative(conv.lastMessageAt)}</span>
          </div>
          <div className="text-[11px] text-white/35 truncate mb-1.5 font-medium">{vLabel}</div>
          {conv.lastMessage && (
            <div className={cn(
              "text-[11px] truncate leading-relaxed",
              needsReply ? "text-violet-300/90 font-medium" : "text-white/25",
            )}>
              {conv.lastMessage.role === "assistant" && <span className="text-violet-400/50 mr-1 text-[10px]">AI ↩</span>}
              {conv.lastMessage.content.slice(0, 68)}
            </div>
          )}
          {conv.vehicle?.price && (
            <div className="text-[10px] text-white/20 mt-1">{fmtPrice(conv.vehicle.price)}{conv.vehicle.mileage ? ` · ${conv.vehicle.mileage.toLocaleString()} mi` : ""}</div>
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
    <div className="shrink-0 border-t border-white/[0.06] bg-[#0e0b1a] px-5 py-4">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-5 h-5 rounded bg-violet-500/20 border border-violet-500/25 flex items-center justify-center">
          <Zap className="w-3 h-3 text-violet-400" />
        </div>
        <span className="text-[10px] font-bold text-violet-400/70 uppercase tracking-widest flex-1">
          AI Suggested Reply
        </span>
        <a
          href={`tel:${STORE_PHONE}`}
          className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400/70 hover:text-emerald-300 transition-colors px-2 py-1 rounded border border-emerald-500/15 hover:border-emerald-500/30"
        >
          <Phone className="w-3 h-3" />
          Call Store
        </a>
      </div>
      <Textarea
        value={text}
        onChange={(e) => { setText(e.target.value); userEdited.current = true; }}
        placeholder="AI reply will appear here…"
        className="min-h-[72px] max-h-[120px] text-[13px] bg-violet-500/[0.04] border-violet-500/15 text-white/80 placeholder:text-white/20 resize-none mb-3 leading-relaxed"
      />
      <div className="flex items-center gap-2">
        <Button
          onClick={() => void handleCopy()}
          disabled={!text}
          className="flex-1 gap-2 h-9 bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[12px]"
        >
          {copied ? <><Check className="w-3.5 h-3.5" />Copied!</> : <><Send className="w-3.5 h-3.5" />Copy &amp; Send</>}
        </Button>
        <Button
          variant="outline"
          onClick={() => void handleCopy()}
          disabled={!text}
          className="gap-2 h-9 px-3 border-white/10 text-white/40 hover:text-white/70 text-[11px]"
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
    refetchInterval: 10_000,
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
        <Loader2 className="w-6 h-6 animate-spin text-violet-400/30" />
      </div>
    );
  }
  if (!conv) return null;

  const displayName = data?.lead?.buyerName ?? conv.buyerName ?? "Unknown Buyer";
  const vLabel = vehicleLabel(data?.vehicle ?? null, conv.detectedVehicleTitle);
  const si = statusInfo(conv.status);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Thread header */}
      <div className="shrink-0 px-6 py-4 border-b border-white/[0.06] bg-gradient-to-r from-violet-950/40 to-transparent">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-violet-500/15 border border-violet-500/20 flex items-center justify-center">
              <User className="w-5 h-5 text-violet-300" />
            </div>
            <div>
              <div className="text-[16px] font-bold text-white leading-tight">{displayName}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={cn("text-[10px] font-bold uppercase tracking-widest", si.cls)}>{si.label}</span>
                <span className="text-white/15 text-[10px]">·</span>
                <span className="text-[11px] text-white/35 truncate max-w-[260px]">{vLabel}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-2 mr-1">
              <span className={cn("text-[10px] font-bold uppercase tracking-widest", conv.autoReplyEnabled ? "text-violet-400" : "text-white/20")}>
                Auto
              </span>
              <Switch checked={conv.autoReplyEnabled} onCheckedChange={(v) => void handleAutoReply(v)} className="scale-[0.85]" />
            </div>
            {conv.status === "active" && (
              <Button size="sm" variant="outline"
                onClick={() => void handleStatus("needs_human")}
                className="h-7 px-3 text-[10px] font-bold border-orange-500/20 text-orange-400 hover:bg-orange-500/10 uppercase tracking-wide"
              >
                <AlertCircle className="w-3 h-3 mr-1.5" />Escalate
              </Button>
            )}
            {conv.status !== "closed" && (
              <Button size="sm" variant="ghost"
                onClick={() => void handleStatus("closed")}
                className="h-7 px-2 text-[10px] text-white/25 hover:text-white/60"
              >
                Close
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {messages.length === 0 ? (
          <div className="text-center text-sm text-white/20 mt-16">No messages yet</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn("flex gap-3", m.role === "assistant" ? "flex-row-reverse" : "flex-row")}>
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 border",
                m.role === "assistant"
                  ? "bg-violet-500/20 border-violet-500/25"
                  : "bg-white/[0.05] border-white/[0.08]",
              )}>
                {m.role === "assistant"
                  ? <Bot className="w-4 h-4 text-violet-400" />
                  : <User className="w-4 h-4 text-white/40" />}
              </div>
              <div className={cn(
                "max-w-[72%] px-4 py-3.5 rounded-2xl text-[13px] leading-relaxed",
                m.role === "assistant"
                  ? "bg-violet-500/[0.10] border border-violet-500/15 text-white/85 rounded-tr-sm"
                  : "bg-white/[0.05] border border-white/[0.06] text-white/75 rounded-tl-sm",
              )}>
                {m.role === "assistant" && (
                  <div className="text-[9px] font-black text-violet-400/50 uppercase tracking-widest mb-2">
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
      <div className="px-4 pt-5 pb-4 border-b border-white/[0.05]">
        <div className="text-[9px] font-bold text-white/20 uppercase tracking-widest mb-3">Vehicle</div>
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
          <div className="h-24 bg-gradient-to-br from-violet-950/50 to-slate-900/70 flex items-center justify-center border-b border-white/[0.04]">
            {vehicle ? (
              <div className="text-center">
                <Car className="w-8 h-8 text-violet-400/30 mx-auto mb-1" />
                <div className="text-[10px] text-white/20">{vehicle.year} {vehicle.make}</div>
              </div>
            ) : (
              <Car className="w-10 h-10 text-white/10" />
            )}
          </div>
          <div className="p-3">
            {vehicle ? (
              <>
                <div className="text-[13px] font-bold text-white leading-tight mb-1">
                  {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")}
                  {vehicle.trim && <span className="text-white/40 font-normal"> {vehicle.trim}</span>}
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-emerald-400 font-bold">{fmtPrice(vehicle.price)}</span>
                  <span className="text-white/35">{vehicle.mileage?.toLocaleString()} mi</span>
                </div>
                {vehicle.stockNumber && (
                  <div className="text-[10px] text-white/20 mt-1">Stock #{vehicle.stockNumber}</div>
                )}
                {conv?.marketplaceDownPayment && (
                  <div className="mt-2 px-2 py-1.5 rounded-lg bg-violet-500/[0.08] border border-violet-500/10 text-[11px] text-violet-300/70">
                    Down: <span className="font-bold text-violet-300">{fmtPrice(conv.marketplaceDownPayment)}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-[12px] text-white/40">
                {conv?.detectedVehicleTitle ?? "Vehicle inquiry"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lead identity */}
      <div className="px-4 py-4 border-b border-white/[0.05] space-y-3">
        <div className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Buyer</div>
        <div className="flex items-center justify-between">
          <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-bold", tempBadge)}>
            <TempIcon className="w-3 h-3" />
            {lead?.temperature ?? "Unknown"}
          </div>
          {lead?.leadScore != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-white/20 uppercase tracking-widest">Score</span>
              <span className="text-lg font-black text-white">{lead.leadScore}</span>
            </div>
          )}
        </div>
        <div>
          <div className="text-[15px] font-bold text-white">{lead?.buyerName ?? "Unknown Buyer"}</div>
          {lead?.phone ? (
            <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-[12px] text-emerald-400/80 hover:text-emerald-300 mt-1 transition-colors">
              <Phone className="w-3 h-3" />
              {lead.phone}
            </a>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-white/20 mt-1">
              <Phone className="w-3 h-3" />
              Phone not captured
            </div>
          )}
        </div>
        {lead?.status && (
          <div className="text-[10px] font-bold px-2 py-1 rounded bg-white/[0.04] text-white/40 inline-block">
            {lead.status}
          </div>
        )}
      </div>

      {/* Qualification checklist */}
      <div className="px-4 py-4 border-b border-white/[0.05]">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Qualification</div>
          <div className={cn("text-[10px] font-bold", completedCount === qualItems.length ? "text-emerald-400" : "text-amber-400/60")}>
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
                done ? "bg-emerald-500/[0.05] border-emerald-500/10 text-emerald-400/75"
                  : "bg-white/[0.01] border-white/[0.03] text-white/20",
              )}>
                <Icon className="w-3 h-3 shrink-0" />
                <span className="flex-1 font-medium">{item.label}</span>
                <span className={cn("text-[10px] truncate max-w-[65px]", done ? "text-white/50" : "text-white/15")}>
                  {done ? item.value : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-4 space-y-2">
        <div className="text-[9px] font-bold text-white/20 uppercase tracking-widest mb-3">Actions</div>

        <Button
          className="w-full gap-2 h-9 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 font-semibold text-[12px] justify-start"
          onClick={() => void handleAction("Appointment", "Appointment set")}
          disabled={!lead}
        >
          <Calendar className="w-4 h-4" />
          Set Appointment
        </Button>

        <Button
          className="w-full gap-2 h-9 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 font-semibold text-[12px] justify-start"
          onClick={() => void handleAction("Sold", "Marked as Sold")}
          disabled={!lead}
        >
          <CheckCircle2 className="w-4 h-4" />
          Mark Sold
        </Button>

        {listingUrl ? (
          <a href={listingUrl} target="_blank" rel="noopener noreferrer" className="block">
            <Button
              className="w-full gap-2 h-9 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 font-semibold text-[12px] justify-start"
            >
              <ExternalLink className="w-4 h-4" />
              Send Listing
            </Button>
          </a>
        ) : (
          <Button
            className="w-full gap-2 h-9 bg-blue-500/10 text-blue-400/40 border border-blue-500/10 font-semibold text-[12px] justify-start cursor-not-allowed"
            disabled
          >
            <ExternalLink className="w-4 h-4" />
            Send Listing
          </Button>
        )}

        <Button
          className="w-full gap-2 h-9 bg-white/[0.04] hover:bg-white/[0.07] text-white/50 border border-white/[0.06] hover:text-white/70 font-semibold text-[12px] justify-start"
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
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
      {/* Icon */}
      <div className="w-20 h-20 rounded-3xl bg-violet-500/[0.06] border border-violet-500/10 flex items-center justify-center mb-6">
        <MessageSquare className="w-10 h-10 text-violet-400/25" />
      </div>

      {/* Headline */}
      <p className="text-[9px] font-black uppercase tracking-[0.22em] text-violet-400/40 mb-3">
        Sales AI · Inbox
      </p>
      <div className="text-[17px] font-semibold text-white/50 mb-3">
        No buyer conversations yet
      </div>
      <div className="text-[13px] text-white/25 max-w-[320px] leading-relaxed mb-8">
        DealerPilot will automatically display Marketplace buyers once your
        Facebook account is connected and your first message is received.
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Button
          className="gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm h-9 px-4"
          onClick={() => navigate("/connection-center")}
        >
          <ExternalLink className="w-4 h-4" />
          Connect Facebook
        </Button>
        <Button
          variant="outline"
          className="gap-2 border-white/[0.08] text-white/35 hover:bg-white/[0.04] hover:text-white/60 text-sm h-9 px-4"
          onClick={() => navigate("/connection-center")}
        >
          <FileText className="w-4 h-4" />
          View setup guide
        </Button>
      </div>

      {/* Separator */}
      <div className="mt-10 pt-8 border-t border-white/[0.04] w-full max-w-xs">
        <p className="text-[11px] text-white/15 leading-relaxed">
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
    refetchInterval: 20_000,
  });

  const conversations = data?.conversations ?? [];

  // Sort: needs_human → needs reply → active → closed, then by time
  const urgencyScore = (c: ConvListItem) =>
    c.status === "needs_human" ? 4 : c.lastMessage?.role === "user" && c.status === "active" ? 3 : c.status === "active" ? 2 : 1;

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
    .sort((a, b) => {
      const diff = urgencyScore(b) - urgencyScore(a);
      if (diff !== 0) return diff;
      return new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime();
    });

  // Auto-open first conversation
  useEffect(() => {
    if (!hasAutoOpened.current && conversations.length > 0) {
      hasAutoOpened.current = true;
      const sorted = [...conversations].sort((a, b) => urgencyScore(b) - urgencyScore(a));
      setSelectedId(sorted[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length]);

  const needsReplyCount = conversations.filter((c) => c.lastMessage?.role === "user" && c.status === "active").length;
  const needsHumanCount = conversations.filter((c) => c.status === "needs_human").length;
  const activeCount = conversations.filter((c) => c.status === "active").length;

  return (
    <AppLayout>
      <div className="flex-1 flex overflow-hidden">

        {/* ── LEFT: Conversation list ──────────────────────────────────── */}
        <div className="w-[280px] flex flex-col border-r border-white/[0.06] overflow-hidden shrink-0 bg-[#0a0812]">

          {/* Panel header */}
          <div className="px-4 pt-5 pb-4 border-b border-white/[0.05] bg-gradient-to-b from-violet-950/30 to-transparent">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <div className="text-[9px] font-black text-violet-400/50 uppercase tracking-[0.18em]">Sales AI</div>
                <div className="text-[15px] font-bold text-white leading-none">Command Inbox</div>
              </div>
            </div>

            {/* Live stats strip */}
            <div className="flex items-center gap-3 mb-4">
              {[
                { label: "Active", value: activeCount, cls: "text-emerald-400" },
                { label: "Need Reply", value: needsReplyCount, cls: "text-violet-400" },
                { label: "Human", value: needsHumanCount, cls: "text-orange-400" },
              ].map((s) => (
                <div key={s.label} className={cn("flex items-center gap-1 text-[10px] font-bold transition-opacity", s.value > 0 ? s.cls : "text-white/15 opacity-40")}>
                  {s.value > 0 && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                  <span className="font-black text-[12px]">{s.value}</span>
                  <span className="font-medium text-white/35">{s.label}</span>
                </div>
              ))}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search buyers, vehicles…"
                className="h-8 pl-7 pr-3 text-xs bg-white/[0.03] border-white/[0.06] text-white/80 placeholder:text-white/20 rounded-lg"
              />
            </div>
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-white/[0.04]">
            {(["all", "active", "needs_human", "closed"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md whitespace-nowrap transition-colors",
                  statusFilter === s ? "bg-violet-500/15 text-violet-400 border border-violet-500/20" : "text-white/20 hover:text-white/40",
                )}
              >
                {s === "needs_human" ? "Human" : s}
              </button>
            ))}
          </div>

          {/* Conversation rows */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-4 h-4 animate-spin text-violet-400/30" />
              </div>
            ) : isError ? (
              <div className="flex items-center justify-center py-16 gap-2 text-xs text-red-400/50">
                <XCircle className="w-3.5 h-3.5" /> Failed to load
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-xs text-white/15 py-16 px-4">
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
        <div className="flex-1 flex overflow-hidden bg-[#0c0a18]">
          {selectedId
            ? <ThreadPanel convId={selectedId} />
            : conversations.length === 0 && !isLoading
              ? <EmptyPane />
              : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <MessageSquare className="w-8 h-8 text-violet-400/20 mx-auto mb-3" />
                    <div className="text-sm text-white/25">Select a conversation</div>
                  </div>
                </div>
              )
          }
        </div>

        {/* ── RIGHT: Lead + vehicle panel ──────────────────────────────── */}
        {selectedId && (
          <div className="w-[256px] border-l border-white/[0.06] overflow-hidden shrink-0 bg-[#0a0812]">
            <LeadPanel convId={selectedId} />
          </div>
        )}

      </div>
    </AppLayout>
  );
}
