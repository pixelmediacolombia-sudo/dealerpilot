import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { EmptyState, SectionCard } from "@/shared/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import { toast } from "@/hooks/use-toast";

type ToRemoveItem = {
  id: number;
  vehicleId: number;
  photoUrl: string | null;
  vehicleLabel: string;
  vin: string;
  price: number | null;
  detectedAt: string;
  listingUrl: string | null;
  state: "pending" | "failed" | "ready";
  error: string | null;
};

async function fetchToRemove(): Promise<{ items: ToRemoveItem[] }> {
  const response = await fetch("/api/publishing/to-remove?dealer_id=1");
  if (!response.ok) throw new Error("No se pudo cargar la cola de Marketplace");
  return response.json() as Promise<{ items: ToRemoveItem[] }>;
}

async function markSold(listingId: number): Promise<void> {
  const response = await fetch(`/api/publishing/listings/${listingId}/mark-sold`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "success" }),
  });
  if (!response.ok) throw new Error("No se pudo registrar la acción");
}

export function ToRemovePanel() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["marketplace-to-remove"], queryFn: fetchToRemove, refetchInterval: 60_000 });
  const mutation = useMutation({
    mutationFn: markSold,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["marketplace-to-remove"] });
      toast({ title: "Acción registrada", description: "La unidad quedó lista para confirmar en Marketplace." });
    },
    onError: (error: Error) => toast({ title: "No se pudo completar", description: error.message, variant: "destructive" }),
  });

  const items = query.data?.items ?? [];
  const handleMarkOne = (item: ToRemoveItem) => {
    if (!window.confirm(`¿Confirmas marcar como vendido el ${item.vehicleLabel}?`)) return;
    mutation.mutate(item.id);
  };
  const handleMarkAll = async () => {
    const pending = items.filter((item) => item.state !== "ready");
    if (pending.length === 0 || !window.confirm(`¿Confirmas procesar ${pending.length} unidades?`)) return;
    for (const item of pending) {
      try {
        await markSold(item.id);
      } catch {
        toast({ title: "Lote detenido", description: `Falló ${item.vehicleLabel}. Las demás unidades siguen pendientes.`, variant: "destructive" });
        break;
      }
    }
    void queryClient.invalidateQueries({ queryKey: ["marketplace-to-remove"] });
  };

  return (
    <SectionCard className="overflow-hidden border-warning/25 bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldAlert className="h-4 w-4 text-warning" />
            To Remove · Marketplace
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Unidades que salieron del inventario y todavía requieren marcarse como vendidas en Facebook.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-warning/25 bg-warning/10 text-warning">{items.length} pendientes</Badge>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleMarkAll} disabled={mutation.isPending || items.length === 0}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Mark All as Sold
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void query.refetch()} aria-label="Actualizar cola">
            <RefreshCw className={query.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          </Button>
        </div>
      </div>
      {query.isLoading ? (
        <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando cola…</div>
      ) : query.isError ? (
        <div className="flex items-center gap-2 px-5 py-8 text-sm text-destructive"><AlertTriangle className="h-4 w-4" /> No se pudo cargar la cola.</div>
      ) : items.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="h-7 w-7" />} title="No hay unidades para retirar" description="La cola se actualizará después de cada ingesta de inventario." />
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => (
            <div key={item.id} className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                  {item.photoUrl ? <img src={item.photoUrl} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-muted" />}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{item.vehicleLabel}</div>
                  <div className="mt-1 text-xs text-muted-foreground">VIN {item.vin} · {item.price != null ? formatCurrency(item.price) : "Precio no disponible"}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">Detectado {formatDate(item.detectedAt)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 lg:justify-end">
                <Badge variant="outline" className={item.state === "failed" ? "border-destructive/30 text-destructive" : item.state === "ready" ? "border-success/30 text-success" : "border-warning/30 text-warning"}>
                  {item.state === "failed" ? "Falló" : item.state === "ready" ? "Listo" : "Pendiente"}
                </Badge>
                {item.listingUrl && <a href={item.listingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /> Listing</a>}
                <Button size="sm" className="h-8 text-xs" onClick={() => handleMarkOne(item)} disabled={mutation.isPending || item.state === "ready"}>Mark as Sold</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
