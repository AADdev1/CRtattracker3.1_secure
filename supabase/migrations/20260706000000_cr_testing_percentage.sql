
-- =========== crs.testing_percentage ===========
-- Manually tracked by the CR's ITPM/BA on the CR Repository screen — not
-- a KPI-engine input, purely informational progress tracking.
ALTER TABLE public.crs ADD COLUMN IF NOT EXISTS testing_percentage integer;

ALTER TABLE public.crs
  DROP CONSTRAINT IF EXISTS crs_testing_percentage_range;
ALTER TABLE public.crs
  ADD CONSTRAINT crs_testing_percentage_range
  CHECK (testing_percentage IS NULL OR (testing_percentage >= 0 AND testing_percentage <= 100));
