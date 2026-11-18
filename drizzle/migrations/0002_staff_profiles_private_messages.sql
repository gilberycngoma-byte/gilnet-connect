CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS image_url text;

GRANT UPDATE(name, address, phone, image_url) ON public.properties TO authenticated;
CREATE POLICY property_profile_update ON public.properties
  FOR UPDATE TO authenticated
  USING (code = public.gpm_property() AND public.gpm_role() = 'Admin')
  WITH CHECK (code = public.gpm_property() AND public.gpm_role() = 'Admin');

CREATE TABLE public.staff_members (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  property_code text NOT NULL REFERENCES public.properties(code) ON DELETE CASCADE,
  company_email text NOT NULL,
  staff_name text NOT NULL,
  department text NOT NULL CHECK (department IN ('Maintenance', 'Security', 'Cleaning', 'Admin')),
  role text NOT NULL CHECK (role IN ('Admin', 'Manager', 'Supervisor', 'Front Desk', 'Housekeeping', 'Maintenance', 'Restaurant')),
  pin_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX staff_members_identity_unique
  ON public.staff_members (property_code, lower(company_email), lower(staff_name), lower(department));
CREATE INDEX staff_members_property_email_idx
  ON public.staff_members (property_code, lower(company_email)) WHERE active;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT (auth_user_id, property_code, staff_name, department, role, active)
  ON public.staff_members TO authenticated;
GRANT ALL ON public.staff_members TO service_role;
CREATE POLICY staff_members_property_read ON public.staff_members
  FOR SELECT TO authenticated
  USING (property_code = public.gpm_property() AND active);

CREATE TABLE public.staff_login_attempts (
  property_code text NOT NULL,
  email_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_code, email_key)
);
REVOKE ALL ON public.staff_login_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.staff_login_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.gpm_hash_staff_pin(p_pin text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'PIN must contain 4 to 6 digits';
  END IF;
  RETURN crypt(p_pin, gen_salt('bf', 10));
END
$$;
REVOKE ALL ON FUNCTION public.gpm_hash_staff_pin(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gpm_hash_staff_pin(text) TO service_role;

CREATE OR REPLACE FUNCTION public.gpm_authenticate_staff(
  p_code text,
  p_email text,
  p_staff_name text,
  p_department text,
  p_pin text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_code text := upper(trim(p_code));
  v_email text := lower(trim(p_email));
  v_attempts integer;
  v_auth_user_id uuid;
  v_pin_hash text;
BEGIN
  INSERT INTO public.staff_login_attempts (property_code, email_key)
  VALUES (v_code, v_email)
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

  IF v_attempts > 10 OR p_pin !~ '^[0-9]{4,6}$' THEN
    RETURN NULL;
  END IF;

  SELECT auth_user_id, pin_hash
    INTO v_auth_user_id, v_pin_hash
    FROM public.staff_members
   WHERE property_code = v_code
     AND lower(company_email) = v_email
     AND lower(staff_name) = lower(trim(p_staff_name))
     AND lower(department) = lower(trim(p_department))
     AND active;

  IF v_auth_user_id IS NULL OR crypt(p_pin, v_pin_hash) <> v_pin_hash THEN
    RETURN NULL;
  END IF;

  DELETE FROM public.staff_login_attempts
   WHERE property_code = v_code AND email_key = v_email;
  RETURN v_auth_user_id;
END
$$;
REVOKE ALL ON FUNCTION public.gpm_authenticate_staff(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gpm_authenticate_staff(text, text, text, text, text) TO service_role;

ALTER TABLE public.operation_rows
  ADD COLUMN IF NOT EXISTS receiver_staff_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS receiver_type text NOT NULL DEFAULT 'all'
    CHECK (receiver_type IN ('all', 'specific')),
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.gpm_sync_message_visibility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.kind = 'messages' THEN
    NEW.receiver_type := coalesce(NEW.payload->>'receiver_type', 'all');
    NEW.receiver_staff_id := nullif(NEW.payload->>'receiver_staff_id', '')::uuid;
    NEW.is_private := NEW.receiver_type = 'specific';
  ELSE
    NEW.receiver_type := 'all';
    NEW.receiver_staff_id := NULL;
    NEW.is_private := false;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER gpm_message_visibility
  BEFORE INSERT OR UPDATE OF kind, payload ON public.operation_rows
  FOR EACH ROW EXECUTE FUNCTION public.gpm_sync_message_visibility();

DROP POLICY IF EXISTS operations_read ON public.operation_rows;
CREATE POLICY operations_read ON public.operation_rows
  FOR SELECT TO authenticated
  USING (
    property_code = public.gpm_property()
    AND (
      kind <> 'messages'
      OR NOT is_private
      OR receiver_staff_id = auth.uid()
      OR payload->>'sender_staff_id' = auth.uid()::text
    )
  );

CREATE OR REPLACE FUNCTION public.gpm_mutate(
  p_kind text,
  p_id text,
  p_payload jsonb,
  p_revision integer,
  p_deleted boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text := public.gpm_role();
  c text := public.gpm_property();
  old public.operation_rows;
  result integer;
  managers text[] := ARRAY['Admin','Manager','Supervisor'];
  desk text[] := ARRAY['Admin','Manager','Supervisor','Front Desk'];
  guest_keys text[] := ARRAY['status','guestName','checkIn','checkOut','reservationId','dnd','serviced_at','pax'];
  receiver uuid;
BEGIN
  IF c IS NULL THEN RAISE EXCEPTION 'No property access'; END IF;
  SELECT * INTO old FROM public.operation_rows
   WHERE property_code = c AND kind = p_kind AND id = p_id FOR UPDATE;
  IF coalesce(old.revision, 0) <> p_revision THEN
    RAISE EXCEPTION 'Conflict: another device changed this record. Refresh and retry.';
  END IF;

  IF p_kind = 'messages' THEN
    IF p_deleted THEN RAISE EXCEPTION 'Messages cannot be deleted'; END IF;
    IF old.id IS NULL THEN
      IF p_payload->>'sender_staff_id' IS DISTINCT FROM auth.uid()::text THEN
        RAISE EXCEPTION 'Message sender does not match the signed-in user';
      END IF;
      IF coalesce(p_payload->>'receiver_type', 'all') NOT IN ('all', 'specific') THEN
        RAISE EXCEPTION 'Invalid message receiver';
      END IF;
      IF coalesce(p_payload->>'receiver_type', 'all') = 'specific' THEN
        receiver := nullif(p_payload->>'receiver_staff_id', '')::uuid;
        IF receiver IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.staff_members
           WHERE auth_user_id = receiver AND property_code = c AND active
        ) THEN RAISE EXCEPTION 'Private message recipient is not in this property'; END IF;
      END IF;
    ELSIF old.payload->>'sender_staff_id' IS DISTINCT FROM auth.uid()::text
       AND old.receiver_staff_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Only message participants can update this message';
    END IF;
  END IF;

  IF p_kind = 'reservations' AND NOT (r = ANY(desk)) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF p_kind = 'menu' AND NOT (r = ANY(managers) OR r = 'Restaurant') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF p_kind = 'sales' AND NOT (r = ANY(managers))
     AND NOT (r IN ('Front Desk','Restaurant') AND old.id IS NULL AND NOT p_deleted) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_kind = 'rooms' THEN
    IF old.id IS NULL AND r <> 'Admin' THEN RAISE EXCEPTION 'Only admins add rooms'; END IF;
    IF p_deleted AND r <> 'Admin' THEN RAISE EXCEPTION 'Only admins remove rooms'; END IF;
    IF NOT (r = ANY(desk)) THEN
      IF r NOT IN ('Housekeeping','Maintenance') OR old.id IS NULL THEN RAISE EXCEPTION 'Permission denied'; END IF;
      IF old.payload->>'status' = 'Occupied' THEN
        IF (p_payload - ARRAY['serviced_at','dnd']) <> (old.payload - ARRAY['serviced_at','dnd']) THEN
          RAISE EXCEPTION 'Permission denied';
        END IF;
      ELSE
        IF (p_payload - guest_keys) <> (old.payload - guest_keys)
           OR coalesce(p_payload->>'status','') NOT IN ('Available','Cleaning','Dirty','Out of Order')
           OR coalesce(p_payload->>'guestName','') <> '' THEN
          RAISE EXCEPTION 'Permission denied';
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_kind = 'notices' AND NOT (r = ANY(desk))
     AND (old.id IS NULL OR p_deleted
       OR (p_payload - ARRAY['seen_by','is_completed','completed_by','completed_photo'])
          <> (old.payload - ARRAY['seen_by','is_completed','completed_by','completed_photo'])) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  INSERT INTO public.operation_rows(property_code,kind,id,payload,revision,deleted)
  VALUES(c,p_kind,p_id,p_payload,p_revision+1,p_deleted)
  ON CONFLICT(property_code,kind,id) DO UPDATE
    SET payload=excluded.payload,revision=excluded.revision,deleted=excluded.deleted
  RETURNING revision INTO result;
  RETURN result;
END
$$;
REVOKE ALL ON FUNCTION public.gpm_mutate(text,text,jsonb,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gpm_mutate(text,text,jsonb,integer,boolean) TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('property_assets', 'property_assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY property_assets_admin_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'property_assets'
    AND (storage.foldername(name))[1] = public.gpm_property()
    AND public.gpm_role() = 'Admin'
  );
CREATE POLICY property_assets_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'property_assets'
    AND (storage.foldername(name))[1] = public.gpm_property()
    AND public.gpm_role() = 'Admin'
  )
  WITH CHECK (
    bucket_id = 'property_assets'
    AND (storage.foldername(name))[1] = public.gpm_property()
    AND public.gpm_role() = 'Admin'
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'properties') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.properties;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'operation_rows') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.operation_rows;
    END IF;
  END IF;
END
$$;
