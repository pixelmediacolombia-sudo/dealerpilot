import { useRoute, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetConversation,
  useUpdateConversationStatus,
  useUpdateLead,
} from "@workspace/api-client-react";
import { PageHeader, SectionCard } from "@/components/shared";
import {
  MessageSquare,
  ArrowLeft,
  Bot,
  User,
  Flame,
  Thermometer,
  Snowflake,
  Car,
  DollarSign,
  Phone,
  Calendar,
  CheckCircle2,
  XCircle,
  FileText,
  Clipboard,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

function temperatureBadge(temp: string | null | undefined) {
  if (temp === "Hot") return "bg-red-500/10 text-red-400 border-red-500/20";
  if (temp === "Warm") return "bg-orange-500/10 text-orange-400 border-orange-500/20";
  return "bg-blue-500/10 text-blue-400 border-blue-500/20";
}

function temperatureIcon(temp: string | null | undefined) {
  if (temp === "Hot") return <Flame className="w-3.5 h-3.5 text-red-400" />;
  if (temp === "Warm") return <Thermometer className="w-3.5 h-3.5 text-orange-400" />;
  return <Snowflake className="w-3.5 h-3.5 text-blue-400" />;
}

export function ConversationDetail() {
  const [, params] = useRoute("/conversations/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const id = Number(params?.id);

  const { data, isLoading, refetch } = useGetConversation(id);
  const { mutateAsync: updateStatus } = useUpdateConversationStatus();
  const { mutateAsync: updateLead } = useUpdateLead();

  const [copied, setCopied] = useState(false);

  const conv = data?.conversation;
  const messages = data?.messages ?? [];
  const lead = data?.lead as {
    id: number;
    buyerName?: string | null;
    temperature?: string | null;
    leadScore?: number | null;
    status?: string | null;
    phone?: string | null;
    hasId?: boolean | null;
    hasProofOfIncome?: boolean | null;
    appointmentIntent?: boolean | null;
    buyerTimeline?: string | null;
    publishedDownPayment?: number | null;
    buyerAvailableDownPayment?: number | null;
    suggestedReply?: string | null;
  } | null;

  const lastReply = messages
    .filter((m) => m.role === "assistant")
    .slice(-1)[0]?.content;

  async function handleCopy() {
    if (!lastReply) return;
    await navigator.clipboard.writeText(lastReply);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Reply copied to clipboard" });
  }

  async function handleMarkStatus(status: string) {
    if (!lead) return;
    await updateLead({ id: lead.id, data: { status } });
    toast({ title: `Lead marked as ${status}` });
    refetch();
  }

  async function handleConvStatus(status: string) {
    if (!conv) return;
    await updateStatus({ id: conv.id, data: { status } });
    toast({ title: `Conversation ${status}` });
    refetch();
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (!conv) {
    return (
      <AppLayout>
        <div className="p-8">
          <div className="text-muted-foreground">Conversation not found.</div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto animate-in fade-in duration-500">
        <div className="p-8 max-w-5xl mx-auto space-y-8">
          <PageHeader
            eyebrow="SALES AI"
            title={conv.buyerName ?? "Conversation"}
            description={
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/sales-ai")}
                  className="gap-2 -ml-2 h-8 text-muted-foreground hover:text-white"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to Sales AI
                </Button>
              </div>
            }
            icon={MessageSquare}
            action={
              <div className="flex gap-2">
                {conv.status === "active" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleConvStatus("needs_human")}
                    className="gap-2 border-orange-500/20 text-orange-400 hover:bg-orange-500/10 text-[10px] font-bold uppercase tracking-widest"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    Needs Human
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleConvStatus("closed")}
                  className="gap-2 border-white/10 text-muted-foreground hover:text-white text-[10px] font-bold uppercase tracking-widest"
                >
                  Close
                </Button>
              </div>
            }
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <SectionCard title="Message Timeline" icon={MessageSquare}>
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {messages.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-8 text-center">
                      No messages yet
                    </div>
                  ) : (
                    messages.map((m) => (
                      <div
                        key={m.id}
                        className={cn(
                          "flex gap-3",
                          m.role === "assistant" ? "flex-row-reverse" : "flex-row",
                        )}
                      >
                        <div
                          className={cn(
                            "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-1",
                            m.role === "assistant"
                              ? "bg-primary/20 border border-primary/30"
                              : "bg-white/10 border border-white/10",
                          )}
                        >
                          {m.role === "assistant" ? (
                            <Bot className="w-3.5 h-3.5 text-primary" />
                          ) : (
                            <User className="w-3.5 h-3.5 text-white/60" />
                          )}
                        </div>
                        <div
                          className={cn(
                            "max-w-[75%] p-3.5 rounded-2xl text-sm",
                            m.role === "assistant"
                              ? "bg-primary/10 border border-primary/20 text-foreground/90 rounded-tr-sm"
                              : "bg-card/60 border border-white/5 text-foreground/80 rounded-tl-sm",
                          )}
                        >
                          {m.role === "assistant" && (
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="text-[9px] font-bold text-primary uppercase tracking-widest">
                                DealerPilot AI
                              </span>
                            </div>
                          )}
                          {m.content}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </SectionCard>

              {lastReply && (
                <SectionCard title="AI Suggested Reply" icon={Bot}>
                  <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-4">
                    <p className="text-sm text-foreground/90 leading-relaxed">{lastReply}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleCopy}
                      className="gap-2 text-[10px] font-bold uppercase tracking-widest"
                    >
                      {copied ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" /> Copied!
                        </>
                      ) : (
                        <>
                          <Clipboard className="w-3.5 h-3.5" /> Copy Reply
                        </>
                      )}
                    </Button>
                  </div>
                </SectionCard>
              )}
            </div>

            <div className="space-y-4">
              {lead && (
                <SectionCard title="Buyer Profile" icon={User}>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white/90">
                        {lead.buyerName ?? "Unknown"}
                      </span>
                      {lead.temperature && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[9px] font-bold uppercase tracking-widest flex items-center gap-1",
                            temperatureBadge(lead.temperature),
                          )}
                        >
                          {temperatureIcon(lead.temperature)}
                          {lead.temperature}
                        </Badge>
                      )}
                    </div>

                    {lead.leadScore != null && (
                      <div>
                        <div className="flex justify-between text-[11px] mb-1">
                          <span className="text-muted-foreground">Lead Score</span>
                          <span className="font-bold text-white/80">{lead.leadScore}/100</span>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${Math.min(lead.leadScore, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 pt-2 border-t border-white/5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <DollarSign className="w-3 h-3" /> Published down
                        </span>
                        <span className="font-medium text-white/80">
                          {lead.publishedDownPayment
                            ? `$${lead.publishedDownPayment.toLocaleString()}`
                            : "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <DollarSign className="w-3 h-3" /> Buyer has
                        </span>
                        <span
                          className={cn(
                            "font-medium",
                            lead.buyerAvailableDownPayment ? "text-primary" : "text-muted-foreground",
                          )}
                        >
                          {lead.buyerAvailableDownPayment
                            ? `$${lead.buyerAvailableDownPayment.toLocaleString()}`
                            : "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Phone className="w-3 h-3" /> Phone
                        </span>
                        <span className={lead.phone ? "text-emerald-400" : "text-muted-foreground"}>
                          {lead.phone ?? "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> Timeline
                        </span>
                        <span className="text-white/70 capitalize">
                          {lead.buyerTimeline?.replace(/_/g, " ") ?? "—"}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-white/5">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                        Qualification
                      </div>
                      {[
                        { label: "ID / Tax ID", value: lead.hasId },
                        { label: "Proof of income", value: lead.hasProofOfIncome },
                        { label: "Appointment intent", value: lead.appointmentIntent },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">{label}</span>
                          {value === true ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : value === false ? (
                            <XCircle className="w-3.5 h-3.5 text-red-400/60" />
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </SectionCard>
              )}

              {conv.vehicleType && (
                <SectionCard title="Vehicle" icon={Car}>
                  <div className="space-y-2 text-[11px]">
                    {conv.detectedVehicleTitle && (
                      <div className="font-medium text-white/90">{conv.detectedVehicleTitle}</div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type</span>
                      <span className="capitalize text-white/70">{conv.vehicleType}</span>
                    </div>
                    {conv.marketplaceDownPayment && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Listed down</span>
                        <span className="text-primary font-medium">
                          ${conv.marketplaceDownPayment.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                </SectionCard>
              )}

              {lead && (
                <SectionCard title="Actions" icon={FileText}>
                  <div className="space-y-2">
                    {[
                      { label: "Mark Hot", status: "Contacted", color: "text-red-400 border-red-500/20 hover:bg-red-500/10" },
                      { label: "Mark Qualified", status: "Qualified", color: "text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10" },
                      { label: "Mark Appt Ready", status: "Appointment Ready", color: "text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/10" },
                      { label: "Mark Lost", status: "Lost", color: "text-muted-foreground border-white/10 hover:bg-white/5" },
                    ].map(({ label, status, color }) => (
                      <Button
                        key={status}
                        variant="outline"
                        size="sm"
                        onClick={() => handleMarkStatus(status)}
                        className={cn(
                          "w-full text-[10px] font-bold uppercase tracking-widest",
                          color,
                        )}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </SectionCard>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
