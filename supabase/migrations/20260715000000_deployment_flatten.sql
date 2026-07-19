
-- =========== Deployment Management: flatten onto crs ===========
-- cr_deployment_mapping added a join table for a relationship that's
-- simpler expressed directly on crs: a CR is "assigned to a deployment"
-- by carrying that deployment's date (and per-CR remarks) on the CR row
-- itself. The schedule a CR belongs to is derived by matching
-- (crs.application, crs.deployment_date) against
-- (deployment_schedule.application, deployment_schedule.deployment_date)
-- — application is the new column that disambiguates same-date
-- schedules, replacing the old (date, remarks) uniqueness check.

ALTER TABLE public.deployment_schedule ADD COLUMN IF NOT EXISTS application text;
UPDATE public.deployment_schedule SET application = 'Unknown' WHERE application IS NULL;
ALTER TABLE public.deployment_schedule ALTER COLUMN application SET NOT NULL;

-- Only one Planned deployment per application per date. Completed/
-- Cancelled schedules don't hold the date reserved, so it can be reused.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deployment_schedule_app_date_planned
  ON public.deployment_schedule(application, deployment_date)
  WHERE status = 'Planned';

ALTER TABLE public.crs ADD COLUMN IF NOT EXISTS deployment_date date;
ALTER TABLE public.crs ADD COLUMN IF NOT EXISTS deployment_remarks text;
CREATE INDEX IF NOT EXISTS idx_crs_deployment_date ON public.crs(application, deployment_date)
  WHERE deployment_date IS NOT NULL;

DROP TABLE IF EXISTS public.cr_deployment_mapping;
