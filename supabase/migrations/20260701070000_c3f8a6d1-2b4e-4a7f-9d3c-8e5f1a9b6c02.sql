
-- =========== app_role + profiles (per-user roles) ===========
CREATE TYPE public.app_role AS ENUM ('ITPM', 'BA', 'Admin');

CREATE TABLE public.profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         public.app_role NOT NULL DEFAULT 'BA',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.profiles TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER function so RLS policies below can check the caller's own
-- role without recursively re-evaluating the profiles RLS policy on itself.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE POLICY "profiles_select_self_or_admin" ON public.profiles
FOR SELECT USING (id = auth.uid() OR public.current_user_role() = 'Admin');

CREATE POLICY "profiles_update_admin_only" ON public.profiles
FOR UPDATE USING (public.current_user_role() = 'Admin') WITH CHECK (public.current_user_role() = 'Admin');

-- No client INSERT/DELETE policy: rows are created by the trigger below and
-- removed via the auth.users cascade, both driven by the service-role Admin API.

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-create a profile row whenever a new auth.users row is created.
-- Role comes from user_metadata.role (set by the admin-provisioning flow),
-- falling back to 'BA' for accounts created without it (e.g. via Studio).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'BA')::public.app_role
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
