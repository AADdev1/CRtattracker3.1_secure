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
} from "lucide-react";
import type { ReactNode } from "react";
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
  { to: "/cr-sizes", label: "CR Size Management", icon: Ruler, hiddenForTester: true },
  { to: "/cr-allocation", label: "CR Allocation", icon: UserPlus, requiresAllocationAccess: true },
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
  async function onLogout() {
    await supabase.auth.signOut();
    router.invalidate();
    await router.navigate({ to: "/auth" });
  }
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="w-64 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="px-6 py-5 border-b border-sidebar-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="size-9 rounded-md bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center">
              <Activity className="size-5" />
            </div>
            <div>
              <div className="font-semibold text-xl leading-tight">Kpisavvy</div>
              {userName && (
                <div className="text-base text-sidebar-foreground/60 truncate max-w-40">
                  {userName}
                  {isAdmin ? " · Admin" : ""}
                </div>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onLogout}
            className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map((item) => {
            if ("requiresAllocationAccess" in item && !canSeeAllocation) return null;
            if ("requiresTesterAccess" in item && !canSeeTesterNav) return null;
            if ("requiresApproverAccess" in item && !canSeeApproverNav) return null;
            if ("hiddenForTester" in item && isTester) return null;
            const Icon = item.icon;
            const active =
              item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 overflow-x-hidden">{children}</main>
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
        {description ? (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="p-8 space-y-6">{children}</div>;
}