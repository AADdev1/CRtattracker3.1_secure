import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Verifies the real Supabase Auth Bearer JWT (attached automatically to
// every server-fn call by attachSupabaseAuth — see start.ts), then looks
// up user_management by the verified email for the BA/ITPM display name
// and admin flag. Every scoped server function built on top of this
// (scoped-data.functions.ts, kpi-engine.ts, etc.) depends on this exact
// return shape — keep it stable.
// Wrapped in createServerOnlyFn so the build keeps its
// @tanstack/react-start/server import out of the client bundle (this file
// is reachable from route/component code).
export type StaffRole = "BA" | "ITPM" | "PMO" | "Tester";

export const requireSessionUser = createServerOnlyFn(
  async (): Promise<{
    email: string;
    userName: string;
    isAdmin: boolean;
    role: StaffRole | null;
    isTestCaseApprover: boolean;
  }> => {
    const request = getRequest();
    const authHeader = request?.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new Error("Unauthorized");
    }
    const token = authHeader.slice("Bearer ".length);

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("Supabase environment variables are not configured");
    }

    const scopedClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: claimsData, error: claimsError } = await scopedClient.auth.getClaims(token);
    const email = claimsData?.claims?.email;
    if (claimsError || !email) {
      throw new Error("Unauthorized");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_management")
      .select("user_name, is_active, is_admin, role, is_test_case_approver")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (profileError || !profile || !profile.is_active) {
      throw new Error("Unauthorized");
    }

    return {
      email,
      userName: profile.user_name,
      isAdmin: profile.is_admin,
      role: profile.role,
      isTestCaseApprover: profile.is_test_case_approver,
    };
  },
);

// Non-throwing wrapper for UI display (useAppUser / app-shell) — same
// shape the interim cookie-based version used, so callers need no changes.
export const getAuthState = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const user = await requireSessionUser();
    return {
      unlocked: true,
      email: user.email,
      userName: user.userName,
      isAdmin: user.isAdmin,
      role: user.role,
      isTestCaseApprover: user.isTestCaseApprover,
    };
  } catch {
    return {
      unlocked: false,
      email: null,
      userName: null,
      isAdmin: false,
      role: null,
      isTestCaseApprover: false,
    };
  }
});
