import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { ArrowLeft, CalendarIcon, Plus } from "lucide-react";
import { DeploymentStageBadge } from "@/components/deployment-stage-badge";
import { useAppUser } from "@/lib/app-user";
import {
  assignCrsToDeployment,
  createDeploymentSchedule,
  getDeploymentDashboardSummary,
  getDeploymentScheduleCrs,
  listCrApplications,
  listDeploymentSchedules,
  listEligibleCrsForPlanning,
  listPlannedSchedules,
  markDeploymentScheduleCompleted,
  MANUAL_DEPLOYMENT_STAGES,
  updateDeploymentSchedule,
  updateDeploymentStage,
  type DeploymentStage,
  type DeploymentStatus,
} from "@/lib/deployment.functions";

export const Route = createFileRoute("/deployment-planning")({
  head: () => ({ meta: [{ title: "Deployment Planning · Kpisavvy" }] }),
  component: DeploymentPlanningPage,
});

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "Planned") return "default";
  if (status === "Completed") return "outline";
  return "destructive"; // Cancelled
}

function DeploymentPlanningPage() {
  const { isAdmin, role, isLoading } = useAppUser();
  const navigate = useNavigate();
  const canAccess = isAdmin || role === "PMO" || role === "ITPM" || role === "BA";
  const canManage = role === "PMO" || role === "ITPM" || role === "BA";

  useEffect(() => {
    if (!isLoading && !canAccess) navigate({ to: "/" });
  }, [isLoading, canAccess, navigate]);

  if (isLoading || !canAccess) return null;

  return <DeploymentPlanningView canManage={canManage} />;
}

function DeploymentPlanningView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const listSchedulesFn = useServerFn(listDeploymentSchedules);
  const listApplicationsFn = useServerFn(listCrApplications);
  const createScheduleFn = useServerFn(createDeploymentSchedule);
  const listEligibleFn = useServerFn(listEligibleCrsForPlanning);
  const listPlannedFn = useServerFn(listPlannedSchedules);
  const assignFn = useServerFn(assignCrsToDeployment);
  const getSummaryFn = useServerFn(getDeploymentDashboardSummary);
  const getScheduleCrsFn = useServerFn(getDeploymentScheduleCrs);
  const updateStageFn = useServerFn(updateDeploymentStage);
  const updateScheduleFn = useServerFn(updateDeploymentSchedule);
  const markCompletedFn = useServerFn(markDeploymentScheduleCompleted);

  const [createOpen, setCreateOpen] = useState(false);
  const [application, setApplication] = useState("");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [scheduleRemarks, setScheduleRemarks] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scheduleId, setScheduleId] = useState<string>("");
  const [assignRemarks, setAssignRemarks] = useState("");

  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [confirmComplete, setConfirmComplete] = useState<{
    id: string;
    name: string;
    crCount: number;
  } | null>(null);

  const summary = useQuery({
    queryKey: ["deployment-dashboard-summary"],
    queryFn: () => getSummaryFn(),
  });

  const schedules = useQuery({
    queryKey: ["deployment-schedules"],
    queryFn: () => listSchedulesFn(),
  });

  const applications = useQuery({
    queryKey: ["deployment-applications"],
    queryFn: () => listApplicationsFn(),
    enabled: createOpen,
  });

  const eligible = useQuery({
    queryKey: ["deployment-eligible-crs"],
    queryFn: () => listEligibleFn(),
  });

  const plannedSchedules = useQuery({
    queryKey: ["deployment-planned-schedules"],
    queryFn: () => listPlannedFn(),
    enabled: canManage,
  });

  const scheduleCrs = useQuery({
    queryKey: ["deployment-schedule-crs", selectedScheduleId],
    queryFn: () => getScheduleCrsFn({ data: { scheduleId: selectedScheduleId! } }),
    enabled: !!selectedScheduleId,
  });

  function resetCreateForm() {
    setApplication("");
    setDate(undefined);
    setScheduleRemarks("");
  }

  const createSchedule = useMutation({
    mutationFn: () =>
      createScheduleFn({
        data: {
          application,
          deploymentDate: format(date!, "yyyy-MM-dd"),
          remarks: scheduleRemarks.trim() || null,
        },
      }),
    onSuccess: (result) => {
      toast.success(`Created ${result.deploymentName}`);
      setCreateOpen(false);
      resetCreateForm();
      qc.invalidateQueries({ queryKey: ["deployment-schedules"] });
      qc.invalidateQueries({ queryKey: ["deployment-planned-schedules"] });
      qc.invalidateQueries({ queryKey: ["deployment-dashboard-summary"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const rows = eligible.data ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.cr_number));

  function toggleOne(crNumber: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(crNumber)) next.delete(crNumber);
      else next.add(crNumber);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) rows.forEach((r) => next.delete(r.cr_number));
      else rows.forEach((r) => next.add(r.cr_number));
      return next;
    });
  }

  const assign = useMutation({
    mutationFn: () =>
      assignFn({
        data: {
          crNumbers: Array.from(selected),
          scheduleId,
          remarks: assignRemarks.trim() || null,
        },
      }),
    onSuccess: (result) => {
      toast.success(`Assigned ${result.assigned} CR(s) to the deployment schedule.`);
      setSelected(new Set());
      setAssignRemarks("");
      qc.invalidateQueries({ queryKey: ["deployment-eligible-crs"] });
      qc.invalidateQueries({ queryKey: ["deployment-schedules"] });
      qc.invalidateQueries({ queryKey: ["deployment-dashboard-summary"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const updateStage = useMutation({
    mutationFn: (v: { crNumber: string; stage: DeploymentStage }) => updateStageFn({ data: v }),
    onSuccess: () => {
      toast.success("Deployment stage updated");
      qc.invalidateQueries({ queryKey: ["deployment-schedule-crs", selectedScheduleId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const updateScheduleStatus = useMutation({
    mutationFn: (v: { id: string; status: DeploymentStatus }) => updateScheduleFn({ data: v }),
    onSuccess: () => {
      toast.success("Deployment schedule updated");
      qc.invalidateQueries({ queryKey: ["deployment-schedules"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const completeSchedule = useMutation({
    mutationFn: (id: string) => markCompletedFn({ data: { scheduleId: id } }),
    onSuccess: (result) => {
      toast.success(`Marked as deployed — ${result.crCount} CR(s) updated`);
      setConfirmComplete(null);
      qc.invalidateQueries({ queryKey: ["deployment-schedules"] });
      qc.invalidateQueries({ queryKey: ["deployment-dashboard-summary"] });
      qc.invalidateQueries({ queryKey: ["deployment-schedule-crs", selectedScheduleId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const selectedSchedule = (schedules.data ?? []).find((s) => s.id === selectedScheduleId);

  return (
    <AppShell>
      <PageHeader
        title="Deployment Planning"
        description="Create deployment schedules, assign CRs that have reached UAT Signed Off, and track them through to production."
        actions={
          canManage ? (
            <Dialog
              open={createOpen}
              onOpenChange={(o) => {
                setCreateOpen(o);
                if (!o) resetCreateForm();
              }}
            >
              <DialogTrigger asChild>
                <Button>
                  <Plus /> Create Deployment Schedule
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Deployment Schedule</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Select value={application} onValueChange={setApplication}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose an application…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(applications.data ?? []).map((app) => (
                          <SelectItem key={app} value={app}>
                            {app}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start font-normal">
                          <CalendarIcon className="size-4" />
                          {date ? format(date, "PPP") : "Pick a deployment date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar mode="single" selected={date} onSelect={setDate} />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Remarks…"
                      value={scheduleRemarks}
                      onChange={(e) => setScheduleRemarks(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    disabled={!application || !date || createSchedule.isPending}
                    onClick={() => createSchedule.mutate()}
                  >
                    {createSchedule.isPending ? "Creating…" : "Create"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : undefined
        }
      />
      <PageBody>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Upcoming Deployments" value={summary.data?.upcoming} />
          <SummaryCard label="Total Planned Deployments" value={summary.data?.totalPlanned} />
          <SummaryCard label="Total CRs Planned" value={summary.data?.totalCrsPlanned} />
          <SummaryCard label="This Week Deployments" value={summary.data?.thisWeek} />
        </div>

        {!selectedScheduleId ? (
          <>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deployment Name</TableHead>
                      <TableHead>Application</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">CRs</TableHead>
                      <TableHead>Remarks</TableHead>
                      <TableHead>Created By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(schedules.data ?? []).map((s) => (
                      <TableRow
                        key={s.id}
                        className="cursor-pointer hover:bg-accent/40"
                        onClick={() => setSelectedScheduleId(s.id)}
                      >
                        <TableCell className="font-medium">{s.deployment_name}</TableCell>
                        <TableCell>{s.application}</TableCell>
                        <TableCell>{new Date(s.deployment_date).toLocaleDateString()}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {canManage && s.status === "Planned" ? (
                            <Select
                              value={s.status}
                              onValueChange={(v) => {
                                if (v === "Completed") {
                                  setConfirmComplete({
                                    id: s.id,
                                    name: s.deployment_name,
                                    crCount: s.crCount,
                                  });
                                } else if (v === "Cancelled") {
                                  updateScheduleStatus.mutate({ id: s.id, status: "Cancelled" });
                                }
                              }}
                            >
                              <SelectTrigger className="w-32 h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Planned">Planned</SelectItem>
                                <SelectItem value="Completed">Completed</SelectItem>
                                <SelectItem value="Cancelled">Cancelled</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant={statusBadgeVariant(s.status)}>{s.status}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{s.crCount}</TableCell>
                        <TableCell className="max-w-xs truncate text-muted-foreground">
                          {s.remarks || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{s.created_by}</TableCell>
                      </TableRow>
                    ))}
                    {(schedules.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                          No deployment schedules yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {canManage && (
                        <TableHead className="w-10">
                          <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                        </TableHead>
                      )}
                      <TableHead>CR Number</TableHead>
                      <TableHead>Application</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Assigned ITPM</TableHead>
                      <TableHead>Assigned BA</TableHead>
                      <TableHead>Workflow Status</TableHead>
                      <TableHead>Deployment Stage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((c) => (
                      <TableRow key={c.cr_number}>
                        {canManage && (
                          <TableCell>
                            <Checkbox
                              checked={selected.has(c.cr_number)}
                              onCheckedChange={() => toggleOne(c.cr_number)}
                            />
                          </TableCell>
                        )}
                        <TableCell className="font-medium">{c.cr_number}</TableCell>
                        <TableCell>{c.application}</TableCell>
                        <TableCell>{c.cr_size ?? "—"}</TableCell>
                        <TableCell>{c.itpm ?? "—"}</TableCell>
                        <TableCell>{c.ba ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.workflow_status}
                        </TableCell>
                        <TableCell>
                          <DeploymentStageBadge stage="UAT Signed Off" />
                        </TableCell>
                      </TableRow>
                    ))}
                    {rows.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={canManage ? 8 : 7}
                          className="text-center py-12 text-muted-foreground"
                        >
                          No eligible CRs — nothing has reached UAT Signed Off yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {canManage && (
              <Card>
                <CardContent className="p-4 flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-48 space-y-1.5">
                    <div className="text-xs text-muted-foreground">Deployment Schedule</div>
                    <Select value={scheduleId} onValueChange={setScheduleId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a schedule…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(plannedSchedules.data ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.deployment_name} ({s.application}) —{" "}
                            {new Date(s.deployment_date).toLocaleDateString()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1 min-w-48 space-y-1.5">
                    <div className="text-xs text-muted-foreground">Remarks</div>
                    <Textarea
                      rows={1}
                      placeholder="Allocation remarks…"
                      value={assignRemarks}
                      onChange={(e) => setAssignRemarks(e.target.value)}
                    />
                  </div>
                  <Button
                    disabled={selected.size === 0 || !scheduleId || assign.isPending}
                    onClick={() => assign.mutate()}
                  >
                    {assign.isPending ? "Assigning…" : `Assign to Deployment (${selected.size})`}
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card>
            <CardHeader className="flex flex-row items-center gap-3 space-y-0">
              <Button variant="ghost" size="icon" onClick={() => setSelectedScheduleId(null)}>
                <ArrowLeft className="size-4" />
              </Button>
              <CardTitle className="text-base">
                {selectedSchedule?.deployment_name ?? "Deployment"} — CRs
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CR Number</TableHead>
                    <TableHead>Application</TableHead>
                    <TableHead>Assigned ITPM</TableHead>
                    <TableHead>Assigned BA</TableHead>
                    <TableHead>CR Size</TableHead>
                    <TableHead>Workflow Status</TableHead>
                    <TableHead>Deployment Stage</TableHead>
                    <TableHead>Allocation Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(scheduleCrs.data ?? []).map((c) => {
                    const locked =
                      !c.deployment_stage || c.deployment_stage === "Deployed to Production";
                    return (
                      <TableRow key={c.cr_number}>
                        <TableCell className="font-medium">{c.cr_number}</TableCell>
                        <TableCell>{c.application}</TableCell>
                        <TableCell>{c.itpm ?? "—"}</TableCell>
                        <TableCell>{c.ba ?? "—"}</TableCell>
                        <TableCell>{c.cr_size ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.workflow_status}
                        </TableCell>
                        <TableCell>
                          {canManage && !locked ? (
                            <Select
                              value={c.deployment_stage ?? undefined}
                              onValueChange={(v) =>
                                updateStage.mutate({
                                  crNumber: c.cr_number,
                                  stage: v as DeploymentStage,
                                })
                              }
                            >
                              <SelectTrigger className="w-44">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {MANUAL_DEPLOYMENT_STAGES.map((stage) => (
                                  <SelectItem key={stage} value={stage}>
                                    {stage}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <DeploymentStageBadge stage={c.deployment_stage} />
                          )}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-muted-foreground">
                          {c.allocation_remarks || "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(scheduleCrs.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                        No CRs assigned to this deployment yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </PageBody>

      <Dialog
        open={!!confirmComplete}
        onOpenChange={(o) => {
          if (!o) setConfirmComplete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark deployment as deployed?</DialogTitle>
            <DialogDescription>
              {confirmComplete?.name} will be marked Completed, and all {confirmComplete?.crCount}{" "}
              assigned CR(s) will have their Deployment Stage set to "Deployed to Production" and
              their CR status set to "28_Deployed in Production". This can't be undone from here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmComplete(null)}>
              Cancel
            </Button>
            <Button
              disabled={completeSchedule.isPending}
              onClick={() => confirmComplete && completeSchedule.mutate(confirmComplete.id)}
            >
              {completeSchedule.isPending ? "Marking…" : "OK, mark as deployed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function SummaryCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold tabular-nums">{value ?? "—"}</div>
        <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}
