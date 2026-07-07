
-- =========== Test Case Management ===========
-- Testers upload test cases (Excel) for any CR; BA/ITPM users flagged as
-- approvers (is_test_case_approver) review and approve/send back. No
-- per-tester CR assignment (shared pool across all Testers) and no
-- version/audit history — re-upload replaces the CR's test cases outright.

ALTER TABLE public.user_management
  ADD COLUMN IF NOT EXISTS is_test_case_approver boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  CREATE TYPE public.test_case_status AS ENUM ('Pending', 'Submitted', 'Sent Back for Revision', 'Approved');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.test_cases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cr_number         text NOT NULL REFERENCES public.crs(cr_number) ON DELETE CASCADE,
  test_priority     text,
  test_case_number  text NOT NULL,
  test_case_name    text NOT NULL,
  test_condition    text NOT NULL,
  expected_result   text NOT NULL,
  tester_comments   text,
  approver_comments text,
  uploaded_by       text NOT NULL,
  uploaded_date     timestamptz NOT NULL DEFAULT now(),
  status            public.test_case_status NOT NULL DEFAULT 'Pending',
  approval_date     timestamptz,
  approved_by       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_cases_cr_number ON public.test_cases(cr_number);
CREATE INDEX IF NOT EXISTS idx_test_cases_status ON public.test_cases(status);

ALTER TABLE public.test_cases ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.test_cases TO service_role;
-- No anon/authenticated policy: same lockdown as every table since
-- 20260703000000_lock_down_rls.sql — access goes through
-- src/lib/test-cases.functions.ts (service-role client), not direct RLS.

CREATE TRIGGER trg_test_cases_updated BEFORE UPDATE ON public.test_cases
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
