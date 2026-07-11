import { useState, useMemo } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/shared/layout/AppLayout";
import {
  useListCreativeStudio,
  getListCreativeStudioQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Search,
  Car,
  Sparkles,
  Camera,
  ImageIcon,
  ScanSearch,
  LayoutGrid,
  List,
  ArrowUpDown,
  Clock,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/shared/ui";

export function CreativeStudio() {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [sortBy, setSortBy] = useState<"photo_count" | "price" | "newest">("photo_count");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const studioParams = { q: search || undefined };
  const { data, isLoading } = useListCreativeStudio(studioParams, {
    query: {
      queryKey: getListCreativeStudioQueryKey(studioParams),
      refetchInterval: 8000,
    },
  });

  const vehicles = data?.vehicles ?? [];

  const sortedVehicles = useMemo(() => {
    const list = [...vehicles];
    switch (sortBy) {
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
  }, [vehicles, sortBy]);

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set(sortedVehicles.map((v) => v.vehicleId)));
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
                  {vehicles.length} vehicles · {vehicles.reduce((s, v) => s + (v.imageCount ?? 0), 0)} photos · pending AI review
                </span>
                <div className="flex flex-wrap gap-2 mt-1">
                  <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-[10px] uppercase tracking-widest gap-1.5">
                    <ScanSearch className="w-3 h-3" /> Photo Gallery
                  </Badge>
                  <Badge variant="secondary" className="bg-secondary/50 text-muted-foreground border-white/5 text-[10px] uppercase tracking-widest gap-1.5">
                    <Clock className="w-3 h-3" /> AI Review Pending
                  </Badge>
                  <Badge variant="secondary" className="bg-secondary/50 text-muted-foreground border-white/5 text-[10px] uppercase tracking-widest gap-1.5">
                    <Camera className="w-3 h-3" /> Marketplace Photo
                  </Badge>
                </div>
              </div>
            }
            icon={Sparkles}
          />

          {/* Module description strip */}
          <div className="flex items-start gap-3 p-4 rounded-xl border bg-muted/10 border-border/30 text-xs">
            <Clock className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
            <div>
              <span className="font-bold text-foreground/80">AI Photo Review — Coming Soon</span>
              {" — "}
              <span className="text-muted-foreground">
                Real photo scoring (angle, lighting, sharpness, overlays) requires computer vision integration.
                Browse and review your vehicle photos below. Select a vehicle to view its full gallery.
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
                  All {sortedVehicles.length}
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

          {/* Count pill */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {sortedVehicles.length} vehicle{sortedVehicles.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Vehicle list / grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="aspect-[4/3] rounded-2xl bg-secondary/50 animate-pulse" />
              ))}
            </div>
          ) : sortedVehicles.length === 0 ? (
            <EmptyState
              icon={Car}
              title="No vehicles found"
              description="DealerPilot couldn't find any vehicles matching your search criteria."
            />
          ) : viewMode === "list" ? (

            /* ── List View ── */
            <div className="rounded-xl border border-border/40 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30 border-b border-border/30 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <div className="w-5 flex-shrink-0">
                  <Checkbox
                    checked={selectedIds.size === sortedVehicles.length && sortedVehicles.length > 0}
                    onCheckedChange={(checked) => checked ? selectAll() : clearSelection()}
                  />
                </div>
                <div className="w-[72px] flex-shrink-0">Photo</div>
                <div className="flex-1 min-w-0">Vehicle</div>
                <div className="w-[80px] text-center flex-shrink-0 hidden sm:block">Photos</div>
                <div className="w-[120px] flex-shrink-0 hidden md:block">Price</div>
                <div className="w-[100px] flex-shrink-0 text-right">Action</div>
              </div>

              {sortedVehicles.map((v) => {
                const isSelected = selectedIds.has(v.vehicleId);
                return (
                  <div
                    key={v.vehicleId}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2 min-h-[72px] border-b border-border/20 last:border-b-0 transition-colors hover:bg-muted/10",
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
                    </div>

                    {/* Vehicle info */}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-foreground truncate">{v.label}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <span className="font-mono">{v.vin.slice(-6)}</span>
                      </div>
                      <Badge className="mt-1 text-[8px] font-bold uppercase tracking-widest bg-muted/40 text-muted-foreground border-border/30 gap-1">
                        <Clock className="w-2 h-2" /> Pending AI Review
                      </Badge>
                    </div>

                    {/* Photo count */}
                    <div className="w-[80px] flex-shrink-0 text-center hidden sm:flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                      <ImageIcon className="w-3 h-3" />
                      {v.imageCount}
                    </div>

                    {/* Price */}
                    <div className="w-[120px] flex-shrink-0 hidden md:block">
                      <div className="font-bold text-sm">{formatCurrency(v.price)}</div>
                    </div>

                    {/* Action */}
                    <div className="w-[100px] flex-shrink-0 flex items-center justify-end">
                      <Link href={`/creative-studio/${v.vehicleId}`}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[10px] gap-1.5 border-primary/30 text-primary hover:bg-primary/10 whitespace-nowrap"
                        >
                          <ScanSearch className="w-3 h-3" />
                          Review →
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
              {sortedVehicles.map((v, i) => {
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

                          {/* Pending review badge */}
                          <Badge className="absolute top-4 right-4 z-10 backdrop-blur-md bg-black/50 text-white/70 border-white/10 uppercase text-[8px] font-bold tracking-widest gap-1">
                            <Clock className="w-2.5 h-2.5" /> Pending Review
                          </Badge>

                          {/* Photo count */}
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
                          <div className="text-muted-foreground text-xs mb-4">
                            {v.imageCount} photo{v.imageCount === 1 ? "" : "s"} · AI review pending
                          </div>

                          <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between">
                            <div className="font-bold text-foreground/90 text-xl">
                              {formatCurrency(v.price)}
                            </div>
                            <div className="text-xs font-semibold flex items-center gap-1 text-primary/80 group-hover:text-primary uppercase tracking-widest transition-colors">
                              <ScanSearch className="w-3 h-3" /> View Photos →
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
