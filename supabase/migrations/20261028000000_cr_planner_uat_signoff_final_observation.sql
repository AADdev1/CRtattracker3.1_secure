-- =========== CR Planner — UAT Sign Off / Final CR Observation dates ===========
-- These two columns were added to the CR Planner grid's UI (cr-planner.tsx)
-- without ever being added to the cr_planner table or to
-- updatePlannerEntry's accepted fields — every edit was silently dropped
-- (zod strips unknown keys, and even if it hadn't, there was no column to
-- write to), and listPlannerGrid never returned them either, so the picker
-- reverted to blank on the next refetch. This backfills the missing
-- schema; src/lib/cr-planner.functions.ts is updated alongside it to
-- actually read/write them.
ALTER TABLE public.cr_planner ADD COLUMN IF NOT EXISTS uat_sign_off_date date;
ALTER TABLE public.cr_planner ADD COLUMN IF NOT EXISTS final_cr_observation_date date;
