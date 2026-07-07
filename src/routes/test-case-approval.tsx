import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search } from "lucide-react";
import { useAppUser } from "@/lib/app-user";
import { listSubmittedForApproval } from "@/lib/test-cases.functions";

export const Route = createFileRoute("/test-case-approval")({
  head: () => ({ meta: [{ title: "Test Case Approval · Kpisavvy" }] }),
  component: TestCaseApprovalPage,
});

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

function TestCaseApprovalPage() {
  const navigate = useNavigate();
  const { isAdmin, isTestCaseApprover, isLoading: userLoading } = useAppUser();
  const canAccess = isAdmin || isTestCaseApprover;

  useEffect(() => {
    if (!userLoading && !canAccess) navigate({ to: "/" });
  }, [userLoading, canAccess, navigate]);

  if (userLoading || !canAccess) return null;

  return <TestCaseApprovalView />;
}

function TestCaseApprovalView() {
  const [q, setQ] = useState("");

  const crs = useQuery({
    queryKey: ["test-case-approval"],
    queryFn: () => listSubmittedForApproval(),
  });

  const filtered = (crs.data ?? []).filter((c) => {
    if (!q) return true;
    const t = q.toLowerCase();
    return (
      c.cr_number.toLowerCase().includes(t) ||
      (c.title ?? "").toLowerCase().includes(t) ||
      (c.application ?? "").toLowerCase().includes(t)
    );
  });

  return (
    <AppShell>
      <PageHeader
        title="Test Case Approval"
        description="CRs with test cases submitted for your review — only CRs where you're the BA or ITPM show up here."
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
                  <TableHead>Title</TableHead>
                  <TableHead>Application</TableHead>
                  <TableHead>BA</TableHead>
                  <TableHead>ITPM</TableHead>
                  <TableHead>Test Cases</TableHead>
                  <TableHead>Uploaded By</TableHead>
                  <TableHead>Last Submission</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.cr_number}>
                    <TableCell className="font-medium">{c.cr_number}</TableCell>
                    <TableCell className="max-w-sm truncate">{c.title}</TableCell>
                    <TableCell>{c.application}</TableCell>
                    <TableCell>{c.ba ?? "—"}</TableCell>
                    <TableCell>{c.itpm ?? "—"}</TableCell>
                    <TableCell>{c.testCaseCount}</TableCell>
                    <TableCell className="text-muted-foreground">{c.uploadedBy ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmt(c.lastUploadedDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" asChild>
                        <Link to="/test-case-review/$crNumber" params={{ crNumber: c.cr_number }}>
                          Review
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                      Nothing waiting on your review.
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
