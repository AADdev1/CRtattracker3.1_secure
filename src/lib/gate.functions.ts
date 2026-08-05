import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Append-only security-event log (TAGIC-IR-GL-001 §3.7 / M3). Deliberately
// only called from denial paths (below) and login success/failure — not
// from every successfully-authorized request, which would add a DB write
// to nearly every page load for no security value. Swallows its own
// errors: a logging failure must never block or mask the underlying
// auth decision.
type SecurityEventType = "login_success" | "login_failure" | "access_denied";

export async function logSecurityEvent(
  eventType: SecurityEventType,
  actorEmail: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("security_events").insert({
      event_type: eventType,
      actor_email: actorEmail,
      detail: (detail ?? null) as never,
    } as never);
  } catch {
    // Never let audit logging take down the request it's logging.
  }
}

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
    spocApplications: string[];
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
    const sessionId = claimsData?.claims?.session_id;
    if (claimsError || !email) {
      // No/invalid token — not logged in yet, or a stale token mid-refresh.
      // Hit constantly by getAuthState's own try/catch polling for
      // signed-out visitors; not a meaningful security signal on its own,
      // so deliberately not logged (would otherwise flood security_events
      // with routine "not logged in" noise).
      throw new Error("Unauthorized");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_management")
      .select(
        "user_name, is_active, is_admin, role, is_test_case_approver, spoc_applications, current_session_id",
      )
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (profileError || !profile || !profile.is_active) {
      // Unlike the branch above, this means a *real, verified* Supabase
      // Auth identity was rejected by the app's own authorization layer
      // (no matching user_management row, or deactivated) — a genuine
      // access-denied event worth recording.
      await logSecurityEvent("access_denied", email, {
        reason: !profile ? "no_user_management_row" : "inactive_account",
      });
      throw new Error("Unauthorized");
    }

    // Single-session-per-user (M9) — logging in from another device
    // overwrites current_session_id (see signIn, auth.functions.ts), which
    // supersedes every session that isn't the one that just logged in.
    // Also rejects a JWT from before this feature shipped (column starts
    // null for everyone), forcing a one-time fresh login on rollout.
    if (!profile.current_session_id || profile.current_session_id !== sessionId) {
      await logSecurityEvent("access_denied", email, { reason: "session_superseded" });
      throw new Error(
        "Unauthorized: this session has ended because your account signed in elsewhere.",
      );
    }

    return {
      email,
      userName: profile.user_name,
      isAdmin: profile.is_admin,
      role: profile.role,
      isTestCaseApprover: profile.is_test_case_approver,
      spocApplications: profile.spoc_applications ?? [],
    };
  },
);

// A user with no role and no Admin flag has no legitimate use for any
// screen in this app. Call this right after requireSessionUser() in any
// handler that was previously "open to any authenticated account" (a bare
// requireSessionUser() with no further check) so no-role accounts are
// rejected consistently everywhere, instead of relying solely on the nav
// link being hidden — a direct call would otherwise still go through.
export function assertHasRoleOrAdmin(session: {
  isAdmin: boolean;
  role: StaffRole | null;
  email?: string;
}): void {
  if (!session.isAdmin && session.role == null) {
    void logSecurityEvent("access_denied", session.email ?? null, { reason: "no_role_assigned" });
    throw new Error("Forbidden: your account has no role assigned. Contact an administrator.");
  }
}

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
