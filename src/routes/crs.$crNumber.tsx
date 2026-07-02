import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { KpiStatusBadge } from "@/components/kpi-status-badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { buildTimeline, type CrRow, type WorkflowStatusRow } from "@/lib/kpi-engine";
import { getScopedCrs, getScopedKpiResults, getScopedDefects, type CrRelation } from "@/lib/scoped-data.functions";
import type { Database } from "@/integrations/supabase/types";

type CrDetailRow = Database["public"]["Tables"]["crs"]["Row"] & { relation: CrRelation };

export const Route = createFileRoute("/crs/$crNumber")({
  head: ({ params }) => ({ meta: [{ title: `${params.crNumber} · Kpisavvy` }] }),
  component: CrDetails,
});

function CrDetails() {
  const { crNumber } = Route.useParams();

  const data = useQuery({
    queryKey: ["cr-details", crNumber],
    queryFn: async () => {
      const [cr, statusRes, results, defects] = await Promise.all([
        getScopedCrs({ data: { crNumber } }),
        supabase.from("workflow_statuses").select("*").order("sort_order"),
        getScopedKpiResults({ data: { crNumber } }),
        getScopedDefects({ data: { crNumber } }),
      ]);
      if (statusRes.error) throw statusRes.error;
      return {
        cr: cr as CrDetailRow | null,
        statuses: statusRes.data ?? [],
        results: results ?? [],
        defects: defects ?? [],
      };
    },
  });

  const cr = data.data?.cr;
  const statuses = (data.data?.statuses ?? []) as WorkflowStatusRow[];
  const results = data.data?.results ?? [];
  const defects = data.data?.defects ?? [];
  const now = Date.now();

  if (data.isLoading) {
    return (
      <AppShell>
        <PageBody>Loading…</PageBody>
      </AppShell>
    );
  }
  if (!cr) {
    return (
      <AppShell>
        <PageHeader title="CR not found" />
        <PageBody>
          <Button asChild variant="outline">
            <Link to="/crs"><ArrowLeft /> Back to Repository</Link>
          </Button>
        </PageBody>
      </AppShell>
    );
  }

  const timeline = buildTimeline(cr as unknown as CrRow, statuses);

  return (
    <AppShell>
      <PageHeader
        title={cr.cr_number}
        description={cr.title ?? undefined}
        actions={
          <Button asChild variant="outline">
            <Link to="/crs"><ArrowLeft /> Back</Link>
          </Button>
        }
      />
      <PageBody>
        <Card>
          <CardHeader><CardTitle className="text-base">Basic Information</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
              <Field label="Application" value={cr.application} />
              <Field label="Module" value={cr.module_name} />
              <Field label="Severity" value={cr.severity} />
              <Field label="CR Size" value={cr.cr_size} />
              <Field label="Current Status" value={cr.workflow_status} />
              <Field label="Department" value={cr.department} />
              <Field label="BA" value={cr.ba} />
              <Field label="ITPM" value={cr.itpm} />
              <Field label="Assigned Team" value={cr.assigned_team} />
              <Field label="Assigned User" value={cr.assigned_user} />
              <Field label="Date Created" value={fmt(cr.date_created)} />
              <Field label="Expected Go Live" value={fmt(cr.expected_go_live_date)} />
            </dl>
            {cr.manual_notes && (
              <div className="mt-4 p-3 bg-muted rounded-md text-sm">
                <div className="text-xs uppercase text-muted-foreground mb-1">Manual Notes</div>
                {cr.manual_notes}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">KPI Timeline & Calculation Summary</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>KPI</TableHead>
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
                {results.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No KPI results. Run the engine.</TableCell></TableRow>
                ) : (
                  results.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.kpis?.name}</TableCell>
                      <TableCell className="text-xs">{fmt(r.start_date)}</TableCell>
                      <TableCell className="text-xs">{fmt(r.end_date)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.working_days ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.hold_days ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.effective_days ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.tat ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.remaining_days ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.utilization_pct != null ? `${r.utilization_pct.toFixed(0)}%` : "—"}</TableCell>
                      <TableCell><KpiStatusBadge status={r.status} /></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Workflow Timeline</CardTitle></CardHeader>
          <CardContent>
            {timeline.length === 0 ? (
              <div className="text-sm text-muted-foreground">No workflow events recorded.</div>
            ) : (
              <ol className="relative border-l border-border ml-2 space-y-4">
                {timeline.map((t, i) => (
                  <li key={i} className="ml-5">
                    <span className="absolute -left-1.5 size-3 rounded-full ring-2 ring-background bg-primary" />
                    <div className="flex items-baseline gap-3">
                      <span className="text-xs text-muted-foreground tabular-nums w-36 shrink-0">{fmt(t.ts.toISOString())}</span>
                      <span className="text-sm font-medium">{t.label}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {cr.relation !== "ba" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Open Defects <span className="text-muted-foreground font-normal">({defects.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {defects.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">No open defects linked to this CR.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Defect No</TableHead>
                      <TableHead>Summary</TableHead>
                      <TableHead>Current Status</TableHead>
                      <TableHead className="text-right">Aging</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {defects.map((d) => {
                      const aging = d.date_created
                        ? Math.floor((now - new Date(d.date_created).getTime()) / 86400000)
                        : null;
                      return (
                        <TableRow key={d.defect_no}>
                          <TableCell className="font-medium">{d.defect_no}</TableCell>
                          <TableCell className="max-w-md truncate">{d.summary}</TableCell>
                          <TableCell>
                            <span className="text-xs px-2 py-0.5 rounded-md bg-[color:var(--kpi-amber-bg)] text-[color:var(--kpi-amber)]">
                              {d.new_status ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{aging != null ? `${aging}d` : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </PageBody>
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value || <span className="text-muted-foreground italic">—</span>}</dd>
    </div>
  );
}

function fmt(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}