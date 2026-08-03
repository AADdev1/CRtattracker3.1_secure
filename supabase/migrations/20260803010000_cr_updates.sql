
-- =========== CR Repository — free-text CR Updates log ===========
-- Append-only running log of free-text updates a PMO/BA/ITPM can post
-- against a CR from the CR Repository grid. Every submission is a new
-- row (never overwritten), timestamped, and shown in full on the CR
-- Detail page. Deliberately its own table rather than a column on crs —
-- a CR can accumulate many updates over its lifetime.
CREATE TABLE IF NOT EXISTS public.cr_updates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cr_number     text NOT NULL REFERENCES public.crs(cr_number) ON DELETE CASCADE,
  update_text   text NOT NULL,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cr_updates_cr_number ON public.cr_updates(cr_number);

-- Lock down exactly like every table since the RLS remediation pass —
-- service-role only, no anon/authenticated grant. All access goes through
-- src/lib/cr-updates.functions.ts.
ALTER TABLE public.cr_updates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.cr_updates TO service_role;
