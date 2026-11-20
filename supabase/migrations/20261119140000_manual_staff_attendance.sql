BEGIN;

-- Recreate the trusted attendance functions without office Wi-Fi restrictions.
CREATE OR REPLACE FUNCTION public.gpm_check_in(
  p_user_id uuid,
  p_client_ip inet
)
RETURNS public.staff_attendance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text;
  v_role text;
  v_name text;
  v_department text;
  v_date date := (now() AT TIME ZONE 'Africa/Lusaka')::date;
  v_now time := (now() AT TIME ZONE 'Africa/Lusaka')::time;
  v_reporting time := time '07:00';
  v_grace integer := 10;
  v_shift public.work_shifts%ROWTYPE;
  v_row public.staff_attendance%ROWTYPE;
  v_minutes integer;
  v_reporting_minutes integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Attendance check-in must use the trusted server.';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;

  SELECT property_code, role INTO v_code, v_role
    FROM public.user_roles
   WHERE user_id = p_user_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Your account is not assigned to a property.';
  END IF;

  SELECT name INTO v_name
    FROM public.profiles
   WHERE id = p_user_id AND property_code = v_code;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Your staff profile is missing.';
  END IF;

  SELECT department INTO v_department
    FROM public.staff_members
   WHERE auth_user_id = p_user_id
     AND property_code = v_code
     AND active;
  v_department := coalesce(
    nullif(v_department, ''),
    CASE v_role
      WHEN 'Admin' THEN 'Admin'
      WHEN 'Manager' THEN 'Admin'
      WHEN 'Supervisor' THEN 'Admin'
      WHEN 'Housekeeping' THEN 'Housekeeping'
      WHEN 'Maintenance' THEN 'Maintenance'
      WHEN 'Restaurant' THEN 'Food and Beverage'
      ELSE 'Front Office'
    END
  );

  SELECT * INTO v_shift
    FROM public.work_shifts
   WHERE property_code = v_code
     AND shift_date = v_date
     AND department = v_department;
  IF FOUND THEN
    v_reporting := v_shift.reporting_time;
    v_grace := v_shift.grace_minutes;
  END IF;

  SELECT * INTO v_row
    FROM public.staff_attendance
   WHERE property_code = v_code
     AND user_id = p_user_id
     AND shift_date = v_date;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  v_minutes := extract(hour FROM v_now)::integer * 60 + extract(minute FROM v_now)::integer;
  v_reporting_minutes := extract(hour FROM v_reporting)::integer * 60
    + extract(minute FROM v_reporting)::integer;

  INSERT INTO public.staff_attendance (
    property_code, user_id, staff_name, department, shift_date, check_in,
    reporting_time, grace_minutes, is_late, late_minutes
  )
  VALUES (
    v_code, p_user_id, v_name, v_department, v_date, now(),
    v_reporting, v_grace,
    v_minutes > v_reporting_minutes + v_grace,
    greatest(0, v_minutes - v_reporting_minutes)
  )
  ON CONFLICT (property_code, user_id, shift_date) DO NOTHING
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row
      FROM public.staff_attendance
     WHERE property_code = v_code
       AND user_id = p_user_id
       AND shift_date = v_date;
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.gpm_check_out(
  p_user_id uuid,
  p_client_ip inet
)
RETURNS public.staff_attendance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text;
  v_row public.staff_attendance%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Attendance check-out must use the trusted server.';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;

  SELECT property_code INTO v_code
    FROM public.user_roles
   WHERE user_id = p_user_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Your account is not assigned to a property.';
  END IF;

  UPDATE public.staff_attendance
     SET check_out = now()
   WHERE id = (
     SELECT id
       FROM public.staff_attendance
      WHERE property_code = v_code
        AND user_id = p_user_id
        AND check_out IS NULL
      ORDER BY shift_date DESC, check_in DESC
      LIMIT 1
   )
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Check in before checking out.';
  END IF;
  RETURN v_row;
END;
$$;

COMMIT;
