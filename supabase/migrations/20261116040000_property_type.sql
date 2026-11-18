ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS property_type text NOT NULL DEFAULT 'Hotel'
  CHECK (property_type IN ('Hotel', 'Motel', 'Lodge', 'Guest House', 'Apartments'));

CREATE OR REPLACE FUNCTION public.gpm_setup_with_billing(
  p_code text,
  p_name text,
  p_address text,
  p_phone text,
  p_billing_email text,
  p_property_type text
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

  IF p_property_type IS NULL
    OR p_property_type NOT IN ('Hotel', 'Motel', 'Lodge', 'Guest House', 'Apartments') THEN
    RAISE EXCEPTION 'Choose a valid property type.';
  END IF;

  PERFORM public.gpm_setup(p_code, p_name, p_address, p_phone);

  UPDATE public.properties AS property
  SET billing_email = normalized_email,
      property_type = p_property_type
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

REVOKE ALL ON FUNCTION public.gpm_setup_with_billing(text, text, text, text, text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gpm_setup_with_billing(text, text, text, text, text, text)
TO authenticated;
