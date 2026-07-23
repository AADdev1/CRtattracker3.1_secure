import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Upload,
  Database,
  Ruler,
  Settings2,
  ListChecks,
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
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAppUser } from "@/lib/app-user";

// Testers only ever see Dashboard + Test Case Upload — the rest of these
// (CR-management screens) aren't relevant to a shared test-case pool.
const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/upload", label: "Data Import", icon: Upload, hiddenForTester: true },
  { to: "/crs", label: "CR Repository", icon: Database, hiddenForTester: true },
  // CR Size Management is a PMO/BA/ITPM function-of-record, not an Admin
  // one — Admin (without also holding one of those job roles) doesn't get
  // this link, matching the server-side check in crs-admin.functions.ts.
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
  },
  // CR Planner is a standalone, ITPM-exclusive module (see
  // cr-planner.functions.ts) — deliberately ITPM only, no Admin bypass,
  // unlike every other requires*Access flag in this file.
  { to: "/cr-planner", label: "CR Planner", icon: CalendarRange, requiresItpmOnlyAccess: true },
  {
    to: "/test-case-upload",
    label: "Test Case Upload",
    icon: FileSpreadsheet,
    requiresTesterAccess: true,
  },
  {
    to: "/test-case-approval",
    label: "Test Case Approval",
    icon: ClipboardCheck,
    requiresApproverAccess: true,
  },
  { to: "/kpis", label: "KPI Configuration", icon: Settings2, hiddenForTester: true },
  { to: "/defect-statuses", label: "Defect Status Mapping", icon: Bug, hiddenForTester: true },
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
  const canSeeApproverNav = isAdmin || isTestCaseApprover;
  const canSeeCrSizes = role === "PMO" || role === "BA" || role === "ITPM";
  const canSeeSecurityReport = isAdmin || role === "ITPM";
  // Admin can view Deployment Management (read-only — see deployment.functions.ts)
  // but not act on it, unlike CR Size Management where Admin has no access
  // at all — so Admin is included here for nav visibility.
  const canSeeDeployment = isAdmin || role === "PMO" || role === "ITPM" || role === "BA";
  // CR Planner: ITPM only, deliberately excluding Admin — matches the
  // spec's "Visible only for ITPM users" literally.
  const canSeePlanner = role === "ITPM";
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
            if ("requiresAllocationAccess" in item && !canSeeAllocation) return null;
            if ("requiresTesterAccess" in item && !canSeeTesterNav) return null;
            if ("requiresApproverAccess" in item && !canSeeApproverNav) return null;
            if ("requiresCrEditAccess" in item && !canSeeCrSizes) return null;
            if ("requiresSecurityReportAccess" in item && !canSeeSecurityReport) return null;
            if ("requiresDeploymentAccess" in item && !canSeeDeployment) return null;
            if ("requiresItpmOnlyAccess" in item && !canSeePlanner) return null;
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
