// CR operations that aren't part of BA/ITPM scoping — CR Size Management
// and the CR Repository's status-update dialog are open to any logged-in
// user, same as before. RLS is locked down, so these go through the
// service-role client now instead of the anon client.
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";

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
    await requireSessionUser();
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
    await requireSessionUser();
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
    await requireSessionUser();
    if (data.crNumbers.length === 0) return { ok: true as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("crs")
      .update({ is_dropped: true } as never)
      .in("cr_number", data.crNumbers);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ITPM/BA/Admin only — not a KPI-engine input, so no recalculation needed.
export const updateCrTestingPercentage = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumber: string; testingPercentage: number | null }) => data)
  .handler(async ({ data }) => {
    const { isAdmin, role } = await requireSessionUser();
    if (!isAdmin && role !== "ITPM" && role !== "BA") {
      throw new Error("Forbidden: only ITPM, BA, or Admin can update testing percentage");
    }
    if (data.testingPercentage != null && (data.testingPercentage < 0 || data.testingPercentage > 100)) {
      throw new Error("Testing percentage must be between 0 and 100");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("crs")
      .update({ testing_percentage: data.testingPercentage } as never)
      .eq("cr_number", data.crNumber);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const updateCrWorkflowStatus = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumber: string; dbColumn: string; label: string }) => data)
  .handler(async ({ data }) => {
    await requireSessionUser();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
