import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { CalendarClock, UploadCloud, Clock } from "lucide-react";

type ScheduleModalProps = {
  open: boolean;
  onClose: () => void;
  vehicleCount: number;
  onConfirm: (opts: ScheduleOpts) => void;
  isLoading?: boolean;
};

export type ScheduleOpts = {
  publishNow: boolean;
  scheduledAt?: string;
  spacingMinutes: number;
  priority: number;
  notes: string;
};

export function ScheduleModal({ open, onClose, vehicleCount, onConfirm, isLoading }: ScheduleModalProps) {
  const [mode, setMode] = useState<"now" | "later">("now");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [spacing, setSpacing] = useState("30");
  const [priority, setPriority] = useState("50");
  const [notes, setNotes] = useState("");

  const handleConfirm = () => {
    let scheduledAt: string | undefined;
    if (mode === "later" && date) {
      scheduledAt = new Date(`${date}T${time}:00`).toISOString();
    }
    onConfirm({
      publishNow: mode === "now",
      scheduledAt,
      spacingMinutes: Number(spacing),
      priority: Number(priority),
      notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary" />
            Schedule Publishing
          </DialogTitle>
          <DialogDescription>
            {vehicleCount} {vehicleCount === 1 ? "vehicle" : "vehicles"} selected for publishing
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Publish mode */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setMode("now")}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition duration-150 text-sm font-medium ${
                mode === "now"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:border-border"
              }`}
            >
              <UploadCloud className="w-5 h-5" />
              Publish Now
            </button>
            <button
              onClick={() => setMode("later")}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition duration-150 text-sm font-medium ${
                mode === "later"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:border-border"
              }`}
            >
              <Clock className="w-5 h-5" />
              Schedule Later
            </button>
          </div>

          {/* Date / Time — only when scheduling later */}
          {mode === "later" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Publish Date</Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="bg-background/50 border-border/50"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Publish Time</Label>
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="bg-background/50 border-border/50"
                />
              </div>
            </div>
          )}

          {/* Spacing */}
          {vehicleCount > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Spacing Between Posts</Label>
              <Select value={spacing} onValueChange={setSpacing}>
                <SelectTrigger className="bg-background/50 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">No spacing (back to back)</SelectItem>
                  <SelectItem value="15">Every 15 minutes</SelectItem>
                  <SelectItem value="30">Every 30 minutes</SelectItem>
                  <SelectItem value="45">Every 45 minutes</SelectItem>
                  <SelectItem value="60">Every 60 minutes</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Total window: ~{Math.round((vehicleCount - 1) * Number(spacing))} min
              </p>
            </div>
          )}

          {/* Priority */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Priority (0–100)</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="bg-background/50 border-border/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">Low (25)</SelectItem>
                <SelectItem value="50">Normal (50)</SelectItem>
                <SelectItem value="75">High (75)</SelectItem>
                <SelectItem value="100">Urgent (100)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
            <Textarea
              placeholder="e.g. Weekend batch for SUVs..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="bg-background/50 border-border/50 resize-none text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading || (mode === "later" && !date)}
            className="premium-gradient-btn gap-2"
          >
            <UploadCloud className="w-4 h-4" />
            {mode === "now" ? "Queue Now" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
