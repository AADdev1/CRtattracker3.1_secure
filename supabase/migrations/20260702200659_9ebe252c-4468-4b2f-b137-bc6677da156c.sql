
-- Reconcile user_management migration with the live schema.
-- The table was originally created manually with bigserial id / varchar
-- columns / timestamps without time zone. The earlier migration file
-- declared a uuid/text shape that never actually applied because it used
-- IF NOT EXISTS against the pre-existing table. This migration re-declares
-- the table in its true shape so a fresh environment reproduces production.

CREATE TABLE IF NOT EXISTS public.user_management (
  id            bigserial PRIMARY KEY,
  user_name     varchar(200) NOT NULL,
  email         varchar(255) UNIQUE,
  password_hash varchar(255),
  is_active     boolean   NOT NULL DEFAULT true,
  is_admin      boolean   NOT NULL DEFAULT false,
  created_at    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    timestamp
);

-- Idempotent guards for environments where the table already exists but
-- is missing one of the later-added columns.
ALTER TABLE public.user_management ADD COLUMN IF NOT EXISTS email         varchar(255);
ALTER TABLE public.user_management ADD COLUMN IF NOT EXISTS password_hash varchar(255);
ALTER TABLE public.user_management ADD COLUMN IF NOT EXISTS is_admin      boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_management_email_key'
      AND conrelid = 'public.user_management'::regclass
  ) THEN
    ALTER TABLE public.user_management ADD CONSTRAINT user_management_email_key UNIQUE (email);
  END IF;
END $$;

ALTER TABLE public.user_management ENABLE ROW LEVEL SECURITY;

GRANT ALL    ON public.user_management TO service_role;
GRANT SELECT ON public.user_management TO anon, authenticated;

-- Read-only public access via the anon/publishable client, matching the
-- fully-open RLS pattern used across the rest of the app. Writes stay
-- service-role (or manual SQL) only. password_hash is unused by the app
-- today (auth is via env vars), so this does not expose real credentials.
DROP POLICY IF EXISTS "read-only access user_management" ON public.user_management;
CREATE POLICY "read-only access user_management" ON public.user_management
FOR SELECT USING (true);
