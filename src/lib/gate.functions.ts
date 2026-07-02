import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { supabase } from "@/integrations/supabase/client";

type GateSession = { unlocked?: boolean; email?: string; userName?: string; isAdmin?: boolean };

function getSessionConfig() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return {
    password: secret,
    name: "kpisavvy-session",
    maxAge: 60 * 60 * 24 * 7,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

function matches(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

// Interim auth: credentials come from env vars (AUTH_USER1_*, AUTH_USER2_*, ...),
// the display name used to match crs.ba / crs.itpm comes from user_management.
// Real Supabase Auth is deferred until later.
function getConfiguredUsers(): { email: string; password: string }[] {
  const users: { email: string; password: string }[] = [];
  for (let i = 1; ; i++) {
    const email = process.env[`AUTH_USER${i}_EMAIL`];
    const password = process.env[`AUTH_USER${i}_PASSWORD`];
    if (!email || !password) break;
    users.push({ email: email.trim().toLowerCase(), password });
  }
  return users;
}

export const loginUser = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; password: string }) => data)
  .handler(async ({ data }) => {
    const users = getConfiguredUsers();
    if (users.length === 0) {
      throw new Error("Auth env vars are not configured");
    }
    const submittedEmail = data.email.trim().toLowerCase();
    const match = users.find((u) => matches(u.email, submittedEmail));
    if (!match || !matches(match.password, data.password)) {
      return { ok: false as const };
    }

    const { data: profile, error } = await supabase
      .from("user_management")
      .select("user_name, is_active, is_admin")
      .eq("email", match.email)
      .maybeSingle();
    if (error || !profile || !profile.is_active) {
      return { ok: false as const };
    }

    const session = await useSession<GateSession>(getSessionConfig());
    await session.update({
      unlocked: true,
      email: match.email,
      userName: profile.user_name,
      isAdmin: profile.is_admin,
    });
    return { ok: true as const };
  });

export const logoutUser = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<GateSession>(getSessionConfig());
  await session.clear();
  return { ok: true as const };
});

export const getAuthState = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<GateSession>(getSessionConfig());
  return {
    unlocked: Boolean(session.data.unlocked),
    email: session.data.email ?? null,
    userName: session.data.userName ?? null,
    isAdmin: Boolean(session.data.isAdmin),
  };
});

// For other server functions (see scoped-data.functions.ts) that need to know
// who's logged in without duplicating the session/cookie config. Wrapped in
// createServerOnlyFn so the build keeps its @tanstack/react-start/server
// import out of the client bundle (this file is reachable from __root.tsx).
export const requireSessionUser = createServerOnlyFn(
  async (): Promise<{ email: string; userName: string; isAdmin: boolean }> => {
    const session = await useSession<GateSession>(getSessionConfig());
    if (!session.data.unlocked || !session.data.email || !session.data.userName) {
      throw new Error("Unauthorized");
    }
    return {
      email: session.data.email,
      userName: session.data.userName,
      isAdmin: Boolean(session.data.isAdmin),
    };
  },
);