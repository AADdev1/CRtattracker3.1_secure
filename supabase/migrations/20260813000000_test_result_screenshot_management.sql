-- =========== Test Result Screenshot Management ===========
-- Testers upload evidence screenshots against Approved test cases on a CR;
-- everyone with view access can browse them. Filename convention:
-- <CRNumber>TC<i>(<j>).<ext> — see
-- src/lib/test-result-screenshots.functions.ts for parsing/matching.
--
-- Deliberately NOT foreign-keyed to test_cases.id: test_case_number is
-- free text with no unique constraint on (cr_number, test_case_number)
-- today, and uploadTestCases (test-cases.functions.ts) deletes+reinserts
-- every row for a CR on every re-upload, minting new ids each time — a
-- hard FK to test_cases.id would cascade-delete every screenshot on the
-- next test-case re-upload. This table only hard-FKs cr_number, and
-- matches test cases at the application layer via a normalized
-- (digits-only) comparison against test_case_number.

CREATE TABLE IF NOT EXISTS public.test_result_screenshots (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cr_number                    text NOT NULL REFERENCES public.crs(cr_number) ON DELETE CASCADE,
  test_case_number_normalized  text NOT NULL,   -- digits-only, e.g. "1", "12"
  test_case_number_raw         text NOT NULL,   -- test_cases.test_case_number at time of write, for display
  sequence                     integer NOT NULL CHECK (sequence > 0),
  storage_path                 text NOT NULL,   -- bucket-relative object key
  file_extension               text NOT NULL,
  original_filename            text NOT NULL,
  uploaded_by                  text NOT NULL,
  uploaded_date                timestamptz NOT NULL DEFAULT now(),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cr_number, test_case_number_normalized, sequence)
);

CREATE INDEX IF NOT EXISTS idx_trs_cr_number ON public.test_result_screenshots(cr_number);
CREATE INDEX IF NOT EXISTS idx_trs_cr_tc ON public.test_result_screenshots(cr_number, test_case_number_normalized);

ALTER TABLE public.test_result_screenshots ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.test_result_screenshots TO service_role;
-- No anon/authenticated policy — same lockdown as every table since
-- 20260703000000_lock_down_rls.sql; access goes through
-- src/lib/test-result-screenshots.functions.ts (service-role client).

CREATE TRIGGER trg_test_result_screenshots_updated BEFORE UPDATE ON public.test_result_screenshots
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Private bucket. All reads (signed URLs) and writes (.upload) go through
-- the service-role client in server functions — no storage.objects RLS
-- policy needed for anon/authenticated (service role bypasses Storage RLS
-- the same way it bypasses table RLS). SVG is deliberately excluded from
-- allowed_mime_types: SVGs can carry <script> and execute when rendered
-- inline, a stored-XSS vector the moment this module displays one.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'test-result-screenshots',
  'test-result-screenshots',
  false,
  8388608, -- 8 MB — matches MAX_SCREENSHOT_FILE_BYTES in src/lib/upload-limits.ts
  ARRAY['image/jpeg','image/png','image/gif','image/webp','image/bmp']
)
ON CONFLICT (id) DO NOTHING;
