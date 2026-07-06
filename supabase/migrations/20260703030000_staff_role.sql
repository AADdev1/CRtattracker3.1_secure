
-- =========== user_management.role (job-function role, distinct from is_admin) ===========
-- Gates the CR Allocation screen: PMO/Admin can assign missing BA/ITPM on
-- any CR; ITPM/BA can only claim CRs missing their own field. Nullable —
-- a user can exist with no role, in which case they don't see that screen
-- at all. Independent of is_admin (a user could hold both).
DO $$ BEGIN
  CREATE TYPE public.staff_role AS ENUM ('BA', 'ITPM', 'PMO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.user_management ADD COLUMN IF NOT EXISTS role public.staff_role;
