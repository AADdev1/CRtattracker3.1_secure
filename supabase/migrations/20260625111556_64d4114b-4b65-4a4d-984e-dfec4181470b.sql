
-- Create per-KPI excluded statuses mapping
CREATE TABLE public.kpi_excluded_statuses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kpi_id UUID NOT NULL REFERENCES public.kpis(id) ON DELETE CASCADE,
  workflow_status_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kpi_id, workflow_status_code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_excluded_statuses TO anon, authenticated;
GRANT ALL ON public.kpi_excluded_statuses TO service_role;

ALTER TABLE public.kpi_excluded_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Phase 1 open access to kpi_excluded_statuses"
ON public.kpi_excluded_statuses FOR ALL
USING (true) WITH CHECK (true);

CREATE INDEX idx_kpi_excluded_statuses_kpi_id ON public.kpi_excluded_statuses(kpi_id);

-- Remove the now-obsolete global excluded flag
ALTER TABLE public.workflow_statuses DROP COLUMN IF EXISTS is_excluded;
