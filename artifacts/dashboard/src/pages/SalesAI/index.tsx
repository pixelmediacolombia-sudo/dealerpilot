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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  MessageSquare, Calendar, CheckCircle2, Radio, Loader2,
  Bot, User, Flame, Thermometer, Snowflake, AlertCircle,
  Search, ChevronRight, Phone, FileText, Shield,
  Copy, Check, Zap, XCircle, Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = "/api";
const DEALER_ID = 1;

// ── Types ──────────────────────────────────────────────────────────────────

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

function tempConfig(temp: string | null) {
  if (temp === "Hot") return { icon: Flame, badge: "text-red-400 bg-red-500/10 border-red-500/20", dot: "bg-red-400" };
  if (temp === "Warm") return { icon: Thermometer, badge: "text-orange-400 bg-orange-500/10 border-orange-500/20", dot: "bg-orange-400" };
  return { icon: Snowflake, badge: "text-blue-400 bg-blue-500/10 border-blue-500/20", dot: "bg-blue-400" };
}

function statusInfo(s: string) {
  if (s === "needs_human") return { label: "Needs Human", cls: "text-orange-400", dot: "bg-orange-400" };
  if (s === "closed") return { label: "Closed", cls: "text-white/25", dot: "bg-white/20" };
  return { label: "Active", cls: "text-emerald-400", dot: "bg-emerald-400" };
}

// ── Left panel: single conversation row ─────────────────────────────────

function ConvRow({
  conv,
  selected,
  onClick,
}: {
  conv: ConvListItem;
  selected: boolean;
  onClick: () => void;
}) {
  const lead = conv.lead;
  const displayName = lead?.buyerName ?? conv.buyerName ?? "Unknown Buyer";
  const vehicleTitle = conv.detectedVehicleTitle ?? conv.vehicleType ?? "Vehicle inquiry";
  const needsReply = conv.lastMessage?.role === "user" && conv.status === "active";
  const { dot: tempDot } = tempConfig(lead?.temperature ?? null);
  const { dot: statusDot } = statusInfo(conv.status);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3.5 border-b border-white/[0.04] transition-all group",
        selected
          ? "bg-violet-500/[0.10] border-l-2 border-l-violet-500/50"
          : "hover:bg-white/[0.025] border-l-2 border-l-transparent",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Status dot */}
        <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
          <span className={cn("w-2 h-2 rounded-full", needsReply ? "bg-violet-400 animate-pulse" : statusDot)} />
          {needsReply && <span className={cn("w-1.5 h-1.5 rounded-full", tempDot)} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className={cn(
              "text-[13px] font-semibold truncate",
              selected ? "text-violet-200" : needsReply ? "text-white" : "text-white/70",
            )}>
              {displayName}
            </span>
            <span className="text-[10px] text-white/25 shrink-0">{fmtRelative(conv.lastMessageAt)}</span>
          </div>

          <div className="text-[11px] text-white/35 truncate mb-1">{vehicleTitle}</div>

          {conv.lastMessage && (
            <div className={cn(
              "text-[11px] truncate leading-relaxed",
              needsReply ? "text-violet-300/80 font-medium" : "text-white/25",
            )}>
              {conv.lastMessage.role === "assistant" && (
                <span className="text-violet-400/40 mr-1">↩</span>
              )}
              {conv.lastMessage.content.slice(0, 65)}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Center panel: thread view ──────────────────────────────────────────────

function ThreadPanel({ convId }: { convId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

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

  async function handleCopy() {
    if (!lastReply) return;
    await navigator.clipboard.writeText(lastReply);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Reply copied" });
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-violet-400/40" />
      </div>
    );
  }

  if (!conv) return null;

  const displayName = data?.lead?.buyerName ?? conv.buyerName ?? "Unknown Buyer";
  const vehicleTitle = conv.detectedVehicleTitle ?? conv.vehicleType ?? "Vehicle inquiry";
  const si = statusInfo(conv.status);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Thread header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.05] shrink-0 bg-white/[0.01]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <User className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <div className="text-[15px] font-semibold text-white">{displayName}</div>
            <div className="flex items-center gap-2">
              <span className={cn("text-[10px] font-bold uppercase tracking-widest", si.cls)}>{si.label}</span>
              <span className="text-white/20 text-[10px]">·</span>
              <span className="text-[11px] text-white/30">{vehicleTitle}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className={cn("text-[10px] font-bold uppercase tracking-widest", conv.autoReplyEnabled ? "text-violet-400" : "text-white/20")}>
              Auto-Reply
            </span>
            <Switch checked={conv.autoReplyEnabled} onCheckedChange={(v) => void handleAutoReply(v)} className="scale-90" />
          </div>
          <div className="h-4 w-px bg-white/[0.08]" />
          {conv.status === "active" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleStatus("needs_human")}
              className="h-7 px-3 text-[10px] font-bold border-orange-500/20 text-orange-400 hover:bg-orange-500/10 uppercase tracking-wide"
            >
              <AlertCircle className="w-3 h-3 mr-1.5" />
              Escalate
            </Button>
          )}
          {conv.status !== "closed" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void handleStatus("closed")}
              className="h-7 px-3 text-[10px] text-white/30 hover:text-white/60 uppercase tracking-wide"
            >
              Close
            </Button>
          )}
        </div>
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {messages.length === 0 ? (
          <div className="text-center text-sm text-white/20 mt-16">No messages yet</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn("flex gap-3", m.role === "assistant" ? "flex-row-reverse" : "flex-row")}>
              <div className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 border",
                m.role === "assistant"
                  ? "bg-violet-500/20 border-violet-500/25"
                  : "bg-white/[0.04] border-white/[0.08]",
              )}>
                {m.role === "assistant"
                  ? <Bot className="w-3.5 h-3.5 text-violet-400" />
                  : <User className="w-3.5 h-3.5 text-white/40" />}
              </div>
              <div className={cn(
                "max-w-[72%] px-4 py-3 rounded-2xl text-[13px] leading-relaxed",
                m.role === "assistant"
                  ? "bg-violet-500/[0.08] border border-violet-500/15 text-white/85 rounded-tr-sm"
                  : "bg-white/[0.04] border border-white/[0.05] text-white/75 rounded-tl-sm",
              )}>
                {m.role === "assistant" && (
                  <div className="text-[9px] font-bold text-violet-400/50 uppercase tracking-widest mb-1.5">
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

      {/* AI reply suggestion */}
      {lastReply && (
        <div className="shrink-0 border-t border-white/[0.05] bg-violet-500/[0.025] px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-violet-500/20 border border-violet-500/25 flex items-center justify-center">
                <Zap className="w-3 h-3 text-violet-400" />
              </div>
              <span className="text-[10px] font-bold text-violet-400/70 uppercase tracking-widest">AI Suggested Reply</span>
            </div>
            <Button
              size="sm"
              onClick={() => void handleCopy()}
              className="h-6 px-3 text-[10px] bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 border border-violet-500/25 font-semibold"
            >
              {copied ? <><Check className="w-2.5 h-2.5 mr-1" />Copied</> : <><Copy className="w-2.5 h-2.5 mr-1" />Copy Reply</>}
            </Button>
          </div>
          <p className="text-[13px] text-white/65 leading-relaxed line-clamp-4">{lastReply}</p>
        </div>
      )}
    </div>
  );
}

// ── Right panel: lead details ──────────────────────────────────────────────

function LeadPanel({ convId }: { convId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["conversation", convId],
    queryFn: () => fetchConversation(convId),
  });

  const { mutateAsync: updateLead } = useUpdateLead();

  const lead = data?.lead;
  const conv = data?.conversation;

  async function handleLeadStatus(status: string) {
    if (!lead) return;
    await updateLead({ id: lead.id, data: { status } });
    toast({ title: status === "Sold" ? "Marked Sold" : "Appointment set" });
    void qc.invalidateQueries({ queryKey: ["conversations", DEALER_ID] });
    void qc.invalidateQueries({ queryKey: ["conversation", convId] });
  }

  const { icon: TempIcon, badge: tempBadge } = tempConfig(lead?.temperature ?? null);

  const qualItems = [
    { label: "Timeline", value: lead?.buyerTimeline ?? null, icon: Clock },
    { label: "Down payment", value: lead?.buyerAvailableDownPayment != null ? `$${lead.buyerAvailableDownPayment.toLocaleString()}` : null, icon: FileText },
    { label: "Phone", value: lead?.phone ?? null, icon: Phone },
    { label: "Photo ID", value: lead?.hasId != null ? (lead.hasId ? "Confirmed" : "No ID") : null, icon: Shield },
    { label: "Income proof", value: lead?.hasProofOfIncome != null ? (lead.hasProofOfIncome ? "Confirmed" : "None") : null, icon: FileText },
    { label: "Appointment", value: lead?.appointmentIntent != null ? (lead.appointmentIntent ? "Interested" : "Not ready") : null, icon: Calendar },
  ];

  const completedCount = qualItems.filter((q) => q.value !== null).length;

  return (
    <div className="h-full overflow-y-auto">
      {/* Lead identity */}
      <div className="px-4 pt-5 pb-4 border-b border-white/[0.05] space-y-3">
        <div className="text-[9px] font-bold text-violet-400/40 uppercase tracking-widest">Lead</div>

        <div className="flex items-center justify-between">
          <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-bold", tempBadge)}>
            <TempIcon className="w-3 h-3" />
            {lead?.temperature ?? "Unknown"}
          </div>
          {lead?.leadScore != null && (
            <div className="text-right">
              <div className="text-[9px] text-white/20 uppercase tracking-widest">Score</div>
              <div className="text-lg font-black text-white leading-none">{lead.leadScore}</div>
            </div>
          )}
        </div>

        <div>
          <div className="text-[15px] font-bold text-white">{lead?.buyerName ?? "Unknown Buyer"}</div>
          {lead?.phone && (
            <div className="flex items-center gap-1 text-[11px] text-white/35 mt-0.5">
              <Phone className="w-3 h-3" />
              {lead.phone}
            </div>
          )}
        </div>

        {conv?.detectedVehicleTitle && (
          <div className="px-3 py-2 rounded-lg bg-violet-500/[0.06] border border-violet-500/10">
            <div className="text-[10px] text-violet-400/50 font-bold uppercase tracking-widest mb-0.5">Asking about</div>
            <div className="text-[12px] text-violet-200/70">{conv.detectedVehicleTitle}</div>
            {conv.marketplaceDownPayment && (
              <div className="text-[11px] text-violet-400 font-bold mt-0.5">
                ${conv.marketplaceDownPayment.toLocaleString()} down
              </div>
            )}
          </div>
        )}
      </div>

      {/* Qualification */}
      <div className="px-4 py-4 border-b border-white/[0.05]">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[9px] font-bold text-white/25 uppercase tracking-widest">Qualification</div>
          <div className={cn(
            "text-[10px] font-bold",
            completedCount === qualItems.length ? "text-emerald-400" : "text-amber-400/70",
          )}>
            {completedCount}/{qualItems.length} complete
          </div>
        </div>
        <div className="space-y-1">
          {qualItems.map((item) => {
            const Icon = item.icon;
            const done = item.value !== null;
            return (
              <div
                key={item.label}
                className={cn(
                  "flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] border",
                  done
                    ? "bg-emerald-500/[0.05] border-emerald-500/10 text-emerald-400/75"
                    : "bg-white/[0.01] border-white/[0.04] text-white/20",
                )}
              >
                <Icon className="w-3 h-3 shrink-0" />
                <span className="flex-1 font-medium">{item.label}</span>
                <span className={cn("text-[10px] truncate max-w-[70px]", done ? "text-white/50" : "text-white/15")}>
                  {done ? item.value : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-4 space-y-2">
        <div className="text-[9px] font-bold text-white/25 uppercase tracking-widest mb-3">Quick Actions</div>
        <Button
          className="w-full gap-2 h-9 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 font-semibold text-[12px]"
          onClick={() => void handleLeadStatus("Appointment")}
          disabled={!lead}
        >
          <Calendar className="w-3.5 h-3.5" />
          Set Appointment
        </Button>
        <Button
          className="w-full gap-2 h-9 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 font-semibold text-[12px]"
          onClick={() => void handleLeadStatus("Sold")}
          disabled={!lead}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Mark Sold
        </Button>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyPane({ hasConversations }: { hasConversations: boolean }) {
  const [, navigate] = useLocation();
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
      <div className="w-16 h-16 rounded-2xl bg-violet-500/[0.06] border border-violet-500/15 flex items-center justify-center mb-6">
        <MessageSquare className="w-8 h-8 text-violet-400/30" />
      </div>
      {hasConversations ? (
        <>
          <div className="text-base font-semibold text-white/40 mb-2">Select a conversation</div>
          <div className="text-[13px] text-white/20 max-w-xs leading-relaxed">
            Pick a buyer conversation from the left to view the full thread and lead details.
          </div>
        </>
      ) : (
        <>
          <div className="text-base font-semibold text-white/40 mb-2">No conversations yet</div>
          <div className="text-[13px] text-white/20 max-w-xs leading-relaxed mb-6">
            Buyer conversations appear here automatically as they message your Marketplace listings.
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-violet-500/20 text-violet-400/60 hover:bg-violet-500/[0.08] text-xs"
            onClick={() => navigate("/listings")}
          >
            <ChevronRight className="w-3.5 h-3.5" />
            Go to Marketplace
          </Button>
        </>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export function SalesAIWorkspace() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "needs_human" | "closed">("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["conversations", DEALER_ID],
    queryFn: fetchConversations,
    refetchInterval: 20_000,
  });

  const conversations = data?.conversations ?? [];

  const filtered = conversations
    .filter((c) => {
      const matchStatus = statusFilter === "all" || c.status === statusFilter;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        (c.lead?.buyerName ?? c.buyerName ?? "").toLowerCase().includes(q) ||
        (c.detectedVehicleTitle ?? "").toLowerCase().includes(q);
      return matchStatus && matchSearch;
    })
    .sort((a, b) => {
      const score = (c: ConvListItem) =>
        c.status === "needs_human" ? 4 : c.lastMessage?.role === "user" && c.status === "active" ? 3 : c.status === "active" ? 2 : 1;
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime();
    });

  const needsReplyCount = conversations.filter((c) => c.lastMessage?.role === "user" && c.status === "active").length;
  const needsHumanCount = conversations.filter((c) => c.status === "needs_human").length;
  const activeCount = conversations.filter((c) => c.status === "active").length;

  return (
    <AppLayout>
      <div className="flex-1 flex overflow-hidden">

        {/* ── LEFT: Conversation list ──────────────────────────────────── */}
        <div className="w-[272px] flex flex-col border-r border-white/[0.06] overflow-hidden shrink-0 bg-black/10">

          {/* Panel header */}
          <div className="px-4 pt-5 pb-4 border-b border-white/[0.05]">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <MessageSquare className="w-3.5 h-3.5 text-violet-400" />
              </div>
              <div>
                <div className="text-[9px] font-bold text-violet-400/50 uppercase tracking-widest">Sales AI</div>
                <div className="text-sm font-bold text-white leading-none">Inbox</div>
              </div>
            </div>

            {/* Live stats */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {[
                { label: "Active", value: activeCount, cls: "text-emerald-400" },
                { label: "Need Reply", value: needsReplyCount, cls: "text-violet-400" },
                { label: "Human", value: needsHumanCount, cls: "text-orange-400" },
              ].map((s) => (
                <div key={s.label} className={cn(
                  "flex items-center gap-1 text-[10px] font-bold transition-opacity",
                  s.value > 0 ? s.cls : "text-white/15 opacity-50",
                )}>
                  {s.value > 0 && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
                  <span className="font-black">{s.value}</span>
                  <span className="font-medium text-white/40">{s.label}</span>
                </div>
              ))}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search buyers…"
                className="h-8 pl-7 pr-3 text-xs bg-white/[0.03] border-white/[0.06] text-white/80 placeholder:text-white/20 rounded-lg"
              />
            </div>
          </div>

          {/* Status filter pills */}
          <div className="flex items-center gap-1 px-3 py-2.5 border-b border-white/[0.04] bg-black/5">
            {(["all", "active", "needs_human", "closed"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md whitespace-nowrap transition-colors",
                  statusFilter === s
                    ? "bg-violet-500/15 text-violet-400 border border-violet-500/20"
                    : "text-white/20 hover:text-white/40",
                )}
              >
                {s === "needs_human" ? "Human" : s}
              </button>
            ))}
          </div>

          {/* Conversation rows */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-4 h-4 animate-spin text-violet-400/30" />
              </div>
            ) : isError ? (
              <div className="flex items-center justify-center py-12 gap-2 text-xs text-red-400/50">
                <XCircle className="w-3.5 h-3.5" /> Failed to load
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-xs text-white/15 py-12 px-4">
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
        <div className="flex-1 flex overflow-hidden">
          {selectedId ? (
            <ThreadPanel convId={selectedId} />
          ) : (
            <EmptyPane hasConversations={conversations.length > 0} />
          )}
        </div>

        {/* ── RIGHT: Lead panel ────────────────────────────────────────── */}
        {selectedId && (
          <div className="w-[248px] border-l border-white/[0.06] overflow-hidden shrink-0 bg-black/10">
            <LeadPanel convId={selectedId} />
          </div>
        )}

      </div>
    </AppLayout>
  );
}
