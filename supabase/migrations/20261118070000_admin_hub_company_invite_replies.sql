ALTER TABLE public.admin_hub_company_invites
  ADD COLUMN IF NOT EXISTS provider_thread_id text,
  ADD COLUMN IF NOT EXISTS last_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reply_sync_at timestamptz;

CREATE TABLE IF NOT EXISTS public.admin_hub_company_invite_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES public.admin_hub_company_invites(id) ON DELETE CASCADE,
  provider_message_id text NOT NULL UNIQUE,
  provider_thread_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  from_email text NOT NULL CHECK (length(from_email) BETWEEN 3 AND 254),
  to_email text NOT NULL CHECK (length(to_email) BETWEEN 3 AND 254),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 998),
  body_text text NOT NULL CHECK (length(body_text) <= 20000),
  rfc_message_id text,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_hub_company_invite_replies_invite_created_at
  ON public.admin_hub_company_invite_replies (invite_id, created_at DESC);

ALTER TABLE public.admin_hub_company_invite_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_hub_company_invite_replies FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admin_hub_company_invite_replies TO service_role;
