// Deployment Management (Phase 4) — deployment schedules, CR assignment,
// and deployment-stage tracking. Reads are open to any authenticated user
// (same "must be logged in, nothing more" pattern as listKpis/
// getWorkflowStatuses) — nav visibility narrows who actually sees these
// screens (see app-shell.tsx), matching how CR Repository/KPI
// Configuration/etc. are hidden from Testers without the underlying reads
// being role-locked. Writes (create/update schedule, assign/remove CRs,
// update stage) are PMO/ITPM/BA only — Admin is deliberately excluded,
// same decision already made for CR size/notes/workflow-status editing in
// crs-admin.functions.ts (CR/deployment data entry isn't an Admin
// function in this app).
//
// UAT Signed Off / Deployed to Production are automatic-only stages,
// synced from CR CSV import via syncDeploymentStagesForCrs (called from
// csv-import.ts) — they reflect facts from the source system, not
// team-tracked progress, so updateDeploymentStage refuses to set them.
//
// A CR's membership in a deployment schedule lives directly on crs
// (deployment_date + deployment_remarks) instead of a join table — the
// schedule a CR belongs to is derived by matching
// (crs.application, crs.deployment_date) against
// (deployment_schedule.application, deployment_schedule.deployment_date).
// application disambiguates schedules that share a date; a DB-level
// partial unique index enforces at most one Planned schedule per
// (application, date) pair, so that match is never ambiguous.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSessionUser } from "@/lib/gate.functions";
import { recalculateForCr } from "@/lib/kpi-engine";
import type { Database } from "@/integrations/supabase/types";

export type DeploymentStage = Database["public"]["Enums"]["deployment_stage"];
export type DeploymentStatus = Database["public"]["Enums"]["deployment_status"];

export const MANUAL_DEPLOYMENT_STAGES: DeploymentStage[] = [
  "Code Merging Done",
  "Deployed to MO",
  "MO Testing Done",
  "MO Signed Off",
];
const MANUAL_STAGES_SET = new Set<DeploymentStage>(MANUAL_DEPLOYMENT_STAGES);

// crs.workflow_status is inconsistently formatted in live data — CSV
// import writes the raw CMS code text (underscore, e.g. "28_Deployed in
// Production"), but some rows carry the friendlier label text instead
// (space, e.g. "29 Live and Closed" — confirmed present in production
// data). Both variants are listed per status, plus the CMS's own
// "Delpoyed" typo in the Tech Go code, so an exact-match check can't
// silently miss a CR just because of which format happened to get set.
// These four are the terminal/closed statuses — a CR at any of them has
// already gone live (or been closed out) and isn't a deployment-planning
// candidate anymore.
export const DEPLOYMENT_TERMINAL_WORKFLOW_STATUSES = new Set([
  "28_Deployed in Production",
  "28 Deployed in Production",
  "28_Tech Go Delpoyed in Production",
  "28 Tech Go - Deployed in Production",
  "29_Live and Closed",
  "29 Live and Closed",
  "30_Issue in production",
  "30 Issue in Production",
]);

async function assertDeploymentActor() {
  const session = await requireSessionUser();
  if (session.role !== "PMO" && session.role !== "ITPM" && session.role !== "BA") {
    throw new Error("Forbidden: only PMO, ITPM, or BA can manage deployments");
  }
  return session;
}

function formatDeploymentName(year: number, seq: number): string {
  return `DEP-${year}-${String(seq).padStart(3, "0")}`;
}

// Compare-and-swap counter, same atomic-conditional-update idiom as
// claimCr/kpi_engine_lock — avoids a read-then-write race between two
// concurrent schedule creations without needing a Postgres function.
async function generateDeploymentName(supabaseAdmin: SupabaseClient<Database>): Promise<string> {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: row } = await supabaseAdmin
      .from("deployment_name_seq")
      .select("last_seq")
      .eq("year", year)
      .maybeSingle();

    const currentSeq = row?.last_seq ?? 0;
    const nextSeq = currentSeq + 1;

    if (!row) {
      const { error: insertErr } = await supabaseAdmin
        .from("deployment_name_seq")
        .insert({ year, last_seq: nextSeq } as never);
      if (!insertErr) return formatDeploymentName(year, nextSeq);
      continue; // another request inserted the year row first — retry as an update
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("deployment_name_seq")
      .update({ last_seq: nextSeq } as never)
      .eq("year", year)
      .eq("last_seq", currentSeq)
      .select("last_seq");
    if (updateErr) throw new Error(updateErr.message);
    if (updated && updated.length > 0) return formatDeploymentName(year, nextSeq);
    // Someone else updated between our read and write — retry.
  }
  throw new Error("Could not generate a deployment name — please try again");
}

interface AuditParams {
  eventType:
    "schedule_created" | "schedule_updated" | "cr_assigned" | "cr_removed" | "stage_changed";
  scheduleId?: string;
  crNumber?: string;
  performedBy: string;
  oldValue?: unknown;
  newValue?: unknown;
}

async function logAudit(supabaseAdmin: SupabaseClient<Database>, params: AuditParams) {
  await supabaseAdmin.from("deployment_audit_log").insert({
    event_type: params.eventType,
    deployment_schedule_id: params.scheduleId ?? null,
    cr_number: params.crNumber ?? null,
    performed_by: params.performedBy,
    old_value: (params.oldValue ?? null) as never,
    new_value: (params.newValue ?? null) as never,
  } as never);
}

function scheduleKey(application: string, deploymentDate: string): string {
  return `${application}::${deploymentDate}`;
}

// Shared by listDeploymentSchedules/getDeploymentDashboardSummary — both
// need "how many CRs sit on each schedule" and "which schedules this user
// can see" (ITPM/BA see only schedules holding a CR they're BA/ITPM for),
// both derived from the same crs.deployment_date scan.
async function loadAssignedCrStats(supabaseAdmin: SupabaseClient<Database>, userName: string) {
  const { data, error } = await supabaseAdmin
    .from("crs")
    .select("application, deployment_date, ba, itpm")
    .not("deployment_date", "is", null);
  if (error) throw new Error(error.message);

  const countByKey = new Map<string, number>();
  const userKeys = new Set<string>();
  for (const c of data ?? []) {
    if (!c.deployment_date) continue;
    const key = scheduleKey(c.application ?? "", c.deployment_date);
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    if (c.ba === userName || c.itpm === userName) userKeys.add(key);
  }
  return { countByKey, userKeys };
}

// ─────────────────────────── Reads ───────────────────────────

export const listDeploymentSchedules = createServerFn({ method: "GET" }).handler(async () => {
  const { isAdmin, userName, role } = await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: schedules, error } = await supabaseAdmin
    .from("deployment_schedule")
    .select(
      "id, deployment_name, application, deployment_date, remarks, status, created_by, created_at",
    )
    .order("deployment_date", { ascending: false });
  if (error) throw new Error(error.message);

  const { countByKey, userKeys } = await loadAssignedCrStats(supabaseAdmin, userName);

  const visible =
    isAdmin || role === "PMO"
      ? (schedules ?? [])
      : (schedules ?? []).filter((s) =>
          userKeys.has(scheduleKey(s.application, s.deployment_date)),
        );

  return visible.map((s) => ({
    ...s,
    crCount: countByKey.get(scheduleKey(s.application, s.deployment_date)) ?? 0,
  }));
});

export const listPlannedSchedules = createServerFn({ method: "GET" }).handler(async () => {
  await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("deployment_schedule")
    .select("id, deployment_name, application, deployment_date")
    .eq("status", "Planned")
    .order("deployment_date", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
});

// Applications with at least one CR — powers the Application picker when
// creating a deployment schedule, same distinct-values-off-crs approach
// crs.tsx uses for its application filter, just computed server-side
// since this page doesn't otherwise load the full CR list.
export const listCrApplications = createServerFn({ method: "GET" }).handler(async () => {
  await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("crs")
    .select("application")
    .not("application", "is", null);
  if (error) throw new Error(error.message);
  const apps = Array.from(new Set((data ?? []).map((c) => c.application as string)));
  apps.sort();
  return apps;
});

// Eligibility: any active (not dropped) CR whose workflow_status isn't
// one of the terminal/closed statuses (DEPLOYMENT_TERMINAL_WORKFLOW_STATUSES
// — deployed to production, tech-go deployed, live and closed, or issue in
// production), and not already carrying a deployment_date. This is
// deliberately broad — a CR at any earlier stage (BRD, dev, UAT, etc.) is
// plannable, not just ones that already reached UAT Signed Off. Sourced
// from crs alone. PMO/Admin see every eligible CR; ITPM/BA see only CRs
// where they're the BA/ITPM.
export const listEligibleCrsForPlanning = createServerFn({ method: "GET" }).handler(async () => {
  const { isAdmin, userName, role } = await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // is_dropped is nullable in the live table — matching the convention
  // already used in kpi-engine.ts (!cr.is_dropped), NULL counts as "not
  // dropped". .eq("is_dropped", false) would silently exclude every NULL
  // row too, since SQL's NULL = false is never true.
  const { data: eligible, error } = await supabaseAdmin
    .from("crs")
    .select("cr_number, application, cr_size, itpm, ba, workflow_status")
    .or("is_dropped.is.null,is_dropped.eq.false")
    .is("deployment_date", null);
  if (error) throw new Error(error.message);
  if (!eligible || eligible.length === 0) return [];

  const notTerminal = eligible.filter(
    (c) => !c.workflow_status || !DEPLOYMENT_TERMINAL_WORKFLOW_STATUSES.has(c.workflow_status),
  );

  return isAdmin || role === "PMO"
    ? notTerminal
    : notTerminal.filter((c) => c.ba === userName || c.itpm === userName);
});

export const getDeploymentDashboardSummary = createServerFn({ method: "GET" }).handler(async () => {
  const { isAdmin, userName, role } = await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: schedules, error } = await supabaseAdmin
    .from("deployment_schedule")
    .select("id, application, deployment_date, status");
  if (error) throw new Error(error.message);

  const { countByKey, userKeys } = await loadAssignedCrStats(supabaseAdmin, userName);

  const visibleSchedules =
    isAdmin || role === "PMO"
      ? (schedules ?? [])
      : (schedules ?? []).filter((s) =>
          userKeys.has(scheduleKey(s.application, s.deployment_date)),
        );

  const planned = visibleSchedules.filter((s) => s.status === "Planned");
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekAheadIso = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  return {
    upcoming: planned.filter((s) => s.deployment_date >= todayIso).length,
    totalPlanned: planned.length,
    totalCrsPlanned: planned.reduce(
      (sum, s) => sum + (countByKey.get(scheduleKey(s.application, s.deployment_date)) ?? 0),
      0,
    ),
    thisWeek: planned.filter(
      (s) => s.deployment_date >= todayIso && s.deployment_date <= weekAheadIso,
    ).length,
  };
});

// CR Repository's "Planned Deployment Date" / "Deployment Stage" columns
// — same shape as defectStats/testCaseCompletion in crs.tsx (a flat array
// keyed by cr_number, merged client-side into a Map, no SQL join needed
// on the caller's side).
export const getDeploymentInfoByCr = createServerFn({ method: "GET" }).handler(async () => {
  await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: crs, error } = await supabaseAdmin
    .from("crs")
    .select("cr_number, deployment_stage, deployment_date");
  if (error) throw new Error(error.message);

  return (crs ?? []).map((c) => ({
    cr_number: c.cr_number,
    deployment_stage: c.deployment_stage,
    planned_deployment_date: c.deployment_date,
  }));
});

export const getDeploymentScheduleCrs = createServerFn({ method: "GET" })
  .inputValidator((data: { scheduleId: string }) => data)
  .handler(async ({ data }) => {
    await requireSessionUser();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: schedule, error: schedErr } = await supabaseAdmin
      .from("deployment_schedule")
      .select("application, deployment_date")
      .eq("id", data.scheduleId)
      .maybeSingle();
    if (schedErr) throw new Error(schedErr.message);
    if (!schedule) throw new Error("Deployment schedule not found");

    const { data: rows, error } = await supabaseAdmin
      .from("crs")
      .select(
        "cr_number, application, ba, itpm, cr_size, workflow_status, deployment_stage, deployment_remarks",
      )
      .eq("application", schedule.application)
      .eq("deployment_date", schedule.deployment_date);
    if (error) throw new Error(error.message);

    return (rows ?? []).map((r) => ({
      cr_number: r.cr_number,
      allocation_remarks: r.deployment_remarks,
      application: r.application,
      ba: r.ba,
      itpm: r.itpm,
      cr_size: r.cr_size,
      workflow_status: r.workflow_status,
      deployment_stage: r.deployment_stage,
    }));
  });

// ─────────────────────────── Writes ───────────────────────────

export const createDeploymentSchedule = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { application: string; deploymentDate: string; remarks?: string | null }) => data,
  )
  .handler(async ({ data }) => {
    const { userName } = await assertDeploymentActor();
    if (!data.deploymentDate) throw new Error("Deployment date is required");
    if (!data.application?.trim()) throw new Error("Application is required");
    const application = data.application.trim();
    const remarks = data.remarks?.trim() || null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: clash, error: dupErr } = await supabaseAdmin
      .from("deployment_schedule")
      .select("id")
      .eq("application", application)
      .eq("deployment_date", data.deploymentDate)
      .eq("status", "Planned")
      .maybeSingle();
    if (dupErr) throw new Error(dupErr.message);
    if (clash) throw new Error(`${application} already has a deployment planned on this date`);

    const deploymentName = await generateDeploymentName(supabaseAdmin);

    const { data: created, error } = await supabaseAdmin
      .from("deployment_schedule")
      .insert({
        deployment_name: deploymentName,
        application,
        deployment_date: data.deploymentDate,
        remarks,
        status: "Planned",
        created_by: userName,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await logAudit(supabaseAdmin, {
      eventType: "schedule_created",
      scheduleId: created.id,
      performedBy: userName,
      newValue: {
        deployment_name: deploymentName,
        application,
        deployment_date: data.deploymentDate,
        remarks,
      },
    });

    return { ok: true as const, id: created.id, deploymentName };
  });

export const updateDeploymentSchedule = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      deploymentDate?: string;
      remarks?: string | null;
      status?: DeploymentStatus;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { userName } = await assertDeploymentActor();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("deployment_schedule")
      .select("id, application, deployment_date, remarks, status")
      .eq("id", data.id)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!existing) throw new Error("Deployment schedule not found");
    if (existing.status !== "Planned") {
      throw new Error(`Cannot edit a ${existing.status.toLowerCase()} deployment schedule`);
    }

    const payload: Record<string, unknown> = {};
    if (data.deploymentDate !== undefined) payload.deployment_date = data.deploymentDate;
    if (data.remarks !== undefined) payload.remarks = data.remarks?.trim() || null;
    if (data.status !== undefined) payload.status = data.status;

    const { error } = await supabaseAdmin
      .from("deployment_schedule")
      .update(payload as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // deployment_date is the link between a schedule and its CRs (matched
    // via crs.application + crs.deployment_date) — moving the schedule's
    // date has to carry its already-assigned CRs along, or they'd
    // silently detach from it.
    if (data.deploymentDate !== undefined && data.deploymentDate !== existing.deployment_date) {
      const { error: cascadeErr } = await supabaseAdmin
        .from("crs")
        .update({ deployment_date: data.deploymentDate } as never)
        .eq("application", existing.application)
        .eq("deployment_date", existing.deployment_date);
      if (cascadeErr) throw new Error(cascadeErr.message);
    }

    await logAudit(supabaseAdmin, {
      eventType: "schedule_updated",
      scheduleId: data.id,
      performedBy: userName,
      oldValue: existing,
      newValue: { ...existing, ...payload },
    });

    return { ok: true as const };
  });

// Marks a Planned schedule Completed ("deployed") and cascades that fact
// onto every CR matched to it (application + deployment_date): their
// deployment_stage becomes "Deployed to Production" and their CMS-style
// workflow_status becomes "28_Deployed in Production" — same literal code
// format used elsewhere in this module (listEligibleCrsForPlanning, CR
// Repository's isDeployedToProduction check), not the friendlier label
// updateCrWorkflowStatus writes for manual single-CR edits. Also stamps
// s28_deployed_in_production so KPI TAT calculations and
// syncDeploymentStagesForCrs see a consistent picture, then recalculates
// KPIs for every affected CR — the same follow-up crs.tsx's "Update
// Status" action does after a workflow_status change.
export const markDeploymentScheduleCompleted = createServerFn({ method: "POST" })
  .inputValidator((data: { scheduleId: string }) => data)
  .handler(async ({ data }) => {
    const { userName } = await assertDeploymentActor();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: schedule, error: schedErr } = await supabaseAdmin
      .from("deployment_schedule")
      .select("id, application, deployment_date, status")
      .eq("id", data.scheduleId)
      .maybeSingle();
    if (schedErr) throw new Error(schedErr.message);
    if (!schedule) throw new Error("Deployment schedule not found");
    if (schedule.status !== "Planned") {
      throw new Error(`Cannot complete a ${schedule.status.toLowerCase()} deployment schedule`);
    }

    const { data: crs, error: crsErr } = await supabaseAdmin
      .from("crs")
      .select("cr_number")
      .eq("application", schedule.application)
      .eq("deployment_date", schedule.deployment_date);
    if (crsErr) throw new Error(crsErr.message);
    const crNumbers = (crs ?? []).map((c) => c.cr_number);

    const { error: schedUpdateErr } = await supabaseAdmin
      .from("deployment_schedule")
      .update({ status: "Completed" } as never)
      .eq("id", data.scheduleId);
    if (schedUpdateErr) throw new Error(schedUpdateErr.message);

    if (crNumbers.length > 0) {
      const nowIso = new Date().toISOString();
      const { error: crUpdateErr } = await supabaseAdmin
        .from("crs")
        .update({
          deployment_stage: "Deployed to Production",
          workflow_status: "28_Deployed in Production",
          s28_deployed_in_production: nowIso,
          date_modified: nowIso,
        } as never)
        .in("cr_number", crNumbers);
      if (crUpdateErr) throw new Error(crUpdateErr.message);

      for (const crNumber of crNumbers) {
        await recalculateForCr({ data: crNumber });
      }
    }

    await logAudit(supabaseAdmin, {
      eventType: "schedule_updated",
      scheduleId: data.scheduleId,
      performedBy: userName,
      oldValue: { status: schedule.status },
      newValue: { status: "Completed", crsMarkedDeployed: crNumbers },
    });

    return { ok: true as const, crCount: crNumbers.length };
  });

export const assignCrsToDeployment = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { crNumbers: string[]; scheduleId: string; remarks?: string | null }) => data,
  )
  .handler(async ({ data }) => {
    const { userName, role } = await assertDeploymentActor();
    if (data.crNumbers.length === 0) throw new Error("Select at least one CR");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: schedule, error: schedErr } = await supabaseAdmin
      .from("deployment_schedule")
      .select("id, application, deployment_date, status")
      .eq("id", data.scheduleId)
      .maybeSingle();
    if (schedErr) throw new Error(schedErr.message);
    if (!schedule) throw new Error("Deployment schedule not found");
    if (schedule.status !== "Planned") {
      throw new Error(`Cannot assign to a ${schedule.status.toLowerCase()} deployment schedule`);
    }

    const { data: targetCrs, error: crErr } = await supabaseAdmin
      .from("crs")
      .select("cr_number, application, ba, itpm, deployment_date")
      .in("cr_number", data.crNumbers);
    if (crErr) throw new Error(crErr.message);

    const mismatched = (targetCrs ?? []).filter((c) => c.application !== schedule.application);
    if (mismatched.length > 0) {
      throw new Error(
        `${mismatched.map((c) => c.cr_number).join(", ")} belong to a different application than ${schedule.application}`,
      );
    }

    // ITPM/BA may only assign CRs they're actually the BA/ITPM for.
    if (role === "ITPM" || role === "BA") {
      const notOwned = (targetCrs ?? []).filter((c) => c.ba !== userName && c.itpm !== userName);
      if (notOwned.length > 0) {
        throw new Error(
          `Forbidden: you are not the BA/ITPM for ${notOwned.map((c) => c.cr_number).join(", ")}`,
        );
      }
    }

    const alreadyAssigned = (targetCrs ?? []).filter((c) => c.deployment_date != null);
    if (alreadyAssigned.length > 0) {
      throw new Error(
        `Already assigned to a deployment: ${alreadyAssigned.map((c) => c.cr_number).join(", ")}`,
      );
    }

    const remarks = data.remarks?.trim() || null;
    const { error: updateErr } = await supabaseAdmin
      .from("crs")
      .update({ deployment_date: schedule.deployment_date, deployment_remarks: remarks } as never)
      .in("cr_number", data.crNumbers);
    if (updateErr) throw new Error(updateErr.message);

    for (const crNumber of data.crNumbers) {
      await logAudit(supabaseAdmin, {
        eventType: "cr_assigned",
        scheduleId: data.scheduleId,
        crNumber,
        performedBy: userName,
        newValue: { deployment_date: schedule.deployment_date, deployment_remarks: remarks },
      });
    }

    return { ok: true as const, assigned: data.crNumbers.length };
  });

export const removeCrFromDeployment = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumber: string }) => data)
  .handler(async ({ data }) => {
    const { userName } = await assertDeploymentActor();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: cr, error: fetchErr } = await supabaseAdmin
      .from("crs")
      .select("cr_number, application, deployment_date")
      .eq("cr_number", data.crNumber)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!cr) throw new Error("CR not found");
    if (!cr.deployment_date) throw new Error("This CR isn't assigned to a deployment");

    const { data: schedule, error: schedErr } = await supabaseAdmin
      .from("deployment_schedule")
      .select("id, status")
      .eq("application", cr.application ?? "")
      .eq("deployment_date", cr.deployment_date)
      .maybeSingle();
    if (schedErr) throw new Error(schedErr.message);
    if (schedule && schedule.status !== "Planned") {
      throw new Error("Cannot remove a CR from a deployment that isn't Planned");
    }

    const { error: updateErr } = await supabaseAdmin
      .from("crs")
      .update({ deployment_date: null, deployment_remarks: null } as never)
      .eq("cr_number", data.crNumber);
    if (updateErr) throw new Error(updateErr.message);

    await logAudit(supabaseAdmin, {
      eventType: "cr_removed",
      scheduleId: schedule?.id,
      crNumber: data.crNumber,
      performedBy: userName,
      oldValue: { deployment_date: cr.deployment_date },
    });

    return { ok: true as const };
  });

// Manual stages only — rejects automatic stages, and rejects any change
// once the CR has reached the terminal "Deployed to Production" stage
// (CMS-confirmed done) or hasn't reached UAT Signed Off yet (nothing to
// progress). A CR currently AT "UAT Signed Off" is editable — that's the
// starting point manual progression moves it forward from.
export const updateDeploymentStage = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumber: string; stage: DeploymentStage }) => data)
  .handler(async ({ data }) => {
    const { userName } = await assertDeploymentActor();
    if (!MANUAL_STAGES_SET.has(data.stage)) {
      throw new Error("This stage is set automatically from CMS import and can't be set manually");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cr, error: fetchErr } = await supabaseAdmin
      .from("crs")
      .select("cr_number, deployment_stage")
      .eq("cr_number", data.crNumber)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!cr) throw new Error("CR not found");
    if (!cr.deployment_stage || cr.deployment_stage === "Deployed to Production") {
      throw new Error(
        `Deployment stage cannot be edited while it is "${cr.deployment_stage ?? "not started"}"`,
      );
    }

    const { error } = await supabaseAdmin
      .from("crs")
      .update({ deployment_stage: data.stage } as never)
      .eq("cr_number", data.crNumber);
    if (error) throw new Error(error.message);

    await logAudit(supabaseAdmin, {
      eventType: "stage_changed",
      crNumber: data.crNumber,
      performedBy: userName,
      oldValue: { deployment_stage: cr.deployment_stage },
      newValue: { deployment_stage: data.stage },
    });

    return { ok: true as const };
  });

// ─────────────────── CMS/CSV-import sync (internal) ───────────────────

// Not a createServerFn — called directly from importCrRows in
// csv-import.ts after its main upsert, the same reconciliation-pass shape
// importDefectRows already uses in defect-import.ts (main write, then a
// follow-up pass reacting to what changed). Automatic stages always
// override manual progress for "Deployed to Production" (per spec); the
// "UAT Signed Off" transition only fires the first time (deployment_stage
// still null), so it never regresses a CR a user has already moved
// further along manually.
export async function syncDeploymentStagesForCrs(
  supabaseAdmin: SupabaseClient<Database>,
  crNumbers: string[],
  performedBy: string,
): Promise<number> {
  if (crNumbers.length === 0) return 0;

  const { data: crs, error } = await supabaseAdmin
    .from("crs")
    .select(
      "cr_number, deployment_stage, s24_uat_signed_off, s28_deployed_in_production, s28_tech_go_deployed_in_production",
    )
    .in("cr_number", crNumbers);
  if (error) throw new Error(error.message);

  let changed = 0;
  for (const cr of crs ?? []) {
    const reachedProduction =
      !!cr.s28_deployed_in_production || !!cr.s28_tech_go_deployed_in_production;
    let nextStage: DeploymentStage | null = null;

    if (reachedProduction && cr.deployment_stage !== "Deployed to Production") {
      nextStage = "Deployed to Production";
    } else if (!reachedProduction && cr.s24_uat_signed_off && cr.deployment_stage == null) {
      nextStage = "UAT Signed Off";
    }

    if (!nextStage) continue;

    const { error: updateErr } = await supabaseAdmin
      .from("crs")
      .update({ deployment_stage: nextStage } as never)
      .eq("cr_number", cr.cr_number);
    if (updateErr) throw new Error(updateErr.message);

    await logAudit(supabaseAdmin, {
      eventType: "stage_changed",
      crNumber: cr.cr_number,
      performedBy,
      oldValue: { deployment_stage: cr.deployment_stage },
      newValue: { deployment_stage: nextStage },
    });
    changed++;
  }
  return changed;
}
