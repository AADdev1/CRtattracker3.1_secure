-- =========== Revert: 20260716000000_deployment_rollback.sql ===========

CREATE TYPE public.deployment_status AS ENUM ('Planned', 'Completed', 'Cancelled');

CREATE TABLE IF NOT EXISTS public.deployment_name_seq (
  year      int PRIMARY KEY,
  last_seq  int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.deployment_schedule (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_name   text NOT NULL UNIQUE,
  application       text NOT NULL,
  deployment_date   date NOT NULL,
  remarks           text,
  status            public.deployment_status NOT NULL DEFAULT 'Planned',
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deployment_schedule_status ON public.deployment_schedule(status);
CREATE INDEX IF NOT EXISTS idx_deployment_schedule_date ON public.deployment_schedule(deployment_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deployment_schedule_app_date_planned
  ON public.deployment_schedule(application, deployment_date)
  WHERE status = 'Planned';
CREATE TRIGGER trg_deployment_schedule_updated BEFORE UPDATE ON public.deployment_schedule
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.deployment_audit_log (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type               text NOT NULL,
  deployment_schedule_id   uuid REFERENCES public.deployment_schedule(id) ON DELETE SET NULL,
  cr_number                text REFERENCES public.crs(cr_number) ON DELETE SET NULL,
  performed_by             text NOT NULL,
  old_value                jsonb,
  new_value                jsonb,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deployment_audit_log_schedule ON public.deployment_audit_log(deployment_schedule_id);
CREATE INDEX IF NOT EXISTS idx_deployment_audit_log_cr ON public.deployment_audit_log(cr_number);

ALTER TABLE public.deployment_name_seq ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_audit_log ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.deployment_name_seq TO service_role;
GRANT ALL ON public.deployment_schedule TO service_role;
GRANT ALL ON public.deployment_audit_log TO service_role;

ALTER TABLE public.crs ADD COLUMN IF NOT EXISTS deployment_date date;
ALTER TABLE public.crs ADD COLUMN IF NOT EXISTS deployment_remarks text;
CREATE INDEX IF NOT EXISTS idx_crs_deployment_date ON public.crs(application, deployment_date)
  WHERE deployment_date IS NOT NULL;