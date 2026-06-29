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
    <div className="space-y-3">
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      <div className="flex flex-wrap gap-3">
        {colors.map((c, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-background p-1 pr-2 shadow-sm transition-all hover:border-primary/50">
            <div className="relative overflow-hidden rounded-md">
              <input
                type="color"
                value={c}
                onChange={(e) => {
                  const next = [...colors];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                className="h-8 w-8 cursor-pointer appearance-none rounded-md border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0"
                aria-label={`${label} ${i + 1}`}
              />
            </div>
            <span className="text-xs font-mono text-muted-foreground uppercase">{c}</span>
            {colors.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(colors.filter((_, idx) => idx !== i))}
                className="text-muted-foreground hover:text-destructive transition-colors ml-1"
                aria-label="Remove color"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        {colors.length < 3 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-[42px] border-dashed gap-1 hover:border-primary hover:text-primary transition-colors"
            onClick={() => onChange([...colors, "#888888"])}
          >
            <Plus className="w-3.5 h-3.5" />
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
        toast({ title: "Brand DNA saved", description: "Your creative defaults were updated." });
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
      headline: "2024 Sample Model GT",
      subline: "Low miles • Certified • Financing available",
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
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="p-8 max-w-7xl mx-auto w-full flex-1 overflow-y-auto">
          <PageHeader
            title="Dealer Brand DNA"
            description="Your brand defaults drive every creative generated in the studio."
            icon={Dna}
            action={
              <Button onClick={handleSave} disabled={update.isPending} className="gap-2 premium-gradient-btn">
                {update.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save Brand DNA
              </Button>
            }
          />

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-8 items-start pb-20">
            {/* Form */}
            <div className="xl:col-span-3 space-y-6">
              
              <SectionCard 
                title="Color Palette" 
                description="The core colors that define your brand identity across all touchpoints."
                icon={Palette}
              >
                <div className="space-y-8">
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
                title="Typography & Assets"
                description="Font choices and logos used in generated creatives."
                icon={Type}
              >
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <Label>Preferred Font</Label>
                      <Select
                        value={form.preferredFont}
                        onValueChange={(v) => set("preferredFont", v)}
                      >
                        <SelectTrigger className="h-10 bg-background">
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
                    <Label>Logo URL</Label>
                    <Input
                      placeholder="https://example.com/logo.png"
                      value={form.logoUrl}
                      onChange={(e) => set("logoUrl", e.target.value)}
                      className="bg-background font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">Used as a fallback if a vehicle-specific overlay logo isn't provided.</p>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="Creative Defaults"
                description="Base styles and templates for new studio variations."
                icon={LayoutTemplate}
              >
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <Label>Brand Style</Label>
                      <Select value={form.brandStyle} onValueChange={(v) => set("brandStyle", v)}>
                        <SelectTrigger className="h-10 bg-background">
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
                      <Label>Background Style</Label>
                      <Select
                        value={form.backgroundStyle}
                        onValueChange={(v) => set("backgroundStyle", v)}
                      >
                        <SelectTrigger className="h-10 bg-background">
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
                      <Label>Default Template</Label>
                      <Select
                        value={form.defaultTemplateKey}
                        onValueChange={(v) => set("defaultTemplateKey", v)}
                      >
                        <SelectTrigger className="h-10 bg-background">
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
            <div className="xl:col-span-2">
              <div className="sticky top-8 space-y-6">
                <div>
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-success animate-pulse" /> Live Preview
                  </h3>
                  <p className="text-sm text-muted-foreground">Changes reflect instantly below</p>
                </div>
                
                <div className="space-y-6 p-6 rounded-xl border border-border/50 bg-secondary/20">
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
