import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListPublishingJobs } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Loader2, Share, Clock, CheckCircle2, AlertTriangle, Send } from "lucide-react";

function statusClass(status: string) {
  switch (status) {
    case "Published":
      return "bg-green-500/10 text-green-500";
    case "Publishing":
      return "bg-blue-500/10 text-blue-500";
    case "Queued":
      return "bg-amber-500/10 text-amber-500";
    case "Failed":
      return "bg-destructive/10 text-destructive";
    case "Retry":
      return "bg-orange-500/10 text-orange-500";
    default:
      return "bg-secondary text-muted-foreground";
  }
}

export function PublishingQueue() {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading } = useListPublishingJobs({
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const jobs = data?.jobs ?? [];
  const queued = jobs.filter((j) => j.status === "Queued").length;
  const publishing = jobs.filter((j) => j.status === "Publishing").length;
  const published = jobs.filter((j) => j.status === "Published").length;
  const failed = jobs.filter((j) => j.status === "Failed" || j.status === "Retry").length;

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Publishing</h1>
            <p className="text-muted-foreground mt-1">
              Jobs queued for the Chrome extension to draft on Facebook Marketplace.
            </p>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Queued</p>
                    <h3 className="text-2xl font-bold text-amber-500">{queued}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-amber-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Publishing</p>
                    <h3 className="text-2xl font-bold text-blue-500">{publishing}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <Send className="w-5 h-5 text-blue-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Published</p>
                    <h3 className="text-2xl font-bold text-green-500">{published}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Needs Attention</p>
                    <h3 className="text-2xl font-bold text-destructive">{failed}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-destructive" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filter */}
          <div className="flex items-center justify-end bg-card p-4 rounded-lg border border-border">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[200px] bg-background/50 border-0">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Queued">Queued</SelectItem>
                <SelectItem value="Publishing">Publishing</SelectItem>
                <SelectItem value="Published">Published</SelectItem>
                <SelectItem value="Retry">Retry</SelectItem>
                <SelectItem value="Failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-20 bg-card rounded-lg border border-border">
              <Share className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">No publishing jobs</h3>
              <p className="text-muted-foreground mt-1">
                Queue a generated listing from its detail page to add it here.
              </p>
            </div>
          ) : (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Listing Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Claimed By</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-medium">
                        <Link href={`/listings/${job.vehicleId}`} className="hover:text-primary transition-colors">
                          {job.vehicleLabel || `Vehicle #${job.vehicleId}`}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {job.listingTitle || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={cn(statusClass(job.status))}>
                          {job.status}
                        </Badge>
                        {job.status === "Failed" && job.failedReason && (
                          <div className="text-xs text-muted-foreground mt-1 max-w-xs truncate">{job.failedReason}</div>
                        )}
                      </TableCell>
                      <TableCell>{job.priority}</TableCell>
                      <TableCell>{job.attempts}</TableCell>
                      <TableCell className="text-muted-foreground">{job.claimedByExtension || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(job.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
