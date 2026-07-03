import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListDealers,
  useGetDealerBrandDna,
  getGetDealerBrandDnaQueryKey,
  useUpdateDealerBrandDna,
  useListCreativeTemplates,
  type DealerBrandDna,
  type CreativeRenderSpec,
} from "@workspace/api-client-react";
import { PageHeader, SectionCard } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { CreativePreviewCard } from "@/components/CreativePreview";
import { Loader2, Save, Dna, Plus, X, Palette, Type, LayoutTemplate } from "lucide-react";

const FONTS = ["Inter", "Poppins", "Montserrat", "Roboto", "Oswald", "Playfair Display"];
const BRAND_STYLES = ["Sport", "Modern", "Luxury", "Aggressive", "Minimal"];
const BACKGROUND_STYLES = ["Dark Studio", "Clean Light", "Showroom", "Outdoor"];

function withValue(options: string[], value: string): string[] {
  return value && !options.includes(value) ? [value, ...options] : options;
}

interface DnaForm {
  primaryColors: string[];
  secondaryColors: string[];
  accentColors: string[];
  logoUrl: string;
  preferredFont: string;
  brandStyle: string;
  backgroundStyle: string;
  defaultTemplateKey: string;
}

function toForm(dna: DealerBrandDna): DnaForm {
  return {
    primaryColors: dna.primaryColors.length ? dna.primaryColors : ["#1d4ed8"],
    secondaryColors: dna.secondaryColors.length ? dna.secondaryColors : ["#1e293b"],
    accentColors: dna.accentColors.length ? dna.accentColors : ["#f59e0b"],
    logoUrl: dna.logoUrl ?? "",
    preferredFont: dna.preferredFont,
    brandStyle: dna.brandStyle,
    backgroundStyle: dna.backgroundStyle,
    defaultTemplateKey: dna.defaultTemplateKey,
  };
}

function ColorList({
  label,
  colors,
  onChange,
}: {
  label: string;
  colors: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-4">
      <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</Label>
      <div className="flex flex-wrap gap-3">
        {colors.map((c, i) => (
          <div key={i} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-1.5 pr-3 shadow-sm transition-all hover:border-primary/50 group">
            <div className="relative overflow-hidden rounded-lg">
              <input
                type="color"
                value={c}
                onChange={(e) => {
                  const next = [...colors];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                className="h-10 w-10 cursor-pointer appearance-none rounded-lg border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0"
                aria-label={`${label} ${i + 1}`}
              />
            </div>
            <span className="text-xs font-mono font-bold text-foreground/80 uppercase tracking-wider">{c}</span>
            {colors.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(colors.filter((_, idx) => idx !== i))}
                className="text-muted-foreground/50 hover:text-destructive transition-colors ml-1 opacity-0 group-hover:opacity-100"
                aria-label="Remove color"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        {colors.length < 3 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-[52px] rounded-xl border-dashed border-white/20 gap-2 hover:border-primary hover:text-primary transition-colors text-[10px] font-bold uppercase tracking-widest"
            onClick={() => onChange([...colors, "#888888"])}
          >
            <Plus className="w-4 h-4" /> Add
          </Button>
        )}
      </div>
    </div>
  );
}

export function DealerDna() {
  const queryClient = useQueryClient();
  const { data: dealersData } = useListDealers();
  const dealerId = dealersData?.dealers[0]?.id;

  const { data: dna, isLoading } = useGetDealerBrandDna(dealerId!, {
    query: {
      queryKey: getGetDealerBrandDnaQueryKey(dealerId!),
      enabled: !!dealerId,
    },
  });

  const { data: templatesData } = useListCreativeTemplates();
  const templates = templatesData?.templates ?? [];

  const [form, setForm] = useState<DnaForm | null>(null);

  useEffect(() => {
    if (dna && !form) setForm(toForm(dna));
  }, [dna, form]);

  const update = useUpdateDealerBrandDna({
    mutation: {
      onSuccess: () => {
        if (dealerId) {
          queryClient.invalidateQueries({ queryKey: getGetDealerBrandDnaQueryKey(dealerId) });
        }
        toast({ title: "DealerPilot saved DNA", description: "Your creative defaults were successfully updated." });
      },
      onError: (err) =>
        toast({ title: "Save failed", description: err.message, variant: "destructive" }),
    },
  });

  const previewSpec: CreativeRenderSpec | null = useMemo(() => {
    if (!form) return null;
    return {
      template: form.defaultTemplateKey,
      brandStyle: form.brandStyle,
      backgroundStyle: form.backgroundStyle,
      colors: {
        primary: form.primaryColors[0] ?? "#1d4ed8",
        secondary: form.secondaryColors[0] ?? "#1e293b",
        accent: form.accentColors[0] ?? "#f59e0b",
      },
      font: form.preferredFont,
      dealerName: dealersData?.dealers[0]?.name ?? "Your Dealership",
      logoUrl: form.logoUrl || null,
      vehicleImageUrl: null,
      headline: "Your Vehicle Listing",
      subline: "Great condition • Competitive price • Ready today",
      price: "$32,995",
      cta: "Message for a Test Drive",
      steps: [],
    };
  }, [form, dealersData]);

  const set = <K extends keyof DnaForm>(key: K, value: DnaForm[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const handleSave = () => {
    if (!dealerId || !form) return;
    update.mutate({
      dealerId,
      data: {
        primaryColors: form.primaryColors,
        secondaryColors: form.secondaryColors,
        accentColors: form.accentColors,
        logoUrl: form.logoUrl || null,
        preferredFont: form.preferredFont,
        brandStyle: form.brandStyle,
        backgroundStyle: form.backgroundStyle,
        defaultTemplateKey: form.defaultTemplateKey,
      },
    });
  };

  if (isLoading || !form) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
             <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
             <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">DealerPilot is loading DNA...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="p-8 max-w-7xl mx-auto w-full flex-1 overflow-y-auto animate-in fade-in duration-500">
          <PageHeader
            eyebrow="Dealer DNA"
            title={<>Dealer <span className="text-orange-400">DNA</span></>}
            description="Brand defaults that drive every creative DealerPilot generates."
            icon={Dna}
            action={
              <Button onClick={handleSave} disabled={update.isPending} className="gap-2 h-11 px-6 rounded-xl font-bold text-[11px] uppercase tracking-widest premium-gradient-btn shadow-lg">
                {update.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save Brand DNA
              </Button>
            }
          />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-10 items-start pt-6 pb-20">
            {/* Form */}
            <div className="space-y-8">
              
              <SectionCard 
                title={<span className="font-bold tracking-tight text-xl">Brand Colors</span>}
                description="The colors DealerPilot uses to tint overlays and text in every creative."
                icon={Palette}
                className="border-white/5 bg-card/40 backdrop-blur-md"
              >
                <div className="space-y-8 mt-2">
                  <ColorList
                    label="Primary Colors"
                    colors={form.primaryColors}
                    onChange={(c) => set("primaryColors", c)}
                  />
                  <ColorList
                    label="Secondary Colors"
                    colors={form.secondaryColors}
                    onChange={(c) => set("secondaryColors", c)}
                  />
                  <ColorList
                    label="Accent Colors"
                    colors={form.accentColors}
                    onChange={(c) => set("accentColors", c)}
                  />
                </div>
              </SectionCard>

              <SectionCard
                title={<span className="font-bold tracking-tight text-xl">Store Identity</span>}
                description="Font and logo DealerPilot applies to your creatives."
                icon={Type}
                className="border-white/5 bg-card/40 backdrop-blur-md"
              >
                <div className="space-y-8 mt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                    <div className="space-y-3">
                      <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Preferred Font</Label>
                      <Select
                        value={form.preferredFont}
                        onValueChange={(v) => set("preferredFont", v)}
                      >
                        <SelectTrigger className="h-12 bg-black/20 border-white/10 rounded-xl font-medium">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {withValue(FONTS, form.preferredFont).map((f) => (
                            <SelectItem key={f} value={f}>
                              {f}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Logo URL</Label>
                    <Input
                      placeholder="https://example.com/logo.png"
                      value={form.logoUrl}
                      onChange={(e) => set("logoUrl", e.target.value)}
                      className="h-12 bg-black/20 border-white/10 rounded-xl font-mono text-sm"
                    />
                    <p className="text-[11px] font-medium text-muted-foreground/60">Used as a fallback if DealerPilot doesn't have a vehicle-specific logo.</p>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title={<span className="font-bold tracking-tight text-xl">Offer Rules</span>}
                description="Default style and layout DealerPilot uses for new creatives."
                icon={LayoutTemplate}
                className="border-white/5 bg-card/40 backdrop-blur-md"
              >
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mt-2">
                    <div className="space-y-3">
                      <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Brand Style</Label>
                      <Select value={form.brandStyle} onValueChange={(v) => set("brandStyle", v)}>
                        <SelectTrigger className="h-12 bg-black/20 border-white/10 rounded-xl font-medium">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {withValue(BRAND_STYLES, form.brandStyle).map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-3">
                      <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Background Style</Label>
                      <Select
                        value={form.backgroundStyle}
                        onValueChange={(v) => set("backgroundStyle", v)}
                      >
                        <SelectTrigger className="h-12 bg-black/20 border-white/10 rounded-xl font-medium">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {withValue(BACKGROUND_STYLES, form.backgroundStyle).map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-3 sm:col-span-2">
                      <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Default Template</Label>
                      <Select
                        value={form.defaultTemplateKey}
                        onValueChange={(v) => set("defaultTemplateKey", v)}
                      >
                        <SelectTrigger className="h-12 bg-black/20 border-white/10 rounded-xl font-medium">
                          <SelectValue placeholder="Select template" />
                        </SelectTrigger>
                        <SelectContent>
                          {templates.map((t) => (
                            <SelectItem key={t.key} value={t.key}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
              </SectionCard>

            </div>

            {/* Live preview */}
            <div>
              <div className="sticky top-8 space-y-6 glass-panel p-8 rounded-3xl border border-orange-500/15 bg-orange-500/[0.03] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2 text-orange-400 mb-1">
                    <div className="w-2 h-2 rounded-full bg-orange-400 animate-ping" /> Live Preview
                  </h3>
                  <p className="text-sm font-medium text-foreground/60 tracking-tight">Updates as you edit</p>
                </div>
                
                <div className="space-y-8 mt-6">
                  {previewSpec && <CreativePreviewCard spec={previewSpec} format="cover" />}
                  {previewSpec && <CreativePreviewCard spec={previewSpec} format="story" />}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
