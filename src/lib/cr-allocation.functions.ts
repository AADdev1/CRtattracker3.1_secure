// CR Allocation screen — filling in missing crs.itpm / crs.ba.
// PMO/Admin can assign either field on any CR missing one; ITPM/BA can only
// self-claim the field matching their own role. Gated by
// user_management.role (independent of is_admin — see requireSessionUser).
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";

const ALLOCATION_COLUMNS = "cr_number, title, application, severity, workflow_status, ba, itpm";

export const listUnassignedCrs = createServerFn({ method: "GET" }).handler(async () => {
  const { isAdmin, role } = await requireSessionUser();
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
  if (role === "ITPM") {
    const { data, error } = await supabaseAdmin
      .from("crs")
      .select(ALLOCATION_COLUMNS)
      .is("itpm", null)
      .order("cr_number");
    if (error) throw new Error(error.message);
    return data;
  }
  if (role === "BA") {
    const { data, error } = await supabaseAdmin
      .from("crs")
      .select(ALLOCATION_COLUMNS)
      .is("ba", null)
      .order("cr_number");
    if (error) throw new Error(error.message);
    return data;
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
    itpmUsers: (data ?? []).filter((u) => u.role === "ITPM").map((u) => u.user_name).sort(),
    baUsers: (data ?? []).filter((u) => u.role === "BA").map((u) => u.user_name).sort(),
  };
});

// Admin/PMO only — assign, reassign, or clear (userName: null) either
// field on any CR.
export const assignCrField = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumber: string; field: "itpm" | "ba"; userName: string | null }) => data)
  .handler(async ({ data }) => {
    const { isAdmin, role } = await requireSessionUser();
    if (!isAdmin && role !== "PMO") throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("crs")
      .update({ [data.field]: data.userName } as never)
      .eq("cr_number", data.crNumber);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ITPM/BA self-service — can only claim the field matching their own role,
// and only if it's still empty (atomic conditional update, same pattern as
// kpi_engine_lock, so two people racing to claim the same CR can't both win).
export const claimCr = createServerFn({ method: "POST" })
  .inputValidator((data: { crNumber: string; field: "itpm" | "ba" }) => data)
  .handler(async ({ data }) => {
    const { userName, role } = await requireSessionUser();
    if (role !== "ITPM" && role !== "BA") throw new Error("Forbidden");
    if (data.field !== (role === "ITPM" ? "itpm" : "ba")) {
      throw new Error("Forbidden: you can only claim your own field");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
