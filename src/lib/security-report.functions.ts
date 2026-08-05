// Serves the security/compliance reports to Admin/ITPM only. Report HTML
// is imported with Vite's ?raw suffix (inlined at build time, not read
// from disk at runtime — works the same on every host, same reasoning as
// the security headers in server.ts) but only ever loaded inside this
// handler, so it never reaches the client bundle for anyone who isn't
// authorized to see it. The route component fetches this on demand — the
// content only crosses the wire when a session with the right role calls it.
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";
import { assertFeatureEnabled } from "@/lib/release-config";

const REPORTS = {
  vapt: () => import("@/security-reports/vapt-report.html?raw"),
  compliance: () => import("@/security-reports/tagic-compliance-report.html?raw"),
} as const;

export type SecurityReportKind = keyof typeof REPORTS;

export const getSecurityReport = createServerFn({ method: "GET" })
  .inputValidator((data: { report?: SecurityReportKind }) => ({
    report: data.report === "compliance" ? "compliance" : ("vapt" as SecurityReportKind),
  }))
  .handler(async ({ data }) => {
    assertFeatureEnabled("administration");
    const { isAdmin, role } = await requireSessionUser();
    if (!isAdmin && role !== "ITPM") {
      throw new Error("Forbidden: only Admin or ITPM can view the security report");
    }
    const { default: html } = await REPORTS[data.report]();
    return { html };
  });
