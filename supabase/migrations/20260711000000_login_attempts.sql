
-- =========== login_attempts (server-side sign-in rate limiting) ===========
-- Backs the signIn server function's lockout logic (src/lib/auth.functions.ts).
-- Sign-in now goes through that server function instead of the browser
-- calling Supabase Auth directly, specifically so repeated bad guesses
-- against one account can be locked out server-side before ever reaching
-- Supabase's own token endpoint. Service-role only — no client ever
-- reads/writes this table directly.
CREATE TABLE IF NOT EXISTS public.login_attempts (
  email            text PRIMARY KEY,
  failed_count     int NOT NULL DEFAULT 0,
  first_failed_at  timestamptz,
  locked_until     timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.login_attempts TO service_role;
-- No anon/authenticated grant — only the signIn server function (service-role) touches this.

CREATE TRIGGER trg_login_attempts_updated BEFORE UPDATE ON public.login_attempts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
