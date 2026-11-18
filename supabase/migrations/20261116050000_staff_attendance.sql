BEGIN;

CREATE TABLE public.work_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_code text NOT NULL REFERENCES public.properties(code) ON DELETE CASCADE,
  shift_date date NOT NULL,
  department text NOT NULL,
  reporting_time time NOT NULL DEFAULT time '07:00',
  grace_minutes integer NOT NULL DEFAULT 10,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_shifts_grace_range CHECK (grace_minutes BETWEEN 0 AND 240),
  CONSTRAINT work_shifts_unique UNIQUE (property_code, shift_date, department)
);

CREATE INDEX work_shifts_property_date_idx
  ON public.work_shifts (property_code, shift_date);

ALTER TABLE public.work_shifts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_shifts TO authenticated;
GRANT ALL ON public.work_shifts TO service_role;

CREATE POLICY work_shifts_property_read ON public.work_shifts
  FOR SELECT TO authenticated
  USING (property_code = public.gpm_property());

CREATE POLICY work_shifts_management_write ON public.work_shifts
  FOR ALL TO authenticated
  USING (
    property_code = public.gpm_property()
    AND public.gpm_role() IN ('Admin', 'Manager')
  )
  WITH CHECK (
    property_code = public.gpm_property()
    AND public.gpm_role() IN ('Admin', 'Manager')
  );

CREATE TABLE public.staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_code text NOT NULL REFERENCES public.properties(code) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_name text NOT NULL,
  department text NOT NULL,
  shift_date date NOT NULL,
  check_in timestamptz NOT NULL DEFAULT now(),
  check_out timestamptz,
  reporting_time time NOT NULL DEFAULT time '07:00',
  grace_minutes integer NOT NULL DEFAULT 10,
  is_late boolean NOT NULL DEFAULT false,
  late_minutes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_attendance_late_minutes_nonnegative CHECK (late_minutes >= 0),
  CONSTRAINT staff_attendance_unique UNIQUE (property_code, user_id, shift_date)
);

CREATE INDEX staff_attendance_property_date_idx
  ON public.staff_attendance (property_code, shift_date);
CREATE INDEX staff_attendance_user_date_idx
  ON public.staff_attendance (user_id, shift_date DESC);

ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.staff_attendance TO authenticated;
GRANT ALL ON public.staff_attendance TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.staff_attendance FROM authenticated;

CREATE POLICY staff_attendance_read ON public.staff_attendance
  FOR SELECT TO authenticated
  USING (
    property_code = public.gpm_property()
    AND (
      user_id = auth.uid()
      OR public.gpm_role() IN ('Admin', 'Manager', 'Supervisor')
    )
  );

CREATE OR REPLACE FUNCTION public.gpm_check_in()
RETURNS public.staff_attendance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;

  SELECT property_code, role
    INTO v_code, v_role
    FROM public.user_roles
   WHERE user_id = v_uid;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Your account is not assigned to a property.';
  END IF;

  SELECT name INTO v_name
    FROM public.profiles
   WHERE id = v_uid AND property_code = v_code;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Your staff profile is missing.';
  END IF;

  SELECT department INTO v_department
    FROM public.staff_members
   WHERE auth_user_id = v_uid
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
     AND user_id = v_uid
     AND shift_date = v_date;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  v_minutes := extract(hour FROM v_now)::integer * 60
    + extract(minute FROM v_now)::integer;
  v_reporting_minutes := extract(hour FROM v_reporting)::integer * 60
    + extract(minute FROM v_reporting)::integer;

  INSERT INTO public.staff_attendance (
    property_code, user_id, staff_name, department, shift_date, check_in,
    reporting_time, grace_minutes, is_late, late_minutes
  )
  VALUES (
    v_code, v_uid, v_name, v_department, v_date, now(),
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
       AND user_id = v_uid
       AND shift_date = v_date;
  END IF;
  RETURN v_row;
END
$$;

CREATE OR REPLACE FUNCTION public.gpm_check_out()
RETURNS public.staff_attendance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_row public.staff_attendance%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;

  SELECT property_code INTO v_code
    FROM public.user_roles
   WHERE user_id = v_uid;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Your account is not assigned to a property.';
  END IF;

  UPDATE public.staff_attendance
     SET check_out = now()
   WHERE id = (
     SELECT id
       FROM public.staff_attendance
      WHERE property_code = v_code
        AND user_id = v_uid
        AND check_out IS NULL
      ORDER BY shift_date DESC, check_in DESC
      LIMIT 1
   )
   RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not checked in.';
  END IF;
  RETURN v_row;
END
$$;

REVOKE ALL ON FUNCTION public.gpm_check_in(), public.gpm_check_out() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gpm_check_in(), public.gpm_check_out() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
