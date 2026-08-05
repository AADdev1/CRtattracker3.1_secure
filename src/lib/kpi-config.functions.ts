// KPI Configuration screen. Reads are open to any logged-in user (KPI
// definitions are useful context for BA/ITPM/PMO too); writes (save/delete)
// are Admin-only. RLS is locked down, so these go through the service-role
// client instead of the anon client.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSessionUser, assertHasRoleOrAdmin } from "@/lib/gate.functions";
import { assertFeatureEnabled } from "@/lib/release-config";
import { text, optionalText, validated } from "@/lib/validation";

const kpiFormSchema = z.object({
  id: optionalText,
  name: text,
  start_status_code: text,
  end_status_code: text,
  small_tat: z.number(),
  medium_tat: z.number(),
  large_tat: z.number(),
  warning_pct: z.number(),
  is_active: z.boolean(),
  excluded_status_codes: z.array(text),
  role: text,
});

export const listKpis = createServerFn({ method: "GET" }).handler(async () => {
  assertFeatureEnabled("administration");
  assertHasRoleOrAdmin(await requireSessionUser());
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("kpis").select("*").order("name");
  if (error) throw new Error(error.message);
  return data;
});

export const listKpiExcludedStatuses = createServerFn({ method: "GET" }).handler(async () => {
  assertFeatureEnabled("administration");
  assertHasRoleOrAdmin(await requireSessionUser());
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("kpi_excluded_statuses")
    .select("kpi_id, workflow_status_code");
  if (error) throw new Error(error.message);
  return data;
});

export const saveKpi = createServerFn({ method: "POST" })
  .inputValidator(validated(kpiFormSchema))
  .handler(async ({ data: form }) => {
    assertFeatureEnabled("administration");
    const { isAdmin } = await requireSessionUser();
    if (!isAdmin) throw new Error("Forbidden: only Admin can configure KPIs");
    if (!form.name || !form.start_status_code || !form.end_status_code) {
      throw new Error("Name, Start Status and End Status are required");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { excluded_status_codes, id, ...payload } = form;
    let kpiId = id;
    if (kpiId) {
      const { error } = await supabaseAdmin.from("kpis").update(payload as never).eq("id", kpiId);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("kpis")
        .insert(payload as never)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      kpiId = created.id;
    }
    const { error: delErr } = await supabaseAdmin
      .from("kpi_excluded_statuses")
      .delete()
      .eq("kpi_id", kpiId);
    if (delErr) throw new Error(delErr.message);
    if (excluded_status_codes.length > 0) {
      const rows = excluded_status_codes.map((code) => ({
        kpi_id: kpiId!,
        workflow_status_code: code,
      }));
      const { error: insErr } = await supabaseAdmin.from("kpi_excluded_statuses").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
    return { ok: true as const };
  });

export const deleteKpi = createServerFn({ method: "POST" })
  .inputValidator(validated(z.object({ id: text })))
  .handler(async ({ data }) => {
    assertFeatureEnabled("administration");
    const { isAdmin } = await requireSessionUser();
    if (!isAdmin) throw new Error("Forbidden: only Admin can configure KPIs");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("kpis").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
