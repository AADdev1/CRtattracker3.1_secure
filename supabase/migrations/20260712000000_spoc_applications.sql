
-- =========== user_management.spoc_applications ===========
-- A user can be the SPOC (single point of contact) for one or more
-- Applications (crs.application values). SPOC status grants the same
-- test-case approval rights as being the CR's BA/ITPM (see
-- assertApproverForCr in test-cases.functions.ts) for every CR under any
-- of their assigned applications, regardless of who's listed as BA/ITPM
-- on that specific CR. Assigned directly in this table — no in-app UI for
-- it (see H4/H5-era decision to keep /users disabled for now).
ALTER TABLE public.user_management
  ADD COLUMN IF NOT EXISTS spoc_applications text[] NOT NULL DEFAULT '{}';
