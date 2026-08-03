import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useMemo } from "react";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Pencil, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { recalculateForCr } from "@/lib/kpi-engine";
import { aggregateDefectStats } from "@/lib/defect-import";
import { getScopedCrs, getScopedDefects } from "@/lib/scoped-data.functions";
import { getWorkflowStatuses } from "@/lib/workflow-statuses.functions";
import { updateCrWorkflowStatus } from "@/lib/crs-admin.functions";
import { addCrUpdate, listUpdatesByCr } from "@/lib/cr-updates.functions";
import { getTestCaseCompletionByCr } from "@/lib/test-cases.functions";
import {
  DEPLOYMENT_TERMINAL_WORKFLOW_STATUSES,
  getDeploymentInfoByCr,
  MANUAL_DEPLOYMENT_STAGES,
  updateDeploymentStage,
  type DeploymentStage,
} from "@/lib/deployment.functions";
import { DeploymentStageBadge } from "@/components/deployment-stage-badge";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import { useAppUser } from "@/lib/app-user";
import { FEATURES } from "@/lib/release-config";

export const Route = createFileRoute("/crs")({
  head: () => ({ meta: [{ title: "CR Repository · Kpisavvy" }] }),
  component: CrLayout,
});

function CrLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { role, isAdmin, isLoading } = useAppUser();
  const navigate = useNavigate();
  // No role and not Admin = no legitimate use for this screen (or the CR
  // Detail page nested under it) — matches the server-side
  // assertHasRoleOrAdmin() gate on getScopedCrs/getDeploymentInfoByCr/etc.
  const blocked = !isLoading && !isAdmin && role == null;

  useEffect(() => {
    if (blocked) navigate({ to: "/" });
  }, [blocked, navigate]);

  if (isLoading || blocked) return null;
  // If a child route is matched, show only the child.
  if (pathname !== "/crs") return <Outlet />;
  return <CrRepository />;
}

function CrRepository() {
  const { role } = useAppUser();
  const canEditStatus = role === "PMO" || role === "BA" || role === "ITPM";
  const [q, setQ] = useState("");
  const [app, setApp] = useState<string[]>([]);
  const [size, setSize] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  type SortKey =
    | "cr_number"
    | "title"
    | "application"
    | "severity"
    | "workflow_status"
    | "cr_size"
    | "date_created"
    | "date_modified"
    | "aging_created"
    | "aging_modified"
    | "open_defects"
    | "max_defect_aging"
    | "tested_pct"
    | "planned_deployment_date"
    | "deployment_stage";
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

  const updateStage = useMutation({
    mutationFn: (v: { crNumber: string; stage: DeploymentStage }) =>
      updateDeploymentStage({ data: v }),
    onSuccess: () => {
      toast.success("Deployment stage updated");
      qc.invalidateQueries({ queryKey: ["deployment-info-by-cr"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
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

  // CR Testing Progress is Release 2 (Testing Governance) scope — don't
  // even fire the request when that release isn't enabled, matching the
  // server-side assertFeatureEnabled("testing") gate on this function.
  const testCaseCompletion = useQuery({
    queryKey: ["test-case-completion-by-cr"],
    queryFn: async () => {
      const rows = await getTestCaseCompletionByCr();
      return new Map(rows.map((r) => [r.cr_number, r]));
    },
    enabled: FEATURES.testing,
  });

  // Deployment Status Tracking is Release 3 scope — same reasoning, matches
  // assertFeatureEnabled("deployment") on getDeploymentInfoByCr.
  const deploymentInfo = useQuery({
    queryKey: ["deployment-info-by-cr"],
    queryFn: async () => {
      const rows = await getDeploymentInfoByCr();
      return new Map(rows.map((r) => [r.cr_number, r]));
    },
    enabled: FEATURES.deployment,
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
    if (app.length > 0 && (!c.application || !app.includes(c.application))) return false;
    if (size.length > 0 && (!c.cr_size || !size.includes(c.cr_size))) return false;
    if (status.length > 0 && (!c.workflow_status || !status.includes(c.workflow_status)))
      return false;
    if (q) {
      const t = q.toLowerCase();
      if (!c.cr_number.toLowerCase().includes(t) && !(c.title ?? "").toLowerCase().includes(t))
        return false;
    }
    return true;
  });

  function getSortValue(c: (typeof filtered)[number], key: SortKey): string | number | null {
    switch (key) {
      case "cr_number":
        return c.cr_number;
      case "title":
        return c.title;
      case "application":
        return c.application;
      case "severity":
        return c.severity;
      case "workflow_status":
        return c.workflow_status;
      case "cr_size":
        return c.cr_size;
      case "date_created":
        return c.date_created ? new Date(c.date_created).getTime() : null;
      case "date_modified":
        return c.date_modified ? new Date(c.date_modified).getTime() : null;
      case "aging_created":
        return ageDays(c.date_created);
      case "aging_modified":
        return ageDays(c.date_modified);
      case "open_defects":
        return defectStats.data?.get(c.cr_number)?.openCount ?? 0;
      case "max_defect_aging":
        return defectStats.data?.get(c.cr_number)?.maxAgingDays ?? null;
      case "tested_pct": {
        const tc = testCaseCompletion.data?.get(c.cr_number);
        if (!tc || tc.testCaseCount === 0) return null;
        return tc.testedCount / tc.testCaseCount;
      }
      case "planned_deployment_date": {
        const d = deploymentInfo.data?.get(c.cr_number)?.planned_deployment_date;
        return d ? new Date(d).getTime() : null;
      }
      case "deployment_stage":
        return deploymentInfo.data?.get(c.cr_number)?.deployment_stage ?? null;
    }
  }

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const av = getSortValue(a, sortKey);
    const bv = getSortValue(b, sortKey);
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
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");
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
            <MultiSelectFilter
              label="Application"
              values={app}
              onChange={setApp}
              options={apps.map((a) => ({ v: a, l: a }))}
              placeholder="All applications"
              triggerClassName="w-48"
            />
            <MultiSelectFilter
              label="Size"
              values={size}
              onChange={setSize}
              options={[
                { v: "Small", l: "Small" },
                { v: "Medium", l: "Medium" },
                { v: "Large", l: "Large" },
              ]}
              placeholder="All sizes"
              triggerClassName="w-40"
            />
            <MultiSelectFilter
              label="Status"
              values={status}
              onChange={setStatus}
              options={statuses.map((s) => ({ v: s, l: s }))}
              placeholder="All statuses"
              triggerClassName="w-64"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer select-none sticky left-0 z-20 w-[110px] min-w-[110px] bg-card"
                    onClick={() => toggleSort("cr_number")}
                  >
                    CR Number
                    <SortIcon k="cr_number" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none sticky left-[110px] z-20 w-[440px] min-w-[440px] bg-card border-r"
                    onClick={() => toggleSort("title")}
                  >
                    Title
                    <SortIcon k="title" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("application")}
                  >
                    Application
                    <SortIcon k="application" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("severity")}
                  >
                    Severity
                    <SortIcon k="severity" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("workflow_status")}
                  >
                    Current Status
                    <SortIcon k="workflow_status" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("cr_size")}
                  >
                    Size
                    <SortIcon k="cr_size" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("date_created")}
                  >
                    Created On
                    <SortIcon k="date_created" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("date_modified")}
                  >
                    Last Modified
                    <SortIcon k="date_modified" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("aging_created")}
                  >
                    Age (Created)
                    <SortIcon k="aging_created" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("aging_modified")}
                  >
                    Age (Modified)
                    <SortIcon k="aging_modified" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("open_defects")}
                  >
                    Open Defects
                    <SortIcon k="open_defects" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("max_defect_aging")}
                  >
                    Max Defect Aging
                    <SortIcon k="max_defect_aging" />
                  </TableHead>
                  {FEATURES.testing && (
                    <TableHead
                      className="w-32 cursor-pointer select-none text-right"
                      onClick={() => toggleSort("tested_pct")}
                    >
                      Tested
                      <SortIcon k="tested_pct" />
                    </TableHead>
                  )}
                  {FEATURES.deployment && (
                    <>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => toggleSort("planned_deployment_date")}
                      >
                        Planned Deployment Date
                        <SortIcon k="planned_deployment_date" />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => toggleSort("deployment_stage")}
                      >
                        Deployment Stage
                        <SortIcon k="deployment_stage" />
                      </TableHead>
                    </>
                  )}
                  <TableHead className="w-56">Updates</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((c) => {
                  const ac = ageDays(c.date_created);
                  const am = ageDays(c.date_modified);
                  const ds = defectStats.data?.get(c.cr_number);
                  const dep = deploymentInfo.data?.get(c.cr_number);
                  // Trust workflow_status as a safety net — a CR can reach these
                  // CMS-reported terminal statuses from CSV import before/without
                  // deployment_stage having been separately synced to match.
                  const isDeployedToProduction =
                    dep?.deployment_stage === "Deployed to Production" ||
                    (!!c.workflow_status &&
                      DEPLOYMENT_TERMINAL_WORKFLOW_STATUSES.has(c.workflow_status));
                  return (
                    <TableRow key={c.cr_number}>
                      <TableCell className="sticky left-0 z-10 w-[110px] min-w-[110px] bg-card">
                        <Link
                          to="/crs/$crNumber"
                          params={{ crNumber: c.cr_number }}
                          className="text-primary hover:underline font-medium"
                        >
                          {c.cr_number}
                        </Link>
                      </TableCell>
                      <TableCell className="sticky left-[110px] z-10 w-[440px] min-w-[440px] bg-card border-r whitespace-normal break-words align-top">
                        {c.title}
                      </TableCell>
                      <TableCell>{c.application}</TableCell>
                      <TableCell>{c.severity}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.workflow_status}
                      </TableCell>
                      <TableCell>
                        {c.cr_size ?? <span className="text-muted-foreground italic">unset</span>}
                      </TableCell>
                      <TableCell className="text-xs">{fmt(c.date_created)}</TableCell>
                      <TableCell className="text-xs">{fmt(c.date_modified)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {ac == null ? "—" : `${ac}d`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {am == null ? "—" : `${am}d`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {ds?.openCount ?? 0}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {ds?.maxAgingDays != null ? `${ds.maxAgingDays}d` : "—"}
                      </TableCell>
                      {FEATURES.testing && (
                        <TableCell className="text-right tabular-nums">
                          {testingPct(c.cr_number)}
                        </TableCell>
                      )}
                      {FEATURES.deployment && (
                        <>
                          <TableCell className="text-xs text-muted-foreground">
                            {dep?.planned_deployment_date ? fmt(dep.planned_deployment_date) : "—"}
                          </TableCell>
                          <TableCell>
                            {isDeployedToProduction ? (
                              <DeploymentStageBadge stage="Deployed to Production" />
                            ) : canEditStatus &&
                              dep?.planned_deployment_date &&
                              dep?.deployment_stage ? (
                              <Select
                                value={dep.deployment_stage}
                                onValueChange={(v) =>
                                  updateStage.mutate({
                                    crNumber: c.cr_number,
                                    stage: v as DeploymentStage,
                                  })
                                }
                              >
                                <SelectTrigger className="w-44 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="UAT Signed Off" disabled>
                                    UAT Signed Off
                                  </SelectItem>
                                  {MANUAL_DEPLOYMENT_STAGES.map((stage) => (
                                    <SelectItem key={stage} value={stage}>
                                      {stage}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <DeploymentStageBadge stage={dep?.deployment_stage ?? null} />
                            )}
                          </TableCell>
                        </>
                      )}
                      <TableCell>
                        <CrUpdateCell crNumber={c.cr_number} canEdit={canEditStatus} />
                      </TableCell>
                      <TableCell className="text-right">
                        {canEditStatus && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing({ crNumber: c.cr_number, current: c.workflow_status });
                              const match = (wfStatuses.data ?? []).find(
                                (w) => w.label === c.workflow_status,
                              );
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
                    <TableCell
                      colSpan={14 + (FEATURES.testing ? 1 : 0) + (FEATURES.deployment ? 2 : 0)}
                      className="text-center py-12 text-muted-foreground"
                    >
                      No CRs match your filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageBody>

      <Dialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null);
            setNewStatusCode("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update CR Status</DialogTitle>
            <DialogDescription>
              {editing?.crNumber} — current:{" "}
              <span className="font-medium">{editing?.current ?? "—"}</span>. The selected status
              will be timestamped with the current date &amp; time, and KPIs will be recalculated.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select value={newStatusCode} onValueChange={setNewStatusCode}>
              <SelectTrigger>
                <SelectValue placeholder="Select new status" />
              </SelectTrigger>
              <SelectContent>
                {(wfStatuses.data ?? []).map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setNewStatusCode("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!newStatusCode || updateStatus.isPending}
              onClick={() =>
                editing && updateStatus.mutate({ crNumber: editing.crNumber, code: newStatusCode })
              }
            >
              {updateStatus.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function fmtDateTime(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleString();
}

// CR Repository's Updates column — a button that opens a popup with an
// add-update box and the CR's full update history below it. History is
// only fetched once the dialog is actually opened, not for every row on
// page load.
function CrUpdateCell({ crNumber, canEdit }: { crNumber: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const updates = useQuery({
    queryKey: ["cr-updates", crNumber],
    queryFn: () => listUpdatesByCr({ data: { crNumber } }),
    enabled: open,
  });

  const submit = useMutation({
    mutationFn: () => addCrUpdate({ data: { crNumber, updateText: text } }),
    onSuccess: () => {
      toast.success("Update added");
      setText("");
      qc.invalidateQueries({ queryKey: ["cr-updates", crNumber] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <MessageSquarePlus className="size-3.5 mr-1" /> Add Update
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Updates — {crNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {canEdit && (
            <div className="flex items-center gap-2">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Add a comment…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && text.trim() && !submit.isPending) submit.mutate();
                }}
              />
              <Button
                size="sm"
                className="shrink-0"
                disabled={!text.trim() || submit.isPending}
                onClick={() => submit.mutate()}
              >
                {submit.isPending ? "Saving…" : "Submit"}
              </Button>
            </div>
          )}

          <div className="max-h-80 overflow-y-auto">
            {updates.isLoading ? (
              <div className="text-sm text-muted-foreground text-center py-6">Loading…</div>
            ) : (updates.data ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                No updates posted yet.
              </div>
            ) : (
              <ol className="relative border-l border-border ml-2 space-y-4">
                {(updates.data ?? []).map((u) => (
                  <li key={u.id} className="ml-5">
                    <span className="absolute -left-1.5 size-3 rounded-full ring-2 ring-background bg-primary" />
                    <div className="flex items-baseline gap-3">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {fmtDateTime(u.created_at)}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {u.created_by}
                      </span>
                    </div>
                    <div className="text-sm mt-0.5">{u.update_text}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
