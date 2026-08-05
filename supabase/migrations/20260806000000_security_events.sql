-- Append-only security-event log (TAGIC-IR-GL-001 §3.7 / M3 remediation).
-- Written from the centralized auth chokepoints (requireSessionUser,
-- assertHasRoleOrAdmin) and successful sign-in — not from every
-- successfully-authorized request, which would be a DB write on nearly
-- every page load for no security value. See src/lib/gate.functions.ts.
CREATE TABLE IF NOT EXISTS public.security_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    text NOT NULL, -- 'login_success' | 'login_failure' | 'access_denied'
  actor_email   text,
  detail        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON public.security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON public.security_events(event_type);

-- Lock down exactly like every table since the RLS remediation pass —
-- service-role only, no anon/authenticated grant. All access goes through
-- src/lib/gate.functions.ts.
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.security_events TO service_role;
