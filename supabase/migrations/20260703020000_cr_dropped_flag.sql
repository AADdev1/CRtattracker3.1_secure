
-- =========== crs.is_dropped (manual, KPI-exclusion flag) ===========
-- Set from CR Size Management. Dropped CRs are skipped entirely by the KPI
-- engine (recalculateAllKpis / recalculateForCr) — no kpi_results rows are
-- computed or kept for them.
--
-- Safety net: CSV import auto-clears this flag if a re-imported CR reports
-- a "Workflow Status" that ISN'T one of the three known drop statuses
-- (03_Concept dropped / 05_Requirement Dropped / 09_BRD Dropped) — i.e. if
-- the source CR Portal shows real activity again, we trust that over a
-- stale manual drop. See src/lib/csv-import.ts.
ALTER TABLE public.crs ADD COLUMN IF NOT EXISTS is_dropped boolean NOT NULL DEFAULT false;
