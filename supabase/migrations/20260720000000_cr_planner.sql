
-- =========== CR Planner (ITPM-only, fully independent module) ===========
-- Standalone Dev/SIT/UAT/Production timeline planner for ITPM. Deliberately
-- touches no existing table — crs is read-only reference data here (never
-- written to), and this doesn't share a table with the Deployment
-- Management module (deployment_schedule etc.). If this module is ever
-- removed, nothing else in the app is affected.

-- "Deployment Master" — the source of valid PROD dates for the planner.
-- Independent of deployment_schedule (Deployment Planning module) by
-- explicit decision, so this stays a self-contained module.
CREATE TABLE IF NOT EXISTS public.deployment_master (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_date   date NOT NULL UNIQUE,
  application       text,
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cr_planner (
  planner_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cr_number         text NOT NULL UNIQUE REFERENCES public.crs(cr_number) ON DELETE CASCADE,
  dev_resource      text,               -- 'R1' | 'R2', validated in the server function
  dev_effort        int,                -- working days, > 0
  dev_start_date    date,
  dev_end_date      date,               -- server-calculated, stored (sorts/filters like a normal column)
  sit_effort        int,
  sit_start_date    date,
  uat_date          date,               -- server-calculated, stored
  prod_date         date,               -- must exist in deployment_master.deployment_date
  remarks           text,
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  modified_by       text,
  modified_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cr_planner_cr_number ON public.cr_planner(cr_number);

-- Lock down exactly like every table since the RLS remediation pass —
-- service-role only, no anon/authenticated grant. All access goes through
-- src/lib/cr-planner.functions.ts.
ALTER TABLE public.deployment_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cr_planner ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.deployment_master TO service_role;
GRANT ALL ON public.cr_planner TO service_role;
