
-- =========== One-time backfill: cr_planner_remarks history ===========
-- Splits the legacy single-field cr_planner.remarks text — several of
-- which held multiple distinct notes glued together in one string, newest
-- note prepended to the top — into individual, dated rows in the new
-- cr_planner_remarks history table (added in
-- 20260907000000_cr_planner_remarks.sql). Only CRs that actually had a
-- non-null remarks value are touched; everything else is left alone.
--
-- Dates: each note's date is read from its own leading marker (e.g.
-- "19th Aug:"), which is then stripped from the stored text since the
-- date is now a real column, not part of the text. Two exceptions, called
-- out per-CR below, had no date marker at all and are approximated:
--   - CR 293's older note is dated one day before its newer note, purely
--     to preserve the legacy field's own newest-first ordering.
--   - CR 302's single note has no date anchor anywhere in the text; it's
--     dated to match the surrounding 19-Aug batch for lack of any better
--     signal.
-- created_by is the generic "Historical Import" label, since the legacy
-- single field never recorded per-note authorship.
--
-- After the inserts, cr_planner.remarks is set to each CR's now-latest
-- note, matching the convention addPlannerRemark() maintains going
-- forward (src/lib/cr-planner.functions.ts).
--
-- Guarded with NOT EXISTS per row so re-running this file is a no-op.

-- ─────────────────────────── CR 293 ───────────────────────────
-- Two notes, no date marker in either. Newer (top-of-field) note dated
-- 19-Aug, older (bottom-of-field) note dated one day earlier.
INSERT INTO public.cr_planner_remarks (cr_number, remark_text, created_by, created_at)
SELECT '293',
       'to configure new file format for attendance data 2 extra working days efforts will be required , all days will be adjusted accordingly , CR to be raised by PEB / biz for LAM application.',
       'Historical Import',
       '2026-08-19 12:00:00+00'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cr_planner_remarks
  WHERE cr_number = '293'
    AND remark_text = 'to configure new file format for attendance data 2 extra working days efforts will be required , all days will be adjusted accordingly , CR to be raised by PEB / biz for LAM application.'
);

INSERT INTO public.cr_planner_remarks (cr_number, remark_text, created_by, created_at)
SELECT '293',
       'For CR-RAS-301 Bulk and Stage column addition changes 2 days is required. Hence this CR will be Dev End date will be delayed by 2 days.',
       'Historical Import',
       '2026-08-18 12:00:00+00'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cr_planner_remarks
  WHERE cr_number = '293'
    AND remark_text = 'For CR-RAS-301 Bulk and Stage column addition changes 2 days is required. Hence this CR will be Dev End date will be delayed by 2 days.'
);

UPDATE public.cr_planner
SET remarks = 'to configure new file format for attendance data 2 extra working days efforts will be required , all days will be adjusted accordingly , CR to be raised by PEB / biz for LAM application.',
    modified_by = 'Historical Import',
    modified_at = '2026-08-19 12:00:00+00'
WHERE cr_number = '293';

-- ─────────────────────────── CR 307 ───────────────────────────
INSERT INTO public.cr_planner_remarks (cr_number, remark_text, created_by, created_at)
SELECT '307',
       'Dev started on 14th Aug 2026. port opening is pending with network team. if not done by 19th aug eod will require to put dev on hold.',
       'Historical Import',
       '2026-08-19 12:00:00+00'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cr_planner_remarks
  WHERE cr_number = '307'
    AND remark_text = 'Dev started on 14th Aug 2026. port opening is pending with network team. if not done by 19th aug eod will require to put dev on hold.'
);

UPDATE public.cr_planner
SET remarks = 'Dev started on 14th Aug 2026. port opening is pending with network team. if not done by 19th aug eod will require to put dev on hold.',
    modified_by = 'Historical Import',
    modified_at = '2026-08-19 12:00:00+00'
WHERE cr_number = '307';

-- ─────────────────────────── CR DPDPD ───────────────────────────
INSERT INTO public.cr_planner_remarks (cr_number, remark_text, created_by, created_at)
SELECT 'DPDPD',
       'DPDP implementation project to be tentatively initiated from  28th aug after completion of CR-RAS-293.',
       'Historical Import',
       '2026-08-19 12:00:00+00'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cr_planner_remarks
  WHERE cr_number = 'DPDPD'
    AND remark_text = 'DPDP implementation project to be tentatively initiated from  28th aug after completion of CR-RAS-293.'
);

UPDATE public.cr_planner
SET remarks = 'DPDP implementation project to be tentatively initiated from  28th aug after completion of CR-RAS-293.',
    modified_by = 'Historical Import',
    modified_at = '2026-08-19 12:00:00+00'
WHERE cr_number = 'DPDPD';

-- ─────────────────────────── CR 303 ───────────────────────────
-- Two notes. The Aug note carries no leading date marker of its own, but
-- its content ("SIT Testing to start from 19 Aug 2026") only reads as
-- live news before the 2-Sep update, so it's dated 19-Aug and ordered as
-- the earlier entry; the 2sep-marked note is the later, and becomes the
-- new latest-remarks mirror.
INSERT INTO public.cr_planner_remarks (cr_number, remark_text, created_by, created_at)
SELECT '303',
       E'due to ESB service unavailabity in UAT env and current ESB service changes required from ESB end the CR delivery date will be extended to 12th Aug.\nCR deployed to UAT for SIT testing.  SIT Testing to start from 19 Aug 2026.',
       'Historical Import',
       '2026-08-19 12:00:00+00'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cr_planner_remarks
  WHERE cr_number = '303'
    AND remark_text = E'due to ESB service unavailabity in UAT env and current ESB service changes required from ESB end the CR delivery date will be extended to 12th Aug.\nCR deployed to UAT for SIT testing.  SIT Testing to start from 19 Aug 2026.'
);

INSERT INTO public.cr_planner_remarks (cr_number, remark_text, created_by, created_at)
SELECT '303',
       'Due to Test Samples the testing is not completed end to end. post changes from Data lake the Test Results will be shared after 1 day of testing.',
       'Historical Import',
       '2026-09-02 12:00:00+00'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cr_planner_remarks
  WHERE cr_number = '303'
    AND remark_text = 'Due to Test Samples the testing is not completed end to end. post changes from Data lake the Test Results will be shared after 1 day of testing.'
);

UPDATE public.cr_planner
SET remarks = 'Due to Test Samples the testing is not completed end to end. post changes from Data lake the Test Results will be shared after 1 day of testing.',
    modified_by = 'Historical Import',
    modified_at = '2026-09-02 12:00:00+00'
WHERE cr_number = '303';

-- ─────────────────────────── CR 302 ───────────────────────────
-- No date marker anywhere in the text; dated to match the surrounding
-- 19-Aug batch for lack of any better signal.
INSERT INTO public.cr_planner_remarks (cr_number, remark_text, created_by, created_at)
SELECT '302',
       'CR Developement started efforts to be confirmed by dev.',
       'Historical Import',
       '2026-08-19 12:00:00+00'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cr_planner_remarks
  WHERE cr_number = '302'
    AND remark_text = 'CR Developement started efforts to be confirmed by dev.'
);

UPDATE public.cr_planner
SET remarks = 'CR Developement started efforts to be confirmed by dev.',
    modified_by = 'Historical Import',
    modified_at = '2026-08-19 12:00:00+00'
WHERE cr_number = '302';

-- ─────────────────────────── CR 304 ───────────────────────────
INSERT INTO public.cr_planner_remarks (cr_number, remark_text, created_by, created_at)
SELECT '304',
       'Print Flag Snapshot to be shared to ankita for all communication.',
       'Historical Import',
       '2026-08-19 12:00:00+00'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cr_planner_remarks
  WHERE cr_number = '304'
    AND remark_text = 'Print Flag Snapshot to be shared to ankita for all communication.'
);

UPDATE public.cr_planner
SET remarks = 'Print Flag Snapshot to be shared to ankita for all communication.',
    modified_by = 'Historical Import',
    modified_at = '2026-08-19 12:00:00+00'
WHERE cr_number = '304';
