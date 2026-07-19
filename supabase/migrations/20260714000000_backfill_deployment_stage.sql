
-- =========== One-time backfill: crs.deployment_stage ===========
-- deployment_stage (added in 20260713000000) only gets populated by
-- syncDeploymentStagesForCrs, which only runs during a *new* CSV import
-- (see src/lib/csv-import.ts). Every CR that already reached UAT Signed
-- Off / Deployed to Production from an import that happened before this
-- column existed is still sitting at NULL — nothing retroactively synced
-- them, so they never show up in Deployment Planning. This backfills
-- existing data once, using the exact same precedence rule
-- syncDeploymentStagesForCrs applies going forward: Deployed to
-- Production always wins; UAT Signed Off only applies if nothing is set
-- yet and production hasn't been reached.
--
-- Not logged to deployment_audit_log — that table tracks user-driven
-- actions and CMS-import-driven syncs, not this one-time catch-up for
-- data that predates the feature.

UPDATE public.crs
SET deployment_stage = 'Deployed to Production'
WHERE deployment_stage IS DISTINCT FROM 'Deployed to Production'
  AND (s28_deployed_in_production IS NOT NULL OR s28_tech_go_deployed_in_production IS NOT NULL);

UPDATE public.crs
SET deployment_stage = 'UAT Signed Off'
WHERE deployment_stage IS NULL
  AND s24_uat_signed_off IS NOT NULL
  AND s28_deployed_in_production IS NULL
  AND s28_tech_go_deployed_in_production IS NULL;
