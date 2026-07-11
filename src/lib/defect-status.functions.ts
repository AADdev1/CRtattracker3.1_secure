// Defect Status Mapping screen. Reads are open to any logged-in user;
// writes are Admin-only. RLS is locked down, so these go through the
// service-role client now instead of the anon client.
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";

async function assertAdmin() {
  const { isAdmin } = await requireSessionUser();
  if (!isAdmin) throw new Error("Forbidden: admin only");
}

export const listDefectStatusMapping = createServerFn({ method: "GET" }).handler(async () => {
  await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("defect_status_mapping")
    .select("id, status, is_open")
    .order("is_open", { ascending: false })
    .order("status");
  if (error) throw new Error(error.message);
  return data;
});

export const listUnmappedDefectStatuses = createServerFn({ method: "GET" }).handler(async () => {
  await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("defects").select("new_status");
  if (error) throw new Error(error.message);
  return Array.from(new Set((data ?? []).map((d) => d.new_status).filter(Boolean) as string[]));
});

export const toggleDefectStatusOpen = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; is_open: boolean }) => data)
  .handler(async ({ data }) => {
    await assertAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("defect_status_mapping")
      .update({ is_open: data.is_open })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const addDefectStatus = createServerFn({ method: "POST" })
  .inputValidator((data: { status: string }) => data)
  .handler(async ({ data }) => {
    await assertAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("defect_status_mapping")
      .insert({ status: data.status, is_open: true });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const removeDefectStatus = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await assertAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("defect_status_mapping").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
