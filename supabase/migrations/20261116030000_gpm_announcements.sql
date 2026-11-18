CREATE TABLE IF NOT EXISTS public.gpm_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 500),
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS gpm_announcements_active_schedule_idx
ON public.gpm_announcements (starts_at DESC, created_at DESC)
WHERE active = true;

ALTER TABLE public.gpm_announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gpm_announcements FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.gpm_announcements TO service_role;
