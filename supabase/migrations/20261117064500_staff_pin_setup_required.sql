ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS pin_setup_required boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
