import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useAppUser } from "@/lib/app-user";
import { listUnassignedCrs, listStaffByRole, assignCrField, claimCr } from "@/lib/cr-allocation.functions";

export const Route = createFileRoute("/cr-allocation")({
  head: () => ({ meta: [{ title: "CR Allocation · Kpisavvy" }] }),
  component: CrAllocationPage,
});

const UNASSIGNED = "__unassigned__";

interface AllocationCr {
  cr_number: string;
  title: string | null;
  application: string | null;
  severity: string | null;
  workflow_status: string | null;
  ba: string | null;
  itpm: string | null;
}

function CrAllocationPage() {
  const navigate = useNavigate();
  const { isAdmin, role, isLoading: userLoading } = useAppUser();
  // CR Allocation is a BA/ITPM/PMO feature — Testers belong to the separate
  // Test Case Management module and have no allocation role here.
  const allocationRole = role === "Tester" ? null : role;
  const canAccess = isAdmin || allocationRole != null;

  useEffect(() => {
    if (!userLoading && !canAccess) navigate({ to: "/" });
  }, [userLoading, canAccess, navigate]);

  if (userLoading || !canAccess) return null;

  return (
    <CrAllocationView isFullView={isAdmin || allocationRole === "PMO"} role={allocationRole} />
  );
}

function CrAllocationView({ isFullView, role }: { isFullView: boolean; role: "BA" | "ITPM" | "PMO" | null }) {
  const qc = useQueryClient();

  const crs = useQuery({
    queryKey: ["cr-allocation"],
    queryFn: async () => (await listUnassignedCrs()) as unknown as AllocationCr[],
  });

  const staff = useQuery({
    queryKey: ["cr-allocation-staff"],
    queryFn: () => listStaffByRole(),
    enabled: isFullView,
  });

  const assign = useMutation({
    mutationFn: (v: { crNumber: string; field: "itpm" | "ba"; userName: string | null }) =>
      assignCrField({ data: v }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["cr-allocation"] });
      toast.success(v.userName ? "Assigned." : "Marked as unassigned.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const claim = useMutation({
    mutationFn: (v: { crNumber: string; field: "itpm" | "ba" }) => claimCr({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cr-allocation"] });
      toast.success("Claimed.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  // The currently-assigned name might not be in the active ITPM/BA list
  // anymore (role changed, deactivated, etc.) — still include it so the
  // Select can display it rather than showing blank.
  const itpmOptions = useMemo(() => {
    const opts = new Set(staff.data?.itpmUsers ?? []);
    (crs.data ?? []).forEach((c) => c.itpm && opts.add(c.itpm));
    return Array.from(opts).sort();
  }, [staff.data, crs.data]);
  const baOptions = useMemo(() => {
    const opts = new Set(staff.data?.baUsers ?? []);
    (crs.data ?? []).forEach((c) => c.ba && opts.add(c.ba));
    return Array.from(opts).sort();
  }, [staff.data, crs.data]);

  const rows = crs.data ?? [];
  const claimField: "itpm" | "ba" = role === "ITPM" ? "itpm" : "ba";

  return (
    <AppShell>
      <PageHeader
        title="CR Allocation"
        description={
          isFullView
            ? "CRs missing an ITPM and/or BA. Pick a name to assign either field."
            : `CRs with no ${claimField === "itpm" ? "ITPM" : "BA"} assigned yet — claim one to take ownership.`
        }
      />
      <PageBody>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CR Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Application</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Current Status</TableHead>
                  {isFullView ? (
                    <>
                      <TableHead className="w-48">ITPM</TableHead>
                      <TableHead className="w-48">BA</TableHead>
                    </>
                  ) : (
                    <TableHead className="w-32 text-right">Action</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
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
                    <TableCell className="max-w-sm truncate">{c.title}</TableCell>
                    <TableCell>{c.application}</TableCell>
                    <TableCell>{c.severity}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.workflow_status}</TableCell>
                    {isFullView ? (
                      <>
                        <TableCell>
                          <Select
                            value={c.itpm ?? undefined}
                            onValueChange={(v) =>
                              assign.mutate({ crNumber: c.cr_number, field: "itpm", userName: v === UNASSIGNED ? null : v })
                            }
                          >
                            <SelectTrigger><SelectValue placeholder="— unassigned —" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNASSIGNED}>— Mark as unassigned —</SelectItem>
                              {itpmOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={c.ba ?? undefined}
                            onValueChange={(v) =>
                              assign.mutate({ crNumber: c.cr_number, field: "ba", userName: v === UNASSIGNED ? null : v })
                            }
                          >
                            <SelectTrigger><SelectValue placeholder="— unassigned —" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNASSIGNED}>— Mark as unassigned —</SelectItem>
                              {baOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </>
                    ) : (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          disabled={claim.isPending}
                          onClick={() => claim.mutate({ crNumber: c.cr_number, field: claimField })}
                        >
                          Claim CR
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={isFullView ? 7 : 6} className="text-center py-12 text-muted-foreground">
                      {isFullView ? "No CRs missing ITPM or BA." : "No unclaimed CRs for you right now."}
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
