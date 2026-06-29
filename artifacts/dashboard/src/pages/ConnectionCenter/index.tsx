import { AppLayout } from "@/components/layout/AppLayout";
import { useGetConnectionStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader, StatusPulse } from "@/components/shared";
import { 
  Server, 
  Database, 
  Rss, 
  Puzzle, 
  Facebook, 
  Store, 
  MessageCircle, 
  Bot,
  Activity,
  Loader2
} from "lucide-react";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ConnectionCenter() {
  const { data: status, isLoading } = useGetConnectionStatus();

  const getStatusConfig = (serviceStatus: string) => {
    switch (serviceStatus?.toLowerCase()) {
      case "connected":
      case "online":
        return { color: "success", label: "Online" } as const;
      case "offline":
      case "error":
        return { color: "destructive", label: "Offline" } as const;
      case "not_synced":
      case "warning":
        return { color: "warning", label: "Degraded" } as const;
      case "coming_soon":
        return { color: "info", label: "Pending" } as const;
      default:
        return { color: "muted", label: "Unknown" } as const;
    }
  };

  const services = [
    { key: 'backend', name: 'Core API Server', icon: Server, description: 'Main orchestration and task runner' },
    { key: 'database', name: 'Primary Database', icon: Database, description: 'Persistent state storage' },
    { key: 'xmlFeed', name: 'Inventory Sync', icon: Rss, description: 'Nightly dealer feed ingestion' },
    { key: 'chromeExtension', name: 'Publishing Agent', icon: Puzzle, description: 'Browser automation bridge' },
    { key: 'facebookSession', name: 'FB Auth Token', icon: Facebook, description: 'Marketplace session state' },
    { key: 'marketplace', name: 'Marketplace API', icon: Store, description: 'Listing publication endpoints' },
    { key: 'messenger', name: 'Messenger Graph', icon: MessageCircle, description: 'Lead interception' },
    { key: 'openai', name: 'Intelligence Engine', icon: Bot, description: 'AI generation and natural language' },
  ] as const;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-7xl mx-auto space-y-8 pb-20">
          
          <PageHeader 
            title="Mission Control"
            description="Real-time health telemetry for the DealerPilot operating system."
            icon={Activity}
          />

          {isLoading ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {services.map(({ key, name, icon: Icon, description }) => {
                const svc = status?.[key];
                const config = getStatusConfig(svc?.status || "unknown");

                return (
                  <Card key={key} className="glass-panel overflow-hidden border-white/5 transition-all hover:border-white/10 hover-lift relative group">
                    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
                    
                    <CardHeader className="pb-4 flex flex-row items-start justify-between space-y-0 relative z-10">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5 text-foreground">
                          <Icon className="w-5 h-5 opacity-80" />
                          <CardTitle className="text-lg font-semibold tracking-tight">{name}</CardTitle>
                        </div>
                        <CardDescription className="text-sm text-muted-foreground line-clamp-1">{description}</CardDescription>
                      </div>
                      <div className="pl-4 pt-1">
                        <StatusPulse status={config.color} label={config.label} />
                      </div>
                    </CardHeader>
                    
                    <CardContent className="relative z-10">
                      <div className="space-y-4 pt-2">
                        {svc?.detail && (
                          <div className="text-sm px-3 py-2 bg-black/40 rounded border border-white/5 text-foreground/80 leading-relaxed font-mono">
                            {svc.detail}
                          </div>
                        )}
                        
                        {(svc?.lastHeartbeatAt || svc?.backendUrl) && (
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            {svc.lastHeartbeatAt && (
                              <div className="space-y-1">
                                <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Heartbeat</span>
                                <span className="block font-medium text-foreground">{formatDate(svc.lastHeartbeatAt)}</span>
                              </div>
                            )}
                            {svc.backendUrl && (
                              <div className="space-y-1 col-span-2 sm:col-span-1">
                                <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Target</span>
                                <span className="block font-mono text-xs text-primary/90 truncate bg-primary/10 px-2 py-1 rounded inline-block" title={svc.backendUrl}>
                                  {svc.backendUrl}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {!svc?.detail && !svc?.lastHeartbeatAt && !svc?.backendUrl && (
                          <div className="flex items-center justify-center py-4 text-sm text-muted-foreground bg-black/20 rounded border border-white/5 border-dashed">
                            Awaiting telemetry...
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

        </div>
      </div>
    </AppLayout>
  );
}
