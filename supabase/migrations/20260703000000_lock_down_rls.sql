
-- =========== Lock down RLS to service-role only ===========
-- Every table below previously had a fully open policy (USING (true))
-- granted to anon/authenticated. The anon/publishable key is embedded in
-- the client JS bundle (not a secret), so this meant anyone could read or
-- write these tables directly via the Supabase REST API, bypassing the app
-- entirely. All app data access now goes through server functions using
-- the service-role client (supabaseAdmin), which bypasses RLS by design —
-- these tables no longer need any anon/authenticated policy at all.

DROP POLICY IF EXISTS "open access workflow_statuses" ON public.workflow_statuses;
REVOKE ALL ON public.workflow_statuses FROM anon, authenticated;

DROP POLICY IF EXISTS "open access kpis" ON public.kpis;
REVOKE ALL ON public.kpis FROM anon, authenticated;

DROP POLICY IF EXISTS "open access crs" ON public.crs;
REVOKE ALL ON public.crs FROM anon, authenticated;

DROP POLICY IF EXISTS "open access kpi_results" ON public.kpi_results;
REVOKE ALL ON public.kpi_results FROM anon, authenticated;

DROP POLICY IF EXISTS "Phase 1 open access to kpi_excluded_statuses" ON public.kpi_excluded_statuses;
REVOKE ALL ON public.kpi_excluded_statuses FROM anon, authenticated;

DROP POLICY IF EXISTS "Public access defects" ON public.defects;
REVOKE ALL ON public.defects FROM anon, authenticated;

DROP POLICY IF EXISTS "Public access defect_status_mapping" ON public.defect_status_mapping;
REVOKE ALL ON public.defect_status_mapping FROM anon, authenticated;

DROP POLICY IF EXISTS "read-only access user_management" ON public.user_management;
REVOKE ALL ON public.user_management FROM anon, authenticated;

-- profiles is untouched: its policies already key off auth.uid(), which is
-- always null for anon-key requests, so it was already effectively locked.
