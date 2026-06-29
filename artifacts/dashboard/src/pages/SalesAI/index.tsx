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
            title="Sales AI"
            description="Your autonomous BDC. Monitor conversations, manage appointments, and watch the AI work."
            icon={Bot}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard 
              label="Active Conversations"
              value={unreadCount}
              icon={MessageSquare}
              valueColor="text-primary"
              trend={{ value: 12, isPositive: true }}
            />
            <KpiCard 
              label="AI Response Rate"
              value="98%"
              icon={Zap}
              valueColor="text-green-500"
            />
            <KpiCard 
              label="Appointments Booked"
              value="--/--"
              icon={Calendar}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <SectionCard title="Live Lead Pipeline" icon={Users}>
                {isLoading ? (
                  <div className="py-12 flex justify-center">
                    <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                  </div>
                ) : leads.length === 0 ? (
                  <EmptyState 
                    icon={MessageSquare}
                    title="No active leads"
                    description="When buyers message you on Marketplace, the AI will intercept and manage the conversation here."
                  />
                ) : (
                  <div className="space-y-4">
                    {leads.map((lead) => (
                      <div key={lead.id} className="p-4 rounded-xl border border-border/50 bg-card/40 hover:bg-card/80 transition-colors flex items-start gap-4">
                        <div className="mt-1">
                          <StatusPulse status={lead.status === "New" ? "warning" : lead.status === "Closed" ? "success" : "default"} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-foreground/90">{lead.buyerName || "Unknown Buyer"}</span>
                            <span className="text-xs text-muted-foreground">{formatDate(lead.createdAt)}</span>
                          </div>
                          <p className="text-sm text-foreground/70 truncate mb-3">{lead.messageText}</p>
                          
                          {lead.suggestedReply && (
                            <div className="bg-primary/5 border border-primary/10 rounded-lg p-3">
                              <div className="flex items-center gap-2 mb-1.5">
                                <Bot className="w-3 h-3 text-primary" />
                                <span className="text-xs font-medium text-primary uppercase tracking-wider">AI Suggested Reply</span>
                              </div>
                              <p className="text-sm text-muted-foreground">{lead.suggestedReply}</p>
                            </div>
                          )}
                        </div>
                        <div className="shrink-0">
                          <Badge variant="outline" className="uppercase text-[10px] tracking-wider bg-secondary/50">
                            {lead.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>

            <div className="space-y-6">
              <SectionCard title="Roadmap: Autonomous BDC" icon={Zap} className="bg-primary/5 border-primary/20">
                <div className="space-y-6">
                  <p className="text-sm text-muted-foreground">
                    We are building a fully autonomous Sales AI that handles 100% of your top-of-funnel Marketplace messages.
                  </p>
                  
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <MessageSquare className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-1">Instant Engagement</h4>
                        <p className="text-xs text-muted-foreground">Replies to new inquiries in under 60 seconds, 24/7.</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-1">Objection Handling</h4>
                        <p className="text-xs text-muted-foreground">Negotiates price, discusses financing, and handles trade-in questions using your Dealership DNA.</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <Calendar className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-1">Appointment Booking</h4>
                        <p className="text-xs text-muted-foreground">Drives the conversation to a firm showroom appointment.</p>
                      </div>
                    </div>
                  </div>
                  
                  <Button variant="outline" className="w-full group">
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
