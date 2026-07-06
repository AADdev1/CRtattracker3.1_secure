
-- =========== kpi_engine_lock (prevents concurrent full recalculations) ===========
-- recalculateAllKpis() rewrites every CR x active-KPI row (~300 CRs x 14
-- KPIs today). Two overlapping runs would double the DB load and can throw
-- duplicate-key errors on kpi_results (UNIQUE (cr_number, kpi_id)) if their
-- delete/insert steps interleave. This is a singleton-row lock claimed with
-- an atomic UPDATE ... WHERE, so only one run can proceed at a time across
-- every session/tab/user. started_at lets a crashed run self-heal after 5
-- minutes instead of locking the engine forever.
CREATE TABLE IF NOT EXISTS public.kpi_engine_lock (
  id         text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  is_running boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.kpi_engine_lock (id, is_running)
VALUES ('singleton', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.kpi_engine_lock ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.kpi_engine_lock TO service_role;
-- No anon/authenticated grant: only recalculateAllKpis (service-role) touches this.
