ALTER TABLE public.gpm_announcements
  ADD COLUMN IF NOT EXISTS property_code text
  REFERENCES public.properties(code)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS gpm_announcements_property_schedule_idx
  ON public.gpm_announcements (property_code, starts_at DESC, created_at DESC)
  WHERE active = true;
