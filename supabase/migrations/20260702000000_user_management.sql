
-- =========== user_management (interim BA/ITPM name-matching lookup) ===========
-- Maps a login email to the exact display name used in crs.ba / crs.itpm.
-- Table already exists in the live project (created manually); this migration
-- exists so the schema is reproducible.
CREATE TABLE IF NOT EXISTS public.user_management (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name     text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text,
  is_active     boolean NOT NULL DEFAULT true,
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_management ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

ALTER TABLE public.user_management ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.user_management TO service_role;

-- Interim: no service-role key available yet, so login/scoping reads this
-- table with the regular anon/publishable client, matching the fully-open
-- RLS pattern already used on every other table in this project (crs, kpis,
-- etc.) — see src/lib/gate.functions.ts. Read-only; writes stay service-role
-- (or manual SQL) only. password_hash is unused by the app (auth is via env
-- vars for now), so this doesn't expose real credentials.
GRANT SELECT ON public.user_management TO anon, authenticated;
CREATE POLICY "read-only access user_management" ON public.user_management
FOR SELECT USING (true);

CREATE TRIGGER trg_user_management_updated BEFORE UPDATE ON public.user_management
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
