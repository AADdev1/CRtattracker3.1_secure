// KPI Configuration screen's reads/writes — open to any logged-in user,
// same as before. RLS is locked down, so these go through the service-role
// client now instead of the anon client.
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";

interface KpiFormInput {
  id?: string;
  name: string;
  start_status_code: string;
  end_status_code: string;
  small_tat: number;
  medium_tat: number;
  large_tat: number;
  warning_pct: number;
  is_active: boolean;
  excluded_status_codes: string[];
  role: "ITPM" | "BA";
}

export const listKpis = createServerFn({ method: "GET" }).handler(async () => {
  await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("kpis").select("*").order("name");
  if (error) throw new Error(error.message);
  return data;
});

export const listKpiExcludedStatuses = createServerFn({ method: "GET" }).handler(async () => {
  await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("kpi_excluded_statuses")
    .select("kpi_id, workflow_status_code");
  if (error) throw new Error(error.message);
  return data;
});

export const saveKpi = createServerFn({ method: "POST" })
  .inputValidator((data: KpiFormInput) => data)
  .handler(async ({ data: form }) => {
    await requireSessionUser();
    if (!form.name || !form.start_status_code || !form.end_status_code) {
      throw new Error("Name, Start Status and End Status are required");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { excluded_status_codes, id, ...payload } = form;
    let kpiId = id;
    if (kpiId) {
      const { error } = await supabaseAdmin.from("kpis").update(payload).eq("id", kpiId);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await supabaseAdmin.from("kpis").insert(payload).select("id").single();
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
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireSessionUser();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("kpis").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
