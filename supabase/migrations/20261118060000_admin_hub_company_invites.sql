CREATE TABLE IF NOT EXISTS public.admin_hub_company_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email text NOT NULL CHECK (length(recipient_email) BETWEEN 3 AND 254),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  message_body text NOT NULL CHECK (length(message_body) BETWEEN 1 AND 10000),
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_message_id text,
  error_message text CHECK (error_message IS NULL OR length(error_message) <= 800),
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_hub_company_invites_created_at
  ON public.admin_hub_company_invites (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_hub_company_invites_sender_created_at
  ON public.admin_hub_company_invites (sent_by, created_at DESC);

ALTER TABLE public.admin_hub_company_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_hub_company_invites FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admin_hub_company_invites TO service_role;
