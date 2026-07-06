import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Search, X } from "lucide-react";
import { toast } from "sonner";
import { recalculateAllKpis, recalculateForCr } from "@/lib/kpi-engine";
import { listAllCrsForSizeManagement, updateCrSizeAndNotes, bulkUpdateCrSize, bulkDropCrs } from "@/lib/crs-admin.functions";

export const Route = createFileRoute("/cr-sizes")({
  head: () => ({ meta: [{ title: "CR Size Management · Kpisavvy" }] }),
  component: CrSizesPage,
});

function CrSizesPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dropConfirmOpen, setDropConfirmOpen] = useState(false);

  const crs = useQuery({
    queryKey: ["crs-sizes"],
    queryFn: () => listAllCrsForSizeManagement(),
  });

  const update = useMutation({
    mutationFn: async (v: { cr_number: string; cr_size?: string | null; manual_notes?: string | null }) => {
      await updateCrSizeAndNotes({
        data: { crNumber: v.cr_number, cr_size: v.cr_size, manual_notes: v.manual_notes },
      });
      await recalculateForCr({ data: v.cr_number });
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Saved. KPIs recalculated for this CR.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const bulkUpdate = useMutation({
    mutationFn: async (cr_size: string | null) => {
      const crNumbers = Array.from(selected);
      await bulkUpdateCrSize({ data: { crNumbers, cr_size } });
      await recalculateAllKpis();
      return crNumbers.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries();
      toast.success(`Updated ${count} CR(s). KPIs recalculated.`);
      setSelected(new Set());
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const bulkDrop = useMutation({
    mutationFn: async () => {
      const crNumbers = Array.from(selected);
      await bulkDropCrs({ data: { crNumbers } });
      await recalculateAllKpis();
      return crNumbers.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries();
      toast.success(`Dropped ${count} CR(s). KPIs recalculated.`);
      setSelected(new Set());
      setDropConfirmOpen(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const filtered = (crs.data ?? [])
    .filter((c) => !c.is_dropped)
    .filter((c) => {
      if (!q) return true;
      const t = q.toLowerCase();
      return c.cr_number.toLowerCase().includes(t) || (c.title ?? "").toLowerCase().includes(t);
    });

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.cr_number));

  function toggleOne(crNumber: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(crNumber)) next.delete(crNumber);
      else next.add(crNumber);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((c) => next.delete(c.cr_number));
      else filtered.forEach((c) => next.add(c.cr_number));
      return next;
    });
  }

  return (
    <AppShell>
      <PageHeader
        title="CR Size Management"
        description="Manually assign CR Size and Notes, or drop CRs from KPI calculation. Dropped CRs are hidden from this list and excluded from KPI calculation, until a later CSV import reports one back in an active (non-dropped) status."
      />
      <PageBody>
        <Card>
          <CardContent className="p-4">
            <div className="relative max-w-md">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search CRs…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
          </CardContent>
        </Card>

        {selected.size > 0 && (
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">{selected.size} selected</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={bulkUpdate.isPending} onClick={() => bulkUpdate.mutate("Small")}>
                  Set Small
                </Button>
                <Button size="sm" variant="outline" disabled={bulkUpdate.isPending} onClick={() => bulkUpdate.mutate("Medium")}>
                  Set Medium
                </Button>
                <Button size="sm" variant="outline" disabled={bulkUpdate.isPending} onClick={() => bulkUpdate.mutate("Large")}>
                  Set Large
                </Button>
                <Button size="sm" variant="ghost" disabled={bulkUpdate.isPending} onClick={() => bulkUpdate.mutate(null)}>
                  Unset
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={bulkUpdate.isPending}
                  onClick={() => setDropConfirmOpen(true)}
                >
                  Drop CR
                </Button>
              </div>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
                <X className="size-3.5 mr-1" /> Clear selection
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allFilteredSelected} onCheckedChange={toggleAllFiltered} />
                  </TableHead>
                  <TableHead>CR Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-40">CR Size</TableHead>
                  <TableHead>Manual Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.cr_number}>
                    <TableCell>
                      <Checkbox checked={selected.has(c.cr_number)} onCheckedChange={() => toggleOne(c.cr_number)} />
                    </TableCell>
                    <TableCell className="font-medium">{c.cr_number}</TableCell>
                    <TableCell className="max-w-sm truncate">{c.title}</TableCell>
                    <TableCell>
                      <Select
                        value={c.cr_size ?? "__none__"}
                        onValueChange={(v) =>
                          update.mutate({ cr_number: c.cr_number, cr_size: v === "__none__" ? null : v })
                        }
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— unset —</SelectItem>
                          <SelectItem value="Small">Small</SelectItem>
                          <SelectItem value="Medium">Medium</SelectItem>
                          <SelectItem value="Large">Large</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Textarea
                        defaultValue={c.manual_notes ?? ""}
                        rows={1}
                        onBlur={(e) => {
                          if (e.target.value !== (c.manual_notes ?? "")) {
                            update.mutate({ cr_number: c.cr_number, manual_notes: e.target.value });
                          }
                        }}
                        placeholder="Notes…"
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No CRs.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageBody>

      <Dialog open={dropConfirmOpen} onOpenChange={(o) => !bulkDrop.isPending && setDropConfirmOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Drop {selected.size} CR{selected.size === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              Do you confirm to drop {Array.from(selected).join(", ")}? Dropped CRs are excluded from KPI
              calculation until a later CSV import reports one of them back in an active status.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={bulkDrop.isPending} onClick={() => setDropConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={bulkDrop.isPending} onClick={() => bulkDrop.mutate()}>
              {bulkDrop.isPending ? "Dropping…" : "Yes, drop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}