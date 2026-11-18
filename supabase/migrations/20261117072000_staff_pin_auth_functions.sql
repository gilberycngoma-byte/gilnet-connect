CREATE OR REPLACE FUNCTION public.gpm_verify_staff_pin(
  p_user_id uuid,
  p_pin text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_property_code text;
  v_pin_hash text;
  v_attempts integer;
  v_email_key text := 'pin-change:' || p_user_id::text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT property_code, pin_hash
    INTO v_property_code, v_pin_hash
    FROM public.staff_members
   WHERE auth_user_id = p_user_id
     AND active
     AND NOT EXISTS (
       SELECT 1
         FROM public.user_roles
        WHERE user_id = p_user_id
          AND role IN ('Admin', 'Manager', 'Supervisor')
     );

  IF v_property_code IS NULL OR v_pin_hash IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.staff_login_attempts (property_code, email_key)
  VALUES (v_property_code, v_email_key)
  ON CONFLICT (property_code, email_key) DO UPDATE
    SET attempts = CASE
      WHEN public.staff_login_attempts.window_started_at < now() - interval '15 minutes' THEN 1
      ELSE public.staff_login_attempts.attempts + 1
    END,
    window_started_at = CASE
      WHEN public.staff_login_attempts.window_started_at < now() - interval '15 minutes' THEN now()
      ELSE public.staff_login_attempts.window_started_at
    END
  RETURNING attempts INTO v_attempts;

  IF v_attempts > 10 OR p_pin IS NULL OR p_pin !~ '^[0-9]{6}$' THEN
    RETURN false;
  END IF;

  IF extensions.crypt(p_pin, v_pin_hash) <> v_pin_hash THEN
    RETURN false;
  END IF;

  DELETE FROM public.staff_login_attempts
   WHERE property_code = v_property_code
     AND email_key = v_email_key;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.gpm_verify_staff_pin(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gpm_verify_staff_pin(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.gpm_authenticate_staff_pin(
  p_email text,
  p_property_code text,
  p_pin text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_email IS NULL OR p_property_code IS NULL OR p_pin IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT member.auth_user_id
    INTO v_user_id
    FROM public.staff_members AS member
    JOIN public.user_roles AS role
      ON role.user_id = member.auth_user_id
     AND role.property_code = member.property_code
    JOIN auth.users AS auth_user
      ON auth_user.id = member.auth_user_id
   WHERE lower(auth_user.email) = lower(trim(p_email))
     AND member.property_code = upper(trim(p_property_code))
     AND member.active
     AND NOT member.pin_setup_required
     AND role.role NOT IN ('Admin', 'Manager', 'Supervisor')
   LIMIT 1;

  IF v_user_id IS NULL OR NOT public.gpm_verify_staff_pin(v_user_id, p_pin) THEN
    RETURN NULL;
  END IF;

  RETURN v_user_id;
END
$$;

REVOKE ALL ON FUNCTION public.gpm_authenticate_staff_pin(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gpm_authenticate_staff_pin(text, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
