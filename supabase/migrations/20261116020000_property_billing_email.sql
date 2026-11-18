ALTER TABLE public.properties
ADD COLUMN IF NOT EXISTS billing_email text;

CREATE UNIQUE INDEX IF NOT EXISTS properties_billing_email_unique
ON public.properties (lower(btrim(billing_email)))
WHERE billing_email IS NOT NULL AND btrim(billing_email) <> '';

CREATE OR REPLACE FUNCTION public.gpm_setup_with_billing(
  p_code text,
  p_name text,
  p_address text,
  p_phone text,
  p_billing_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_code text := upper(btrim(p_code));
  normalized_email text := lower(btrim(p_billing_email));
BEGIN
  IF normalized_email IS NULL
    OR normalized_email = ''
    OR length(normalized_email) > 254
    OR normalized_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN
    RAISE EXCEPTION 'Enter a valid property billing email address.';
  END IF;

  PERFORM public.gpm_setup(p_code, p_name, p_address, p_phone);

  UPDATE public.properties AS property
  SET billing_email = normalized_email
  WHERE property.code = normalized_code
    AND EXISTS (
      SELECT 1
      FROM public.user_roles AS role
      WHERE role.user_id = auth.uid()
        AND role.property_code = property.code
        AND role.role = 'Admin'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property setup did not assign this account as the property Admin.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.gpm_setup_with_billing(text, text, text, text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gpm_setup_with_billing(text, text, text, text, text)
TO authenticated;

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  price numeric(12, 2) NOT NULL CHECK (price >= 0),
  currency text NOT NULL DEFAULT 'ZMW' CHECK (currency = 'ZMW'),
  billing_interval text NOT NULL DEFAULT 'monthly'
    CHECK (billing_interval IN ('monthly', 'quarterly', 'yearly')),
  description text NOT NULL DEFAULT '',
  features text[] NOT NULL DEFAULT '{}',
  recommended boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.property_subscriptions (
  property_code text PRIMARY KEY REFERENCES public.properties(code) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'active', 'cancelled')),
  selected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  selected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.subscription_plans, public.property_subscriptions
FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.subscription_plans, public.property_subscriptions
TO service_role;
