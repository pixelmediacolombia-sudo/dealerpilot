import { useLocation } from "wouter";
import { AppLayout } from "@/shared/layout/AppLayout";
import { useListLeads } from "@workspace/api-client-react";
import { PageHeader, EmptyState, SectionCard } from "@/shared/ui";
import {
  Users,
  Flame,
  Thermometer,
  Snowflake,
  DollarSign,
  Phone,
  Calendar,
  ArrowRight,
  CheckCircle2,
  Trophy,
  XCircle,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";

const DEALER_ID = 1;

const COLUMNS = [
  { key: "Hot", label: "Hot", icon: Flame, color: "text-destructive" },
  { key: "Warm", label: "Warm", icon: Thermometer, color: "text-orange-400" },
  { key: "Cold", label: "Cold", icon: Snowflake, color: "text-primary" },
  { key: "Appointment Ready", label: "Appt Ready", icon: Calendar, color: "text-yellow-400" },
  { key: "Sold", label: "Sold", icon: Trophy, color: "text-primary" },
  { key: "Lost", label: "Lost", icon: XCircle, color: "text-muted-foreground" },
] as const;

function statusBadge(status: string) {
  const map: Record<string, string> = {
    New: "bg-primary/10 text-primary border-primary/20",
    Contacted: "bg-primary/10 text-primary border-primary/20",
    Qualified: "bg-success/10 text-success border-success/20",
    "Appointment Ready": "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    "Appointment Set": "bg-success/10 text-success border-success/20",
    Sold: "bg-primary/10 text-primary border-primary/20",
    Lost: "bg-muted text-muted-foreground border-border",
  };
  return map[status] ?? "bg-secondary/50";
}

export function LeadsCRM() {
  const [, navigate] = useLocation();
  const { data, isLoading } = useListLeads({ dealerId: DEALER_ID });
  const leads = data?.leads ?? [];

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto animate-in fade-in duration-500">
        <div className="gymove-surface-shell p-8 max-w-7xl mx-auto space-y-8">
          <PageHeader
            eyebrow="SALES AI"
            title="Leads CRM"
            description={<div>Full pipeline view of all buyer leads from Marketplace conversations.</div>}
            icon={Users}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate("/sales-ai")}
                className="gap-2 border-border text-muted-foreground hover:text-foreground text-xs font-bold  tracking-wide"
              >
                ← Sales AI
              </Button>
            }
          />

          {isLoading ? (
            <div className="py-16 flex justify-center">
              <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : leads.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No leads yet"
              description="Leads appear here automatically when buyers message your Marketplace listings. Publish your first vehicle to start receiving inquiries."
            />
          ) : (
            <div className="overflow-x-auto pb-4">
              <div className="flex gap-4 min-w-max">
                {COLUMNS.map(({ key, label, icon: Icon, color }) => {
                  const colLeads =
                    key === "Hot" || key === "Warm" || key === "Cold"
                      ? leads.filter((l) => l.temperature === key)
                      : leads.filter((l) => l.status === key || l.status === `${key} Set`);

                  return (
                    <div key={key} className="w-72 shrink-0">
                      <div className="flex items-center gap-2 mb-3 px-1">
                        <Icon className={cn("w-4 h-4", color)} />
                        <span
                          className={cn(
                            "text-[11px] font-bold  tracking-wide",
                            color,
                          )}
                        >
                          {label}
                        </span>
                        <span className="ml-auto text-[11px] text-muted-foreground/60">
                          {colLeads.length}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {colLeads.length === 0 ? (
                          <div className="p-4 rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground/40">
                            Empty
                          </div>
                        ) : (
                          colLeads.map((lead) => (
                            <div
                              key={lead.id}
                              className="gymove-box-row p-4 hover:bg-card/70 hover:border-primary/20 transition cursor-pointer group"
                              onClick={() => navigate(`/leads/${lead.id}`)}
                            >
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <span className="font-bold text-sm text-foreground truncate">
                                  {lead.buyerName ?? "Buyer"}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[11px] font-bold  tracking-wide shrink-0",
                                    statusBadge(lead.status),
                                  )}
                                >
                                  {lead.status}
                                </Badge>
                              </div>

                              <div className="space-y-1.5 mb-3">
                                {lead.publishedDownPayment && (
                                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                    <DollarSign className="w-3 h-3" />
                                    Listed: {formatCurrency(lead.publishedDownPayment)}
                                  </div>
                                )}
                                {lead.buyerAvailableDownPayment && (
                                  <div className="flex items-center gap-1 text-[11px] text-primary font-medium">
                                    <DollarSign className="w-3 h-3" />
                                    Has: {formatCurrency(lead.buyerAvailableDownPayment)}
                                  </div>
                                )}
                                {lead.phone && (
                                  <div className="flex items-center gap-1 text-[11px] text-primary">
                                    <Phone className="w-3 h-3" />
                                    {lead.phone}
                                  </div>
                                )}
                                {lead.buyerTimeline && (
                                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70 capitalize">
                                    <Calendar className="w-3 h-3" />
                                    {lead.buyerTimeline.replace(/_/g, " ")}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                {lead.hasId && (
                                  <CheckCircle2 className="w-3 h-3 text-success" aria-label="Has ID" />
                                )}
                                {lead.hasProofOfIncome && (
                                  <CheckCircle2 className="w-3 h-3 text-success" aria-label="Income proof" />
                                )}
                                {lead.appointmentIntent && (
                                  <Calendar className="w-3 h-3 text-yellow-400" aria-label="Appointment intent" />
                                )}
                                {lead.leadScore != null && (
                                  <span className="ml-auto text-xs font-bold text-muted-foreground/60">
                                    {lead.leadScore}pts
                                  </span>
                                )}
                              </div>

                              {lead.leadScore != null && (
                                <div className="mt-2 h-0.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-primary rounded-full"
                                    style={{ width: `${Math.min(lead.leadScore, 100)}%` }}
                                  />
                                </div>
                              )}

                              <div className="mt-2 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="gap-1 h-6 text-[11px] font-bold  tracking-wide text-primary hover:text-primary px-2"
                                >
                                  View <ArrowRight className="w-2.5 h-2.5" />
                                </Button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
