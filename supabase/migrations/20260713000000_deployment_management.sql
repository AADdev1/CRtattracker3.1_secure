
-- =========== Deployment Management (Phase 4) ===========
-- PMO/ITPM/BA can group CRs that have reached UAT Signed Off into named
-- deployment schedules and track each CR's progress through deployment
-- stages. UAT Signed Off / Deployed to Production are driven
-- automatically from CR CSV import (see syncDeploymentStagesForCrs in
-- src/lib/deployment.functions.ts, called from src/lib/csv-import.ts) —
-- they reflect facts from the source system, not team-tracked progress,
-- so they're not manually editable. Admin is deliberately excluded from
-- write access here, same as CR size/notes/workflow-status editing
-- (crs-admin.functions.ts) — CR/deployment data entry isn't an Admin
-- function in this app.

CREATE TYPE public.deployment_status AS ENUM ('Planned', 'Completed', 'Cancelled');

CREATE TYPE public.deployment_stage AS ENUM (
  'UAT Signed Off',
  'Code Merging Done',
  'Deployed to MO',
  'MO Testing Done',
  'MO Signed Off',
  'Deployed to Production'
);

-- Deployment stage lives on crs itself, not on the mapping table — a CR
-- reaches 'UAT Signed Off' (and becomes eligible for deployment planning)
-- before it's ever assigned to a schedule. Null = deployment tracking
-- hasn't started for this CR yet.
ALTER TABLE public.crs ADD COLUMN IF NOT EXISTS deployment_stage public.deployment_stage;
CREATE INDEX IF NOT EXISTS idx_crs_deployment_stage ON public.crs(deployment_stage);

-- Atomic per-year counter backing DEP-<year>-<seq> name generation — same
-- atomic-conditional-update idiom as kpi_engine_lock / claimCr, avoids a
-- read-then-write race between two concurrent schedule creations.
CREATE TABLE IF NOT EXISTS public.deployment_name_seq (
  year      int PRIMARY KEY,
  last_seq  int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.deployment_schedule (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_name   text NOT NULL UNIQUE,
  deployment_date   date NOT NULL,
  remarks           text,
  status            public.deployment_status NOT NULL DEFAULT 'Planned',
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deployment_schedule_status ON public.deployment_schedule(status);
CREATE INDEX IF NOT EXISTS idx_deployment_schedule_date ON public.deployment_schedule(deployment_date);
CREATE TRIGGER trg_deployment_schedule_updated BEFORE UPDATE ON public.deployment_schedule
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.cr_deployment_mapping (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_schedule_id   uuid NOT NULL REFERENCES public.deployment_schedule(id) ON DELETE CASCADE,
  cr_number                text NOT NULL REFERENCES public.crs(cr_number) ON DELETE CASCADE,
  allocation_remarks       text,
  assigned_by              text NOT NULL,
  assigned_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cr_deployment_mapping_cr ON public.cr_deployment_mapping(cr_number);
CREATE INDEX IF NOT EXISTS idx_cr_deployment_mapping_schedule ON public.cr_deployment_mapping(deployment_schedule_id);

-- "One CR : one active schedule" is enforced in assignCrsToDeployment
-- (checks for an existing mapping row joined to a Planned schedule before
-- inserting) rather than a DB constraint — expressing "active" requires a
-- join to deployment_schedule.status, which a plain UNIQUE index can't
-- express without a synced denormalized column + trigger. Given this
-- app's small internal user base and the established preference against
-- added trigger complexity (see the M3 decision to skip a pg_net
-- trigger), an application-level check is the right tradeoff here.

CREATE TABLE IF NOT EXISTS public.deployment_audit_log (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type               text NOT NULL, -- 'schedule_created' | 'schedule_updated' | 'cr_assigned' | 'cr_removed' | 'stage_changed'
  deployment_schedule_id   uuid REFERENCES public.deployment_schedule(id) ON DELETE SET NULL,
  cr_number                text REFERENCES public.crs(cr_number) ON DELETE SET NULL,
  performed_by             text NOT NULL,
  old_value                jsonb,
  new_value                jsonb,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deployment_audit_log_schedule ON public.deployment_audit_log(deployment_schedule_id);
CREATE INDEX IF NOT EXISTS idx_deployment_audit_log_cr ON public.deployment_audit_log(cr_number);

-- Lock down exactly like every table since the RLS remediation pass —
-- service-role only, no anon/authenticated grant. All access goes through
-- src/lib/deployment.functions.ts.
ALTER TABLE public.deployment_name_seq ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cr_deployment_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_audit_log ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.deployment_name_seq TO service_role;
GRANT ALL ON public.deployment_schedule TO service_role;
GRANT ALL ON public.cr_deployment_mapping TO service_role;
GRANT ALL ON public.deployment_audit_log TO service_role;
