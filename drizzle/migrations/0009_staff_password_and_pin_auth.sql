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
