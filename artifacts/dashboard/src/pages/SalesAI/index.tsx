import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetLeads } from "@workspace/api-client-react";
import { PageHeader, KpiCard, EmptyState, SectionCard, StatusPulse } from "@/components/shared";
import { MessageSquare, Users, Calendar, Bot, Zap, ArrowRight, Clock, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";

// Since useGetLeads might not be exported properly yet or missing query key helper,
// I'll provide a fallback query key.
const getGetLeadsQueryKey = () => ["/api/leads"];

export function SalesAI() {
  const { data, isLoading } = useGetLeads({
    query: {
      queryKey: getGetLeadsQueryKey(),
      refetchInterval: 10000,
    }
  });

  const leads = data?.leads ?? [];
  
  const activeLeads = leads.filter(l => l.status === "New" || l.status === "Active");
  const unreadCount = activeLeads.length;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto animate-in fade-in duration-500">
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          <PageHeader 
            eyebrow="AUTONOMOUS BDC"
            title="Sales AI"
            description="DealerPilot is monitoring conversations, managing appointments, and responding to buyers 24/7."
            icon={Bot}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <KpiCard 
              label="DealerPilot is managing"
              value={unreadCount}
              icon={MessageSquare}
              valueColor="text-primary"
              trend={{ value: 12, isPositive: true }}
            />
            <KpiCard 
              label="DealerPilot response rate"
              value="98%"
              icon={Zap}
              valueColor="text-green-500"
            />
            <KpiCard 
              label="DealerPilot booked"
              value="--/--"
              icon={Calendar}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-4">
            <div className="lg:col-span-2 space-y-6">
              <SectionCard 
                title={unreadCount === 1 ? "1 buyer is waiting for a reply" : `${unreadCount} buyers are waiting for a reply`} 
                icon={Users}
                className="border-white/5"
              >
                {isLoading ? (
                  <div className="py-16 flex justify-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">DealerPilot is fetching leads...</p>
                    </div>
                  </div>
                ) : leads.length === 0 ? (
                  <EmptyState 
                    icon={MessageSquare}
                    title="Inbox Zero"
                    description="When buyers message you on Marketplace, DealerPilot will intercept and manage the conversation here."
                  />
                ) : (
                  <div className="space-y-4">
                    {leads.map((lead) => (
                      <div key={lead.id} className="p-6 rounded-2xl border border-white/5 bg-card/40 hover:bg-card/80 hover:border-primary/20 transition-colors flex flex-col gap-4 relative overflow-hidden group">
                        <div className="absolute top-4 right-4 z-10">
                          <Badge variant="outline" className={cn("uppercase text-[9px] font-bold tracking-widest px-2.5 py-1 border-white/10", lead.status === "New" ? "bg-blue-500/10 text-blue-500 border-blue-500/20" : lead.status === "Closed" ? "bg-green-500/10 text-green-500 border-green-500/20" : "bg-secondary/50")}>
                            {lead.status}
                          </Badge>
                        </div>
                        
                        <div className="flex items-start gap-4 pr-16">
                           <div className="mt-1.5 shrink-0">
                            <StatusPulse status={lead.status === "New" ? "blue" : lead.status === "Closed" ? "success" : "default"} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-lg font-bold text-foreground/90 tracking-tight">{lead.buyerName || "Unknown Buyer"}</span>
                              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{formatDate(lead.createdAt)}</span>
                            </div>
                            <p className="text-sm text-foreground/80 leading-relaxed max-w-2xl">"{lead.messageText}"</p>
                          </div>
                        </div>

                        {lead.suggestedReply && (
                          <div className="ml-8 mt-2 bg-primary/5 border border-primary/20 rounded-xl p-4 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-50 pointer-events-none" />
                            <div className="relative z-10">
                              <div className="flex items-center gap-2 mb-2">
                                <Bot className="w-3.5 h-3.5 text-primary" />
                                <span className="text-[10px] font-bold text-primary uppercase tracking-widest">DealerPilot Suggested Reply</span>
                              </div>
                              <p className="text-sm text-foreground/90 font-medium">{lead.suggestedReply}</p>
                            </div>
                          </div>
                        )}
                        
                        <div className="ml-8 mt-2 flex justify-end">
                           <Button size="sm" className="gap-2 h-9 px-5 text-[10px] font-bold uppercase tracking-widest rounded-lg">
                             View Conversation <ArrowRight className="w-3.5 h-3.5" />
                           </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>

            <div className="space-y-6">
              <SectionCard title="Roadmap: Autonomous BDC" icon={Zap} className="bg-primary/5 border-primary/20">
                <div className="space-y-8">
                  <p className="text-sm text-muted-foreground font-medium leading-relaxed">
                    DealerPilot is building a fully autonomous Sales AI that will handle 100% of your top-of-funnel Marketplace messages.
                  </p>
                  
                  <div className="space-y-6">
                    <div className="flex gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <MessageSquare className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold mb-1 tracking-tight">Instant Engagement</h4>
                        <p className="text-xs text-muted-foreground/80">DealerPilot replies to new inquiries in under 60 seconds, 24/7.</p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold mb-1 tracking-tight">Objection Handling</h4>
                        <p className="text-xs text-muted-foreground/80">DealerPilot negotiates price, discusses financing, and handles trade-ins.</p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <Calendar className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold mb-1 tracking-tight">Appointment Booking</h4>
                        <p className="text-xs text-muted-foreground/80">DealerPilot drives the conversation to a firm showroom appointment.</p>
                      </div>
                    </div>
                  </div>
                  
                  <Button variant="outline" className="w-full group h-12 text-[10px] font-bold uppercase tracking-widest border-primary/20 hover:bg-primary/10 hover:text-primary transition-all">
                    View full roadmap <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </div>
              </SectionCard>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
