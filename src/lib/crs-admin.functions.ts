// CR operations that aren't part of BA/ITPM scoping — CR Size Management
// and the CR Repository's status-update dialog. Reads are open to any
// logged-in user; writes are restricted to Admin/PMO/BA/ITPM (Testers only
// use the Test Case Management module and have no business reason to edit
// CR data). RLS is locked down, so these go through the service-role
// client instead of the anon client.
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";

// Deliberately does NOT include isAdmin — CR size/notes/workflow-status
// edits are a PMO/BA/ITPM function-of-record, not an Admin one.
async function assertCrEditAccess() {
  const { role } = await requireSessionUser();
  if (role !== "PMO" && role !== "BA" && role !== "ITPM") {
    throw new Error("Forbidden: only PMO, BA, or ITPM can modify CR data");
  }
}

export const listAllCrsForSizeManagement = createServerFn({ method: "GET" }).handler(async () => {
  await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("crs")
    .select("cr_number, title, application, cr_size, manual_notes, is_dropped")
    .order("cr_number");
  if (error) throw new Error(error.message);
  return data;
});

export const updateCrSizeAndNotes = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumber: string; cr_size?: string | null; manual_notes?: string | null }) => data)
  .handler(async ({ data }) => {
    await assertCrEditAccess();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload: Record<string, unknown> = {};
    if (data.cr_size !== undefined) payload.cr_size = data.cr_size;
    if (data.manual_notes !== undefined) payload.manual_notes = data.manual_notes;
    const { error } = await supabaseAdmin.from("crs").update(payload as never).eq("cr_number", data.crNumber);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const bulkUpdateCrSize = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumbers: string[]; cr_size: string | null }) => data)
  .handler(async ({ data }) => {
    await assertCrEditAccess();
    if (data.crNumbers.length === 0) return { ok: true as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("crs")
      .update({ cr_size: data.cr_size } as never)
      .in("cr_number", data.crNumbers);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const bulkDropCrs = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumbers: string[] }) => data)
  .handler(async ({ data }) => {
    await assertCrEditAccess();
    if (data.crNumbers.length === 0) return { ok: true as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("crs")
      .update({ is_dropped: true } as never)
      .in("cr_number", data.crNumbers);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const updateCrWorkflowStatus = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumber: string; dbColumn: string; label: string }) => data)
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
    const { error } = await supabaseAdmin.from("crs").update(payload as never).eq("cr_number", data.crNumber);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
