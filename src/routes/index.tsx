import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { RefreshKpiButton } from "@/components/refresh-kpi-button";
import { KpiStatusBadge } from "@/components/kpi-status-badge";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, CircleCheck, CircleAlert, Database, Ruler, Bug, Clock } from "lucide-react";
import type { KpiStatusValue } from "@/lib/kpi-engine";
import { aggregateDefectStats } from "@/lib/defect-import";
import { getScopedCrs, getScopedKpiResults, getScopedDefects } from "@/lib/scoped-data.functions";
import { useAppUser } from "@/lib/app-user";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard · Kpisavvy" }] }),
  component: Dashboard,
});

interface ResultRow {
  id: string;
  cr_number: string;
  status: KpiStatusValue;
  effective_days: number | null;
  tat: number | null;
  remaining_days: number | null;
  utilization_pct: number | null;
  kpis: { name: string; role: string } | null;
  crs: { application: string | null; cr_size: string | null } | null;
}

interface CrListRow {
  cr_number: string;
  application: string | null;
  cr_size: string | null;
  ba: string | null;
  itpm: string | null;
}

function Dashboard() {
  const { isAdmin } = useAppUser();
  const [userFilter, setUserFilter] = useState("__all__");
  const [appFilter, setAppFilter] = useState("__all__");

  const raw = useQuery({
    queryKey: ["dashboard-raw"],
    queryFn: async () => {
      const [crs, results, openDefectsList] = await Promise.all([
        getScopedCrs(),
        getScopedKpiResults(),
        getScopedDefects(),
      ]);
      return {
        crList: crs as unknown as CrListRow[],
        allResults: results as unknown as ResultRow[],
        openDefectsList: openDefectsList as unknown as { cr_number: string; date_created: string | null }[],
      };
    },
  });

  const userOpts = useMemo(() => {
    const set = new Set<string>();
    (raw.data?.crList ?? []).forEach((c) => {
      if (c.ba) set.add(c.ba);
      if (c.itpm) set.add(c.itpm);
    });
    return Array.from(set).sort();
  }, [raw.data]);

  const appOpts = useMemo(() => {
    const set = new Set<string>();
    (raw.data?.crList ?? []).forEach((c) => c.application && set.add(c.application));
    return Array.from(set).sort();
  }, [raw.data]);

  const s = useMemo(() => {
    if (!raw.data) return undefined;
    const matches = (c: CrListRow) => {
      if (userFilter !== "__all__" && c.ba !== userFilter && c.itpm !== userFilter) return false;
      if (appFilter !== "__all__" && c.application !== appFilter) return false;
      return true;
    };
    const crList = raw.data.crList.filter(matches);

    // getScopedKpiResults()/getScopedDefects() hand Admin every role/CR
    // unfiltered — narrowing to a specific user here has to redo the same
    // per-CR role/relation restriction that non-admin sessions get for
    // free (BA-only -> BA KPIs & no defects, ITPM-only -> ITPM KPIs +
    // defects, both -> everything), otherwise the "User" filter only
    // narrows which CRs show up, not which role's data shows for them.
    type Relation = "ba" | "itpm" | "both";
    const relationByCr = new Map<string, Relation>();
    if (userFilter !== "__all__") {
      for (const c of crList) {
        const isBa = c.ba === userFilter;
        const isItpm = c.itpm === userFilter;
        if (isBa && isItpm) relationByCr.set(c.cr_number, "both");
        else if (isBa) relationByCr.set(c.cr_number, "ba");
        else if (isItpm) relationByCr.set(c.cr_number, "itpm");
      }
    }

    const crNumbers = new Set(crList.map((c) => c.cr_number));
    const allResults = raw.data.allResults.filter((r) => {
      if (!crNumbers.has(r.cr_number)) return false;
      const relation = relationByCr.get(r.cr_number);
      if (!relation || relation === "both") return true;
      return r.kpis?.role === (relation === "ba" ? "BA" : "ITPM");
    });
    const openDefectsList = raw.data.openDefectsList.filter((d) => {
      if (!crNumbers.has(d.cr_number)) return false;
      const relation = relationByCr.get(d.cr_number);
      if (!relation) return true;
      return relation === "itpm" || relation === "both";
    });

    const defectStats = aggregateDefectStats(openDefectsList);
    const counts = { green: 0, amber: 0, red: 0, pending: 0, not_started: 0 };
    for (const r of allResults) counts[r.status]++;
    const nearBreach = allResults
      .filter((r) => r.status === "amber")
      .sort((a, b) => (b.utilization_pct ?? 0) - (a.utilization_pct ?? 0))
      .slice(0, 10);
    const breached = allResults
      .filter((r) => r.status === "red")
      .sort((a, b) => (b.utilization_pct ?? 0) - (a.utilization_pct ?? 0))
      .slice(0, 10);
    const pendingSize = crList.filter((c) => !c.cr_size).length;
    let openDefects = 0;
    let maxAging = 0;
    for (const v of defectStats.values()) {
      openDefects += v.openCount;
      if (v.maxAgingDays != null && v.maxAgingDays > maxAging) maxAging = v.maxAgingDays;
    }
    return {
      activeCrs: crList.length,
      pendingSize,
      counts,
      nearBreach,
      breached,
      openDefects,
      maxAging,
    };
  }, [raw.data, userFilter, appFilter]);

  return (
    <AppShell>
      <PageHeader
        title="Dashboard"
        description="Live KPI health across all Change Requests."
        actions={<RefreshKpiButton />}
      />
      <PageBody>
        {isAdmin && (
          <Card>
            <CardContent className="p-4 flex flex-wrap gap-3">
              <Filter
                label="User"
                value={userFilter}
                setValue={setUserFilter}
                options={[{ v: "__all__", l: "All users" }, ...userOpts.map((u) => ({ v: u, l: u }))]}
              />
              <Filter
                label="Application"
                value={appFilter}
                setValue={setAppFilter}
                options={[{ v: "__all__", l: "All applications" }, ...appOpts.map((a) => ({ v: a, l: a }))]}
              />
            </CardContent>
          </Card>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Active CRs" value={s?.activeCrs ?? 0} icon={<Database className="size-4" />} to="/crs" />
          <StatCard
            label="Pending CR Size"
            value={s?.pendingSize ?? 0}
            icon={<Ruler className="size-4" />}
            tone={s?.pendingSize ? "amber" : "muted"}
            to="/cr-sizes"
          />
          <StatCard label="Green KPIs" value={s?.counts.green ?? 0} icon={<CircleCheck className="size-4" />} tone="green" to="/worklist" search={{ status: "green" }} />
          <StatCard label="Amber KPIs" value={s?.counts.amber ?? 0} icon={<CircleAlert className="size-4" />} tone="amber" to="/worklist" search={{ status: "amber" }} />
          <StatCard label="Red KPIs" value={s?.counts.red ?? 0} icon={<AlertTriangle className="size-4" />} tone="red" to="/worklist" search={{ status: "red" }} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard
            label="Open Defects"
            value={s?.openDefects ?? 0}
            icon={<Bug className="size-4" />}
            tone={s?.openDefects ? "amber" : "muted"}
            to="/crs"
          />
          <StatCard
            label="Max Open Defect Aging (days)"
            value={s?.maxAging ?? 0}
            icon={<Clock className="size-4" />}
            tone={(s?.maxAging ?? 0) > 30 ? "red" : (s?.maxAging ?? 0) > 0 ? "amber" : "muted"}
            to="/crs"
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <KpiTable title="Near Breach KPIs" rows={s?.nearBreach ?? []} emptyText="No KPIs near breach." />
          <KpiTable title="Breached KPIs" rows={s?.breached ?? []} emptyText="No breached KPIs." />
        </div>
      </PageBody>
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone = "default",
  to,
  search,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "default" | "green" | "amber" | "red" | "muted";
  to?: string;
  search?: Record<string, string>;
}) {
  const toneCls: Record<string, string> = {
    default: "bg-card",
    green: "bg-[color:var(--kpi-green-bg)]",
    amber: "bg-[color:var(--kpi-amber-bg)]",
    red: "bg-[color:var(--kpi-red-bg)]",
    muted: "bg-muted",
  };
  const valueCls: Record<string, string> = {
    default: "text-foreground",
    green: "text-[color:var(--kpi-green)]",
    amber: "text-[color:var(--kpi-amber)]",
    red: "text-[color:var(--kpi-red)]",
    muted: "text-foreground",
  };
  const content = (
    <Card className={cn("transition-all duration-200 hover:shadow-md hover:-translate-y-0.5", toneCls[tone], to && "cursor-pointer")}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-semibold ${valueCls[tone]}`}>{value}</div>
      </CardContent>
    </Card>
  );
  if (to) {
    return (
      <Link to={to} search={search as never} className="block no-underline">
        {content}
      </Link>
    );
  }
  return content;
}

function Filter({
  label, value, setValue, options,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function KpiTable({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: ResultRow[];
  emptyText: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">{emptyText}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CR</TableHead>
                <TableHead>KPI</TableHead>
                <TableHead>App</TableHead>
                <TableHead className="text-right">Eff / TAT</TableHead>
                <TableHead className="text-right">Util %</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
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
                  <TableCell>{r.kpis?.name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.crs?.application ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.effective_days ?? "—"} / {r.tat ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.utilization_pct != null ? `${r.utilization_pct.toFixed(0)}%` : "—"}
                  </TableCell>
                  <TableCell><KpiStatusBadge status={r.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
