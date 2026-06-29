import { useGetLeads } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, ExternalLink, User } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";

export function TestLeads() {
  const { data, isLoading } = useGetLeads();
  const leads = data?.leads || [];

  return (
    <Card className="flex flex-col h-full border-t-4 border-t-secondary shadow-md">
      <CardHeader className="bg-card pb-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">Test Leads</CardTitle>
            <CardDescription>Recent CRM inquiries</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-sm px-2 py-1">
              {isLoading ? "-" : leads.length} Total
            </Badge>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex gap-4 p-4 border rounded-lg">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : leads.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-12 text-center">
            <MessageSquare className="w-12 h-12 text-muted-foreground mb-4 opacity-20" />
            <h3 className="text-lg font-medium text-foreground">No leads yet</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-[250px]">
              Use the Messenger Simulator to create a test lead.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[500px] sm:h-[600px]">
            <div className="divide-y">
              {leads.map((lead) => (
                <div key={lead.id} className="p-4 hover:bg-muted/30 transition-colors group">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <div className="bg-primary/10 text-primary w-8 h-8 rounded-full flex items-center justify-center">
                        <User className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          {lead.buyerName || "Unknown Buyer"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs bg-slate-100 text-slate-600 border-slate-200">
                      {lead.status}
                    </Badge>
                  </div>
                  
                  <div className="ml-10 space-y-3">
                    <div className="bg-muted/50 p-3 rounded-md text-sm border-l-2 border-l-slate-300">
                      <p className="font-medium mb-1 text-xs text-muted-foreground uppercase tracking-wider">Buyer Message</p>
                      <p className="text-foreground/90">{lead.messageText}</p>
                    </div>
                    
                    {lead.suggestedReply && (
                      <div className="bg-primary/5 p-3 rounded-md text-sm border-l-2 border-l-primary">
                        <p className="font-medium mb-1 text-xs text-primary/80 uppercase tracking-wider flex items-center gap-1">
                          Suggested Reply
                        </p>
                        <p className="text-foreground/90">{lead.suggestedReply}</p>
                      </div>
                    )}
                    
                    {lead.sourceUrl && (
                      <a 
                        href={lead.sourceUrl} 
                        target="_blank" 
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline mt-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Source Link
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
