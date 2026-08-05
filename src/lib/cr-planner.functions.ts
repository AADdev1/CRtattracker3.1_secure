// CR Planner — standalone Dev/SIT/UAT/Production timeline planning for
// ITPM. Deliberately independent of every other module: crs is read-only
// reference data here (never written to), and this imports nothing from
// deployment.functions.ts — if this module were deleted, nothing else in
// the app would need to change. One deliberate, explicitly-requested
// exception: PROD Date options are read (SELECT only, never written) from
// the Deployment Planning module's deployment_schedule table, filtered to
// status = 'Planned' — CR Planner has no "add a date" capability of its
// own, it just mirrors what's already scheduled there.
//
// Visibility is scoped to assigned CRs: listActiveCrsForPlanner (ITPM-only)
// and listPlannerGrid only show CRs where the caller is the CR's assigned
// itpm. Admin keeps the app-wide "read-only everywhere" baseline on the
// planner grid and sees every entry, unfiltered.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSessionUser } from "@/lib/gate.functions";
import { assertFeatureEnabled } from "@/lib/release-config";
import { addWorkingDays, toIsoDateKey } from "@/lib/working-days";
import { text, optionalText, validated } from "@/lib/validation";
import type { Database } from "@/integrations/supabase/types";

type PlannerRow = Database["public"]["Tables"]["cr_planner"]["Row"];

// ITPM only — no Admin bypass. Editing the planner stays a PMO/BA/ITPM-
// style function-of-record, not an Admin one, matching the spec's
// "Visible only for ITPM users" literally for the write path.
async function assertPlannerActor() {
  assertFeatureEnabled("planner");
  const session = await requireSessionUser();
  if (session.role !== "ITPM") {
    throw new Error("Forbidden: CR Planner is available to ITPM only");
  }
  return session;
}

// ITPM or Admin — Admin gets the app-wide "read-only everywhere" baseline
// on the planner grid and PROD Date list, without unlocking any of the
// edit/add actions above (those still go through assertPlannerActor).
async function assertPlannerViewer() {
  assertFeatureEnabled("planner");
  const session = await requireSessionUser();
  if (session.role !== "ITPM" && !session.isAdmin) {
    throw new Error("Forbidden: CR Planner is available to ITPM and Admin only");
  }
  return session;
}

// Same terminal-status idea as deployment.functions.ts's
// DEPLOYMENT_TERMINAL_WORKFLOW_STATUSES, but a separate, self-contained
// copy — this module intentionally shares no code with the Deployment
// Management module. workflow_status is inconsistently formatted in live
// data (CSV import sometimes writes the raw CMS code with underscores,
// sometimes the space-separated label), so both forms are listed.
const PLANNER_EXCLUDED_WORKFLOW_STATUSES = new Set([
  "28_Deployed in Production",
  "28 Deployed in Production",
  "28_Tech Go Delpoyed in Production",
  "28 Tech Go - Deployed in Production",
  "29_Live and Closed",
  "29 Live and Closed",
  "30_Issue in production",
  "30 Issue in Production",
]);

// ─────────────────────────── Reads ───────────────────────────

// Active CRs eligible to be added to the planner: not dropped, not at a
// Deployed/Closed terminal status, not already in cr_planner, and — since
// this list is ITPM-only (assertPlannerActor) — scoped to CRs where the
// caller is actually the assigned ITPM.
export const listActiveCrsForPlanner = createServerFn({ method: "GET" }).handler(async () => {
  const { userName } = await assertPlannerActor();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // is_dropped is nullable in the live table (not every row has it
  // explicitly set to false) — matching the convention already used in
  // kpi-engine.ts (!cr.is_dropped), NULL counts as "not dropped", not
  // "unknown/excluded". .eq("is_dropped", false) would silently drop
  // every NULL row too, since SQL's NULL = false is never true.
  const [{ data: crs, error: crsErr }, { data: planned, error: plannedErr }] = await Promise.all([
    supabaseAdmin
      .from("crs")
      .select("cr_number, title, workflow_status, itpm")
      .or("is_dropped.is.null,is_dropped.eq.false"),
    supabaseAdmin.from("cr_planner").select("cr_number"),
  ]);
  if (crsErr) throw new Error(crsErr.message);
  if (plannedErr) throw new Error(plannedErr.message);

  const alreadyPlanned = new Set((planned ?? []).map((p) => p.cr_number));

  return (crs ?? [])
    .filter((c) => c.itpm === userName)
    .filter((c) => !alreadyPlanned.has(c.cr_number))
    .filter((c) => !c.workflow_status || !PLANNER_EXCLUDED_WORKFLOW_STATUSES.has(c.workflow_status))
    .map((c) => ({ cr_number: c.cr_number, title: c.title }));
});

// The planner grid — every cr_planner row, merged with its read-only
// display fields from crs (no SQL join, same client-side-merge style
// already used throughout this codebase, e.g. crs.tsx's defectStats map).
// ITPM only sees entries for CRs where they're the assigned ITPM; Admin
// keeps the app-wide "read-only everywhere" baseline and sees every entry.
export const listPlannerGrid = createServerFn({ method: "GET" }).handler(async () => {
  const { userName, isAdmin } = await assertPlannerViewer();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: planner, error: plannerErr } = await supabaseAdmin.from("cr_planner").select("*");
  if (plannerErr) throw new Error(plannerErr.message);
  if (!planner || planner.length === 0) return [];

  const { data: crs, error: crsErr } = await supabaseAdmin
    .from("crs")
    .select("cr_number, title, date_created, date_modified, created_user, workflow_status, itpm")
    .in(
      "cr_number",
      planner.map((p) => p.cr_number),
    );
  if (crsErr) throw new Error(crsErr.message);

  const crByNumber = new Map((crs ?? []).map((c) => [c.cr_number, c]));

  const visible = isAdmin
    ? planner
    : planner.filter((p) => crByNumber.get(p.cr_number)?.itpm === userName);

  return visible.map((p) => {
    const cr = crByNumber.get(p.cr_number);
    return {
      plannerId: p.planner_id,
      crNumber: p.cr_number,
      title: cr?.title ?? null,
      dateCreated: cr?.date_created ?? null,
      dateModified: cr?.date_modified ?? null,
      createdUser: cr?.created_user ?? null,
      workflowStatus: cr?.workflow_status ?? null,
      devResource: p.dev_resource,
      devEffort: p.dev_effort,
      devStartDate: p.dev_start_date,
      devEndDate: p.dev_end_date,
      sitEffort: p.sit_effort,
      sitStartDate: p.sit_start_date,
      uatDate: p.uat_date,
      prodDate: p.prod_date,
      remarks: p.remarks,
    };
  });
});

// PROD Date options — read-only, sourced from the Deployment Planning
// module's deployment_schedule table (status = 'Planned' only). This is a
// self-contained copy of the same query deployment.functions.ts's
// listPlannedSchedules runs, not an import of it, so this file still has
// zero code-level dependency on deployment.functions.ts.
export const listPlannedDeploymentDates = createServerFn({ method: "GET" }).handler(async () => {
  await assertPlannerViewer();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("deployment_schedule")
    .select("id, deployment_name, application, deployment_date")
    .eq("status", "Planned")
    .order("deployment_date", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
});

// ─────────────────────────── Writes ───────────────────────────

// Adds each selected CR to the planner. Duplicates are skipped (not a
// hard error for the whole batch) — the route surfaces `skipped` as a
// "already exists in planner" message per the spec.
export const addCrsToPlanner = createServerFn({ method: "POST" })
  .inputValidator(validated(z.object({ crNumbers: z.array(text).max(1000) })))
  .handler(async ({ data }) => {
    const { userName } = await assertPlannerActor();
    if (data.crNumbers.length === 0) throw new Error("Select at least one CR");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("cr_planner")
      .select("cr_number")
      .in("cr_number", data.crNumbers);
    if (existingErr) throw new Error(existingErr.message);
    const existingSet = new Set((existing ?? []).map((e) => e.cr_number));

    const toInsert = data.crNumbers.filter((cr) => !existingSet.has(cr));
    const skipped = data.crNumbers.filter((cr) => existingSet.has(cr));

    if (toInsert.length > 0) {
      const { error: insertErr } = await supabaseAdmin.from("cr_planner").insert(
        toInsert.map((crNumber) => ({
          cr_number: crNumber,
          created_by: userName,
          modified_by: userName,
        })) as never,
      );
      if (insertErr) throw new Error(insertErr.message);
    }

    return { added: toInsert, skipped };
  });

const optionalNumber = z.number().nullable().optional();

export const updatePlannerEntry = createServerFn({ method: "POST" })
  .inputValidator(
    validated(
      z.object({
        crNumber: text,
        devResource: optionalText,
        devEffort: optionalNumber,
        devStartDate: optionalText,
        sitEffort: optionalNumber,
        sitStartDate: optionalText,
        prodDate: optionalText,
        remarks: optionalText,
      }),
    ),
  )
  .handler(async ({ data }) => {
    const { userName } = await assertPlannerActor();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.devResource != null && data.devResource !== "R1" && data.devResource !== "R2") {
      throw new Error("Developer must be R1 or R2");
    }
    if (data.devEffort != null && (!Number.isInteger(data.devEffort) || data.devEffort <= 0)) {
      throw new Error("Dev Effort must be a whole number greater than zero");
    }
    if (data.sitEffort != null && (!Number.isInteger(data.sitEffort) || data.sitEffort <= 0)) {
      throw new Error("SIT Effort must be a whole number greater than zero");
    }
    if (data.devEffort != null && !data.devStartDate) {
      throw new Error("Dev Start Date is required when Dev Effort is entered");
    }
    if (data.sitEffort != null && !data.sitStartDate) {
      throw new Error("SIT Start Date is required when SIT Effort is entered");
    }
    if (data.prodDate) {
      const { data: planned, error: plannedErr } = await supabaseAdmin
        .from("deployment_schedule")
        .select("deployment_date")
        .eq("deployment_date", data.prodDate)
        .eq("status", "Planned")
        .maybeSingle();
      if (plannedErr) throw new Error(plannedErr.message);
      if (!planned)
        throw new Error("PROD Date must be a date from the Deployment Schedule (Planned)");
    }

    const devEndDate =
      data.devEffort != null && data.devStartDate
        ? toIsoDateKey(addWorkingDays(new Date(`${data.devStartDate}T00:00:00`), data.devEffort))
        : null;
    const uatDate =
      data.sitEffort != null && data.sitStartDate
        ? toIsoDateKey(addWorkingDays(new Date(`${data.sitStartDate}T00:00:00`), data.sitEffort))
        : null;

    const payload: Partial<PlannerRow> = {
      dev_resource: data.devResource ?? null,
      dev_effort: data.devEffort ?? null,
      dev_start_date: data.devStartDate ?? null,
      dev_end_date: devEndDate,
      sit_effort: data.sitEffort ?? null,
      sit_start_date: data.sitStartDate ?? null,
      uat_date: uatDate,
      prod_date: data.prodDate ?? null,
      remarks: data.remarks ?? null,
      modified_by: userName,
      modified_at: new Date().toISOString(),
    };

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("cr_planner")
      .select("planner_id")
      .eq("cr_number", data.crNumber)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);

    if (existing) {
      const { error } = await supabaseAdmin
        .from("cr_planner")
        .update(payload as never)
        .eq("cr_number", data.crNumber);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("cr_planner").insert({
        cr_number: data.crNumber,
        created_by: userName,
        ...payload,
      } as never);
      if (error) throw new Error(error.message);
    }

    return { ok: true as const, devEndDate, uatDate };
  });
