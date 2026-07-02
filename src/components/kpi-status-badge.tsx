import { cn } from "@/lib/utils";
import type { KpiStatusValue } from "@/lib/kpi-engine";

const map: Record<KpiStatusValue, { label: string; cls: string }> = {
  green:        { label: "Green",       cls: "bg-[color:var(--kpi-green-bg)] text-[color:var(--kpi-green)] ring-1 ring-[color:var(--kpi-green)]/30" },
  amber:        { label: "Amber",       cls: "bg-[color:var(--kpi-amber-bg)] text-[color:var(--kpi-amber)] ring-1 ring-[color:var(--kpi-amber)]/30" },
  red:          { label: "Red",         cls: "bg-[color:var(--kpi-red-bg)] text-[color:var(--kpi-red)] ring-1 ring-[color:var(--kpi-red)]/30" },
  pending:      { label: "Pending",     cls: "bg-[color:var(--kpi-pending-bg)] text-[color:var(--kpi-pending)] ring-1 ring-[color:var(--kpi-pending)]/30" },
  not_started:  { label: "Not Started", cls: "bg-muted text-muted-foreground ring-1 ring-border" },
};

export function KpiStatusBadge({ status }: { status: KpiStatusValue }) {
  const m = map[status] ?? map.not_started;
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        m.cls,
      )}
    >
      {m.label}
    </span>
  );
}