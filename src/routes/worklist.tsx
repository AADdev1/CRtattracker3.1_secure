import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ChevronDown } from "lucide-react";
import { KpiStatusBadge } from "@/components/kpi-status-badge";
import type { KpiStatusValue } from "@/lib/kpi-engine";
import { getScopedKpiResults } from "@/lib/scoped-data.functions";
import { useAppUser } from "@/lib/app-user";

const STATUS_VALUES = ["green", "amber", "red", "pending", "not_started"] as const;

export const Route = createFileRoute("/worklist")({
  head: () => ({ meta: [{ title: "KPI Worklist · Kpisavvy" }] }),
  validateSearch: z.object({
    status: z.union([z.enum(STATUS_VALUES), z.array(z.enum(STATUS_VALUES))]).optional(),
  }).parse,
  component: WorklistPage,
});

interface Row {
  id: string;
  cr_number: string;
  start_date: string | null;
  end_date: string | null;
  working_days: number | null;
  hold_days: number | null;
  effective_days: number | null;
  tat: number | null;
  remaining_days: number | null;
  utilization_pct: number | null;
  status: KpiStatusValue;
  kpis: { id: string; name: string } | null;
  crs: { application: string | null; cr_size: string | null; ba: string | null; itpm: string | null } | null;
}

function WorklistPage() {
  const search = Route.useSearch();
  const { isAdmin } = useAppUser();
  const [kpi, setKpi] = useState<string[]>([]);
  const [app, setApp] = useState<string[]>([]);
  const [size, setSize] = useState<string[]>([]);
  const [ba, setBa] = useState<string[]>([]);
  const [itpm, setItpm] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>(() => {
    const s = search.status;
    if (s == null) return [];
    return Array.isArray(s) ? s : [s];
  });

  const q = useQuery({
    queryKey: ["worklist"],
    queryFn: async () => (await getScopedKpiResults()) as unknown as Row[],
  });

  const rows = q.data ?? [];
  const kpiOpts = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => r.kpis && m.set(r.kpis.id, r.kpis.name));
    return Array.from(m, ([v, l]) => ({ v, l }));
  }, [rows]);
  const appOpts = useMemo(() => uniqueOptions(rows.map((r) => r.crs?.application ?? null)), [rows]);
  const baOpts = useMemo(() => uniqueOptions(rows.map((r) => r.crs?.ba ?? null)), [rows]);
  const itpmOpts = useMemo(() => uniqueOptions(rows.map((r) => r.crs?.itpm ?? null)), [rows]);

  const filtered = rows.filter((r) => {
    if (kpi.length > 0 && (!r.kpis || !kpi.includes(r.kpis.id))) return false;
    if (status.length > 0 && !status.includes(r.status)) return false;
    if (app.length > 0 && (!r.crs?.application || !app.includes(r.crs.application))) return false;
    if (size.length > 0 && (!r.crs?.cr_size || !size.includes(r.crs.cr_size))) return false;
    if (isAdmin && ba.length > 0 && (!r.crs?.ba || !ba.includes(r.crs.ba))) return false;
    if (isAdmin && itpm.length > 0 && (!r.crs?.itpm || !itpm.includes(r.crs.itpm))) return false;
    return true;
  });

  return (
    <AppShell>
      <PageHeader
        title="KPI Worklist"
        description="Operational view of every CR × KPI pair with current health and timing."
      />
      <PageBody>
        <Card>
          <CardContent className="p-4 flex flex-wrap gap-3">
            <MultiSelectFilter label="KPI" values={kpi} onChange={setKpi} options={kpiOpts} placeholder="All KPIs" />
            <MultiSelectFilter
              label="Status"
              values={status}
              onChange={setStatus}
              options={[
                { v: "green", l: "Green" }, { v: "amber", l: "Amber" }, { v: "red", l: "Red" },
                { v: "pending", l: "Pending" }, { v: "not_started", l: "Not Started" },
              ]}
              placeholder="All statuses"
            />
            <MultiSelectFilter label="Application" values={app} onChange={setApp} options={appOpts} placeholder="All apps" />
            <MultiSelectFilter
              label="CR Size"
              values={size}
              onChange={setSize}
              options={[{ v: "Small", l: "Small" }, { v: "Medium", l: "Medium" }, { v: "Large", l: "Large" }]}
              placeholder="All sizes"
            />
            {isAdmin && (
              <>
                <MultiSelectFilter label="BA" values={ba} onChange={setBa} options={baOpts} placeholder="All BAs" />
                <MultiSelectFilter label="ITPM" values={itpm} onChange={setItpm} options={itpmOpts} placeholder="All ITPMs" />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CR</TableHead>
                  <TableHead>KPI</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead className="text-right">Working</TableHead>
                  <TableHead className="text-right">Hold</TableHead>
                  <TableHead className="text-right">Effective</TableHead>
                  <TableHead className="text-right">TAT</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="text-right">Util %</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to="/crs/$crNumber"
                        params={{ crNumber: r.cr_number }}
                        className="text-primary hover:underline font-medium"
                      >
                        {r.cr_number}
                      </Link>
                    </TableCell>
                    <TableCell>{r.kpis?.name}</TableCell>
                    <TableCell>{r.crs?.cr_size ?? "—"}</TableCell>
                    <TableCell className="text-xs">{fmt(r.start_date)}</TableCell>
                    <TableCell className="text-xs">{fmt(r.end_date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.working_days ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.hold_days ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.effective_days ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.tat ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.remaining_days ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.utilization_pct != null ? `${r.utilization_pct.toFixed(0)}%` : "—"}
                    </TableCell>
                    <TableCell><KpiStatusBadge status={r.status} /></TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={12} className="text-center py-12 text-muted-foreground">No KPI results match your filters.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageBody>
    </AppShell>
  );
}

function uniqueOptions(values: (string | null)[]): { v: string; l: string }[] {
  const s = new Set<string>();
  values.forEach((v) => v && s.add(v));
  return Array.from(s).sort().map((v) => ({ v, l: v }));
}

function MultiSelectFilter({
  label, values, onChange, options, placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: { v: string; l: string }[];
  placeholder: string;
}) {
  const toggle = (v: string) => {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-48 justify-between font-normal">
            <span className="truncate">{values.length === 0 ? placeholder : `${values.length} selected`}</span>
            <ChevronDown className="size-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <ScrollArea className="h-56">
            <div className="p-2 space-y-1">
              {options.map((o) => (
                <label
                  key={o.v}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                >
                  <Checkbox checked={values.includes(o.v)} onCheckedChange={() => toggle(o.v)} />
                  <span className="truncate">{o.l}</span>
                </label>
              ))}
              {options.length === 0 && (
                <div className="text-xs text-muted-foreground p-2">No options.</div>
              )}
            </div>
          </ScrollArea>
          {values.length > 0 && (
            <div className="border-t p-2">
              <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>
                Clear
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function fmt(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}
