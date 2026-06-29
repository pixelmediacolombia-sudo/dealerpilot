import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListConversations,
  useListLeads,
  useGetDownPaymentIntelligence,
  useListSimulatorScenarios,
  useRunSimulator,
} from "@workspace/api-client-react";
import {
  PageHeader,
  KpiCard,
  EmptyState,
  SectionCard,
  StatusPulse,
} from "@/components/shared";
import {
  MessageSquare,
  Users,
  Calendar,
  Bot,
  Zap,
  ArrowRight,
  Flame,
  Thermometer,
  Snowflake,
  TrendingUp,
  Play,
  CheckCircle2,
  Clock,
  DollarSign,
  Car,
  Phone,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DEALER_ID = 1;

function temperatureIcon(temp: string | null | undefined) {
  if (temp === "Hot") return <Flame className="w-3.5 h-3.5 text-red-400" />;
  if (temp === "Warm") return <Thermometer className="w-3.5 h-3.5 text-orange-400" />;
  return <Snowflake className="w-3.5 h-3.5 text-blue-400" />;
}

function temperatureBadge(temp: string | null | undefined) {
  if (temp === "Hot") return "bg-red-500/10 text-red-400 border-red-500/20";
  if (temp === "Warm") return "bg-orange-500/10 text-orange-400 border-orange-500/20";
  return "bg-blue-500/10 text-blue-400 border-blue-500/20";
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    New: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    Contacted: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    Qualified: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    "Appointment Ready": "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    "Appointment Set": "bg-green-500/10 text-green-400 border-green-500/20",
    Sold: "bg-primary/10 text-primary border-primary/20",
    Lost: "bg-white/5 text-muted-foreground border-white/10",
  };
  return map[status] ?? "bg-secondary/50";
}

type Tab = "conversations" | "leads" | "down-payment" | "simulator";

export function SalesAIWorkspace() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<Tab>("conversations");
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    suggestedReply: string;
    temperature: string;
    leadScore: number;
    language: string;
    messages: string[];
    conversationId: number;
    leadId: number;
  } | null>(null);

  const { data: convsData, isLoading: convsLoading } = useListConversations({ dealerId: DEALER_ID });
  const { data: leadsData, isLoading: leadsLoading } = useListLeads({ dealerId: DEALER_ID });
  const { data: dpData } = useGetDownPaymentIntelligence({ dealerId: DEALER_ID });
  const { data: scenariosData } = useListSimulatorScenarios();
  const { mutateAsync: runSim } = useRunSimulator();

  const conversations = convsData?.conversations ?? [];
  const leads = leadsData?.leads ?? [];
  const dpSummary = dpData?.summary ?? [];
  const scenarios = scenariosData?.scenarios ?? [];

  const hotLeads = leads.filter((l) => l.temperature === "Hot");
  const warmLeads = leads.filter((l) => l.temperature === "Warm");
  const apptReady = leads.filter(
    (l) => l.status === "Appointment Ready" || l.status === "Appointment Set",
  );
  const waiting = conversations.filter((c) => c.status === "active");

  async function handleRunScenario(key: string) {
    setRunningScenario(key);
    setLastResult(null);
    try {
      const result = await runSim({ data: { scenarioKey: key } });
      setLastResult(result);
      setTab("conversations");
    } catch (_e) {
    } finally {
      setRunningScenario(null);
    }
  }

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "conversations", label: "Conversations", icon: MessageSquare },
    { key: "leads", label: "Leads CRM", icon: Users },
    { key: "down-payment", label: "Down Payment Intel", icon: TrendingUp },
    { key: "simulator", label: "Simulator", icon: Play },
  ];

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto animate-in fade-in duration-500">
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          <PageHeader
            eyebrow="SALES AI"
            title="Sales AI Workspace"
            description={
              <div>
                DealerPilot monitors Messenger conversations, qualifies buyers,
                and suggests replies — 24/7.
              </div>
            }
            icon={Bot}
          />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Conversations waiting"
              value={waiting.length}
              icon={MessageSquare}
              valueColor="text-primary"
            />
            <KpiCard
              label="Hot leads"
              value={hotLeads.length}
              icon={Flame}
              valueColor="text-red-400"
            />
            <KpiCard
              label="Warm leads"
              value={warmLeads.length}
              icon={Thermometer}
              valueColor="text-orange-400"
            />
            <KpiCard
              label="Appointment ready"
              value={apptReady.length}
              icon={Calendar}
              valueColor="text-green-400"
            />
          </div>

          {lastResult && (
            <div className="p-5 rounded-2xl border border-green-500/20 bg-green-500/5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <span className="text-[11px] font-bold text-green-400 uppercase tracking-widest">
                  Simulator ran — conversation #{lastResult.conversationId} created
                </span>
                <Badge
                  variant="outline"
                  className={cn("ml-auto text-[9px] font-bold uppercase tracking-widest", temperatureBadge(lastResult.temperature))}
                >
                  {lastResult.temperature} · Score {lastResult.leadScore}
                </Badge>
              </div>
              <div className="bg-card/60 rounded-xl p-4 border border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <Bot className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[10px] font-bold text-primary uppercase tracking-widest">
                    AI Reply ({lastResult.language === "es" ? "Spanish" : "English"})
                  </span>
                </div>
                <p className="text-sm text-foreground/90">{lastResult.suggestedReply}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 gap-2 border-green-500/20 text-green-400 hover:bg-green-500/10 text-[10px] font-bold uppercase tracking-widest"
                onClick={() => navigate(`/conversations/${lastResult.conversationId}`)}
              >
                View conversation <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          )}

          <div className="flex gap-1 p-1 bg-card/40 rounded-xl border border-white/5 w-fit">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest transition-all",
                  tab === t.key
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-white/70",
                )}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {tab === "conversations" && (
            <SectionCard title="Active Conversations" icon={MessageSquare}>
              {convsLoading ? (
                <div className="py-12 flex justify-center">
                  <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                </div>
              ) : conversations.length === 0 ? (
                <EmptyState
                  icon={MessageSquare}
                  title="No conversations yet"
                  description="Run a simulator scenario or connect the Chrome extension to start receiving buyer messages."
                />
              ) : (
                <div className="space-y-3">
                  {conversations.map((c) => {
                    const lead = c.lead as {
                      temperature?: string;
                      leadScore?: number;
                      status?: string;
                    } | null;
                    const lastMsg = c.lastMessage as { content?: string; role?: string } | null;
                    return (
                      <div
                        key={c.id}
                        className="p-5 rounded-xl border border-white/5 bg-card/40 hover:bg-card/70 hover:border-primary/20 transition-all cursor-pointer group"
                        onClick={() => navigate(`/conversations/${c.id}`)}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <StatusPulse
                              status={c.status === "active" ? "blue" : "default"}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-bold text-sm text-white/90 truncate">
                                  {c.buyerName ?? "Unknown Buyer"}
                                </span>
                                {c.language === "es" && (
                                  <Badge variant="outline" className="text-[9px] px-1.5 border-white/10 text-muted-foreground">
                                    ES
                                  </Badge>
                                )}
                              </div>
                              {c.detectedVehicleTitle && (
                                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Car className="w-3 h-3" />
                                  {c.detectedVehicleTitle}
                                  {c.marketplaceDownPayment ? (
                                    <span className="ml-2 text-primary font-medium">
                                      ${c.marketplaceDownPayment.toLocaleString()} down
                                    </span>
                                  ) : null}
                                </div>
                              )}
                              {lastMsg && (
                                <p className="text-xs text-muted-foreground/70 mt-1 truncate max-w-xs">
                                  {lastMsg.role === "assistant" ? "↩ " : ""}
                                  {lastMsg.content}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2 shrink-0">
                            {lead?.temperature && (
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
                            {lead?.leadScore != null && (
                              <span className="text-[10px] text-muted-foreground">
                                Score {lead.leadScore}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 h-7 text-[10px] font-bold uppercase tracking-widest text-primary hover:text-primary"
                          >
                            View <ArrowRight className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          )}

          {tab === "leads" && (
            <SectionCard title="Leads Pipeline" icon={Users}>
              {leadsLoading ? (
                <div className="py-12 flex justify-center">
                  <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                </div>
              ) : leads.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No leads yet"
                  description="Run a simulator scenario to generate your first leads."
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {(["Hot", "Warm", "Cold"] as const).map((temp) => {
                    const group = leads.filter((l) => l.temperature === temp);
                    return (
                      <div key={temp} className="space-y-3">
                        <div className="flex items-center gap-2 mb-3">
                          {temperatureIcon(temp)}
                          <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                            {temp} · {group.length}
                          </span>
                        </div>
                        {group.length === 0 ? (
                          <div className="p-4 rounded-xl border border-dashed border-white/10 text-center text-xs text-muted-foreground/50">
                            No {temp.toLowerCase()} leads
                          </div>
                        ) : (
                          group.map((lead) => (
                            <div
                              key={lead.id}
                              className="p-4 rounded-xl border border-white/5 bg-card/40 hover:bg-card/70 hover:border-primary/20 transition-all cursor-pointer"
                              onClick={() => navigate(`/leads/${lead.id}`)}
                            >
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <span className="font-bold text-sm text-white/90 truncate">
                                  {lead.buyerName ?? "Buyer"}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[9px] font-bold uppercase tracking-widest shrink-0",
                                    statusBadge(lead.status),
                                  )}
                                >
                                  {lead.status}
                                </Badge>
                              </div>
                              <div className="space-y-1">
                                {lead.publishedDownPayment && (
                                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                    <DollarSign className="w-3 h-3" />
                                    Published: ${lead.publishedDownPayment.toLocaleString()}
                                  </div>
                                )}
                                {lead.buyerAvailableDownPayment && (
                                  <div className="flex items-center gap-1 text-[11px] text-primary">
                                    <DollarSign className="w-3 h-3" />
                                    Buyer has: ${lead.buyerAvailableDownPayment.toLocaleString()}
                                  </div>
                                )}
                                {lead.phone && (
                                  <div className="flex items-center gap-1 text-[11px] text-emerald-400">
                                    <Phone className="w-3 h-3" />
                                    {lead.phone}
                                  </div>
                                )}
                              </div>
                              {lead.leadScore != null && (
                                <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-primary rounded-full"
                                    style={{ width: `${Math.min(lead.leadScore, 100)}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          )}

          {tab === "down-payment" && (
            <SectionCard title="Down Payment Performance" icon={TrendingUp}>
              {dpData?.total === 0 ? (
                <EmptyState
                  icon={TrendingUp}
                  title="No data yet"
                  description="Run simulator scenarios to generate down payment intelligence data."
                />
              ) : (
                <div className="space-y-8">
                  {dpSummary.map((group) => (
                    <div key={group.vehicleType}>
                      <div className="flex items-center gap-2 mb-4">
                        <Car className="w-4 h-4 text-primary" />
                        <span className="font-bold text-sm text-white/90 capitalize">
                          {group.vehicleType}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {group.variants.map((v) => {
                          const hotPct =
                            v.totalConversations > 0
                              ? Math.round((v.hotLeads / v.totalConversations) * 100)
                              : 0;
                          return (
                            <div
                              key={v.publishedDownPayment}
                              className="p-4 rounded-xl border border-white/5 bg-card/40"
                            >
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-lg font-bold text-white/90">
                                  ${v.publishedDownPayment.toLocaleString()}
                                </span>
                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                  down
                                </span>
                              </div>
                              <div className="space-y-1.5 text-[11px]">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Conversations</span>
                                  <span className="font-bold text-white/80">
                                    {v.totalConversations}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-red-400">Hot leads</span>
                                  <span className="font-bold text-red-400">
                                    {v.hotLeads}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-green-400">Appt ready</span>
                                  <span className="font-bold text-green-400">
                                    {v.appointmentReady}
                                  </span>
                                </div>
                              </div>
                              <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-red-400 rounded-full transition-all"
                                  style={{ width: `${hotPct}%` }}
                                />
                              </div>
                              <div className="mt-1 text-[10px] text-muted-foreground/60 text-right">
                                {hotPct}% hot rate
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          )}

          {tab === "simulator" && (
            <SectionCard title="Conversation Simulator" icon={Play}>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Simulate real buyer conversations to test the AI reply engine, lead scoring,
                  and down payment intelligence.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {scenarios.map((s) => (
                    <div
                      key={s.key}
                      className="p-4 rounded-xl border border-white/5 bg-card/40 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm text-white/90">{s.label}</span>
                          <Badge
                            variant="outline"
                            className="text-[9px] uppercase tracking-widest border-white/10 text-muted-foreground"
                          >
                            {s.language === "es" ? "🇲🇽 ES" : "🇺🇸 EN"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                          <span className="capitalize">{s.vehicleType}</span>
                          <span className="text-primary font-medium">
                            ${s.downPayment.toLocaleString()} down
                          </span>
                          <span>{s.messageCount} msg{s.messageCount > 1 ? "s" : ""}</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={runningScenario !== null}
                        onClick={() => handleRunScenario(s.key)}
                        className="shrink-0 gap-2 h-8 px-3 text-[10px] font-bold uppercase tracking-widest"
                      >
                        {runningScenario === s.key ? (
                          <>
                            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Running
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3" />
                            Run
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
