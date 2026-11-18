BEGIN;

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_role_check;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('Admin', 'Manager', 'Supervisor', 'Front Desk', 'Housekeeping', 'Maintenance', 'Restaurant'));

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
