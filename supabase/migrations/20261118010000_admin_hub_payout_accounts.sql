CREATE TABLE IF NOT EXISTS public.admin_hub_payout_accounts (
  provider text PRIMARY KEY CHECK (provider IN ('paypal')),
  account_identifier text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT admin_hub_paypal_email_format CHECK (
    account_identifier = '' OR (
      length(account_identifier) <= 254
      AND account_identifier ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    )
  )
);

ALTER TABLE public.admin_hub_payout_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_hub_payout_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admin_hub_payout_accounts TO service_role;

CREATE OR REPLACE FUNCTION public.admin_hub_save_payout_account(
  target_provider text,
  target_account_identifier text,
  target_updated_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF target_provider IS DISTINCT FROM 'paypal' THEN
    RAISE EXCEPTION 'Invalid payout provider.';
  END IF;

  IF target_account_identifier IS NULL
    OR length(target_account_identifier) > 254
    OR (
      target_account_identifier <> ''
      AND target_account_identifier !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    ) THEN
    RAISE EXCEPTION 'Enter a valid PayPal email address.';
  END IF;

  INSERT INTO public.admin_hub_payout_accounts (
    provider,
    account_identifier,
    updated_at,
    updated_by
  )
  VALUES (
    target_provider,
    target_account_identifier,
    now(),
    target_updated_by
  )
  ON CONFLICT (provider) DO UPDATE
  SET account_identifier = EXCLUDED.account_identifier,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_hub_save_payout_account(text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hub_save_payout_account(text, text, uuid)
  TO service_role;
