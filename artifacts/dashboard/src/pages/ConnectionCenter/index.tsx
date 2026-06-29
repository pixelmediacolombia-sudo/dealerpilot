import { AppLayout } from "@/components/layout/AppLayout";
import { useGetConnectionStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Server, 
  Database, 
  Rss, 
  Puzzle, 
  Facebook, 
  Store, 
  MessageCircle, 
  Bot,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  HelpCircle,
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
        return { color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/20", icon: CheckCircle2 };
      case "offline":
      case "error":
        return { color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20", icon: XCircle };
      case "not_synced":
      case "warning":
        return { color: "text-yellow-500", bg: "bg-yellow-500/10", border: "border-yellow-500/20", icon: AlertCircle };
      case "coming_soon":
        return { color: "text-primary", bg: "bg-primary/10", border: "border-primary/20", icon: Clock };
      default:
        return { color: "text-muted-foreground", bg: "bg-muted", border: "border-border", icon: HelpCircle };
    }
  };

  const services = [
    { key: 'backend', name: 'Core Backend', icon: Server, description: 'Main API server and task runner' },
    { key: 'database', name: 'Database', icon: Database, description: 'Primary PostgreSQL storage' },
    { key: 'xmlFeed', name: 'XML Feed Parser', icon: Rss, description: 'Ingestion engine for dealer inventory feeds' },
    { key: 'chromeExtension', name: 'Chrome Extension', icon: Puzzle, description: 'Bridge to Marketplace for automation' },
    { key: 'facebookSession', name: 'Facebook Session', icon: Facebook, description: 'Authentication token for the connected account' },
    { key: 'marketplace', name: 'FB Marketplace API', icon: Store, description: 'Listing management and status syncing' },
    { key: 'messenger', name: 'FB Messenger API', icon: MessageCircle, description: 'Lead reception and automated replies' },
    { key: 'openai', name: 'OpenAI API', icon: Bot, description: 'AI generation for listings and conversations' },
  ] as const;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Connection Center</h1>
            <p className="text-muted-foreground mt-1">Monitor the health and status of all connected services and integrations.</p>
          </div>

          {isLoading ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {services.map(({ key, name, icon: Icon, description }) => {
                const svc = status?.[key];
                const config = getStatusConfig(svc?.status || "unknown");
                const StatusIcon = config.icon;

                return (
                  <Card key={key} className={cn("border transition-colors", config.border)}>
                    <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className="w-5 h-5 text-muted-foreground" />
                          <CardTitle className="text-lg">{name}</CardTitle>
                        </div>
                        <CardDescription className="text-xs">{description}</CardDescription>
                      </div>
                      <Badge variant="outline" className={cn("uppercase text-[10px] px-2 py-0.5 border-transparent font-bold tracking-wider", config.bg, config.color)}>
                        {svc?.status || "Unknown"}
                      </Badge>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3 mt-2">
                        {svc?.detail && (
                          <div className="text-sm bg-secondary/50 p-3 rounded-md text-foreground/80 border border-border/50">
                            {svc.detail}
                          </div>
                        )}
                        
                        {(svc?.lastHeartbeatAt || svc?.backendUrl) && (
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            {svc.lastHeartbeatAt && (
                              <div className="bg-background rounded p-2 border border-border">
                                <span className="text-muted-foreground block mb-0.5">Last Heartbeat</span>
                                <span className="font-medium text-foreground">{formatDate(svc.lastHeartbeatAt)}</span>
                              </div>
                            )}
                            {svc.backendUrl && (
                              <div className="bg-background rounded p-2 border border-border col-span-2 sm:col-span-1">
                                <span className="text-muted-foreground block mb-0.5">Connected Target</span>
                                <span className="font-mono text-[10px] text-primary truncate block w-full" title={svc.backendUrl}>
                                  {svc.backendUrl}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Empty state filler for consistent card height if no details */}
                        {!svc?.detail && !svc?.lastHeartbeatAt && !svc?.backendUrl && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <StatusIcon className="w-4 h-4" />
                            <span>System is reporting as {svc?.status || "unknown"}</span>
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
