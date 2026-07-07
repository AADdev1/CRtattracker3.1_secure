
-- =========== staff_role: add 'Tester' ===========
-- Own migration file — Postgres can't use a newly added enum value in the
-- same transaction that adds it.
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'Tester';
