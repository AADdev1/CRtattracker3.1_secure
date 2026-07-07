import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAppUser } from "@/lib/app-user";
import {
  getCrTestingHeader,
  getTestCases,
  approveTestCases,
  sendBackTestCases,
  updateApproverComment,
  updateExecutionStatus,
  downloadTestCasesExcel,
} from "@/lib/test-cases.functions";

export const Route = createFileRoute("/test-case-review/$crNumber")({
  head: ({ params }) => ({ meta: [{ title: `${params.crNumber} Test Cases · Kpisavvy` }] }),
  component: TestCaseReviewPage,
});

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "Submitted") return "default";
  if (status === "Approved") return "outline";
  if (status === "Sent Back for Revision") return "destructive";
  return "secondary";
}

function executionBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "Tested") return "outline";
  if (status === "Defect Raised") return "destructive";
  return "secondary";
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

const EXECUTION_STATUSES = ["Pending", "Tested", "Defect Raised"] as const;

function TestCaseReviewPage() {
  const { crNumber } = Route.useParams();
  const qc = useQueryClient();
  const { isAdmin, role, isTestCaseApprover } = useAppUser();
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackComment, setSendBackComment] = useState("");
  const [draftExecutionStatus, setDraftExecutionStatus] = useState<Record<string, string>>({});

  const data = useQuery({
    queryKey: ["test-case-review", crNumber],
    queryFn: async () => {
      const [header, rows] = await Promise.all([
        getCrTestingHeader({ data: { crNumber } }),
        getTestCases({ data: { crNumber } }),
      ]);
      return { header, rows };
    },
  });

  const rows = data.data?.rows ?? [];
  const header = data.data?.header;
  const status = rows[0]?.status ?? "Pending";
  const canAct = (isAdmin || isTestCaseApprover) && status === "Submitted";
  const canEditExecution = (isAdmin || role === "Tester") && status === "Approved";
  const testedCount = rows.filter((r) => r.execution_status === "Tested").length;
  const testedPct =
    rows.length === 0
      ? "—"
      : `${testedCount}/${rows.length} (${Math.round((testedCount / rows.length) * 100)}%)`;

  const saveComment = useMutation({
    mutationFn: (v: { testCaseId: string; comment: string | null }) =>
      updateApproverComment({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-case-review", crNumber] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const updateExecution = useMutation({
    mutationFn: (v: {
      testCaseId: string;
      executionStatus: "Pending" | "Tested" | "Defect Raised";
      defectId?: string | null;
    }) => updateExecutionStatus({ data: v }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["test-case-review", crNumber] });
      setDraftExecutionStatus((prev) => {
        const next = { ...prev };
        delete next[v.testCaseId];
        return next;
      });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const approve = useMutation({
    mutationFn: () => approveTestCases({ data: { crNumber } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["test-case-review", crNumber] });
      toast.success("Approved.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const sendBack = useMutation({
    mutationFn: () =>
      sendBackTestCases({ data: { crNumber, overallComment: sendBackComment || null } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["test-case-review", crNumber] });
      toast.success("Sent back for revision.");
      setSendBackOpen(false);
      setSendBackComment("");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  if (data.isLoading) {
    return (
      <AppShell>
        <PageBody>Loading…</PageBody>
      </AppShell>
    );
  }

  if (!header) {
    return (
      <AppShell>
        <PageHeader title="CR not found" />
        <PageBody>
          <Button asChild variant="outline">
            <Link to="/test-case-upload">
              <ArrowLeft /> Back
            </Link>
          </Button>
        </PageBody>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title={`${header.cr_number} — Test Cases`}
        description={header.title ?? undefined}
        actions={
          <>
            <Badge variant={statusBadgeVariant(status)}>{status}</Badge>
            <Button
              variant="outline"
              disabled={rows.length === 0}
              onClick={() => downloadTestCasesExcel(crNumber, rows)}
            >
              <Download /> Download Excel
            </Button>
            {canAct && (
              <>
                <Button
                  variant="outline"
                  disabled={sendBack.isPending}
                  onClick={() => setSendBackOpen(true)}
                >
                  Send Back
                </Button>
                <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
                  {approve.isPending ? "Approving…" : "Approve"}
                </Button>
              </>
            )}
            <Button asChild variant="outline">
              <Link to="/test-case-upload">
                <ArrowLeft /> Back
              </Link>
            </Button>
          </>
        }
      />
      <PageBody>
        <Card>
          <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Application</div>
              <div className="font-medium">{header.application ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">BA</div>
              <div className="font-medium">{header.ba ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">ITPM</div>
              <div className="font-medium">{header.itpm ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Current Status</div>
              <div className="font-medium">{header.workflow_status ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Tested</div>
              <div className="font-medium tabular-nums">{testedPct}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Uploaded By</div>
              <div className="font-medium">
                {rows[0] ? `${rows[0].uploaded_by} · ${fmt(rows[0].uploaded_date)}` : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Approved By</div>
              <div className="font-medium">
                {rows[0]?.approved_by
                  ? `${rows[0].approved_by} · ${fmt(rows[0].approval_date)}`
                  : "—"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test Case No</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Test Case Name</TableHead>
                  <TableHead>Test Condition</TableHead>
                  <TableHead>Expected Result</TableHead>
                  <TableHead>Tester Comments</TableHead>
                  <TableHead className="w-64">Approver Comments</TableHead>
                  <TableHead className="w-40">Execution Status</TableHead>
                  <TableHead className="w-40">Defect ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className={r.needs_retest ? "bg-[color:var(--kpi-amber-bg)]" : undefined}
                  >
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {r.needs_retest && (
                          <AlertTriangle
                            className="size-3.5 text-[color:var(--kpi-amber)]"
                            aria-label="Needs retest — its defect was resolved"
                          />
                        )}
                        {r.test_case_number}
                      </span>
                    </TableCell>
                    <TableCell>{r.test_priority ?? "—"}</TableCell>
                    <TableCell className="max-w-xs">{r.test_case_name}</TableCell>
                    <TableCell className="max-w-xs">{r.test_condition}</TableCell>
                    <TableCell className="max-w-xs">{r.expected_result}</TableCell>
                    <TableCell className="max-w-xs text-muted-foreground">
                      {r.tester_comments ?? "—"}
                    </TableCell>
                    <TableCell>
                      {canAct ? (
                        <Textarea
                          defaultValue={r.approver_comments ?? ""}
                          rows={1}
                          onBlur={(e) => {
                            if (e.target.value !== (r.approver_comments ?? "")) {
                              saveComment.mutate({
                                testCaseId: r.id,
                                comment: e.target.value || null,
                              });
                            }
                          }}
                          placeholder="Comment…"
                        />
                      ) : (
                        (r.approver_comments ?? "—")
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const executionStatus = draftExecutionStatus[r.id] ?? r.execution_status;
                        if (!canEditExecution) {
                          return (
                            <Badge variant={executionBadgeVariant(executionStatus)}>
                              {executionStatus}
                            </Badge>
                          );
                        }
                        return (
                          <Select
                            value={executionStatus}
                            onValueChange={(v) => {
                              setDraftExecutionStatus((prev) => ({ ...prev, [r.id]: v }));
                              if (v !== "Defect Raised") {
                                updateExecution.mutate({
                                  testCaseId: r.id,
                                  executionStatus: v as "Pending" | "Tested",
                                  defectId: null,
                                });
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {EXECUTION_STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      {canEditExecution &&
                      (draftExecutionStatus[r.id] ?? r.execution_status) === "Defect Raised" ? (
                        <Input
                          defaultValue={r.defect_id ?? ""}
                          placeholder="Defect ID…"
                          onBlur={(e) => {
                            const value = e.target.value.trim();
                            if (!value) {
                              toast.error(
                                "Defect ID is required to mark a test case as Defect Raised.",
                              );
                              setDraftExecutionStatus((prev) => {
                                const next = { ...prev };
                                delete next[r.id];
                                return next;
                              });
                              return;
                            }
                            if (value !== (r.defect_id ?? "")) {
                              updateExecution.mutate({
                                testCaseId: r.id,
                                executionStatus: "Defect Raised",
                                defectId: value,
                              });
                            }
                          }}
                        />
                      ) : (
                        (r.defect_id ?? "—")
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                      No test cases uploaded yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageBody>

      <Dialog open={sendBackOpen} onOpenChange={(o) => !sendBack.isPending && setSendBackOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send back {crNumber} for revision?</DialogTitle>
            <DialogDescription>
              This overall comment fills in for any row you haven't left a comment on — rows with
              their own comment keep it as-is.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={sendBackComment}
            onChange={(e) => setSendBackComment(e.target.value)}
            placeholder="Overall comment (optional)…"
          />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={sendBack.isPending}
              onClick={() => setSendBackOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={sendBack.isPending}
              onClick={() => sendBack.mutate()}
            >
              {sendBack.isPending ? "Sending…" : "Send Back"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
