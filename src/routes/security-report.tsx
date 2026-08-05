import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { z } from "zod";
import { useAppUser } from "@/lib/app-user";
import { FEATURES } from "@/lib/release-config";
import { getSecurityReport, type SecurityReportKind } from "@/lib/security-report.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/security-report")({
  head: () => ({ meta: [{ title: "Security Report · Kpisavvy" }] }),
  validateSearch: z.object({
    report: z.enum(["vapt", "compliance"]).optional(),
  }).parse,
  component: SecurityReportPage,
});

const REPORT_TABS: { value: SecurityReportKind; label: string }[] = [
  { value: "compliance", label: "TAGIC-IR-GL-001 Compliance Report" },
  { value: "vapt", label: "Internal VAPT Report" },
];

function SecurityReportPage() {
  const { isAdmin, role, isLoading } = useAppUser();
  const navigate = useNavigate();
  const { report } = Route.useSearch();
  const activeReport: SecurityReportKind = report === "vapt" ? "vapt" : "compliance";
  const canAccess = FEATURES.administration && (isAdmin || role === "ITPM");

  useEffect(() => {
    if (!isLoading && !canAccess) navigate({ to: "/" });
  }, [isLoading, canAccess, navigate]);

  // The real gate is server-side, inside getSecurityReport itself — this
  // is only to avoid firing the request at all for someone who can't see
  // it, and to avoid a flash of the (empty) iframe before the redirect.
  const getReportFn = useServerFn(getSecurityReport);
  const query = useQuery({
    queryKey: ["security-report", activeReport],
    queryFn: () => getReportFn({ data: { report: activeReport } }),
    enabled: canAccess,
    retry: false,
  });

  if (isLoading || !canAccess) return null;

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b bg-background px-3 py-2">
        {REPORT_TABS.map((tab) => (
          <Button
            key={tab.value}
            type="button"
            size="sm"
            variant={activeReport === tab.value ? "default" : "ghost"}
            onClick={() => navigate({ to: "/security-report", search: { report: tab.value } })}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading report…
        </div>
      ) : query.isError ? (
        <div className="flex flex-1 items-center justify-center text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load report"}
        </div>
      ) : (
        <iframe
          title="Security Report"
          srcDoc={query.data?.html}
          sandbox="allow-same-origin allow-scripts"
          className="block w-full flex-1 border-0"
        />
      )}
    </div>
  );
}
