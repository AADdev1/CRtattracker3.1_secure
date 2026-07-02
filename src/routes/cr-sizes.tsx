import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { recalculateForCr } from "@/lib/kpi-engine";
import type { Database } from "@/integrations/supabase/types";

type CrUpdate = Database["public"]["Tables"]["crs"]["Update"];

export const Route = createFileRoute("/cr-sizes")({
  head: () => ({ meta: [{ title: "CR Size Management · Kpisavvy" }] }),
  component: CrSizesPage,
});

function CrSizesPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  const crs = useQuery({
    queryKey: ["crs-sizes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crs")
        .select("cr_number, title, application, cr_size, manual_notes")
        .order("cr_number");
      if (error) throw error;
      return data;
    },
  });

  const update = useMutation({
    mutationFn: async (v: { cr_number: string; cr_size?: string | null; manual_notes?: string | null }) => {
      const payload: CrUpdate = {};
      if (v.cr_size !== undefined) payload.cr_size = v.cr_size as CrUpdate["cr_size"];
      if (v.manual_notes !== undefined) payload.manual_notes = v.manual_notes;
      const { error } = await supabase.from("crs").update(payload).eq("cr_number", v.cr_number);
      if (error) throw error;
      await recalculateForCr(v.cr_number);
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Saved. KPIs recalculated for this CR.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const filtered = (crs.data ?? []).filter((c) => {
    if (!q) return true;
    const t = q.toLowerCase();
    return c.cr_number.toLowerCase().includes(t) || (c.title ?? "").toLowerCase().includes(t);
  });

  return (
    <AppShell>
      <PageHeader
        title="CR Size Management"
        description="Manually assign CR Size and Notes. These fields are preserved across CSV re-imports."
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
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CR Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-40">CR Size</TableHead>
                  <TableHead>Manual Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.cr_number}>
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
                  <TableRow><TableCell colSpan={4} className="text-center py-12 text-muted-foreground">No CRs.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageBody>
    </AppShell>
  );
}