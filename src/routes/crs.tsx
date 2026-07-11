import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { recalculateForCr } from "@/lib/kpi-engine";
import { aggregateDefectStats } from "@/lib/defect-import";
import { getScopedCrs, getScopedDefects } from "@/lib/scoped-data.functions";
import { getWorkflowStatuses } from "@/lib/workflow-statuses.functions";
import { updateCrWorkflowStatus } from "@/lib/crs-admin.functions";
import { getTestCaseCompletionByCr } from "@/lib/test-cases.functions";
import { useAppUser } from "@/lib/app-user";

export const Route = createFileRoute("/crs")({
  head: () => ({ meta: [{ title: "CR Repository · Kpisavvy" }] }),
  component: CrLayout,
});

function CrLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // If a child route is matched, show only the child.
  if (pathname !== "/crs") return <Outlet />;
  return <CrRepository />;
}

function CrRepository() {
  const { role } = useAppUser();
  const canEditStatus = role === "PMO" || role === "BA" || role === "ITPM";
  const [q, setQ] = useState("");
  const [app, setApp] = useState<string>("__all__");
  const [size, setSize] = useState<string>("__all__");
  const [status, setStatus] = useState<string>("__all__");
  type SortKey = "cr_number" | "date_created" | "date_modified" | "aging_created" | "aging_modified";
  const [sortKey, setSortKey] = useState<SortKey>("date_modified");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ crNumber: string; current: string | null } | null>(null);
  const [newStatusCode, setNewStatusCode] = useState<string>("");

  const wfStatuses = useQuery({
    queryKey: ["workflow-statuses-all"],
    queryFn: () => getWorkflowStatuses(),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ crNumber, code }: { crNumber: string; code: string }) => {
      const s = (wfStatuses.data ?? []).find((w) => w.code === code);
      if (!s) throw new Error("Unknown status");
      await updateCrWorkflowStatus({ data: { crNumber, dbColumn: s.db_column, label: s.label } });
      await recalculateForCr({ data: crNumber });
    },
    onSuccess: () => {
      toast.success("Status updated");
      setEditing(null);
      setNewStatusCode("");
      qc.invalidateQueries({ queryKey: ["crs-list"] });
      qc.invalidateQueries({ queryKey: ["kpi-results"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to update status"),
  });

  const crs = useQuery({
    queryKey: ["crs-list"],
    queryFn: async () =>
      (await getScopedCrs()) as unknown as {
        cr_number: string;
        title: string | null;
        application: string | null;
        severity: string | null;
        workflow_status: string | null;
        cr_size: string | null;
        date_created: string | null;
        date_modified: string | null;
      }[],
  });

  const defectStats = useQuery({
    queryKey: ["defect-stats-by-cr"],
    queryFn: async () => {
      const openDefects = (await getScopedDefects()) as unknown as {
        cr_number: string;
        date_created: string | null;
      }[];
      return aggregateDefectStats(openDefects);
    },
  });

  const testCaseCompletion = useQuery({
    queryKey: ["test-case-completion-by-cr"],
    queryFn: async () => {
      const rows = await getTestCaseCompletionByCr();
      return new Map(rows.map((r) => [r.cr_number, r]));
    },
  });

  const apps = useMemo(() => {
    const s = new Set<string>();
    (crs.data ?? []).forEach((c) => c.application && s.add(c.application));
    return Array.from(s).sort();
  }, [crs.data]);

  const statuses = useMemo(() => {
    const s = new Set<string>();
    (crs.data ?? []).forEach((c) => c.workflow_status && s.add(c.workflow_status));
    return Array.from(s).sort();
  }, [crs.data]);

  const now = Date.now();
  const ageDays = (d: string | null) =>
    d ? Math.floor((now - new Date(d).getTime()) / 86400000) : null;

  const filtered = (crs.data ?? []).filter((c) => {
    if (app !== "__all__" && c.application !== app) return false;
    if (size !== "__all__" && c.cr_size !== size) return false;
    if (status !== "__all__" && c.workflow_status !== status) return false;
    if (q) {
      const t = q.toLowerCase();
      if (
        !c.cr_number.toLowerCase().includes(t) &&
        !(c.title ?? "").toLowerCase().includes(t)
      )
        return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const av =
      sortKey === "cr_number"
        ? a.cr_number
        : sortKey === "date_created" || sortKey === "aging_created"
        ? a.date_created
          ? new Date(a.date_created).getTime()
          : null
        : a.date_modified
        ? new Date(a.date_modified).getTime()
        : null;
    const bv =
      sortKey === "cr_number"
        ? b.cr_number
        : sortKey === "date_created" || sortKey === "aging_created"
        ? b.date_created
          ? new Date(b.date_created).getTime()
          : null
        : b.date_modified
        ? new Date(b.date_modified).getTime()
        : null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };
  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? (
      <ArrowUpDown className="size-3 inline ml-1 opacity-50" />
    ) : sortDir === "asc" ? (
      <ArrowUp className="size-3 inline ml-1" />
    ) : (
      <ArrowDown className="size-3 inline ml-1" />
    );
  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString() : "—";
  const testingPct = (crNumber: string) => {
    const tc = testCaseCompletion.data?.get(crNumber);
    if (!tc || tc.testCaseCount === 0) return "—";
    return `${tc.testedCount}/${tc.testCaseCount} (${Math.round((tc.testedCount / tc.testCaseCount) * 100)}%)`;
  };

  return (
    <AppShell>
      <PageHeader
        title="CR Repository"
        description="Browse all imported Change Requests. Click a CR to view its KPI timeline."
      />
      <PageBody>
        <Card>
          <CardContent className="p-4 flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-64">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by CR number or title"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={app} onValueChange={setApp}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Application" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All applications</SelectItem>
                {apps.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={size} onValueChange={setSize}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Size" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All sizes</SelectItem>
                <SelectItem value="Small">Small</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="Large">Large</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All statuses</SelectItem>
                {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("cr_number")}>
                    CR Number<SortIcon k="cr_number" />
                  </TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Application</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Current Status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("date_created")}>
                    Created On<SortIcon k="date_created" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("date_modified")}>
                    Last Modified<SortIcon k="date_modified" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("aging_created")}>
                    Age (Created)<SortIcon k="aging_created" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("aging_modified")}>
                    Age (Modified)<SortIcon k="aging_modified" />
                  </TableHead>
                  <TableHead className="text-right">Open Defects</TableHead>
                  <TableHead className="text-right">Max Defect Aging</TableHead>
                  <TableHead className="w-32 text-right">Tested</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((c) => {
                  const ac = ageDays(c.date_created);
                  const am = ageDays(c.date_modified);
                  const ds = defectStats.data?.get(c.cr_number);
                  return (
                  <TableRow key={c.cr_number}>
                    <TableCell>
                      <Link
                        to="/crs/$crNumber"
                        params={{ crNumber: c.cr_number }}
                        className="text-primary hover:underline font-medium"
                      >
                        {c.cr_number}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-md truncate">{c.title}</TableCell>
                    <TableCell>{c.application}</TableCell>
                    <TableCell>{c.severity}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.workflow_status}</TableCell>
                    <TableCell>{c.cr_size ?? <span className="text-muted-foreground italic">unset</span>}</TableCell>
                    <TableCell className="text-xs">{fmt(c.date_created)}</TableCell>
                    <TableCell className="text-xs">{fmt(c.date_modified)}</TableCell>
                    <TableCell className="text-right tabular-nums">{ac == null ? "—" : `${ac}d`}</TableCell>
                    <TableCell className="text-right tabular-nums">{am == null ? "—" : `${am}d`}</TableCell>
                    <TableCell className="text-right tabular-nums">{ds?.openCount ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{ds?.maxAgingDays != null ? `${ds.maxAgingDays}d` : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {testingPct(c.cr_number)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEditStatus && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing({ crNumber: c.cr_number, current: c.workflow_status });
                            const match = (wfStatuses.data ?? []).find((w) => w.label === c.workflow_status);
                            setNewStatusCode(match?.code ?? "");
                          }}
                        >
                          <Pencil className="size-3.5 mr-1" /> Update Status
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })}
                {sorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center py-12 text-muted-foreground">
                      No CRs match your filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageBody>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { setEditing(null); setNewStatusCode(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update CR Status</DialogTitle>
            <DialogDescription>
              {editing?.crNumber} — current: <span className="font-medium">{editing?.current ?? "—"}</span>.
              The selected status will be timestamped with the current date &amp; time, and KPIs will be recalculated.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select value={newStatusCode} onValueChange={setNewStatusCode}>
              <SelectTrigger><SelectValue placeholder="Select new status" /></SelectTrigger>
              <SelectContent>
                {(wfStatuses.data ?? []).map((s) => (
                  <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); setNewStatusCode(""); }}>Cancel</Button>
            <Button
              disabled={!newStatusCode || updateStatus.isPending}
              onClick={() => editing && updateStatus.mutate({ crNumber: editing.crNumber, code: newStatusCode })}
            >
              {updateStatus.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}