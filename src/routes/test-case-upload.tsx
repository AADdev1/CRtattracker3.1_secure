import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Search, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAppUser } from "@/lib/app-user";
import {
  listAllCrsForTesting,
  submitTestCases,
  uploadTestCaseExcel,
} from "@/lib/test-cases.functions";

export const Route = createFileRoute("/test-case-upload")({
  head: () => ({ meta: [{ title: "Test Case Upload · Kpisavvy" }] }),
  component: TestCaseUploadPage,
});

const UPLOAD_ELIGIBLE_STATUSES = new Set(["Pending", "Sent Back for Revision"]);

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "Submitted") return "default";
  if (status === "Approved") return "outline";
  if (status === "Sent Back for Revision") return "destructive";
  return "secondary";
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

function testedPct(tested: number, total: number): string {
  if (total === 0) return "—";
  return `${tested}/${total} (${Math.round((tested / total) * 100)}%)`;
}

function TestCaseUploadPage() {
  const navigate = useNavigate();
  const { isAdmin, role, isLoading: userLoading } = useAppUser();
  const canAccess = isAdmin || role === "Tester";

  useEffect(() => {
    if (!userLoading && !canAccess) navigate({ to: "/" });
  }, [userLoading, canAccess, navigate]);

  if (userLoading || !canAccess) return null;

  return <TestCaseUploadView />;
}

function TestCaseUploadView() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const crs = useQuery({
    queryKey: ["test-case-upload-crs"],
    queryFn: () => listAllCrsForTesting(),
  });

  const upload = useMutation({
    mutationFn: (v: { crNumber: string; file: File }) => uploadTestCaseExcel(v.crNumber, v.file),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["test-case-upload-crs"] });
      toast.success(`Uploaded ${result.count} test case(s).`);
      setUploadTarget(null);
      setSelectedFile(null);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const submit = useMutation({
    mutationFn: (crNumber: string) => submitTestCases({ data: { crNumber } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["test-case-upload-crs"] });
      toast.success("Submitted for approval.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const filtered = (crs.data ?? []).filter((c) => {
    if (c.is_dropped) return false;
    if (!q) return true;
    const t = q.toLowerCase();
    return (
      c.cr_number.toLowerCase().includes(t) ||
      (c.title ?? "").toLowerCase().includes(t) ||
      (c.application ?? "").toLowerCase().includes(t)
    );
  });

  function closeUploadDialog() {
    if (upload.isPending) return;
    setUploadTarget(null);
    setSelectedFile(null);
  }

  return (
    <AppShell>
      <PageHeader
        title="Test Case Upload"
        description="Upload test cases (Excel) for any CR. Every upload replaces the CR's current set outright — there's no version history. Once you're happy with what's uploaded, submit it for approval."
      />
      <PageBody>
        <Card>
          <CardContent className="p-4">
            <div className="relative max-w-md">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search CRs…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CR Number</TableHead>
                  <TableHead>Application</TableHead>
                  <TableHead>BA</TableHead>
                  <TableHead>ITPM</TableHead>
                  <TableHead>Current Status</TableHead>
                  <TableHead>Test Case Status</TableHead>
                  <TableHead>Tested</TableHead>
                  <TableHead>Uploaded By</TableHead>
                  <TableHead>Last Submission</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => {
                  const uploadEligible = UPLOAD_ELIGIBLE_STATUSES.has(c.testCaseStatus);
                  const submitEligible = c.testCaseStatus === "Pending" && c.testCaseCount > 0;
                  return (
                    <TableRow
                      key={c.cr_number}
                      className={c.hasNeedsRetest ? "bg-[color:var(--kpi-amber-bg)]" : undefined}
                    >
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {c.hasNeedsRetest && (
                            <AlertTriangle
                              className="size-3.5 text-[color:var(--kpi-amber)]"
                              aria-label="Needs retest — a referenced defect was resolved"
                            />
                          )}
                          {c.cr_number}
                        </span>
                      </TableCell>
                      <TableCell>{c.application}</TableCell>
                      <TableCell>{c.ba ?? "—"}</TableCell>
                      <TableCell>{c.itpm ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.workflow_status}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(c.testCaseStatus)}>
                          {c.testCaseStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {testedPct(c.testedCount, c.testCaseCount)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{c.uploadedBy ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmt(c.lastUploadedDate)}
                      </TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!uploadEligible}
                          onClick={() => setUploadTarget(c.cr_number)}
                        >
                          Upload
                        </Button>
                        <Button
                          size="sm"
                          disabled={!submitEligible || submit.isPending}
                          onClick={() => submit.mutate(c.cr_number)}
                        >
                          Submit
                        </Button>
                        <Button size="sm" variant="ghost" asChild>
                          <Link to="/test-case-review/$crNumber" params={{ crNumber: c.cr_number }}>
                            View Status
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                      No CRs.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageBody>

      <Dialog open={uploadTarget != null} onOpenChange={(o) => !o && closeUploadDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload test cases for {uploadTarget}</DialogTitle>
            <DialogDescription>
              Pick an .xlsx file. This replaces any test cases already uploaded for this CR —
              there's no version history.
            </DialogDescription>
          </DialogHeader>
          <Input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
          />
          <DialogFooter>
            <Button variant="outline" disabled={upload.isPending} onClick={closeUploadDialog}>
              Cancel
            </Button>
            <Button
              disabled={!selectedFile || upload.isPending}
              onClick={() => {
                if (uploadTarget && selectedFile) {
                  upload.mutate({ crNumber: uploadTarget, file: selectedFile });
                }
              }}
            >
              {upload.isPending ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
