BEGIN;

CREATE TABLE public.gpm_passkey_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  device_name text NOT NULL DEFAULT 'Passkey',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gpm_passkey_credentials_user_id_idx
  ON public.gpm_passkey_credentials (user_id);

ALTER TABLE public.gpm_passkey_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gpm_passkey_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gpm_passkey_credentials TO service_role;

CREATE TABLE public.gpm_passkey_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('registration', 'authentication')),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge text NOT NULL,
  rp_id text NOT NULL,
  origin text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (purpose = 'registration' AND user_id IS NOT NULL)
    OR (purpose = 'authentication' AND user_id IS NULL)
  )
);

CREATE INDEX gpm_passkey_challenges_expires_at_idx
  ON public.gpm_passkey_challenges (expires_at);

ALTER TABLE public.gpm_passkey_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gpm_passkey_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.gpm_passkey_challenges TO service_role;

COMMIT;
