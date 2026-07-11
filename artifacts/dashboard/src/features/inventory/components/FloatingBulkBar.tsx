import { cn } from "@/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  Wand2,
  UploadCloud,
  Tag,
  Archive,
  CalendarClock,
  CheckCircle2,
  X,
} from "lucide-react";

type FloatingBulkBarProps = {
  count: number;
  onClear: () => void;
  onMarkReady: () => void;
  onGenerateCreative: () => void;
  onSchedule: () => void;
  onMarkSold: () => void;
  onArchive: () => void;
  isLoading?: boolean;
};

export function FloatingBulkBar({
  count,
  onClear,
  onMarkReady,
  onGenerateCreative,
  onSchedule,
  onMarkSold,
  onArchive,
  isLoading,
}: FloatingBulkBarProps) {
  if (count === 0) return null;

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
        "flex items-center gap-2 px-4 py-3 rounded-2xl",
        "bg-card/95 backdrop-blur-xl border border-border/60 shadow-2xl shadow-black/40",
        "animate-in slide-in-from-bottom-4 duration-300",
      )}
    >
      {/* Count pill */}
      <div className="flex items-center gap-2 pr-3 border-r border-border/50 mr-1">
        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[11px] font-bold text-primary-foreground">
          {count}
        </div>
        <span className="text-sm font-medium text-foreground whitespace-nowrap">
          {count === 1 ? "vehicle" : "vehicles"} selected
        </span>
        <button
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground transition-colors ml-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Actions */}
      <Button
        size="sm"
        variant="ghost"
        onClick={onMarkReady}
        disabled={isLoading}
        className="h-8 gap-1.5 text-xs hover:bg-blue-500/10 hover:text-blue-400"
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        Mark Ready
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={onGenerateCreative}
        disabled={isLoading}
        className="h-8 gap-1.5 text-xs hover:bg-primary/10 hover:text-primary"
      >
        <Wand2 className="w-3.5 h-3.5" />
        Generate Creative
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={onSchedule}
        disabled={isLoading}
        className="h-8 gap-1.5 text-xs hover:bg-accent/10 hover:text-accent-foreground"
      >
        <CalendarClock className="w-3.5 h-3.5" />
        Schedule
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={onMarkSold}
        disabled={isLoading}
        className="h-8 gap-1.5 text-xs hover:bg-amber-500/10 hover:text-amber-400"
      >
        <Tag className="w-3.5 h-3.5" />
        Mark Sold
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={onArchive}
        disabled={isLoading}
        className="h-8 gap-1.5 text-xs hover:bg-destructive/10 hover:text-destructive"
      >
        <Archive className="w-3.5 h-3.5" />
        Archive
      </Button>

      <div className="pl-2 border-l border-border/50">
        <Button
          size="sm"
          onClick={onSchedule}
          disabled={isLoading}
          className="h-8 gap-1.5 text-xs premium-gradient-btn"
        >
          <UploadCloud className="w-3.5 h-3.5" />
          Publish Now
        </Button>
      </div>
    </div>
  );
}
