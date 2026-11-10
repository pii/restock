import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATUS_TEXT, STATUS_TONE, type StatusTone, type StockStatus } from "@/lib/status";

const TONE: Record<StatusTone, { badge: string; dot: string }> = {
  good: { badge: "border-status-good/25 bg-status-good-bg text-status-good", dot: "bg-status-good" },
  warn: { badge: "border-status-warn/25 bg-status-warn-bg text-status-warn", dot: "bg-status-warn" },
  wait: { badge: "border-status-wait/25 bg-status-wait-bg text-status-wait", dot: "bg-status-wait" },
  bad: { badge: "border-status-bad/25 bg-status-bad-bg text-status-bad", dot: "bg-status-bad" },
  none: { badge: "border-border bg-status-none-bg text-status-none", dot: "bg-status-none" },
};

export function statusDot(status: StockStatus) {
  return TONE[STATUS_TONE[status]].dot;
}

export function StatusBadge({
  status,
  label,
  paused = false,
  className,
}: {
  status: StockStatus;
  /** The store's own wording, shown as a tooltip. */
  label?: string | null;
  paused?: boolean;
  className?: string;
}) {
  const tone = paused ? TONE.none : TONE[STATUS_TONE[status]];
  return (
    <Badge variant="outline" title={label ?? undefined} className={cn("gap-1.5 font-medium", tone.badge, className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", tone.dot)} />
      {paused ? "Paused" : STATUS_TEXT[status]}
    </Badge>
  );
}
