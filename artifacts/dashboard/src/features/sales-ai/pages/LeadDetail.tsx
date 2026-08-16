import { useRoute, useLocation } from "wouter";
import { AppLayout } from "@/shared/layout/AppLayout";
import { useGetLead, useUpdateLead, useGetConversation } from "@workspace/api-client-react";
import { PageHeader, SectionCard } from "@/shared/ui";
import {
  Users,
  ArrowLeft,
  Flame,
  Thermometer,
  Snowflake,
  DollarSign,
  Phone,
  Calendar,
  CheckCircle2,
  XCircle,
  MessageSquare,
  ArrowRight,
  FileText,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";

function temperatureBadge(temp: string | null | undefined) {
  if (temp === "Hot") return "bg-destructive/10 text-destructive border-destructive/20";
  if (temp === "Warm") return "bg-orange-500/10 text-orange-400 border-orange-500/20";
  return "bg-primary/10 text-primary border-primary/20";
}

function temperatureIcon(temp: string | null | undefined) {
  if (temp === "Hot") return <Flame className="w-3.5 h-3.5 text-destructive" />;
  if (temp === "Warm") return <Thermometer className="w-3.5 h-3.5 text-orange-400" />;
  return <Snowflake className="w-3.5 h-3.5 text-primary" />;
}

const STATUS_FLOW = [
  "New",
  "Contacted",
  "Qualified",
  "Appointment Ready",
  "Appointment Set",
  "Sold",
];

export function LeadDetail() {
  const [, params] = useRoute("/leads/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const id = Number(params?.id);

  const { data, isLoading, refetch } = useGetLead(id);
  const { mutateAsync: updateLead } = useUpdateLead();

  const lead = data?.lead;
  const { data: convData } = useGetConversation(lead?.conversationId ?? 0);

  async function handleStatus(status: string) {
    await updateLead({ id, data: { status } });
    toast({ title: `Lead marked as ${status}` });
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

  if (!lead) {
    return (
      <AppLayout>
        <div className="p-8 text-muted-foreground">Lead not found.</div>
      </AppLayout>
    );
  }

  const currentIdx = STATUS_FLOW.indexOf(lead.status);

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto animate-in fade-in duration-500">
        <div className="p-8 max-w-4xl mx-auto space-y-8">
          <PageHeader
            eyebrow="LEADS CRM"
            title={lead.buyerName ?? "Lead"}
            description={
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/leads")}
                  className="gap-2 -ml-2 h-8 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to Leads CRM
                </Button>
              </div>
            }
            icon={Users}
          />

          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {STATUS_FLOW.map((s, i) => (
              <div key={s} className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleStatus(s)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-bold  tracking-wide transition border",
                    i <= currentIdx
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "text-muted-foreground border-border hover:border-border hover:text-muted-foreground",
                  )}
                >
                  {s}
                </button>
                {i < STATUS_FLOW.length - 1 && (
                  <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SectionCard title="Buyer Info" icon={Users}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-lg text-foreground">
                    {lead.buyerName ?? "Unknown Buyer"}
                  </span>
                  {lead.temperature && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "flex items-center gap-1 text-[11px] font-bold  tracking-wide",
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
                      <span className="font-bold text-foreground">{lead.leadScore}/100</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${Math.min(lead.leadScore, 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-border space-y-2">
                  {[
                    { label: "Phone", value: lead.phone, icon: Phone, accent: "text-success" },
                    { label: "Language", value: lead.language === "es" ? "Spanish" : "English", icon: MessageSquare },
                    { label: "Timeline", value: lead.buyerTimeline?.replace(/_/g, " "), icon: Calendar },
                    { label: "Source", value: lead.sourceUrl, icon: FileText },
                  ].map(({ label, value, icon: Icon, accent }) => (
                    <div key={label} className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Icon className="w-3 h-3" />
                        {label}
                      </span>
                      <span className={cn("font-medium truncate max-w-[150px]", accent ?? "text-foreground")}>
                        {value ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Down Payment" icon={DollarSign}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-card/60 border border-border text-center">
                    <div className="text-xs font-bold  tracking-wide text-muted-foreground mb-1">
                      Published
                    </div>
                    <div className="text-xl font-bold text-foreground">
                      {lead.publishedDownPayment
                        ? formatCurrency(lead.publishedDownPayment)
                        : "—"}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 text-center">
                    <div className="text-xs font-bold  tracking-wide text-primary mb-1">
                      Buyer Has
                    </div>
                    <div className="text-xl font-bold text-primary">
                      {lead.buyerAvailableDownPayment
                        ? formatCurrency(lead.buyerAvailableDownPayment)
                        : "—"}
                    </div>
                  </div>
                </div>

                {lead.buyerAvailableDownPayment != null &&
                  lead.publishedDownPayment != null && (
                    <div
                      className={cn(
                        "p-3 rounded-xl border text-[11px] font-medium",
                        lead.buyerAvailableDownPayment >= lead.publishedDownPayment
                          ? "bg-success/10 border-success/20 text-success"
                          : "bg-orange-500/10 border-orange-500/20 text-orange-400",
                      )}
                    >
                      {lead.buyerAvailableDownPayment >= lead.publishedDownPayment
                        ? "✓ Down payment requirement met"
                        : `${formatCurrency(lead.publishedDownPayment - lead.buyerAvailableDownPayment)} short of requirement`}
                    </div>
                  )}
              </div>
            </SectionCard>

            <SectionCard title="Qualification Signals" icon={CheckCircle2}>
              <div className="space-y-3">
                {[
                  { label: "ID or Tax ID (ITIN)", value: lead.hasId },
                  { label: "Proof of income", value: lead.hasProofOfIncome },
                  { label: "Appointment intent", value: lead.appointmentIntent },
                  { label: "Phone provided", value: !!lead.phone },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{label}</span>
                    {value === true ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-success font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Yes
                      </div>
                    ) : value === false ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-destructive/60 font-medium">
                        <XCircle className="w-4 h-4" />
                        No
                      </div>
                    ) : (
                      <span className="text-muted-foreground/40 text-sm">—</span>
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Actions" icon={FileText}>
              <div className="space-y-2">
                {lead.conversationId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/conversations/${lead.conversationId}`)}
                    className="w-full gap-2 border-primary/20 text-primary hover:bg-primary/10 text-xs font-bold  tracking-wide"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    View conversation
                    <ArrowRight className="w-3 h-3 ml-auto" />
                  </Button>
                )}
                {[
                  { label: "Mark Hot", status: "Contacted", color: "text-destructive border-destructive/20 hover:bg-destructive/10" },
                  { label: "Mark Qualified", status: "Qualified", color: "text-success border-success/20 hover:bg-success/10" },
                  { label: "Appointment Ready", status: "Appointment Ready", color: "text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/10" },
                  { label: "Appointment Set", status: "Appointment Set", color: "text-success border-success/20 hover:bg-success/10" },
                  { label: "Mark Sold", status: "Sold", color: "text-primary border-primary/20 hover:bg-primary/10" },
                  { label: "Mark Lost", status: "Lost", color: "text-muted-foreground border-border hover:bg-muted" },
                ].map(({ label, status, color }) => (
                  <Button
                    key={status}
                    variant="outline"
                    size="sm"
                    onClick={() => handleStatus(status)}
                    className={cn(
                      "w-full text-xs font-bold  tracking-wide",
                      color,
                    )}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </SectionCard>
          </div>

          {convData && (
            <SectionCard title="Conversation Summary" icon={MessageSquare}>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {convData.messages.slice(-6).map((m) => (
                  <div key={m.id} className={cn("text-sm", m.role === "assistant" ? "text-primary/90 pl-4 border-l border-primary/20" : "text-foreground/70")}>
                    <span className="text-xs font-bold  tracking-wide text-muted-foreground/60 block mb-0.5">
                      {m.role === "assistant" ? "DealerPilot" : "Buyer"}
                    </span>
                    {m.content}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
