// CR operations that aren't part of BA/ITPM scoping — CR Size Management
// and the CR Repository's status-update dialog. Reads are open to any
// logged-in user; writes are restricted to Admin/PMO/BA/ITPM (Testers only
// use the Test Case Management module and have no business reason to edit
// CR data). RLS is locked down, so these go through the service-role
// client instead of the anon client.
//
// CR Size Management specifically (listAllCrsForSizeManagement/
// updateCrSizeAndNotes/bulkUpdateCrSize/bulkDropCrs) is further scoped for
// ITPM/BA: they only see and can only modify CRs where they're the CR's
// ba/itpm — same ownership rule used for Deployment Planning's assign/
// remove-CR actions (see deployment.functions.ts). PMO keeps unrestricted
// visibility/edit here, matching PMO's "sees all CRs" rule elsewhere
// (scoped-data.functions.ts). updateCrWorkflowStatus (the CR Repository's
// status dialog, a separate screen) is intentionally NOT scoped this way.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSessionUser, assertHasRoleOrAdmin } from "@/lib/gate.functions";
import { text, optionalText, validated } from "@/lib/validation";

// No .min(1) — bulkUpdateCrSize/bulkDropCrs treat an empty array as a
// no-op success (existing behavior, not something to start rejecting).
const crNumbers = z.array(text).max(1000);

// Deliberately does NOT include isAdmin — CR size/notes/workflow-status
// edits are a PMO/BA/ITPM function-of-record, not an Admin one.
async function assertCrEditAccess() {
  const session = await requireSessionUser();
  if (session.role !== "PMO" && session.role !== "BA" && session.role !== "ITPM") {
    throw new Error("Forbidden: only PMO, BA, or ITPM can modify CR data");
  }
  return session;
}

export const listAllCrsForSizeManagement = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSessionUser();
  assertHasRoleOrAdmin(session);
  const { role, userName } = session;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("crs")
    .select("cr_number, title, application, cr_size, manual_notes, is_dropped, ba, itpm")
    .order("cr_number");
  if (error) throw new Error(error.message);

  // ITPM/BA only see CRs where they're the ba/itpm; PMO and Admin see all.
  if (role === "ITPM" || role === "BA") {
    return (data ?? []).filter((c) => c.ba === userName || c.itpm === userName);
  }
  return data;
});

export const updateCrSizeAndNotes = createServerFn({ method: "POST" })
  .inputValidator(
    validated(z.object({ crNumber: text, cr_size: optionalText, manual_notes: optionalText })),
  )
  .handler(async ({ data }) => {
    const { role, userName } = await assertCrEditAccess();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (role === "ITPM" || role === "BA") {
      const { data: cr, error: crErr } = await supabaseAdmin
        .from("crs")
        .select("ba, itpm")
        .eq("cr_number", data.crNumber)
        .maybeSingle();
      if (crErr) throw new Error(crErr.message);
      if (!cr || (cr.ba !== userName && cr.itpm !== userName)) {
        throw new Error(`Forbidden: you are not the BA/ITPM for ${data.crNumber}`);
      }
    }

    const payload: Record<string, unknown> = {};
    if (data.cr_size !== undefined) payload.cr_size = data.cr_size;
    if (data.manual_notes !== undefined) payload.manual_notes = data.manual_notes;
    const { error } = await supabaseAdmin
      .from("crs")
      .update(payload as never)
      .eq("cr_number", data.crNumber);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const bulkUpdateCrSize = createServerFn({ method: "POST" })
  .inputValidator(validated(z.object({ crNumbers, cr_size: text.nullable() })))
  .handler(async ({ data }) => {
    const { role, userName } = await assertCrEditAccess();
    if (data.crNumbers.length === 0) return { ok: true as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (role === "ITPM" || role === "BA") {
      const { data: crs, error: crsErr } = await supabaseAdmin
        .from("crs")
        .select("cr_number, ba, itpm")
        .in("cr_number", data.crNumbers);
      if (crsErr) throw new Error(crsErr.message);
      const notOwned = (crs ?? []).filter((c) => c.ba !== userName && c.itpm !== userName);
      if (notOwned.length > 0) {
        throw new Error(
          `Forbidden: you are not the BA/ITPM for ${notOwned.map((c) => c.cr_number).join(", ")}`,
        );
      }
    }

    const { error } = await supabaseAdmin
      .from("crs")
      .update({ cr_size: data.cr_size } as never)
      .in("cr_number", data.crNumbers);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const bulkDropCrs = createServerFn({ method: "POST" })
  .inputValidator(validated(z.object({ crNumbers })))
  .handler(async ({ data }) => {
    const { role, userName } = await assertCrEditAccess();
    if (data.crNumbers.length === 0) return { ok: true as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (role === "ITPM" || role === "BA") {
      const { data: crs, error: crsErr } = await supabaseAdmin
        .from("crs")
        .select("cr_number, ba, itpm")
        .in("cr_number", data.crNumbers);
      if (crsErr) throw new Error(crsErr.message);
      const notOwned = (crs ?? []).filter((c) => c.ba !== userName && c.itpm !== userName);
      if (notOwned.length > 0) {
        throw new Error(
          `Forbidden: you are not the BA/ITPM for ${notOwned.map((c) => c.cr_number).join(", ")}`,
        );
      }
    }

    const { error } = await supabaseAdmin
      .from("crs")
      .update({ is_dropped: true } as never)
      .in("cr_number", data.crNumbers);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const updateCrWorkflowStatus = createServerFn({ method: "POST" })
  .inputValidator(validated(z.object({ crNumber: text, dbColumn: text, label: text })))
  .handler(async ({ data }) => {
    await assertCrEditAccess();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // dbColumn drives a dynamic update key below — constrain it to a real,
    // known workflow-status column first so a caller can't aim the write
    // at an arbitrary crs column (e.g. "ba", "title").
    const { data: statusRow, error: statusErr } = await supabaseAdmin
      .from("workflow_statuses")
      .select("db_column")
      .eq("db_column", data.dbColumn)
      .maybeSingle();
    if (statusErr) throw new Error(statusErr.message);
    if (!statusRow) throw new Error("Invalid workflow status column");

    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = {
      workflow_status: data.label,
      date_modified: nowIso,
      [data.dbColumn]: nowIso,
    };
    const { error } = await supabaseAdmin
      .from("crs")
      .update(payload as never)
      .eq("cr_number", data.crNumber);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
