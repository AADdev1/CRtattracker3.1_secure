// Serves the VAPT remediation report to Admin/ITPM only. The report HTML
// is imported with Vite's ?raw suffix (inlined at build time, not read
// from disk at runtime — works the same on every host, same reasoning as
// the security headers in server.ts) but only ever loaded inside this
// handler, so it never reaches the client bundle for anyone who isn't
// authorized to see it. The route component fetches this on demand — the
// content only crosses the wire when a session with the right role calls it.
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";

export const getSecurityReport = createServerFn({ method: "GET" }).handler(async () => {
  const { isAdmin, role } = await requireSessionUser();
  if (!isAdmin && role !== "ITPM") {
    throw new Error("Forbidden: only Admin or ITPM can view the security report");
  }
  const { default: html } = await import("@/security-reports/vapt-report.html?raw");
  return { html };
});
