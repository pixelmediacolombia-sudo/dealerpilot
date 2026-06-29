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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Loader2, Save, Dna, Plus, X } from "lucide-react";

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
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {colors.map((c, i) => (
          <div key={i} className="flex items-center gap-1 rounded-md border border-border p-1 pr-2">
            <input
              type="color"
              value={c}
              onChange={(e) => {
                const next = [...colors];
                next[i] = e.target.value;
                onChange(next);
              }}
              className="h-7 w-7 rounded cursor-pointer border-0 bg-transparent p-0"
              aria-label={`${label} ${i + 1}`}
            />
            <span className="text-xs font-mono text-muted-foreground">{c}</span>
            {colors.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(colors.filter((_, idx) => idx !== i))}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Remove color"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1"
          onClick={() => onChange([...colors, "#888888"])}
        >
          <Plus className="w-3 h-3" /> Add
        </Button>
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
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-6xl mx-auto space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                <Dna className="w-7 h-7 text-primary" /> Dealer Brand DNA
              </h1>
              <p className="text-muted-foreground mt-1">
                Your brand defaults drive every creative generated in the studio.
              </p>
            </div>
            <Button onClick={handleSave} disabled={update.isPending} className="gap-2">
              {update.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Brand DNA
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            {/* Form */}
            <div className="lg:col-span-3 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Colors</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
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
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Style & Defaults</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <Label>Preferred Font</Label>
                    <Select
                      value={form.preferredFont}
                      onValueChange={(v) => set("preferredFont", v)}
                    >
                      <SelectTrigger>
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
                  <div className="space-y-2">
                    <Label>Brand Style</Label>
                    <Select value={form.brandStyle} onValueChange={(v) => set("brandStyle", v)}>
                      <SelectTrigger>
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
                  <div className="space-y-2">
                    <Label>Background Style</Label>
                    <Select
                      value={form.backgroundStyle}
                      onValueChange={(v) => set("backgroundStyle", v)}
                    >
                      <SelectTrigger>
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
                  <div className="space-y-2">
                    <Label>Default Template</Label>
                    <Select
                      value={form.defaultTemplateKey}
                      onValueChange={(v) => set("defaultTemplateKey", v)}
                    >
                      <SelectTrigger>
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
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Logo URL</Label>
                    <Input
                      placeholder="https://..."
                      value={form.logoUrl}
                      onChange={(e) => set("logoUrl", e.target.value)}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Live preview */}
            <div className="lg:col-span-2">
              <div className="sticky top-8 space-y-4">
                <div className="text-sm font-medium text-muted-foreground">Live Preview</div>
                {previewSpec && <CreativePreviewCard spec={previewSpec} format="cover" />}
                {previewSpec && <CreativePreviewCard spec={previewSpec} format="story" />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
