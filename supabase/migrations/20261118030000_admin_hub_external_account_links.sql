CREATE TABLE IF NOT EXISTS public.admin_hub_external_account_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  url text NOT NULL CHECK (
    length(url) <= 2048
    AND url ~ '^https://[^[:space:]]+$'
    AND url !~ '^https://[^/@]+:[^/@]+@'
    AND url !~ '[?#]'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_hub_external_account_name_idx
  ON public.admin_hub_external_account_links (lower(name));

ALTER TABLE public.admin_hub_external_account_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_hub_external_account_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admin_hub_external_account_links TO service_role;

INSERT INTO public.admin_hub_external_account_links (name, url)
VALUES
  ('Supabase Dashboard', 'https://supabase.com/dashboard'),
  ('GitHub', 'https://github.com'),
  ('Vercel Dashboard', 'https://vercel.com/dashboard')
ON CONFLICT DO NOTHING;
