
CREATE TABLE public.defects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_no text NOT NULL UNIQUE,
  summary text,
  cr_number text NOT NULL REFERENCES public.crs(cr_number) ON DELETE CASCADE,
  priority text,
  severity text,
  environment text,
  application text,
  module text,
  product text,
  nature_of_defect text,
  old_status text,
  new_status text,
  defect_raised_by text,
  last_modified_by text,
  date_modified timestamptz,
  date_created timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_defects_cr_number ON public.defects(cr_number);
CREATE INDEX idx_defects_new_status ON public.defects(new_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defects TO anon, authenticated;
GRANT ALL ON public.defects TO service_role;
ALTER TABLE public.defects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access defects" ON public.defects FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER defects_touch BEFORE UPDATE ON public.defects FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.defect_status_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL UNIQUE,
  is_open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.defect_status_mapping TO anon, authenticated;
GRANT ALL ON public.defect_status_mapping TO service_role;
ALTER TABLE public.defect_status_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access defect_status_mapping" ON public.defect_status_mapping FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER dsm_touch BEFORE UPDATE ON public.defect_status_mapping FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed common open/closed statuses from typical defect lifecycle.
INSERT INTO public.defect_status_mapping (status, is_open) VALUES
  ('Open', true),
  ('Assign to BA', true),
  ('Assigned to BA', true),
  ('Assigned to Dev', true),
  ('In Progress', true),
  ('Reopen', true),
  ('Reopened', true),
  ('CR to be raised', true),
  ('Fixed', true),
  ('Ready for Retest', true),
  ('Retest', true),
  ('Closed', false),
  ('Accepted the rejection', false),
  ('Rejected', false),
  ('Duplicate', false),
  ('Deferred', false)
ON CONFLICT (status) DO NOTHING;
