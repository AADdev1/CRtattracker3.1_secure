// Server-mediated sign-in. The browser no longer calls Supabase Auth
// directly (supabase.auth.signInWithPassword) — it calls this function,
// which enforces a per-email lockout (public.login_attempts) before ever
// contacting Supabase, then hands the resulting session tokens back to the
// client to hydrate via supabase.auth.setSession(). This is app-owned
// brute-force protection for traffic that actually goes through the app's
// own login form (see H5 in the security review) — it does not replace
// Supabase Auth's own platform-level rate limiting, which still matters
// for anyone calling Supabase's endpoint directly with the public key.
import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const ATTEMPT_WINDOW_MINUTES = 15;

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization');
    }
    headers.set('apikey', supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

type AttemptRow = { failed_count: number; first_failed_at: string | null; locked_until: string | null };

async function recordFailedAttempt(
  supabaseAdmin: SupabaseClient<Database>,
  email: string,
  existing: AttemptRow | null,
) {
  const nowIso = new Date().toISOString();
  const windowExpired =
    !!existing?.first_failed_at &&
    Date.now() - new Date(existing.first_failed_at).getTime() > ATTEMPT_WINDOW_MINUTES * 60_000;

  const priorCount = windowExpired ? 0 : (existing?.failed_count ?? 0);
  const nextCount = priorCount + 1;

  await supabaseAdmin.from("login_attempts").upsert(
    {
      email,
      failed_count: nextCount,
      first_failed_at: priorCount === 0 ? nowIso : existing!.first_failed_at,
      updated_at: nowIso,
      locked_until:
        nextCount >= MAX_FAILED_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
          : null,
    } as never,
    { onConflict: "email" },
  );
}

export const signIn = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; password: string }) => data)
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    if (!email || !data.password) {
      throw new Error("Email and password are required");
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("Supabase environment variables are not configured");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: attempt } = await supabaseAdmin
      .from("login_attempts")
      .select("failed_count, first_failed_at, locked_until")
      .eq("email", email)
      .maybeSingle<AttemptRow>();

    // Reject immediately, without ever contacting Supabase, if this email
    // is currently locked out from too many recent failures.
    if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(attempt.locked_until).getTime() - Date.now()) / 60_000);
      throw new Error(
        `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`,
      );
    }

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY) },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: signInData, error } = await supabase.auth.signInWithPassword({
      email,
      password: data.password,
    });

    if (error || !signInData.session) {
      await recordFailedAttempt(supabaseAdmin, email, attempt ?? null);
      throw new Error("Invalid email or password");
    }

    // Success — clear any prior failure record for this email.
    await supabaseAdmin.from("login_attempts").delete().eq("email", email);

    return {
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
    };
  });
