// In-app user creation/role management is disabled for now — accounts are
// provisioned directly in Supabase (auth.users + public.user_management)
// instead of through this API. Nothing currently imports from this file
// (src/routes/users.tsx shows a static placeholder instead of calling
// these). The full original implementation is preserved below, commented
// out, ready to restore in a future release — see H4 in the security
// review for why this was disabled rather than just left running
// (createUserAccount let any Admin set arbitrary temporary passwords with
// no strength check).

/* ── Disabled pending a future release — restore by uncommenting below and
   re-wiring src/routes/users.tsx back to its full implementation ──

import { createServerFn } from "@tanstack/react-start";
import { requireSessionUser } from "@/lib/gate.functions";
import type { StaffRole } from "@/lib/gate.functions";

async function assertAdmin() {
  const { isAdmin } = await requireSessionUser();
  if (!isAdmin) throw new Error("Forbidden: admin only");
}

export const listUsers = createServerFn({ method: "GET" }).handler(async () => {
  await assertAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_management")
    .select("id, user_name, email, is_admin, role, is_test_case_approver, is_active, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
});

export const createUserAccount = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      email: string;
      password: string;
      userName: string;
      isAdmin: boolean;
      role: StaffRole | null;
      isTestCaseApprover: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    await assertAdmin();
    const email = data.email.trim().toLowerCase();
    const userName = data.userName.trim();
    if (!email || !data.password || !userName) {
      throw new Error("Email, password, and display name are required");
    }
    // TODO before re-enabling: enforce a minimum password length/strength
    // check here (H4) — this used to forward data.password straight to
    // the Admin API with no validation at all beyond non-empty.

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
    });
    if (authErr) throw new Error(authErr.message);

    // user_name must exactly match the BA/ITPM name used on CRs — that's
    // what scoped-data.functions.ts matches against for CR visibility.
    const { error: umErr } = await supabaseAdmin.from("user_management").insert({
      auth_user_id: created.user.id,
      user_name: userName,
      email,
      is_admin: data.isAdmin,
      role: data.role,
      is_test_case_approver: data.isTestCaseApprover,
      is_active: true,
    } as never);

    if (umErr) {
      // Don't leave an orphaned login behind if the profile row failed
      // (e.g. duplicate email already in user_management).
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw new Error(umErr.message);
    }

    return { ok: true as const, email };
  });

export const updateUserFields = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      isAdmin: boolean;
      role: StaffRole | null;
      isTestCaseApprover: boolean;
      isActive: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    await assertAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_management")
      .update({
        is_admin: data.isAdmin,
        role: data.role,
        is_test_case_approver: data.isTestCaseApprover,
        is_active: data.isActive,
      } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteUserAccount = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await assertAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: fetchErr } = await supabaseAdmin
      .from("user_management")
      .select("auth_user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);

    const { error: delErr } = await supabaseAdmin.from("user_management").delete().eq("id", data.id);
    if (delErr) throw new Error(delErr.message);

    // Rows provisioned by hand before auth_user_id existed have no linked
    // login to remove — deleting the user_management row still revokes all
    // app access via requireSessionUser's email lookup.
    if (row?.auth_user_id) {
      await supabaseAdmin.auth.admin.deleteUser(row.auth_user_id);
    }
    return { ok: true as const };
  });
── end disabled block ── */
