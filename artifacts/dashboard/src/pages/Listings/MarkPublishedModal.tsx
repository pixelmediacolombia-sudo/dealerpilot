import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CheckCircle2, ExternalLink } from "lucide-react";

type MarkPublishedModalProps = {
  open: boolean;
  onClose: () => void;
  vehicleLabel: string;
  onConfirm: (marketplaceUrl?: string) => void;
  isLoading?: boolean;
};

export function MarkPublishedModal({
  open,
  onClose,
  vehicleLabel,
  onConfirm,
  isLoading,
}: MarkPublishedModalProps) {
  const [url, setUrl] = useState("");

  const handleConfirm = () => {
    onConfirm(url.trim() || undefined);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-success" />
            Mark as Published
          </DialogTitle>
          <DialogDescription>
            Confirm that <strong>{vehicleLabel}</strong> has been published on Facebook Marketplace.
            Paste the listing URL so DealerPilot can track engagement.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ExternalLink className="w-3.5 h-3.5" />
              Marketplace URL (optional but recommended)
            </Label>
            <Input
              placeholder="https://www.facebook.com/marketplace/item/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="bg-background/50 border-border/50 text-sm font-mono"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            DealerPilot will use this URL to track views, messages, and engagement from the listing.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading}
            className="gap-2 bg-success/90 hover:bg-success text-success-foreground border-0"
          >
            <CheckCircle2 className="w-4 h-4" />
            Mark Published
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
