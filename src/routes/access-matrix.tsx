import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell, PageHeader, PageBody } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useAppUser } from "@/lib/app-user";
import { FEATURES } from "@/lib/release-config";

export const Route = createFileRoute("/access-matrix")({
  head: () => ({ meta: [{ title: "Access Rights Matrix · Kpisavvy" }] }),
  component: AccessMatrixPage,
});

// Read straight off the actual route guards and server-fn checks (not the
// nav menu) — see app-shell.tsx's `nav` array and each module's
// assert*Access()/assert*Actor() function for the source of truth this
// mirrors. Keep this in sync whenever a role check changes elsewhere.
type Level = "full" | "scoped" | "view" | "none";

interface Cell {
  level: Level;
  label?: string;
  note?: string;
}

interface ScreenRow {
  name: string;
  route: string;
  description: string;
  flag?: string;
  uniform?: { level: Level; label?: string; note: string };
  admin?: Cell;
  pmo?: Cell;
  itpm?: Cell;
  ba?: Cell;
  tester?: Cell;
}

const SCREENS: ScreenRow[] = [
  {
    name: "Dashboard",
    route: "/",
    description: "Live KPI health tiles + near-breach / breached KPI tables.",
    admin: { level: "full", note: "Every CR/KPI/defect, unfiltered. Only role with the User and Application filter dropdowns." },
    pmo: {
      level: "view",
      note: "Active CRs tile counts every CR (PMO's global CR visibility) — but the KPI-status and Open Defects tiles are scoped to only CRs where PMO is BA/ITPM/SPOC. The two halves of this page use different rules.",
    },
    itpm: { level: "view", note: "Every tile scoped to CRs where they're actually named the ITPM. SPOC no longer broadens this." },
    ba: { level: "view", note: "Every tile scoped to CRs where they're actually named the BA. SPOC no longer broadens this; Open Defects stays 0 unless also named ITPM." },
    tester: { level: "view", note: "Page loads (has a role) but every tile reads zero — a Tester is never a CR's BA/ITPM." },
  },
  {
    name: "CR Repository",
    route: "/crs",
    description: "Browse all imported CRs; update status, deployment stage, post Updates.",
    admin: { level: "view", note: "Every CR, unfiltered. No edit controls at all — status/stage updates and CR Updates are PMO/BA/ITPM only." },
    pmo: { level: "full", note: "Every CR, unfiltered. Can update workflow status, deployment stage, and post CR Updates on any of them." },
    itpm: { level: "scoped", note: "Only CRs where they're actually named the ITPM (SPOC no longer broadens this) — same set is editable (status, deployment stage, Updates)." },
    ba: { level: "scoped", note: "Only CRs where they're actually named the BA (SPOC no longer broadens this) — same set is editable (status, deployment stage, Updates)." },
    tester: { level: "view", note: "Grid loads but is effectively empty (Testers never match a CR's BA/ITPM). No edit controls regardless." },
  },
  {
    name: "CR Detail",
    route: "/crs/$crNumber",
    description: "KPI timeline, workflow history, Updates log, open defects, testing progress.",
    admin: { level: "view", note: "Any CR. Entirely read-only page — no edit controls exist here for any role." },
    pmo: { level: "view", note: "Any CR (PMO's global visibility rule)." },
    itpm: { level: "view", note: "Only CRs where they're actually named the ITPM (SPOC no longer broadens this) — others 404 as “CR not found.”" },
    ba: { level: "view", note: "Only CRs where they're actually named the BA (SPOC no longer broadens this). Open Defects card is hidden entirely on a BA-only relation." },
    tester: { level: "none", note: "No CR ever resolves for a Tester — always “CR not found” in practice." },
  },
  {
    name: "CR Size Management",
    route: "/cr-sizes",
    description: "Set CR Size / Manual Notes; bulk set size or drop from KPI calculation.",
    admin: { level: "view", note: "Every CR, but no edit/bulk-action controls — read-only baseline." },
    pmo: { level: "full", note: "Edit size/notes and bulk set/drop on every CR." },
    itpm: { level: "scoped", note: "Only sees and can edit/drop CRs where they're the ITPM." },
    ba: { level: "scoped", note: "Only sees and can edit/drop CRs where they're the BA." },
    tester: { level: "none", note: "Route redirects home." },
  },
  {
    name: "CR Allocation",
    route: "/cr-allocation",
    description: "Fill in a missing BA and/or ITPM on a CR.",
    admin: { level: "full", note: "Assign, reassign, or clear either field on any CR missing one." },
    pmo: { level: "full", note: "Same as Admin — assign/reassign/clear either field on any CR missing one." },
    itpm: { level: "scoped", note: "Self-claim only, and SPOC-gated: sees and can claim the ITPM field only on CRs missing an ITPM whose application is in their own spoc_applications — being unassigned alone isn't enough. Can't touch BA or reassign others." },
    ba: { level: "scoped", note: "Self-claim only, and SPOC-gated: sees and can claim the BA field only on CRs missing a BA whose application is in their own spoc_applications — being unassigned alone isn't enough. Can't touch ITPM or reassign others." },
    tester: { level: "none", note: "Explicitly excluded — Testers have no allocation role." },
  },
  {
    name: "Data Import",
    route: "/upload",
    description: "Import CR CSV and Defect CSV; triggers a full KPI engine recalculation.",
    admin: { level: "full", note: "Import CR and Defect CSVs." },
    pmo: { level: "full", note: "Import CR and Defect CSVs." },
    itpm: { level: "full", note: "Import CR and Defect CSVs — no per-CR ownership restriction on import itself." },
    ba: { level: "full", note: "Import CR and Defect CSVs — no per-CR ownership restriction on import itself." },
    tester: { level: "none", note: "Route redirects home." },
  },
  {
    name: "KPI Worklist",
    route: "/worklist",
    description: "Every KPI result row, filterable by KPI / application / size / BA / ITPM / status.",
    admin: { level: "full", note: "Every KPI result. Only role with the BA/ITPM narrowing filters." },
    pmo: { level: "view", note: "Scoped to CRs where they're BA/ITPM/SPOC — not all CRs (one of two screens where PMO's usual “sees everything” rule is deliberately not extended)." },
    itpm: { level: "view", note: "Only ITPM-role KPIs, on CRs where they're actually named the ITPM (SPOC no longer broadens this)." },
    ba: { level: "view", note: "Only BA-role KPIs, on CRs where they're actually named the BA (SPOC no longer broadens this)." },
    tester: { level: "view", note: "Page loads but is effectively empty — no KPI result ever matches a Tester's relation." },
  },
  {
    name: "TAT Calculator Logic",
    route: "/tat-logic",
    description: "Static explainer: how working days, hold days, and Green/Amber/Red are computed.",
    uniform: { level: "view", note: "Identical for every role, including Tester — reference content only, gated on having a role or being Admin. Nothing to edit." },
  },
  {
    name: "KPI Configuration",
    route: "/kpis",
    description: "Define KPIs: start/end status, TAT per CR size, warning %, excluded statuses.",
    flag: "Release 4 · administration",
    admin: { level: "full", note: "Add, edit, delete KPI definitions and their excluded-status lists." },
    pmo: { level: "view", note: "Can see every KPI's configuration; Add/Edit/Delete controls are hidden and rejected server-side." },
    itpm: { level: "view", note: "Same read-only view as PMO." },
    ba: { level: "view", note: "Same read-only view as PMO." },
    tester: { level: "view", note: "Same read-only view — any role clears this screen's gate, Admin-only is enforced purely on the write actions." },
  },
  {
    name: "Defect Status Mapping",
    route: "/defect-statuses",
    description: "Maps raw defect statuses to open/closed for KPI + dashboard aggregation.",
    flag: "Release 4 · administration",
    admin: { level: "full", note: "Add/remove statuses, toggle open vs. closed." },
    pmo: { level: "none" },
    itpm: { level: "none" },
    ba: { level: "none" },
    tester: { level: "none", note: "Admin-only end to end — route and server both reject non-Admin." },
  },
  {
    name: "Test Case Upload",
    route: "/test-case-upload",
    description: "Upload a test case Excel per CR (shared pool, not per-Tester assignment); submit for approval.",
    flag: "Release 2 · testing",
    admin: { level: "full", note: "Explicit exception: Admin can upload/submit test cases for any CR too, same as a Tester." },
    pmo: { level: "none" },
    itpm: { level: "none" },
    ba: { level: "none" },
    tester: { level: "full", note: "Upload/re-upload and submit test cases for any CR — no per-Tester CR assignment exists." },
  },
  {
    name: "Test Case Approval",
    route: "/test-case-approval",
    description: "Queue of CRs with test cases Submitted, awaiting approve / send-back.",
    flag: "Release 2 · testing",
    admin: { level: "full", note: "Sees and can act on every submitted CR." },
    pmo: { level: "scoped", label: "Scoped*", note: "Only visible at all if is_test_case_approver is set on their account — then scoped to CRs where they're BA/ITPM/SPOC. Role alone is not enough." },
    itpm: { level: "scoped", label: "Scoped*", note: "Same approver-flag + BA/ITPM/SPOC scoping as PMO." },
    ba: { level: "scoped", label: "Scoped*", note: "Same approver-flag + BA/ITPM/SPOC scoping as PMO." },
    tester: { level: "none", note: "Approver flag without a qualifying staff role isn't enough — Testers aren't approvers by design." },
  },
  {
    name: "Test Case Review",
    route: "/test-case-review/$crNumber",
    description: "Per-CR test case list: approve / send back / comment, and set execution status once approved.",
    flag: "Release 2 · testing",
    admin: { level: "scoped", note: "Can approve/send back/comment on any CR. Cannot set Execution Status — that action checks role === 'Tester' literally, with no Admin bypass." },
    pmo: { level: "view", note: "Page always loads. Approve/send-back/comment only work if approver-flagged and BA/ITPM/SPOC for this CR; otherwise view-only. Never can set Execution Status." },
    itpm: { level: "view", note: "Same conditional approver rights as PMO. Never can set Execution Status." },
    ba: { level: "view", note: "Same conditional approver rights as PMO. Never can set Execution Status." },
    tester: { level: "scoped", note: "The only role that can set Execution Status (Tested / Defect Raised) — but only once the CR's test cases are Approved. Cannot approve/send back/comment." },
  },
  {
    name: "CR Planner",
    route: "/cr-planner",
    description: "Plan Dev / SIT / UAT / Production dates per CR.",
    flag: "Release 3 · planner",
    admin: { level: "view", note: "Every planner entry — read-only baseline, no Add/edit controls." },
    pmo: { level: "none" },
    itpm: { level: "scoped", note: "The only editor. Sees only CRs where they're the ITPM, both in the “add to planner” picker and the grid itself." },
    ba: { level: "none" },
    tester: { level: "none" },
  },
  {
    name: "Planner Calendar",
    route: "/planner-calendar",
    description: "Month-view Gantt of the planner grid, by developer / tester lane.",
    flag: "Release 3 · planner",
    admin: { level: "view", note: "Every planner entry, calendar view." },
    pmo: { level: "none" },
    itpm: { level: "view", note: "Same scoping as CR Planner's grid (own ITPM CRs only). Purely read-only page — no edit controls exist here for anyone." },
    ba: { level: "none" },
    tester: { level: "none" },
  },
  {
    name: "Deployment Planning",
    route: "/deployment-planning",
    description: "Create deployment schedules, assign CRs to them, progress deployment stage.",
    flag: "Release 3 · deployment",
    admin: { level: "view", note: "Every schedule and every eligible CR — but no manage controls at all (can't create a schedule, assign/remove a CR, or change stage)." },
    pmo: { level: "scoped", note: "Sees every schedule. Create/edit/complete a schedule record, and assign/remove CRs on one, only for applications in their spoc_applications." },
    itpm: { level: "scoped", note: "Sees every schedule. Cannot create/edit/complete a schedule record (PMO-only) — can only assign/remove/progress-stage on CRs where they're the ITPM." },
    ba: { level: "scoped", note: "Same as ITPM: sees every schedule, can assign/remove/progress-stage only on CRs where they're the BA. No schedule-record rights." },
    tester: { level: "none" },
  },
  {
    name: "User & Role Management",
    route: "/users",
    description: "Would create accounts and assign roles / SPOC applications in-app.",
    uniform: {
      level: "none",
      label: "None (disabled)",
      note: "Same placeholder for every role, including Admin — the in-app UI was deliberately disabled after a security review (unrestricted temp-password creation). Accounts, roles, and spoc_applications are currently provisioned directly in Supabase.",
    },
  },
  {
    name: "Security Report",
    route: "/security-report",
    description: "TAGIC-IR-GL-001 compliance report and internal VAPT report.",
    flag: "Release 4 · administration",
    admin: { level: "full" },
    pmo: { level: "none" },
    itpm: { level: "full", note: "Explicitly named alongside Admin — the only staff role with access." },
    ba: { level: "none" },
    tester: { level: "none" },
  },
];

const LEVEL_STYLE: Record<Level, { label: string; cls: string }> = {
  full: { label: "Full", cls: "bg-[color:var(--kpi-green-bg)] text-[color:var(--kpi-green)] ring-1 ring-[color:var(--kpi-green)]/30" },
  scoped: { label: "Scoped", cls: "bg-[color:var(--kpi-amber-bg)] text-[color:var(--kpi-amber)] ring-1 ring-[color:var(--kpi-amber)]/30" },
  view: { label: "View", cls: "bg-[color:var(--kpi-pending-bg)] text-[color:var(--kpi-pending)] ring-1 ring-[color:var(--kpi-pending)]/30" },
  none: { label: "None", cls: "bg-muted text-muted-foreground ring-1 ring-border" },
};

function AccessPill({ level, label }: { level: Level; label?: string }) {
  const m = LEVEL_STYLE[level];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", m.cls)}>
      {label ?? m.label}
    </span>
  );
}

function RoleCell({ cell }: { cell?: Cell }) {
  if (!cell) return <TableCell className="align-top">—</TableCell>;
  return (
    <TableCell className="align-top min-w-56">
      <AccessPill level={cell.level} label={cell.label} />
      {cell.note && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{cell.note}</p>}
    </TableCell>
  );
}

function AccessMatrixPage() {
  const { isAdmin, isLoading } = useAppUser();
  const navigate = useNavigate();
  // Governance/reference material about how every role's access works —
  // Admin-only, same tier as Defect Status Mapping and gated behind the
  // same Release 4 (administration) flag as the rest of that group.
  const canAccess = FEATURES.administration && isAdmin;

  useEffect(() => {
    if (!isLoading && !canAccess) navigate({ to: "/" });
  }, [isLoading, canAccess, navigate]);

  if (isLoading || !canAccess) return null;

  return (
    <AppShell>
      <PageHeader
        title="Access Rights Matrix"
        description="Every screen in the app, and exactly what each role can see and do on it — read straight from the current route guards and server-side checks."
      />
      <PageBody>
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Legend
            </span>
            <span className="flex items-center gap-2">
              <AccessPill level="full" /> unrestricted read + write, every record
            </span>
            <span className="flex items-center gap-2">
              <AccessPill level="scoped" /> read + write, but only their own / assigned records
            </span>
            <span className="flex items-center gap-2">
              <AccessPill level="view" /> read-only (data may itself be scoped — see note)
            </span>
            <span className="flex items-center gap-2">
              <AccessPill level="none" /> blocked — route redirects, server rejects
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-20 w-64 min-w-64 bg-card">Screen</TableHead>
                  <TableHead className="min-w-56">Admin</TableHead>
                  <TableHead className="min-w-56">PMO</TableHead>
                  <TableHead className="min-w-56">ITPM</TableHead>
                  <TableHead className="min-w-56">BA</TableHead>
                  <TableHead className="min-w-56">Tester</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SCREENS.map((s) => (
                  <TableRow key={s.route}>
                    <TableCell className="sticky left-0 z-10 w-64 min-w-64 bg-card align-top border-r">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs font-mono text-muted-foreground mt-0.5">{s.route}</div>
                      <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                        {s.description}
                      </div>
                      {s.flag && (
                        <span className="inline-block mt-2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          {s.flag}
                        </span>
                      )}
                    </TableCell>
                    {s.uniform ? (
                      <TableCell colSpan={5} className="align-top">
                        <AccessPill level={s.uniform.level} label={s.uniform.label} />
                        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground max-w-2xl">
                          {s.uniform.note}
                        </p>
                      </TableCell>
                    ) : (
                      <>
                        <RoleCell cell={s.admin} />
                        <RoleCell cell={s.pmo} />
                        <RoleCell cell={s.itpm} />
                        <RoleCell cell={s.ba} />
                        <RoleCell cell={s.tester} />
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3 text-sm text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">Admin + role are independent — </span>
              is_admin and role are separate columns on user_management; one account can hold both.
              Most checks are <code className="text-xs">isAdmin || role === 'X'</code>, so a
              dual-flagged account gets the union of whatever Admin and their role each unlock — not
              a downgrade to one or the other. The few exceptions are called out inline above (e.g.
              Execution Status on Test Case Review, or schedule-record edits on Deployment Planning).
            </div>
            <div>
              <span className="font-medium text-foreground">&quot;SPOC&quot; means something different per role — </span>
              a user&apos;s user_management.spoc_applications (an array of application names) still
              broadens PMO&apos;s visibility (Dashboard&apos;s CR list, the KPI Worklist) and the
              approver rights on Test Case Approval/Review, for any role that holds the approver
              flag — but it no longer broadens CR visibility for ITPM/BA on Dashboard, CR
              Repository, CR Detail, or the Worklist; there, they&apos;re limited strictly to CRs
              where they&apos;re actually named ba/itpm. For ITPM/BA, SPOC now matters in exactly
              one place instead — CR Allocation — where it&apos;s not a broadener at all but a hard
              requirement: they can only claim a CR whose application is on their own
              spoc_applications list.
            </div>
            <div>
              <span className="font-medium text-foreground">&quot;View&quot; (empty) vs. &quot;None&quot; — </span>
              where a role clears a screen&apos;s role-or-admin gate but the underlying data query
              can never return a match for that role (e.g. Tester on CR Repository/Detail/Worklist),
              the screen is marked View with a note — it&apos;s reachable, just permanently empty.
              None means the route itself redirects home and the server functions reject the call
              outright.
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </AppShell>
  );
}
