-- =========== Test Case Execution Status ===========
-- Once a CR's test cases are Approved, the Tester marks each row with the
-- actual execution outcome — separate from test_cases.status (the
-- upload/approval workflow state). "Defect Raised" requires a defect id.

DO $$ BEGIN
  CREATE TYPE public.test_case_execution_status AS ENUM ('Pending', 'Tested', 'Defect Raised');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.test_cases
  ADD COLUMN IF NOT EXISTS execution_status public.test_case_execution_status NOT NULL DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS defect_id text;
