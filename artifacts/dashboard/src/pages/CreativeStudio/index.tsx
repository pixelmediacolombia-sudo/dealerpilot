import { useState, useMemo } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListCreativeStudio,
  getListCreativeStudioQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Search,
  Car,
  Gauge,
  Sparkles,
  Camera,
  ImageIcon,
  ScanSearch,
  LayoutGrid,
  List,
  ArrowUpDown,
  AlertTriangle,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/shared";
import { vehicleAuditBreakdown, decisionBadgeClass, scoreBadgeClass, scoreTextClass } from "./vehicleAudit";

export function CreativeStudio() {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [sortBy, setSortBy] = useState<"ai_score" | "photo_count" | "price" | "newest">("ai_score");
  const [photoFilter, setPhotoFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const studioParams = { q: search || undefined };
  const { data, isLoading } = useListCreativeStudio(studioParams, {
    query: {
      queryKey: getListCreativeStudioQueryKey(studioParams),
      refetchInterval: 8000,
    },
  });

  const vehicles = data?.vehicles ?? [];

  // Pre-compute audits so filter/sort and render are consistent
  const audits = useMemo(
    () => new Map(vehicles.map((v) => [v.vehicleId, vehicleAuditBreakdown(v.vehicleId)])),
    [vehicles],
  );

  const useOriginalCount = [...audits.values()].filter((a) => a.decision === "Use Original").length;
  const enhanceCount = [...audits.values()].filter((a) => a.decision === "Enhance Recommended").length;

  const filteredSortedVehicles = useMemo(() => {
    let list = [...vehicles];
    if (photoFilter) {
      list = list.filter((v) => {
        const audit = audits.get(v.vehicleId);
        if (!audit) return true;
        if (photoFilter === "use_original") return audit.decision === "Use Original";
        if (photoFilter === "enhance") return audit.decision === "Enhance Recommended";
        if (photoFilter === "review") return audit.decision === "Do Not Use";
        return true;
      });
    }
    switch (sortBy) {
      case "ai_score":
        list.sort((a, b) => (audits.get(b.vehicleId)?.total ?? 0) - (audits.get(a.vehicleId)?.total ?? 0));
        break;
      case "photo_count":
        list.sort((a, b) => (b.imageCount ?? 0) - (a.imageCount ?? 0));
        break;
      case "price":
        list.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
        break;
      default:
        break;
    }
    return list;
  }, [vehicles, sortBy, photoFilter, audits]);

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set(filteredSortedVehicles.map((v) => v.vehicleId)));
  const clearSelection = () => setSelectedIds(new Set());

  return (
    <AppLayout>
      <div className="flex-1 overflow-y-auto animate-in fade-in duration-500">
        <div className="p-8 max-w-7xl mx-auto space-y-6">
          <PageHeader
            eyebrow="AI VEHICLE STUDIO"
            title="AI Vehicle Studio"
            description={
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground text-sm">
                  {vehicles.length} vehicles · {useOriginalCount} use original · {enhanceCount} enhance recommended
                </span>
                <div className="flex flex-wrap gap-2 mt-1">
                  <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-[10px] uppercase tracking-widest gap-1.5">
                    <ScanSearch className="w-3 h-3" /> Photo Audit
                  </Badge>
                  <Badge variant="secondary" className="bg-success/10 text-success border-success/20 text-[10px] uppercase tracking-widest gap-1.5">
                    <Camera className="w-3 h-3" /> Marketplace Photo
                  </Badge>
                  <Badge variant="secondary" className="bg-secondary/50 text-muted-foreground border-white/5 text-[10px] uppercase tracking-widest gap-1.5">
                    <ImageIcon className="w-3 h-3" /> Gallery
                  </Badge>
                </div>
              </div>
            }
            icon={Sparkles}
          />

          {/* Module description strip */}
          <div className="flex items-start gap-3 p-4 rounded-xl border bg-primary/5 border-primary/20 text-primary text-xs">
            <Camera className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-bold">AI Vehicle Studio</span>
              {" — "}
              <span className="text-muted-foreground">
                DealerPilot audits every vehicle photo and recommends{" "}
                <strong className="text-foreground/70">Use Original</strong> when photos are already strong.
                Enhancement is only recommended when overlays, poor lighting, or background issues require it.
                Select a vehicle to open its Photo Audit.
              </span>
            </div>
          </div>

          {/* Toolbar */}
          <div className="glass-panel p-4 rounded-xl flex flex-col sm:flex-row gap-3 items-center border border-border/50">
            <div className="relative flex-1 w-full max-w-xl">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search VIN, make, model…"
                className="pl-11 h-10 bg-card/60 backdrop-blur-xl border-border/50 focus-visible:ring-primary/50 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge className="bg-primary/20 text-primary border-primary/30 gap-1.5 text-xs">
                  {selectedIds.size} selected
                </Badge>
                <Button size="sm" variant="ghost" onClick={selectAll} className="h-7 text-xs px-2">
                  All {filteredSortedVehicles.length}
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSelection} className="h-7 text-xs px-2">×</Button>
              </div>
            )}

            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="w-full sm:w-[150px] bg-background/50 border-border/50 gap-1.5 h-10">
                <ArrowUpDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ai_score">AI Audit Score</SelectItem>
                <SelectItem value="photo_count">Photo Count</SelectItem>
                <SelectItem value="price">Price</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center rounded-lg border border-border/50 overflow-hidden flex-shrink-0 h-10">
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "flex items-center gap-1.5 px-3 h-full text-xs font-semibold transition-colors",
                  viewMode === "list" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <List className="w-3.5 h-3.5" /> List
              </button>
              <div className="w-px h-5 bg-border/60" />
              <button
                onClick={() => setViewMode("grid")}
                className={cn(
                  "flex items-center gap-1.5 px-3 h-full text-xs font-semibold transition-colors",
                  viewMode === "grid" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Grid
              </button>
            </div>
          </div>

          {/* Photo recommendation filter pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex-shrink-0 mr-1">Filter:</span>
            {([
              { key: null, label: "All" },
              { key: "use_original", label: "Use Original" },
              { key: "enhance", label: "Enhance Recommended" },
              { key: "review", label: "Needs Review" },
            ] as const).map(({ key, label }) => (
              <button
                key={String(key)}
                onClick={() => setPhotoFilter(key)}
                className={cn(
                  "px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors",
                  photoFilter === key
                    ? key === null
                      ? "bg-muted text-foreground border-border"
                      : key === "use_original"
                        ? "bg-success/20 text-success border-success/40"
                        : key === "enhance"
                          ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                          : "bg-red-500/20 text-red-400 border-red-500/40"
                    : "bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
            <div className="w-px h-4 bg-border/40 mx-1" />
            <span className="text-[11px] text-muted-foreground">
              {filteredSortedVehicles.length} vehicle{filteredSortedVehicles.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Vehicle grid / list */}
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="aspect-[4/3] rounded-2xl bg-secondary/50 animate-pulse" />
              ))}
            </div>
          ) : filteredSortedVehicles.length === 0 ? (
            <EmptyState
              icon={Car}
              title="No vehicles found"
              description="DealerPilot couldn't find any vehicles matching your search criteria."
            />
          ) : viewMode === "list" ? (
            /* ── Compact List View ── */
            <div className="rounded-xl border border-border/40 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30 border-b border-border/30 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <div className="w-5 flex-shrink-0">
                  <Checkbox
                    checked={selectedIds.size === filteredSortedVehicles.length && filteredSortedVehicles.length > 0}
                    onCheckedChange={(checked) => checked ? selectAll() : clearSelection()}
                  />
                </div>
                <div className="w-[72px] flex-shrink-0">Photo</div>
                <div className="flex-1 min-w-0">Vehicle</div>
                <div className="w-[110px] text-center flex-shrink-0 hidden lg:block">AI Score</div>
                <div className="w-[120px] flex-shrink-0 hidden md:block">Price</div>
                <div className="w-[100px] flex-shrink-0 text-right">Action</div>
              </div>
              {filteredSortedVehicles.map((v) => {
                const audit = audits.get(v.vehicleId)!;
                const isSelected = selectedIds.has(v.vehicleId);
                return (
                  <div
                    key={v.vehicleId}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2 min-h-[82px] border-b border-border/20 last:border-b-0 transition-colors hover:bg-muted/10",
                      isSelected && "bg-primary/5 border-l-2 border-l-primary"
                    )}
                  >
                    <div className="w-5 flex-shrink-0">
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleSelected(v.vehicleId)} />
                    </div>
                    {/* Thumbnail */}
                    <div className="relative w-[72px] h-[52px] flex-shrink-0 rounded-lg overflow-hidden bg-secondary/50">
                      {v.primaryImageUrl ? (
                        <img src={v.primaryImageUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Car className="w-5 h-5 text-muted-foreground/30" />
                        </div>
                      )}
                      {v.imageCount > 0 && (
                        <div className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5 bg-black/70 text-white text-[8px] font-bold px-1 py-0.5 rounded">
                          <ImageIcon className="w-2 h-2" />{v.imageCount}
                        </div>
                      )}
                    </div>
                    {/* Vehicle info + decision + top reasons */}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-foreground truncate">{v.label}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <span className="font-mono">{v.vin.slice(-6)}</span>
                        <span className="text-border/80">·</span>
                        <span>{v.imageCount} photo{v.imageCount === 1 ? "" : "s"}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className={cn(
                          "inline-flex items-center text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded",
                          audit.decision === "Use Original" ? "text-success bg-success/10" :
                          audit.decision === "Enhance Recommended" ? "text-amber-400 bg-amber-500/10" :
                          "text-red-400 bg-red-500/10"
                        )}>
                          {audit.decision}
                        </span>
                        {audit.topReasons[0] && (
                          <span className="text-[9px] text-muted-foreground/70 flex items-center gap-0.5 hidden sm:flex">
                            <AlertTriangle className="w-2.5 h-2.5 text-amber-400/60 flex-shrink-0" />
                            {audit.topReasons[0]}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* AI score — labeled "AI-estimated" on hover */}
                    <div className="w-[110px] flex-shrink-0 text-center hidden lg:flex flex-col items-center gap-1">
                      <div className={cn(
                        "inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold border",
                        scoreBadgeClass(audit.total)
                      )}>
                        <Gauge className="w-3 h-3" />{audit.total}
                      </div>
                      <span className="text-[8px] text-muted-foreground/50 uppercase tracking-widest">AI-estimated</span>
                    </div>
                    {/* Price */}
                    <div className="w-[120px] flex-shrink-0 hidden md:block">
                      <div className="font-bold text-sm">{formatCurrency(v.price)}</div>
                    </div>
                    {/* Action */}
                    <div className="w-[100px] flex-shrink-0 flex items-center justify-end">
                      <Link href={`/creative-studio/${v.vehicleId}`}>
                        <Button size="sm" variant="outline" className="h-7 px-2.5 text-[10px] gap-1.5 border-primary/30 text-primary hover:bg-primary/10 whitespace-nowrap">
                          <ScanSearch className="w-3 h-3" />
                          Audit →
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── Grid View ── */
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
              {filteredSortedVehicles.map((v, i) => {
                const audit = audits.get(v.vehicleId)!;
                const isSelected = selectedIds.has(v.vehicleId);

                return (
                  <div key={v.vehicleId} className="relative">
                    <div
                      className="absolute top-3 left-3 z-30"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelected(v.vehicleId); }}
                    >
                      <div className={cn(
                        "w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all duration-150 shadow-sm cursor-pointer",
                        isSelected ? "bg-primary border-primary" : "bg-black/40 border-white/60 hover:border-white backdrop-blur-sm"
                      )}>
                        {isSelected && <span className="text-white text-[10px] font-bold">✓</span>}
                      </div>
                    </div>
                    <Link href={`/creative-studio/${v.vehicleId}`}>
                      <div
                        className="group glass-panel rounded-2xl overflow-hidden hover-lift cursor-pointer flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 shadow-sm hover:shadow-primary/5 border border-white/5 hover:border-primary/30 transition-all duration-500 relative"
                        style={{ animationDelay: `${i * 50}ms`, animationFillMode: "both" }}
                      >
                        {/* Image area */}
                        <div className="aspect-[4/3] bg-secondary relative overflow-hidden">
                          {v.primaryImageUrl ? (
                            <img
                              src={v.primaryImageUrl}
                              alt={v.label}
                              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-muted/50">
                              <Car className="w-12 h-12 text-muted-foreground/30" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/30" />

                          {/* Decision badge — top right */}
                          <Badge className={cn(
                            "absolute top-4 right-4 z-10 backdrop-blur-md uppercase text-[9px] font-bold tracking-widest px-2 py-0.5 rounded-full border-0",
                            decisionBadgeClass(audit.decision),
                          )}>
                            {audit.decision}
                          </Badge>

                          {/* Score badge — top left */}
                          <div className="absolute top-4 left-4 z-10">
                            <Badge
                              variant="outline"
                              className={cn(
                                "backdrop-blur-md font-bold text-[10px] uppercase tracking-widest px-2.5 py-1 border-white/10",
                                scoreBadgeClass(audit.total),
                              )}
                            >
                              <Gauge className="w-3 h-3 mr-1" />
                              {audit.total}
                            </Badge>
                          </div>

                          {v.imageCount > 0 && (
                            <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-lg backdrop-blur-sm">
                              <ImageIcon className="w-3 h-3" />
                              {v.imageCount}
                            </div>
                          )}
                        </div>

                        {/* Card body */}
                        <div className="p-5 flex flex-col flex-1 bg-card/40 backdrop-blur-xl">
                          <div className="text-primary text-[10px] font-bold uppercase tracking-widest mb-1.5">
                            {v.vin.slice(-6)}
                          </div>
                          <div className="font-bold tracking-tight text-xl truncate mb-1 text-foreground/90 group-hover:text-primary transition-colors">
                            {v.label}
                          </div>
                          <div className="text-muted-foreground text-xs mb-2">
                            {v.imageCount} photo{v.imageCount === 1 ? "" : "s"} · <span className="text-muted-foreground/60">AI-estimated score</span>
                          </div>

                          {/* Top 2 reasons */}
                          {audit.topReasons.length > 0 && (
                            <div className="space-y-1 mb-4">
                              {audit.topReasons.slice(0, 2).map((reason, ri) => (
                                <div key={ri} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                                  <AlertTriangle className={cn("w-3 h-3 flex-shrink-0 mt-0.5", ri === 0 ? "text-amber-400/80" : "text-muted-foreground/50")} />
                                  {reason}
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between">
                            <div className="font-bold text-foreground/90 text-xl">
                              {formatCurrency(v.price)}
                            </div>
                            <div className="text-xs font-semibold flex items-center gap-1 text-primary/80 group-hover:text-primary uppercase tracking-widest transition-colors">
                              <ScanSearch className="w-3 h-3" /> Open Audit →
                            </div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
