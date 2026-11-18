CREATE OR REPLACE FUNCTION public.gpm_mutate(p_kind text, p_id text, p_payload jsonb, p_revision integer, p_deleted boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r text := public.gpm_role();
  c text := public.gpm_property();
  old public.operation_rows;
  result integer;
  managers text[] := ARRAY['Admin','Manager','Supervisor'];
  desk text[] := ARRAY['Admin','Manager','Supervisor','Front Desk'];
  guest_keys text[] := ARRAY['status','guestName','checkIn','checkOut','reservationId','dnd','serviced_at','pax'];
BEGIN
  IF c IS NULL THEN RAISE EXCEPTION 'No property access'; END IF;
  SELECT * INTO old FROM public.operation_rows WHERE property_code=c AND kind=p_kind AND id=p_id FOR UPDATE;
  IF coalesce(old.revision,0)<>p_revision THEN RAISE EXCEPTION 'Conflict: another device changed this record. Refresh and retry.'; END IF;

  IF p_kind='reservations' AND NOT (r = ANY(desk)) THEN RAISE EXCEPTION 'Permission denied'; END IF;

  IF p_kind='menu' AND NOT (r = ANY(managers) OR r='Restaurant') THEN RAISE EXCEPTION 'Permission denied'; END IF;

  -- Sellers may record new sales; only managers may edit or delete recorded sales.
  IF p_kind='sales' AND NOT (r = ANY(managers)) AND NOT (r IN ('Front Desk','Restaurant') AND old.id IS NULL AND NOT p_deleted) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_kind='rooms' THEN
    IF old.id IS NULL AND r<>'Admin' THEN RAISE EXCEPTION 'Only admins add rooms'; END IF;
    IF p_deleted AND r<>'Admin' THEN RAISE EXCEPTION 'Only admins remove rooms'; END IF;
    IF NOT (r = ANY(desk)) THEN
      IF r NOT IN ('Housekeeping','Maintenance') OR old.id IS NULL THEN RAISE EXCEPTION 'Permission denied'; END IF;
      IF old.payload->>'status'='Occupied' THEN
        -- Occupied rooms: housekeeping may only record servicing / do-not-disturb.
        IF (p_payload - ARRAY['serviced_at','dnd']) <> (old.payload - ARRAY['serviced_at','dnd']) THEN RAISE EXCEPTION 'Permission denied'; END IF;
      ELSE
        IF (p_payload - guest_keys) <> (old.payload - guest_keys)
           OR coalesce(p_payload->>'status','') NOT IN ('Available','Cleaning','Dirty','Out of Order')
           OR coalesce(p_payload->>'guestName','') <> '' THEN
          RAISE EXCEPTION 'Permission denied';
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_kind='notices' AND NOT (r = ANY(desk)) AND (old.id IS NULL OR p_deleted OR (p_payload - ARRAY['seen_by','is_completed','completed_by','completed_photo'])<>(old.payload - ARRAY['seen_by','is_completed','completed_by','completed_photo'])) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  INSERT INTO public.operation_rows(property_code,kind,id,payload,revision,deleted)
  VALUES(c,p_kind,p_id,p_payload,p_revision+1,p_deleted)
  ON CONFLICT(property_code,kind,id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,deleted=excluded.deleted
  RETURNING revision INTO result;
  RETURN result;
END $function$;

DROP POLICY IF EXISTS profile_read ON public.profiles;
CREATE POLICY profile_read ON public.profiles FOR SELECT TO authenticated
  USING ((id = auth.uid()) OR ((property_code = public.gpm_property()) AND (public.gpm_role() IN ('Admin','Manager','Supervisor'))));

DROP POLICY IF EXISTS role_read ON public.user_roles;
CREATE POLICY role_read ON public.user_roles FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR ((property_code = public.gpm_property()) AND (public.gpm_role() IN ('Admin','Manager','Supervisor'))));