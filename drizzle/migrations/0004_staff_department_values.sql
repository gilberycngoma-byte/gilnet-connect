BEGIN;

ALTER TABLE public.staff_members
  DROP CONSTRAINT IF EXISTS staff_members_department_check;

ALTER TABLE public.staff_members
  ADD CONSTRAINT staff_members_department_check
  CHECK (
    department IN (
      'Housekeeping',
      'Food and Beverage',
      'Front Office',
      'Human Resource',
      'Maintenance',
      'Security',
      'Admin',
      'Cleaning'
    )
  );

COMMIT;
