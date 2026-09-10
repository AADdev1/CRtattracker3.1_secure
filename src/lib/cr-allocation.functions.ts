// CR Allocation screen — filling in missing crs.itpm / crs.ba, and
// assigning crs.tester (the Test Case Management module's per-CR Tester
// "bucket" — see test-cases.functions.ts). PMO/Admin can assign itpm/ba on
// any CR missing one; ITPM/BA can only self-claim the field matching their
// own role, and — unlike CR visibility elsewhere (see
// scoped-data.functions.ts) — SPOC status is exactly what gates that claim
// here: an ITPM/BA may only claim a CR whose application is in their own
// user_management.spoc_applications, not just any unassigned CR of their
// role. Gated by user_management.role (independent of is_admin — see
// requireSessionUser).
//
// Tester assignment is a third, distinct pattern: ITPM or PMO (or Admin,
// unscoped) assigns *someone else* — a Tester — rather than self-claiming,
// but still SPOC-gated the same way: only for a CR whose application is in
// the assigner's own spoc_applications, and only to a Tester whose own
// spoc_applications also covers that application. BA has no role in tester
// assignment.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSessionUser } from "@/lib/gate.functions";
import { text, optionalText, validated } from "@/lib/validation";

const ALLOCATION_COLUMNS = "cr_number, title, application, severity, workflow_status, ba, itpm";

export const listUnassignedCrs = createServerFn({ method: "GET" }).handler(async () => {
  const { isAdmin, role, spocApplications } = await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (isAdmin || role === "PMO") {
    const { data, error } = await supabaseAdmin
      .from("crs")
      .select(ALLOCATION_COLUMNS)
      .or("itpm.is.null,ba.is.null")
      .order("cr_number");
    if (error) throw new Error(error.message);
    return data;
  }
  // ITPM/BA only see (and, in claimCr below, can only claim) CRs whose
  // application they're the SPOC for — being unassigned alone isn't enough.
  if (role === "ITPM") {
    const { data, error } = await supabaseAdmin
      .from("crs")
      .select(ALLOCATION_COLUMNS)
      .is("itpm", null)
      .order("cr_number");
    if (error) throw new Error(error.message);
    return (data ?? []).filter((c) => !!c.application && spocApplications.includes(c.application));
  }
  if (role === "BA") {
    const { data, error } = await supabaseAdmin
      .from("crs")
      .select(ALLOCATION_COLUMNS)
      .is("ba", null)
      .order("cr_number");
    if (error) throw new Error(error.message);
    return (data ?? []).filter((c) => !!c.application && spocApplications.includes(c.application));
  }

  throw new Error("Forbidden: no allocation role assigned");
});

// Admin/PMO only — populates the assignment dropdowns.
export const listStaffByRole = createServerFn({ method: "GET" }).handler(async () => {
  const { isAdmin, role } = await requireSessionUser();
  if (!isAdmin && role !== "PMO") throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_management")
    .select("user_name, role")
    .eq("is_active", true)
    .in("role", ["ITPM", "BA"]);
  if (error) throw new Error(error.message);
  return {
    itpmUsers: (data ?? [])
      .filter((u) => u.role === "ITPM")
      .map((u) => u.user_name)
      .sort(),
    baUsers: (data ?? [])
      .filter((u) => u.role === "BA")
      .map((u) => u.user_name)
      .sort(),
  };
});

// Admin/PMO only — assign, reassign, or clear (userName: null) either
// field on any CR.
export const assignCrField = createServerFn({ method: "POST" })
  .inputValidator(
    validated(z.object({ crNumber: text, field: text, userName: optionalText })),
  )
  .handler(async ({ data }) => {
    const { isAdmin, role } = await requireSessionUser();
    if (!isAdmin && role !== "PMO") throw new Error("Forbidden");
    // data.field is only checked by TypeScript at compile time — a caller
    // hitting this RPC directly (not through the typed frontend) could
    // otherwise pass any crs column name here. Same runtime whitelist
    // claimCr below already does.
    if (data.field !== "itpm" && data.field !== "ba") {
      throw new Error("Forbidden: field must be itpm or ba");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("crs")
      .update({ [data.field]: data.userName } as never)
      .eq("cr_number", data.crNumber);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ITPM/BA self-service — can only claim the field matching their own role,
// only for a CR whose application they're the SPOC for, and only if the
// field is still empty (atomic conditional update, same pattern as
// kpi_engine_lock, so two people racing to claim the same CR can't both win).
export const claimCr = createServerFn({ method: "POST" })
  .inputValidator(validated(z.object({ crNumber: text, field: text })))
  .handler(async ({ data }) => {
    const { userName, role, spocApplications } = await requireSessionUser();
    if (role !== "ITPM" && role !== "BA") throw new Error("Forbidden");
    if (data.field !== (role === "ITPM" ? "itpm" : "ba")) {
      throw new Error("Forbidden: you can only claim your own field");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: cr, error: fetchErr } = await supabaseAdmin
      .from("crs")
      .select("application")
      .eq("cr_number", data.crNumber)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!cr) throw new Error("CR not found");
    if (!cr.application || !spocApplications.includes(cr.application)) {
      throw new Error(
        `Forbidden: you're not the SPOC for ${cr.application ?? "this CR's"} application`,
      );
    }

    const { data: claimed, error } = await supabaseAdmin
      .from("crs")
      .update({ [data.field]: userName } as never)
      .eq("cr_number", data.crNumber)
      .is(data.field, null)
      .select("cr_number");
    if (error) throw new Error(error.message);
    if (!claimed || claimed.length === 0) {
      throw new Error("This CR was already claimed by someone else.");
    }
    return { ok: true as const };
  });

// ─────────────────────── Tester assignment ───────────────────────

// CRs with no Tester assigned yet — either never assigned, or just
// released back into the pool by updateExecutionStatus
// (test-cases.functions.ts) once every one of the CR's test cases has a
// final execution outcome. Dropped CRs are excluded, same "NULL counts as
// not dropped" convention used throughout (e.g. cr-planner.functions.ts's
// listActiveCrsForPlanner). ITPM/PMO only see (and, in assignTester below,
// can only assign) CRs whose application is in their own spoc_applications;
// Admin sees every one, unscoped.
export const listCrsNeedingTester = createServerFn({ method: "GET" }).handler(async () => {
  const { isAdmin, role, spocApplications } = await requireSessionUser();
  if (!isAdmin && role !== "PMO" && role !== "ITPM") throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin
    .from("crs")
    .select("cr_number, title, application, severity, workflow_status, tester")
    .is("tester", null)
    .or("is_dropped.is.null,is_dropped.eq.false")
    .order("cr_number");
  if (error) throw new Error(error.message);

  if (isAdmin) return data;
  return (data ?? []).filter((c) => !!c.application && spocApplications.includes(c.application));
});

// ITPM/PMO/Admin only — populates the tester-assignment dropdown. Returns
// every active Tester with their own spoc_applications so the caller can
// filter, per row, to testers who actually cover that CR's application
// (client-side, same shape as listStaffByRole's itpmOptions/baOptions).
export const listTestersForAssignment = createServerFn({ method: "GET" }).handler(async () => {
  const { isAdmin, role } = await requireSessionUser();
  if (!isAdmin && role !== "PMO" && role !== "ITPM") throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_management")
    .select("user_name, spoc_applications")
    .eq("is_active", true)
    .eq("role", "Tester");
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((u) => ({ user_name: u.user_name, spocApplications: u.spoc_applications ?? [] }))
    .sort((a, b) => a.user_name.localeCompare(b.user_name));
});

// Assign (or clear, testerUserName: null) crs.tester. Admin: any CR,
// unscoped. PMO/ITPM: only a CR whose application is in their own
// spoc_applications — same SPOC gate claimCr uses, but assigning someone
// else rather than self-claiming, since a PMO/ITPM is never the Tester.
export const assignTester = createServerFn({ method: "POST" })
  .inputValidator(validated(z.object({ crNumber: text, testerUserName: optionalText })))
  .handler(async ({ data }) => {
    const { isAdmin, role, spocApplications } = await requireSessionUser();
    if (!isAdmin && role !== "PMO" && role !== "ITPM") throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!isAdmin) {
      const { data: cr, error: fetchErr } = await supabaseAdmin
        .from("crs")
        .select("application")
        .eq("cr_number", data.crNumber)
        .maybeSingle();
      if (fetchErr) throw new Error(fetchErr.message);
      if (!cr) throw new Error("CR not found");
      if (!cr.application || !spocApplications.includes(cr.application)) {
        throw new Error(
          `Forbidden: you're not the SPOC for ${cr.application ?? "this CR's"} application`,
        );
      }
    }

    const { error } = await supabaseAdmin
      .from("crs")
      .update({ tester: data.testerUserName } as never)
      .eq("cr_number", data.crNumber);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
