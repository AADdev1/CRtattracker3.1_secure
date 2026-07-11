
-- =========== Remove legacy Supabase-Auth-based role system ===========
-- public.profiles / public.app_role were an earlier, parallel authorization
-- system that only ever gated the /users admin panel (via the old
-- src/lib/user-management.functions.ts assertAdmin), while every other
-- feature in the app authorizes through public.user_management (see
-- src/lib/gate.functions.ts). The two systems never stayed in sync, and
-- profiles.role was seeded from auth.users.raw_user_meta_data — a
-- client-writable field at signup time — making it possible to self-grant
-- Admin via a direct signUp() call. Removing it entirely so there is
-- exactly one authorization source for the whole app.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP POLICY IF EXISTS "profiles_select_self_or_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin_only" ON public.profiles;
DROP FUNCTION IF EXISTS public.current_user_role();
DROP TABLE IF EXISTS public.profiles;
DROP TYPE IF EXISTS public.app_role;

-- =========== user_management.auth_user_id ===========
-- Links a user_management row to its Supabase Auth account, so the /users
-- admin panel can create and delete logins cleanly instead of leaving
-- orphaned auth.users rows behind. Nullable: rows provisioned by hand
-- before this column existed aren't linked until an admin recreates or
-- backfills them — requireSessionUser's email-based lookup is unaffected
-- and keeps working regardless of whether this column is populated.
ALTER TABLE public.user_management
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_management_auth_user_id
  ON public.user_management(auth_user_id) WHERE auth_user_id IS NOT NULL;
