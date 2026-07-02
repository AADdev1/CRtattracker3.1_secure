import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/defect-statuses")({
  head: () => ({ meta: [{ title: "Defect Status Mapping · Kpisavvy" }] }),
  component: DefectStatusMapping,
});

function DefectStatusMapping() {
  const qc = useQueryClient();
  const [newStatus, setNewStatus] = useState("");

  const mapping = useQuery({
    queryKey: ["defect-status-mapping"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("defect_status_mapping")
        .select("id, status, is_open")
        .order("is_open", { ascending: false })
        .order("status");
      if (error) throw error;
      return data;
    },
  });

  // Also surface statuses that exist in defects but aren't mapped yet.
  const unmapped = useQuery({
    queryKey: ["defect-unmapped-statuses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("defects").select("new_status");
      if (error) throw error;
      return Array.from(new Set((data ?? []).map((d) => d.new_status).filter(Boolean) as string[]));
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, is_open }: { id: string; is_open: boolean }) => {
      const { error } = await supabase.from("defect_status_mapping").update({ is_open }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const add = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase
        .from("defect_status_mapping")
        .insert({ status, is_open: true });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewStatus("");
      toast.success("Status added");
      qc.invalidateQueries();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("defect_status_mapping").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const mapped = new Set((mapping.data ?? []).map((m) => m.status));
  const missing = (unmapped.data ?? []).filter((s) => !mapped.has(s));

  return (
    <AppShell>
      <PageHeader
        title="Defect Status Mapping"
        description="Configure which defect statuses count as Open. Any status not mapped as Open is treated as Closed."
      />
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add status</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              placeholder="e.g. Ready for Retest"
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
            />
            <Button onClick={() => newStatus.trim() && add.mutate(newStatus.trim())} disabled={!newStatus.trim() || add.isPending}>
              <Plus className="size-4" /> Add
            </Button>
          </CardContent>
        </Card>

        {missing.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Unmapped statuses in your defects ({missing.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {missing.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="sm"
                  onClick={() => add.mutate(s)}
                  disabled={add.isPending}
                >
                  <Plus className="size-3" /> {s}
                </Button>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32">Open</TableHead>
                  <TableHead className="text-right w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(mapping.data ?? []).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.status}</TableCell>
                    <TableCell>
                      <Switch
                        checked={m.is_open}
                        onCheckedChange={(v) => toggle.mutate({ id: m.id, is_open: v })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => remove.mutate(m.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(mapping.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      No statuses configured.
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