// Shared read of the workflow_statuses dictionary — same for every user,
// not part of BA/ITPM scoping. RLS is locked down (see
// supabase/migrations/20260703000000_lock_down_rls.sql), so this goes
// through the service-role client like every other table read now.
import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";

export const getWorkflowStatuses = createServerFn({ method: "GET" }).handler(async () => {
  await requireSessionUser();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("workflow_statuses")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
});
