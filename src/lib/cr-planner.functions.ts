// CR Planner — standalone Dev/SIT/UAT/Production timeline planning for
// ITPM. Deliberately independent of every other module: crs is read-only
// reference data here (never written to), and this shares no table with
// Deployment Management (deployment_schedule, cr_deployment_mapping,
// etc.) — "Deployment Master" for this module is its own deployment_master
// table, not that one. Nothing outside this file imports from it, and it
// imports nothing from deployment.functions.ts — if this module were
// deleted, nothing else in the app would need to change.
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";
import { addWorkingDays, toIsoDateKey } from "@/lib/working-days";
import type { Database } from "@/integrations/supabase/types";

type PlannerRow = Database["public"]["Tables"]["cr_planner"]["Row"];

// ITPM only — no Admin bypass. This is a deliberate deviation from this
// app's usual "Admin sees everything read-only" convention, matching the
// spec's "Visible only for ITPM users" literally.
async function assertPlannerActor() {
  const session = await requireSessionUser();
  if (session.role !== "ITPM") {
    throw new Error("Forbidden: CR Planner is available to ITPM only");
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
// Deployed/Closed terminal status, and not already in cr_planner.
export const listActiveCrsForPlanner = createServerFn({ method: "GET" }).handler(async () => {
  await assertPlannerActor();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // is_dropped is nullable in the live table (not every row has it
  // explicitly set to false) — matching the convention already used in
  // kpi-engine.ts (!cr.is_dropped), NULL counts as "not dropped", not
  // "unknown/excluded". .eq("is_dropped", false) would silently drop
  // every NULL row too, since SQL's NULL = false is never true.
  const [{ data: crs, error: crsErr }, { data: planned, error: plannedErr }] = await Promise.all([
    supabaseAdmin
      .from("crs")
      .select("cr_number, title, workflow_status")
      .or("is_dropped.is.null,is_dropped.eq.false"),
    supabaseAdmin.from("cr_planner").select("cr_number"),
  ]);
  if (crsErr) throw new Error(crsErr.message);
  if (plannedErr) throw new Error(plannedErr.message);

  const alreadyPlanned = new Set((planned ?? []).map((p) => p.cr_number));

  return (crs ?? [])
    .filter((c) => !alreadyPlanned.has(c.cr_number))
    .filter((c) => !c.workflow_status || !PLANNER_EXCLUDED_WORKFLOW_STATUSES.has(c.workflow_status))
    .map((c) => ({ cr_number: c.cr_number, title: c.title }));
});

// The planner grid — every cr_planner row, merged with its read-only
// display fields from crs (no SQL join, same client-side-merge style
// already used throughout this codebase, e.g. crs.tsx's defectStats map).
export const listPlannerGrid = createServerFn({ method: "GET" }).handler(async () => {
  await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: planner, error: plannerErr } = await supabaseAdmin.from("cr_planner").select("*");
  if (plannerErr) throw new Error(plannerErr.message);
  if (!planner || planner.length === 0) return [];

  const { data: crs, error: crsErr } = await supabaseAdmin
    .from("crs")
    .select("cr_number, title, date_created, date_modified, created_user, workflow_status")
    .in(
      "cr_number",
      planner.map((p) => p.cr_number),
    );
  if (crsErr) throw new Error(crsErr.message);

  const crByNumber = new Map((crs ?? []).map((c) => [c.cr_number, c]));

  return planner.map((p) => {
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

export const listDeploymentMasterDates = createServerFn({ method: "GET" }).handler(async () => {
  await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("deployment_master")
    .select("id, deployment_date, application")
    .order("deployment_date", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
});

// ─────────────────────────── Writes ───────────────────────────

// Adds each selected CR to the planner. Duplicates are skipped (not a
// hard error for the whole batch) — the route surfaces `skipped` as a
// "already exists in planner" message per the spec.
export const addCrsToPlanner = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumbers: string[] }) => data)
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

interface UpdatePlannerEntryInput {
  crNumber: string;
  devResource?: string | null;
  devEffort?: number | null;
  devStartDate?: string | null;
  sitEffort?: number | null;
  sitStartDate?: string | null;
  prodDate?: string | null;
  remarks?: string | null;
}

export const updatePlannerEntry = createServerFn({ method: "POST" })
  .inputValidator((data: UpdatePlannerEntryInput) => data)
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
      const { data: master, error: masterErr } = await supabaseAdmin
        .from("deployment_master")
        .select("deployment_date")
        .eq("deployment_date", data.prodDate)
        .maybeSingle();
      if (masterErr) throw new Error(masterErr.message);
      if (!master) throw new Error("PROD Date must be a date from the Deployment Master list");
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

export const addDeploymentMasterDate = createServerFn({ method: "POST" })
  .inputValidator((data: { deploymentDate: string; application?: string | null }) => data)
  .handler(async ({ data }) => {
    const { userName } = await assertPlannerActor();
    if (!data.deploymentDate) throw new Error("Deployment date is required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("deployment_master")
      .select("id")
      .eq("deployment_date", data.deploymentDate)
      .maybeSingle();
    if (existingErr) throw new Error(existingErr.message);
    if (existing) throw new Error("This date is already in the Deployment Master list");

    const { error } = await supabaseAdmin.from("deployment_master").insert({
      deployment_date: data.deploymentDate,
      application: data.application?.trim() || null,
      created_by: userName,
    } as never);
    if (error) throw new Error(error.message);

    return { ok: true as const };
  });
