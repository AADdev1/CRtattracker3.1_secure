import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { recalculateAllKpis } from "@/lib/kpi-engine";
import { getWorkflowStatuses } from "@/lib/workflow-statuses.functions";
import { listKpis, listKpiExcludedStatuses, saveKpi, deleteKpi } from "@/lib/kpi-config.functions";

export const Route = createFileRoute("/kpis")({
  head: () => ({ meta: [{ title: "KPI Configuration · Kpisavvy" }] }),
  component: KpiConfigPage,
});

interface KpiForm {
  id?: string;
  name: string;
  start_status_code: string;
  end_status_code: string;
  small_tat: number;
  medium_tat: number;
  large_tat: number;
  warning_pct: number;
  is_active: boolean;
  excluded_status_codes: string[];
  role: "ITPM" | "BA";
}

const EMPTY: KpiForm = {
  name: "",
  start_status_code: "",
  end_status_code: "",
  small_tat: 5,
  medium_tat: 7,
  large_tat: 10,
  warning_pct: 80,
  is_active: true,
  excluded_status_codes: [],
  role: "ITPM",
};

function KpiConfigPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<KpiForm | null>(null);

  const kpis = useQuery({
    queryKey: ["kpis"],
    queryFn: () => listKpis(),
  });
  const statuses = useQuery({
    queryKey: ["workflow-statuses"],
    queryFn: () => getWorkflowStatuses(),
  });
  const excluded = useQuery({
    queryKey: ["kpi-excluded-statuses"],
    queryFn: () => listKpiExcludedStatuses(),
  });

  const exclByKpi = (() => {
    const map = new Map<string, string[]>();
    for (const r of excluded.data ?? []) {
      const arr = map.get(r.kpi_id) ?? [];
      arr.push(r.workflow_status_code);
      map.set(r.kpi_id, arr);
    }
    return map;
  })();

  const save = useMutation({
    mutationFn: async (form: KpiForm) => {
      await saveKpi({ data: form });
      await recalculateAllKpis();
    },
    onSuccess: () => {
      qc.invalidateQueries();
      setEditing(null);
      toast.success("KPI saved. Engine recalculated.");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : String(e)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await deleteKpi({ data: { id } });
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("KPI deleted.");
    },
  });

  return (
    <AppShell>
      <PageHeader
        title="KPI Configuration"
        description="Define KPIs. Each one is a Start → End workflow pair with TAT by CR size."
        actions={
          <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing(EMPTY)}>
                <Plus /> New KPI
              </Button>
            </DialogTrigger>
            {editing && (
              <KpiDialog
                form={editing}
                statuses={statuses.data ?? []}
                onChange={setEditing}
                onSave={() => save.mutate(editing)}
                saving={save.isPending}
              />
            )}
          </Dialog>
        }
      />
      <PageBody>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Excluded</TableHead>
                  <TableHead className="text-right">S / M / L</TableHead>
                  <TableHead className="text-right">Warn %</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(kpis.data ?? []).map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline">{(k as { role?: string }).role ?? "ITPM"}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{k.start_status_code}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{k.end_status_code}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {(exclByKpi.get(k.id)?.length ?? 0) === 0
                        ? "—"
                        : `${exclByKpi.get(k.id)!.length} status${exclByKpi.get(k.id)!.length === 1 ? "" : "es"}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {k.small_tat} / {k.medium_tat} / {k.large_tat}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{k.warning_pct}%</TableCell>
                    <TableCell>{k.is_active ? "Yes" : "No"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            setEditing({
                              ...(k as unknown as KpiForm),
                              excluded_status_codes: exclByKpi.get(k.id) ?? [],
                            })
                          }
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`Delete KPI "${k.name}"?`)) del.mutate(k.id);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {kpis.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                      No KPIs configured yet. Click "New KPI".
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageBody>
    </AppShell>
  );
}

function KpiDialog({
  form, statuses, onChange, onSave, saving,
}: {
  form: KpiForm;
  statuses: { code: string; label: string }[];
  onChange: (f: KpiForm) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const set = <K extends keyof KpiForm>(k: K, v: KpiForm[K]) => onChange({ ...form, [k]: v });
  const toggleExcluded = (code: string) => {
    const has = form.excluded_status_codes.includes(code);
    set(
      "excluded_status_codes",
      has
        ? form.excluded_status_codes.filter((c) => c !== code)
        : [...form.excluded_status_codes, code],
    );
  };
  const selectableExcluded = statuses.filter(
    (s) => s.code !== form.start_status_code && s.code !== form.end_status_code,
  );
  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{form.id ? "Edit KPI" : "New KPI"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>KPI Name</Label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div>
          <Label>Role</Label>
          <Select value={form.role} onValueChange={(v) => set("role", v as "ITPM" | "BA")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ITPM">ITPM</SelectItem>
              <SelectItem value="BA">BA</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Start Status</Label>
            <Select value={form.start_status_code} onValueChange={(v) => set("start_status_code", v)}>
              <SelectTrigger><SelectValue placeholder="Pick a status" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {statuses.map((s) => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>End Status</Label>
            <Select value={form.end_status_code} onValueChange={(v) => set("end_status_code", v)}>
              <SelectTrigger><SelectValue placeholder="Pick a status" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {statuses.map((s) => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div><Label>Small TAT</Label><Input type="number" value={form.small_tat} onChange={(e) => set("small_tat", Number(e.target.value))} /></div>
          <div><Label>Medium TAT</Label><Input type="number" value={form.medium_tat} onChange={(e) => set("medium_tat", Number(e.target.value))} /></div>
          <div><Label>Large TAT</Label><Input type="number" value={form.large_tat} onChange={(e) => set("large_tat", Number(e.target.value))} /></div>
          <div><Label>Warn %</Label><Input type="number" value={form.warning_pct} onChange={(e) => set("warning_pct", Number(e.target.value))} /></div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Excluded Statuses (pause the timer for this KPI)</Label>
            <span className="text-xs text-muted-foreground">
              {form.excluded_status_codes.length} selected
            </span>
          </div>
          {form.excluded_status_codes.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {form.excluded_status_codes.map((code) => {
                const s = statuses.find((x) => x.code === code);
                return (
                  <Badge key={code} variant="secondary" className="gap-1">
                    {s?.label ?? code}
                    <button
                      type="button"
                      onClick={() => toggleExcluded(code)}
                      className="hover:text-destructive"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}
          <ScrollArea className="h-56 rounded-md border">
            <div className="p-2 space-y-1">
              {selectableExcluded.map((s) => {
                const checked = form.excluded_status_codes.includes(s.code);
                return (
                  <label
                    key={s.code}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleExcluded(s.code)}
                    />
                    <span>{s.label}</span>
                  </label>
                );
              })}
              {selectableExcluded.length === 0 && (
                <div className="text-xs text-muted-foreground p-2">
                  Pick Start and End statuses first.
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} />
          <Label>Active</Label>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={onSave} disabled={saving}>
          {saving ? "Saving & recalculating…" : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}