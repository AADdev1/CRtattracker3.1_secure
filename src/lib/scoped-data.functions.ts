// Server-side scoping for CRs/KPI results/defects by BA/ITPM name match.
// A CR is visible to the logged-in user when their user_management.user_name
// exactly equals crs.ba and/or crs.itpm. Admins (user_management.is_admin)
// bypass this entirely and see every CR/KPI/defect unfiltered.
//
// Uses the service-role client (RLS is locked down on these tables — see
// supabase/migrations/20260703000000_lock_down_rls.sql), loaded dynamically
// inside each handler so client.server.ts never gets pulled into the client
// bundle (this file is reachable from route components).
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CrRelation = "ba" | "itpm" | "both" | "admin";

type CrRow = Database["public"]["Tables"]["crs"]["Row"];

interface ScopedInput {
  crNumber?: string;
}

function relationFor(row: { ba: string | null; itpm: string | null }, userName: string): CrRelation | null {
  const isBa = row.ba === userName;
  const isItpm = row.itpm === userName;
  if (isBa && isItpm) return "both";
  if (isBa) return "ba";
  if (isItpm) return "itpm";
  return null;
}

async function loadScopedCrs(
  db: SupabaseClient<Database>,
  userName: string,
  isAdmin: boolean,
  crNumber?: string,
) {
  const columns = crNumber
    ? "*"
    : "cr_number, title, application, severity, workflow_status, cr_size, date_created, date_modified, ba, itpm";
  let query = db.from("crs").select(columns);
  if (crNumber) query = query.eq("cr_number", crNumber);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => ({
      row: row as unknown as CrRow,
      relation: isAdmin ? ("admin" as const) : relationFor(row as unknown as CrRow, userName),
    }))
    .filter((x): x is { row: CrRow; relation: CrRelation } => x.relation !== null);
}

export const getScopedCrs = createServerFn({ method: "GET" })
  .inputValidator((data: ScopedInput | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const { userName, isAdmin } = await requireSessionUser();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const scoped = await loadScopedCrs(supabaseAdmin, userName, isAdmin, data.crNumber);
    if (data.crNumber) {
      const only = scoped[0];
      return only ? { ...only.row, relation: only.relation } : null;
    }
    return scoped.map((s) => ({ ...s.row, relation: s.relation }));
  });

// A CR's relation decides which KPI role(s) apply: BA-only shows BA KPIs,
// ITPM-only shows ITPM KPIs, both/admin shows both — same KPI can be BA on
// one CR and ITPM on another purely by which name column matched.
function roleAllowedForRelation(role: string | undefined, relation: CrRelation): boolean {
  if (relation === "both" || relation === "admin") return true;
  return role === (relation === "ba" ? "BA" : "ITPM");
}

export const getScopedKpiResults = createServerFn({ method: "GET" })
  .inputValidator((data: ScopedInput | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const { userName, isAdmin } = await requireSessionUser();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const scoped = await loadScopedCrs(supabaseAdmin, userName, isAdmin, data.crNumber);
    if (scoped.length === 0) return [];
    const crMap = new Map(scoped.map((s) => [s.row.cr_number, s]));
    const { data: results, error } = await supabaseAdmin
      .from("kpi_results")
      .select(
        "id, cr_number, start_date, end_date, working_days, hold_days, effective_days, tat, remaining_days, utilization_pct, status, kpis(id, name, role, start_status_code, end_status_code, warning_pct, small_tat, medium_tat, large_tat)",
      )
      .in("cr_number", Array.from(crMap.keys()))
      .order("utilization_pct", { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (results ?? [])
      .filter((r) => roleAllowedForRelation(r.kpis?.role, crMap.get(r.cr_number)!.relation))
      .map((r) => {
        const c = crMap.get(r.cr_number)!;
        return {
          ...r,
          relation: c.relation,
          crs: { application: c.row.application, cr_size: c.row.cr_size, ba: c.row.ba, itpm: c.row.itpm },
        };
      });
  });

export const getScopedDefects = createServerFn({ method: "GET" })
  .inputValidator((data: ScopedInput | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const { userName, isAdmin } = await requireSessionUser();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const scoped = await loadScopedCrs(supabaseAdmin, userName, isAdmin, data.crNumber);
    // Admins see every defect, not just open ones; everyone else only sees
    // open defects on CRs where they're the ITPM (or BA+ITPM).
    const visible = isAdmin ? scoped : scoped.filter((s) => s.relation === "itpm" || s.relation === "both");
    if (visible.length === 0) return [];
    const crNumbers = visible.map((s) => s.row.cr_number);
    const [{ data: defects, error: dErr }, { data: mapping, error: mErr }] = await Promise.all([
      supabaseAdmin
        .from("defects")
        .select("defect_no, summary, cr_number, new_status, date_created, date_modified")
        .in("cr_number", crNumbers)
        .order("date_created", { ascending: false }),
      supabaseAdmin.from("defect_status_mapping").select("status, is_open"),
    ]);
    if (dErr) throw new Error(dErr.message);
    if (mErr) throw new Error(mErr.message);
    if (isAdmin) return defects ?? [];
    const openSet = new Set((mapping ?? []).filter((m) => m.is_open).map((m) => m.status));
    return (defects ?? []).filter((d) => d.new_status && openSet.has(d.new_status));
  });
