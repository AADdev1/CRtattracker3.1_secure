
-- =========== ENUMS ===========
CREATE TYPE public.cr_size AS ENUM ('Small', 'Medium', 'Large');
CREATE TYPE public.kpi_status AS ENUM ('pending', 'not_started', 'green', 'amber', 'red');

-- =========== workflow_statuses (dictionary) ===========
CREATE TABLE public.workflow_statuses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,         -- exact CSV header, e.g. "12_BRD Signed Off"
  db_column    text NOT NULL UNIQUE,         -- snake_case column on public.crs, e.g. "s12_brd_signed_off"
  label        text NOT NULL,                -- display label
  sort_order   int  NOT NULL,
  is_excluded  boolean NOT NULL DEFAULT false,
  remarks      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_statuses TO anon, authenticated;
GRANT ALL ON public.workflow_statuses TO service_role;
ALTER TABLE public.workflow_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access workflow_statuses" ON public.workflow_statuses FOR ALL USING (true) WITH CHECK (true);

-- =========== kpis (configuration) ===========
CREATE TABLE public.kpis (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  start_status_code   text NOT NULL REFERENCES public.workflow_statuses(code) ON UPDATE CASCADE,
  end_status_code     text NOT NULL REFERENCES public.workflow_statuses(code) ON UPDATE CASCADE,
  small_tat           int NOT NULL CHECK (small_tat  >= 0),
  medium_tat          int NOT NULL CHECK (medium_tat >= 0),
  large_tat           int NOT NULL CHECK (large_tat  >= 0),
  warning_pct         int NOT NULL DEFAULT 80 CHECK (warning_pct BETWEEN 0 AND 100),
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpis TO anon, authenticated;
GRANT ALL ON public.kpis TO service_role;
ALTER TABLE public.kpis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access kpis" ON public.kpis FOR ALL USING (true) WITH CHECK (true);

-- =========== crs (Change Requests) ===========
CREATE TABLE public.crs (
  cr_number                   text PRIMARY KEY,
  title                       text,
  application                 text,
  module_name                 text,
  date_created                timestamptz,
  date_modified               timestamptz,
  created_user                text,
  department                  text,
  hod                         text,
  kom                         text,
  kom_department              text,
  it_vertical_head            text,
  lob                         text,
  product                     text,
  severity                    text,
  workflow_status             text,
  brd_start_date              timestamptz,
  brd_signoff_awaited_by_ba   timestamptz,
  brd_signoff_date_by_ba      timestamptz,
  uat_signoff_awaited_by_ba   timestamptz,
  uat_signoff_date_by_ba      timestamptz,
  planned_development_date    timestamptz,
  planned_uat_release_date    timestamptz,
  planned_production_date     timestamptz,
  ba                          text,
  itpm                        text,
  assigned_team               text,
  assigned_user               text,
  expected_go_live_date       timestamptz,

  -- Manual fields (NEVER overwritten on CSV re-import)
  cr_size                     public.cr_size,
  manual_notes                text,

  -- One timestamp column per workflow status
  s01_concept_doc_generated                  timestamptz,
  s02_concept_doc_approved                   timestamptz,
  s03_concept_dropped                        timestamptz,
  s03c_priority_changed                      timestamptz,
  s03d_prioritize                            timestamptz,
  s04_requirement_discussed                  timestamptz,
  s05_requirement_dropped                    timestamptz,
  s06_requirement_approved                   timestamptz,
  s07_brd_not_started                        timestamptz,
  s08_brd_wip                                timestamptz,
  s09_brd_dropped                            timestamptz,
  s10_dependent_cr_raised                    timestamptz,
  s11_brd_signoff_awaited                    timestamptz,
  s12_brd_signed_off                         timestamptz,
  s13_pending_in_tech_pipeline               timestamptz,
  s14_brd_tech_clarification                 timestamptz,
  s14a_cr_on_cr                              timestamptz,
  s14a_cr_on_cr_push_back                    timestamptz,
  s14b_approved_cr_on_cr                     timestamptz,
  s14c_not_a_cr_on_cr                        timestamptz,
  s14d_approach_note_shared                  timestamptz,
  s14e_tech_clarification_priority_changed   timestamptz,
  s14f_approach_note_signed_off              timestamptz,
  s14g_approach_note_sent_back_for_revision  timestamptz,
  s15_brd_sent_back_for_revision             timestamptz,
  s16_dev_approved_timelines_awaited         timestamptz,
  s17_timelines_provided_dev_to_start        timestamptz,
  s18_dev_wip                                timestamptz,
  s19_dev_on_hold_pending_with_partner       timestamptz,
  s20_released_for_uat                       timestamptz,
  s21_uat_wip                                timestamptz,
  s21a_uat_on_hold_dependency                timestamptz,
  s21b_uat_on_hold_priority_changed          timestamptz,
  s21c_uat_demo_rejected                     timestamptz,
  s22_uat_bug_raised                         timestamptz,
  s23_uat_signoff_awaited                    timestamptz,
  s24_uat_signed_off                         timestamptz,
  s24a_technical_go_live                     timestamptz,
  s25_security_signed_off                    timestamptz,
  s25a_security_signed_off_on_tech_go        timestamptz,
  s26_assign_to_release_team                 timestamptz,
  s26_tech_go_assign_to_release_team         timestamptz,
  s27_release_package_rejected               timestamptz,
  s27a_tech_go_release_package_rejected      timestamptz,
  s28_deployed_in_production                 timestamptz,
  s28_tech_go_deployed_in_production         timestamptz,
  s29_live_and_closed                        timestamptz,
  s30_issue_in_production                    timestamptz,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crs TO anon, authenticated;
GRANT ALL ON public.crs TO service_role;
ALTER TABLE public.crs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access crs" ON public.crs FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_crs_application ON public.crs(application);
CREATE INDEX idx_crs_workflow_status ON public.crs(workflow_status);
CREATE INDEX idx_crs_cr_size ON public.crs(cr_size);

-- =========== kpi_results (engine output) ===========
CREATE TABLE public.kpi_results (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cr_number        text NOT NULL REFERENCES public.crs(cr_number) ON DELETE CASCADE,
  kpi_id           uuid NOT NULL REFERENCES public.kpis(id) ON DELETE CASCADE,
  start_date       timestamptz,
  end_date         timestamptz,
  working_days     numeric(10,2),
  hold_days        numeric(10,2),
  effective_days   numeric(10,2),
  tat              int,
  remaining_days   numeric(10,2),
  utilization_pct  numeric(10,2),
  status           public.kpi_status NOT NULL DEFAULT 'pending',
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cr_number, kpi_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_results TO anon, authenticated;
GRANT ALL ON public.kpi_results TO service_role;
ALTER TABLE public.kpi_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access kpi_results" ON public.kpi_results FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_kpi_results_status ON public.kpi_results(status);
CREATE INDEX idx_kpi_results_kpi ON public.kpi_results(kpi_id);
CREATE INDEX idx_kpi_results_cr ON public.kpi_results(cr_number);

-- =========== updated_at trigger ===========
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_ws_updated   BEFORE UPDATE ON public.workflow_statuses FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_kpis_updated BEFORE UPDATE ON public.kpis              FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_crs_updated  BEFORE UPDATE ON public.crs               FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========== Seed workflow statuses ===========
INSERT INTO public.workflow_statuses (code, db_column, label, sort_order, is_excluded) VALUES
  ('01_Concept doc Generated',                          's01_concept_doc_generated',                  '01 Concept Doc Generated',                  10, false),
  ('02_Concept doc Approved',                           's02_concept_doc_approved',                   '02 Concept Doc Approved',                   20, false),
  ('03_Concept dropped',                                's03_concept_dropped',                        '03 Concept Dropped',                        30, false),
  ('03c_Priority Changed',                              's03c_priority_changed',                      '03c Priority Changed',                      35, true),
  ('03d_Prioritize',                                    's03d_prioritize',                            '03d Prioritize',                            36, false),
  ('04_Requirement Discussed',                          's04_requirement_discussed',                  '04 Requirement Discussed',                  40, false),
  ('05_Requirement Dropped',                            's05_requirement_dropped',                    '05 Requirement Dropped',                    50, false),
  ('06_Requirement Approved',                           's06_requirement_approved',                   '06 Requirement Approved',                   60, false),
  ('07_BRD Not Started',                                's07_brd_not_started',                        '07 BRD Not Started',                        70, false),
  ('08_BRD WIP',                                        's08_brd_wip',                                '08 BRD WIP',                                80, false),
  ('09_BRD Dropped',                                    's09_brd_dropped',                            '09 BRD Dropped',                            90, false),
  ('10_Dependent CR Raised',                            's10_dependent_cr_raised',                    '10 Dependent CR Raised',                   100, true),
  ('11_BRD Signoff Awaited',                            's11_brd_signoff_awaited',                    '11 BRD Signoff Awaited',                   110, false),
  ('12_BRD Signed Off',                                 's12_brd_signed_off',                         '12 BRD Signed Off',                        120, false),
  ('13_Pending in Tech Pipeline',                       's13_pending_in_tech_pipeline',               '13 Pending in Tech Pipeline',              130, true),
  ('14_BRD Tech clarification',                         's14_brd_tech_clarification',                 '14 BRD Tech Clarification',                140, true),
  ('14A_CR ON CR',                                      's14a_cr_on_cr',                              '14A CR ON CR',                             150, true),
  ('14A_CR ON CR_Push Back',                            's14a_cr_on_cr_push_back',                    '14A CR ON CR (Push Back)',                 151, true),
  ('14B_Approved CR on CR',                             's14b_approved_cr_on_cr',                     '14B Approved CR on CR',                    160, false),
  ('14C_Not a CR on CR',                                's14c_not_a_cr_on_cr',                        '14C Not a CR on CR',                       161, false),
  ('14D_Approach Note Shared',                          's14d_approach_note_shared',                  '14D Approach Note Shared',                 170, false),
  ('14E_Tech Clarification Priority Changed',           's14e_tech_clarification_priority_changed',   '14E Tech Clarification Priority Changed',  171, true),
  ('14F_Approach Note Signed Off',                      's14f_approach_note_signed_off',              '14F Approach Note Signed Off',             172, false),
  ('14G_Approach Note Sent Back For Revision',          's14g_approach_note_sent_back_for_revision',  '14G Approach Note Sent Back For Revision', 173, true),
  ('15_BRD Sent back for Revision',                     's15_brd_sent_back_for_revision',             '15 BRD Sent Back For Revision',            180, true),
  ('16_Dev Approved Timelines Awaited',                 's16_dev_approved_timelines_awaited',         '16 Dev Approved Timelines Awaited',        190, true),
  ('17_Timelines Provided Dev to Start',                's17_timelines_provided_dev_to_start',        '17 Timelines Provided Dev to Start',       200, false),
  ('18_Dev WIP',                                        's18_dev_wip',                                '18 Dev WIP',                               210, false),
  ('19_ Dev on Hold/Pending with Partner',              's19_dev_on_hold_pending_with_partner',       '19 Dev on Hold / Pending with Partner',    220, true),
  ('20_Released for UAT',                               's20_released_for_uat',                       '20 Released for UAT',                      230, false),
  ('21_UAT WIP',                                        's21_uat_wip',                                '21 UAT WIP',                               240, false),
  ('21A_UAT On Hold/Dependency with other applications',  's21a_uat_on_hold_dependency',              '21A UAT On Hold / Dependency',             241, true),
  ('21B_UAT On Hold/Priority Changed',                  's21b_uat_on_hold_priority_changed',          '21B UAT On Hold / Priority Changed',       242, true),
  ('21C_UAT/Demo Rejected',                             's21c_uat_demo_rejected',                     '21C UAT / Demo Rejected',                  243, true),
  ('22_UAT Bug Raised',                                 's22_uat_bug_raised',                         '22 UAT Bug Raised',                        250, true),
  ('23_UAT Sign Off Awaited',                           's23_uat_signoff_awaited',                    '23 UAT Sign Off Awaited',                  260, false),
  ('24_UAT Signed Off',                                 's24_uat_signed_off',                         '24 UAT Signed Off',                        270, false),
  ('24A_Techinical Go Live',                            's24a_technical_go_live',                     '24A Technical Go Live',                    271, false),
  ('25_Security Signed Off',                            's25_security_signed_off',                    '25 Security Signed Off',                   280, false),
  ('25A_Security Signed Off On Tech Go',                's25a_security_signed_off_on_tech_go',        '25A Security Signed Off On Tech Go',       281, false),
  ('26_Assign to release team',                         's26_assign_to_release_team',                 '26 Assign to Release Team',                290, false),
  ('26_Tech go Assign to release team',                 's26_tech_go_assign_to_release_team',         '26 Tech Go - Assign to Release Team',      291, false),
  ('27_Release Package rejected',                       's27_release_package_rejected',               '27 Release Package Rejected',              300, true),
  ('27A_Tech Go_Release Package rejected',              's27a_tech_go_release_package_rejected',      '27A Tech Go - Release Package Rejected',   301, true),
  ('28_Deployed in Production',                         's28_deployed_in_production',                 '28 Deployed in Production',                310, false),
  ('28_Tech Go Delpoyed in Production',                 's28_tech_go_deployed_in_production',         '28 Tech Go - Deployed in Production',      311, false),
  ('29_Live and Closed',                                's29_live_and_closed',                        '29 Live and Closed',                       320, false),
  ('30_Issue in production',                            's30_issue_in_production',                    '30 Issue in Production',                   330, false);

-- =========== Seed sample KPI ===========
INSERT INTO public.kpis (name, start_status_code, end_status_code, small_tat, medium_tat, large_tat, warning_pct, is_active)
VALUES ('BRD → Approach Note', '12_BRD Signed Off', '14D_Approach Note Shared', 5, 7, 10, 80, true);
