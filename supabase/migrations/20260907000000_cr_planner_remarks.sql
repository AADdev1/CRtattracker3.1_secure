
-- =========== CR Planner — free-text Remarks history ===========
-- Append-only running log of free-text remarks an ITPM can post against a
-- planner entry, each timestamped and attributed. Deliberately its own
-- table rather than only the single cr_planner.remarks column — a CR can
-- accumulate many remarks over its planning lifetime, and every past one
-- stays visible (hover/click on the Remarks cell in CR Planner). The
-- cr_planner.remarks column is kept in sync with the latest entry's text
-- by src/lib/cr-planner.functions.ts's addPlannerRemark, so existing
-- sort/export/display logic that reads it keeps working unchanged.
CREATE TABLE IF NOT EXISTS public.cr_planner_remarks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cr_number     text NOT NULL REFERENCES public.crs(cr_number) ON DELETE CASCADE,
  remark_text   text NOT NULL,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cr_planner_remarks_cr_number ON public.cr_planner_remarks(cr_number);

-- Lock down exactly like every table since the RLS remediation pass —
-- service-role only, no anon/authenticated grant. All access goes through
-- src/lib/cr-planner.functions.ts.
ALTER TABLE public.cr_planner_remarks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.cr_planner_remarks TO service_role;
