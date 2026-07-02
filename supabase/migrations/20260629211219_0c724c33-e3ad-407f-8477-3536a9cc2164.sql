
ALTER TABLE public.kpi_results DROP CONSTRAINT IF EXISTS kpi_results_cr_number_fkey;
ALTER TABLE public.defects DROP CONSTRAINT IF EXISTS defects_cr_number_fkey;

UPDATE public.crs SET cr_number = regexp_replace(cr_number, '^CR-RAS-', '') WHERE cr_number LIKE 'CR-RAS-%';
UPDATE public.kpi_results SET cr_number = regexp_replace(cr_number, '^CR-RAS-', '') WHERE cr_number LIKE 'CR-RAS-%';
UPDATE public.defects SET cr_number = regexp_replace(cr_number, '^CR-RAS-', '') WHERE cr_number LIKE 'CR-RAS-%';

ALTER TABLE public.kpi_results
  ADD CONSTRAINT kpi_results_cr_number_fkey
  FOREIGN KEY (cr_number) REFERENCES public.crs(cr_number) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public.defects
  ADD CONSTRAINT defects_cr_number_fkey
  FOREIGN KEY (cr_number) REFERENCES public.crs(cr_number) ON UPDATE CASCADE ON DELETE CASCADE;
