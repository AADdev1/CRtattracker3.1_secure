-- =========== test_cases.needs_retest ===========
-- Set automatically when a defect import reports that a test case's
-- referenced defect (test_cases.defect_id) is no longer open per
-- defect_status_mapping — the test case is scratched back to Pending and
-- flagged here so the Tester notices it needs a fresh look. Cleared the
-- next time the Tester updates that row's execution status (any action
-- counts as "handled"). See src/lib/defect-import.ts and
-- src/lib/test-cases.functions.ts.
ALTER TABLE public.test_cases
  ADD COLUMN IF NOT EXISTS needs_retest boolean NOT NULL DEFAULT false;
