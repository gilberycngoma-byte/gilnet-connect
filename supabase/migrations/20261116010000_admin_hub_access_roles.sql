CREATE OR REPLACE FUNCTION public.admin_hub_set_access_role(
  target_user_id uuid,
  requested_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_metadata jsonb;
  super_admin_count integer;
  technical_admin_count integer;
BEGIN
  IF requested_role NOT IN ('super_admin', 'technical_admin', 'user') THEN
    RAISE EXCEPTION 'Invalid Admin Hub access role.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(7260411601);

  SELECT raw_app_meta_data
  INTO target_metadata
  FROM auth.users
  WHERE id = target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected account was not found.';
  END IF;

  SELECT count(*)::integer
  INTO super_admin_count
  FROM auth.users
  WHERE raw_app_meta_data -> 'super_admin' = 'true'::jsonb;

  SELECT count(*)::integer
  INTO technical_admin_count
  FROM auth.users
  WHERE raw_app_meta_data -> 'technical_admin' = 'true'::jsonb;

  IF requested_role = 'super_admin'
    AND target_metadata -> 'super_admin' IS DISTINCT FROM 'true'::jsonb
    AND super_admin_count >= 3 THEN
    RAISE EXCEPTION 'The maximum of three Super Admins has been reached.';
  END IF;

  IF requested_role = 'technical_admin'
    AND target_metadata -> 'technical_admin' IS DISTINCT FROM 'true'::jsonb
    AND technical_admin_count >= 2 THEN
    RAISE EXCEPTION 'The maximum of two Technical Admins has been reached.';
  END IF;

  IF requested_role <> 'super_admin'
    AND target_metadata -> 'super_admin' = 'true'::jsonb
    AND super_admin_count <= 1 THEN
    RAISE EXCEPTION 'At least one Super Admin must remain.';
  END IF;

  UPDATE auth.users
  SET raw_app_meta_data =
    (COALESCE(raw_app_meta_data, '{}'::jsonb)
      - 'super_admin'
      - 'technical_admin'
      - 'technical_admin_permissions')
    || CASE requested_role
      WHEN 'super_admin' THEN jsonb_build_object('super_admin', true)
      WHEN 'technical_admin' THEN jsonb_build_object(
        'technical_admin', true,
        'technical_admin_permissions', jsonb_build_array(
          'view_dashboard_properties_users',
          'edit_user_profiles_and_property_roles',
          'suspend_or_restore_users',
          'manage_billing_and_payouts',
          'reply_to_support'
        )
      )
      ELSE '{}'::jsonb
    END
  WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_hub_set_access_role(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hub_set_access_role(uuid, text) TO service_role;
