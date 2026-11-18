BEGIN;

ALTER TABLE public.app_versions
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS public_url text,
  ADD COLUMN IF NOT EXISTS apk_url text,
  ADD COLUMN IF NOT EXISTS is_latest boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS app_versions_single_latest
  ON public.app_versions ((is_latest))
  WHERE is_latest;

INSERT INTO public.app_versions (version, release_notes, forced, is_latest)
SELECT
  '2.5.4',
  'Fix staff PIN sign-in with Supabase password complexity requirements',
  false,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_versions WHERE is_latest
)
ON CONFLICT (version) DO UPDATE SET is_latest = EXCLUDED.is_latest;

INSERT INTO storage.buckets (id, name, public)
VALUES ('installers', 'installers', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

COMMIT;
