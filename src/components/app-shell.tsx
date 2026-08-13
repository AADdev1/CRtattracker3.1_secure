import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Upload,
  Database,
  Ruler,
  Settings2,
  ListChecks,
  Images,
  Activity,
  Bug,
  Calculator,
  LogOut,
  UserPlus,
  FileSpreadsheet,
  ClipboardCheck,
  ShieldCheck,
  ClipboardList,
  CalendarRange,
  CalendarDays,
  PanelLeftClose,
  PanelLeftOpen,
  KeyRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAppUser } from "@/lib/app-user";
import { FEATURES } from "@/lib/release-config";

// Testers only ever see Dashboard + Test Case Upload — the rest of these
// (CR-management screens) aren't relevant to a shared test-case pool.
const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/upload", label: "Data Import", icon: Upload, hiddenForTester: true },
  { to: "/crs", label: "CR Repository", icon: Database, hiddenForTester: true },
  // CR Size Management: PMO/BA/ITPM can edit; Admin gets the app-wide
  // "read-only everywhere" baseline (view only — the edit controls are
  // hidden for Admin in cr-sizes.tsx, and writes stay blocked server-side
  // in crs-admin.functions.ts).
  { to: "/cr-sizes", label: "CR Size Management", icon: Ruler, requiresCrEditAccess: true },
  { to: "/cr-allocation", label: "CR Allocation", icon: UserPlus, requiresAllocationAccess: true },
  // Deployment Management (Phase 4) — PMO/ITPM/BA manage schedules and
  // assignments; Admin sees the same screens read-only (can't create/
  // assign/update-stage, enforced server-side in deployment.functions.ts).
  // Testers and no-role users don't get this link at all. One screen now
  // covers schedule creation, CR assignment, and stage/status tracking —
  // Deployment Schedule and Deployment Dashboard were both merged into it.
  {
    to: "/deployment-planning",
    label: "Deployment Planning",
    icon: ClipboardList,
    requiresDeploymentAccess: true,
    feature: "deployment",
  },
  // CR Planner is a standalone module (see cr-planner.functions.ts). ITPM
  // can edit; Admin gets the app-wide read-only baseline (view the grid,
  // no Add/edit controls — see cr-planner.tsx). Editing itself stays
  // ITPM-only, enforced server-side in assertPlannerActor.
  {
    to: "/cr-planner",
    label: "CR Planner",
    icon: CalendarRange,
    requiresItpmOnlyAccess: true,
    feature: "planner",
  },
  // Same audience as CR Planner — a calendar view derived entirely from
  // cr_planner data.
  {
    to: "/planner-calendar",
    label: "Planner Calendar",
    icon: CalendarDays,
    requiresPlannerCalendarAccess: true,
    feature: "planner",
  },
  {
    to: "/test-case-upload",
    label: "Test Case Upload",
    icon: FileSpreadsheet,
    requiresTesterAccess: true,
    feature: "testing",
  },
  {
    to: "/test-case-approval",
    label: "Test Case Approval",
    icon: ClipboardCheck,
    requiresApproverAccess: true,
    feature: "testing",
  },
  // Everyone with a role or Admin can view — same tier as Dashboard, no
  // extra requires* gate. Upload itself is restricted to Tester/Admin
  // inside test-result-screenshots.functions.ts and on the CR detail /
  // Test Case Review pages, not here.
  { to: "/test-result-screenshots", label: "Test Results", icon: Images, feature: "testing" },
  {
    to: "/kpis",
    label: "KPI Configuration",
    icon: Settings2,
    hiddenForTester: true,
    feature: "administration",
  },
  // Admin-only in practice (defect-statuses.tsx's page guard is
  // `!isAdmin` → redirect) — a dedicated flag instead of `hiddenForTester`
  // so PMO/BA/ITPM don't see a nav link that immediately bounces them.
  {
    to: "/defect-statuses",
    label: "Defect Status Mapping",
    icon: Bug,
    requiresAdminOnlyAccess: true,
    feature: "administration",
  },
  { to: "/worklist", label: "KPI Worklist", icon: ListChecks, hiddenForTester: true },
  { to: "/tat-logic", label: "TAT Calculator Logic", icon: Calculator, hiddenForTester: true },
  // Admin/ITPM only — the real gate is server-side in
  // security-report.functions.ts; this just keeps the link off the nav
  // for everyone else. Opens in a new tab so it doesn't replace the app.
  {
    to: "/security-report",
    label: "Security Report",
    icon: ShieldCheck,
    requiresSecurityReportAccess: true,
    openInNewTab: true,
    feature: "administration",
  },
  // Admin-only reference doc — same tier as Defect Status Mapping. The real
  // gate is server-side in access-matrix.tsx's own canAccess check; this
  // just keeps the link off the nav for everyone else.
  {
    to: "/access-matrix",
    label: "Access Rights",
    icon: KeyRound,
    requiresAdminOnlyAccess: true,
    feature: "administration",
  },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const { userName, isAdmin, role, isTestCaseApprover } = useAppUser();
  const isTester = role === "Tester" && !isAdmin;
  // CR Allocation is a BA/ITPM/PMO feature — separate from the Tester's
  // Test Case Management module.
  const canSeeAllocation = isAdmin || (role != null && role !== "Tester");
  const canSeeTesterNav = isAdmin || role === "Tester";
  // A no-role account can't use the approver flag alone to get in — it's
  // only meaningful paired with an actual staff role.
  const canSeeApproverNav = isAdmin || (role != null && isTestCaseApprover);
  const canSeeCrSizes = isAdmin || role === "PMO" || role === "BA" || role === "ITPM";
  const canSeeSecurityReport = isAdmin || role === "ITPM";
  // Admin can view Deployment Management (read-only — see deployment.functions.ts)
  // but not act on it, unlike CR Size Management where Admin has no access
  // at all — so Admin is included here for nav visibility.
  const canSeeDeployment = isAdmin || role === "PMO" || role === "ITPM" || role === "BA";
  // CR Planner: ITPM can edit; Admin gets the read-only baseline too.
  const canSeePlanner = isAdmin || role === "ITPM";
  // Planner Calendar: same audience as CR Planner.
  const canSeePlannerCalendar = isAdmin || role === "ITPM";
  // A no-role account (not Admin, no staff role assigned) has no
  // legitimate use for any screen in this app — matches the server-side
  // assertHasRoleOrAdmin() gate now applied to every previously-open read.
  const noRoleBlocked = !isAdmin && role == null;
  // Persisted across navigations (AppShell remounts per route) and reloads
  // via localStorage — this is a pure UI preference, no reason to round-trip
  // it through the backend.
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("sidebar-collapsed") === "true",
  );
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }
  async function onLogout() {
    await supabase.auth.signOut();
    router.invalidate();
    await router.navigate({ to: "/auth" });
  }
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={cn(
          "shrink-0 bg-sidebar text-sidebar-foreground flex flex-col transition-[width] duration-200",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div className="px-3 py-5 border-b border-sidebar-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="size-9 rounded-md bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center shrink-0">
              <Activity className="size-5" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-semibold text-xl leading-tight truncate">Kpisavvy</div>
                {userName && (
                  <div className="text-base text-sidebar-foreground/60 truncate max-w-40">
                    {userName}
                    {isAdmin ? " · Admin" : ""}
                  </div>
                )}
              </div>
            )}
          </div>
          {!collapsed && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onLogout}
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent shrink-0"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          )}
        </div>
        <div className="px-3 py-2 border-b border-sidebar-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCollapsed}
            className={cn(
              "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
              collapsed && "w-full",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </Button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map((item) => {
            // No role and not Admin = no legitimate use for any screen —
            // this must win over every other check below.
            if (noRoleBlocked) return null;
            // Release gate — wins over every role check below too. A
            // module outside the current release is invisible regardless
            // of who's looking at it.
            if ("feature" in item && !FEATURES[item.feature]) return null;
            if ("requiresAllocationAccess" in item && !canSeeAllocation) return null;
            if ("requiresTesterAccess" in item && !canSeeTesterNav) return null;
            if ("requiresApproverAccess" in item && !canSeeApproverNav) return null;
            if ("requiresCrEditAccess" in item && !canSeeCrSizes) return null;
            if ("requiresSecurityReportAccess" in item && !canSeeSecurityReport) return null;
            if ("requiresDeploymentAccess" in item && !canSeeDeployment) return null;
            if ("requiresItpmOnlyAccess" in item && !canSeePlanner) return null;
            if ("requiresPlannerCalendarAccess" in item && !canSeePlannerCalendar) return null;
            if ("requiresAdminOnlyAccess" in item && !isAdmin) return null;
            if ("hiddenForTester" in item && isTester) return null;
            const Icon = item.icon;
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                {...("openInNewTab" in item
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  collapsed && "justify-center px-2",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>
        {collapsed && (
          <div className="px-3 pb-4 pt-3 border-t border-sidebar-border">
            <Button
              variant="ghost"
              size="icon"
              onClick={onLogout}
              className="w-full text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        )}
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="border-b bg-card px-8 py-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground mt-1">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="p-8 space-y-6">{children}</div>;
}
