import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAppUser } from "@/lib/app-user";
import { getSecurityReport } from "@/lib/security-report.functions";

export const Route = createFileRoute("/security-report")({
  head: () => ({ meta: [{ title: "Security Report · Kpisavvy" }] }),
  component: SecurityReportPage,
});

function SecurityReportPage() {
  const { isAdmin, role, isLoading } = useAppUser();
  const navigate = useNavigate();
  const canAccess = isAdmin || role === "ITPM";

  useEffect(() => {
    if (!isLoading && !canAccess) navigate({ to: "/" });
  }, [isLoading, canAccess, navigate]);

  // The real gate is server-side, inside getSecurityReport itself — this
  // is only to avoid firing the request at all for someone who can't see
  // it, and to avoid a flash of the (empty) iframe before the redirect.
  const getReportFn = useServerFn(getSecurityReport);
  const query = useQuery({
    queryKey: ["security-report"],
    queryFn: () => getReportFn(),
    enabled: canAccess,
    retry: false,
  });

  if (isLoading || !canAccess) return null;

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading report…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-destructive">
        {query.error instanceof Error ? query.error.message : "Failed to load report"}
      </div>
    );
  }

  return (
    <iframe
      title="Security Report"
      srcDoc={query.data?.html}
      sandbox="allow-same-origin"
      className="block w-screen h-screen border-0"
    />
  );
}
