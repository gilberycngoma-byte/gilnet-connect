BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.property_backup_settings (
  property_code text PRIMARY KEY REFERENCES public.properties(code) ON DELETE CASCADE,
  schedule text NOT NULL CHECK (
    schedule IN ('hourly', 'daily', 'weekly', 'monthly', 'after_each_entry')
  ),
  next_run_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  lease_token uuid,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.property_backup_jobs (
  property_code text PRIMARY KEY REFERENCES public.properties(code) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)
);

CREATE TABLE IF NOT EXISTS public.property_backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_code text NOT NULL REFERENCES public.properties(code) ON DELETE CASCADE,
  schedule text NOT NULL CHECK (
    schedule IN ('manual', 'hourly', 'daily', 'weekly', 'monthly', 'after_each_entry')
  ),
  trigger_type text NOT NULL CHECK (trigger_type IN ('manual', 'scheduled', 'entry')),
  status text NOT NULL CHECK (status IN ('success', 'failure')),
  backup_path text,
  record_count integer CHECK (record_count IS NULL OR record_count >= 0),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_backup_runs_success_has_path CHECK (
    status <> 'success' OR (backup_path IS NOT NULL AND record_count IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS property_backup_runs_latest_idx
  ON public.property_backup_runs (property_code, created_at DESC);

ALTER TABLE public.property_backup_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_backup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_backup_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_backup_settings_read ON public.property_backup_settings;
CREATE POLICY property_backup_settings_read ON public.property_backup_settings
  FOR SELECT TO authenticated
  USING (
    property_code = public.gpm_property()
    AND public.gpm_role() IN ('Admin', 'Manager', 'Supervisor')
  );

DROP POLICY IF EXISTS property_backup_runs_read ON public.property_backup_runs;
CREATE POLICY property_backup_runs_read ON public.property_backup_runs
  FOR SELECT TO authenticated
  USING (
    property_code = public.gpm_property()
    AND public.gpm_role() IN ('Admin', 'Manager', 'Supervisor')
  );

REVOKE ALL ON public.property_backup_settings FROM PUBLIC, anon;
REVOKE ALL ON public.property_backup_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.property_backup_runs FROM PUBLIC, anon;
GRANT SELECT ON public.property_backup_settings TO authenticated;
GRANT SELECT ON public.property_backup_runs TO authenticated;
GRANT ALL ON public.property_backup_settings TO service_role;
GRANT ALL ON public.property_backup_jobs TO service_role;
GRANT ALL ON public.property_backup_runs TO service_role;

CREATE OR REPLACE FUNCTION public.gpm_set_property_backup_schedule(p_schedule text)
RETURNS public.property_backup_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_property_code text;
  saved_setting public.property_backup_settings;
BEGIN
  IF p_schedule IS NULL
    OR p_schedule NOT IN ('hourly', 'daily', 'weekly', 'monthly', 'after_each_entry') THEN
    RAISE EXCEPTION 'Choose a supported property backup plan.';
  END IF;

  IF public.gpm_role() IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Only the property Admin can change the backup plan.';
  END IF;

  v_property_code := public.gpm_property();
  IF v_property_code IS NULL OR v_property_code = '' THEN
    RAISE EXCEPTION 'The signed-in account is not assigned to a property.';
  END IF;

  INSERT INTO public.property_backup_settings (
    property_code,
    schedule,
    next_run_at,
    updated_by
  )
  VALUES (
    v_property_code,
    p_schedule,
    now(),
    auth.uid()
  )
  ON CONFLICT (property_code) DO UPDATE
  SET
    schedule = EXCLUDED.schedule,
    next_run_at = now(),
    last_error = NULL,
    lease_token = NULL,
    lease_until = NULL,
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING * INTO saved_setting;

  DELETE FROM public.property_backup_jobs
  WHERE property_code = v_property_code
    AND p_schedule <> 'after_each_entry';

  RETURN saved_setting;
END;
$$;

REVOKE ALL ON FUNCTION public.gpm_set_property_backup_schedule(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gpm_set_property_backup_schedule(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.gpm_record_property_backup_run(
  p_status text,
  p_backup_path text DEFAULT NULL,
  p_record_count integer DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_property_code text;
  v_run_id uuid;
  v_schedule text;
BEGIN
  v_property_code := public.gpm_property();
  IF v_property_code IS NULL OR public.gpm_role() NOT IN ('Admin', 'Manager', 'Supervisor') THEN
    RAISE EXCEPTION 'Property backup reporting requires a property management account.';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('success', 'failure') THEN
    RAISE EXCEPTION 'The backup result is invalid.';
  END IF;
  IF p_error_message IS NOT NULL AND length(p_error_message) > 800 THEN
    RAISE EXCEPTION 'The backup error details are too long.';
  END IF;

  SELECT schedule
  INTO v_schedule
  FROM public.property_backup_settings
  WHERE property_code = v_property_code;

  IF p_status = 'success' THEN
    IF p_backup_path IS NULL
      OR p_backup_path !~ ('^' || v_property_code || '/backup-[0-9]+[.]json$')
      OR p_record_count IS NULL
      OR p_record_count < 0 THEN
      RAISE EXCEPTION 'The backup file details are invalid for this property.';
    END IF;
    PERFORM 1
    FROM storage.objects
    WHERE bucket_id = 'gilnet-backups'
      AND name = p_backup_path;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The backup file was not found in the property bucket.';
    END IF;
  ELSIF p_error_message IS NULL OR p_error_message = '' THEN
    RAISE EXCEPTION 'A failure description is required.';
  END IF;

  INSERT INTO public.property_backup_runs (
    property_code,
    schedule,
    trigger_type,
    status,
    backup_path,
    record_count,
    error_message
  )
  VALUES (
    v_property_code,
    COALESCE(v_schedule, 'manual'),
    'manual',
    p_status,
    p_backup_path,
    p_record_count,
    p_error_message
  )
  RETURNING id INTO v_run_id;

  IF p_status = 'success' THEN
    UPDATE public.property_backup_settings
    SET last_success_at = now(), last_error = NULL
    WHERE property_code = v_property_code;
  ELSE
    UPDATE public.property_backup_settings
    SET last_failure_at = now(), last_error = p_error_message
    WHERE property_code = v_property_code;
  END IF;

  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.gpm_record_property_backup_run(text, text, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gpm_record_property_backup_run(text, text, integer, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.gpm_enqueue_property_backup_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_property_code text;
BEGIN
  v_property_code := COALESCE(NEW.property_code, OLD.property_code);
  IF EXISTS (
    SELECT 1
    FROM public.property_backup_settings
    WHERE property_code = v_property_code
      AND schedule = 'after_each_entry'
  ) THEN
    INSERT INTO public.property_backup_jobs (property_code, queued_at, available_at, attempt_count)
    VALUES (v_property_code, now(), now(), 0)
    ON CONFLICT (property_code) DO UPDATE
    SET
      queued_at = now(),
      available_at = now(),
      attempt_count = 0;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS property_backup_enqueue_after_change ON public.operation_rows;
CREATE TRIGGER property_backup_enqueue_after_change
  AFTER INSERT OR UPDATE OR DELETE ON public.operation_rows
  FOR EACH ROW
  EXECUTE FUNCTION public.gpm_enqueue_property_backup_after_change();

CREATE OR REPLACE FUNCTION public.gpm_claim_property_backup_jobs(p_limit integer DEFAULT 20)
RETURNS TABLE (
  property_code text,
  schedule text,
  queued_at timestamptz,
  lease_token uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH eligible AS (
    SELECT
      settings.property_code,
      settings.schedule,
      jobs.queued_at
    FROM public.property_backup_settings AS settings
    LEFT JOIN public.property_backup_jobs AS jobs
      ON jobs.property_code = settings.property_code
    WHERE (
      settings.next_run_at <= now()
      OR (
        settings.schedule = 'after_each_entry'
        AND jobs.queued_at IS NOT NULL
        AND jobs.available_at <= now()
      )
    )
      AND (settings.lease_until IS NULL OR settings.lease_until < now())
    ORDER BY COALESCE(jobs.queued_at, settings.next_run_at)
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
    FOR UPDATE OF settings SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.property_backup_settings AS settings
    SET
      lease_token = gen_random_uuid(),
      lease_until = now() + interval '30 minutes'
    FROM eligible
    WHERE settings.property_code = eligible.property_code
    RETURNING settings.property_code, settings.schedule, settings.lease_token
  )
  SELECT claimed.property_code, claimed.schedule, eligible.queued_at, claimed.lease_token
  FROM claimed
  JOIN eligible USING (property_code);
$$;

CREATE OR REPLACE FUNCTION public.gpm_complete_property_backup_job(
  p_property_code text,
  p_lease_token uuid,
  p_queued_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_schedule text;
BEGIN
  UPDATE public.property_backup_settings
  SET
    last_success_at = now(),
    last_error = NULL,
    next_run_at = CASE schedule
      WHEN 'hourly' THEN now() + interval '1 hour'
      WHEN 'daily' THEN now() + interval '1 day'
      WHEN 'weekly' THEN now() + interval '1 week'
      WHEN 'monthly' THEN now() + interval '1 month'
      ELSE NULL
    END,
    lease_token = NULL,
    lease_until = NULL
  WHERE property_code = p_property_code
    AND lease_token = p_lease_token
  RETURNING schedule INTO current_schedule;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The property backup lease expired before completion.';
  END IF;

  IF current_schedule = 'after_each_entry' AND p_queued_at IS NOT NULL THEN
    DELETE FROM public.property_backup_jobs
    WHERE property_code = p_property_code
      AND queued_at = p_queued_at;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.gpm_fail_property_backup_job(
  p_property_code text,
  p_lease_token uuid,
  p_queued_at timestamptz,
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_schedule text;
BEGIN
  IF p_error_message IS NULL OR p_error_message = '' OR length(p_error_message) > 800 THEN
    RAISE EXCEPTION 'A valid property backup error is required.';
  END IF;

  UPDATE public.property_backup_settings
  SET
    last_failure_at = now(),
    last_error = p_error_message,
    next_run_at = CASE
      WHEN schedule = 'after_each_entry' AND p_queued_at IS NOT NULL THEN NULL
      ELSE now() + interval '15 minutes'
    END,
    lease_token = NULL,
    lease_until = NULL
  WHERE property_code = p_property_code
    AND lease_token = p_lease_token
  RETURNING schedule INTO current_schedule;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The property backup lease expired before failure was recorded.';
  END IF;

  IF current_schedule = 'after_each_entry' AND p_queued_at IS NOT NULL THEN
    UPDATE public.property_backup_jobs
    SET
      attempt_count = attempt_count + 1,
      available_at = now() + interval '5 minutes'
    WHERE property_code = p_property_code
      AND queued_at = p_queued_at;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.gpm_claim_property_backup_jobs(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gpm_complete_property_backup_job(text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gpm_fail_property_backup_job(text, uuid, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gpm_claim_property_backup_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.gpm_complete_property_backup_job(text, uuid, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.gpm_fail_property_backup_job(text, uuid, timestamptz, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_hub_property_backup_overview()
RETURNS TABLE (
  property_code text,
  schedule text,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  latest_run_status text,
  latest_run_at timestamptz,
  latest_backup_path text,
  latest_record_count integer,
  latest_error_message text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    properties.code,
    settings.schedule,
    settings.last_success_at,
    settings.last_failure_at,
    settings.last_error,
    latest_run.status,
    latest_run.created_at,
    latest_success.backup_path,
    latest_success.record_count,
    latest_run.error_message
  FROM public.properties AS properties
  LEFT JOIN public.property_backup_settings AS settings
    ON settings.property_code = properties.code
  LEFT JOIN LATERAL (
    SELECT runs.status, runs.created_at, runs.backup_path, runs.record_count, runs.error_message
    FROM public.property_backup_runs AS runs
    WHERE runs.property_code = properties.code
    ORDER BY runs.created_at DESC
    LIMIT 1
  ) AS latest_run ON true
  LEFT JOIN LATERAL (
    SELECT runs.backup_path, runs.record_count
    FROM public.property_backup_runs AS runs
    WHERE runs.property_code = properties.code
      AND runs.status = 'success'
    ORDER BY runs.created_at DESC
    LIMIT 1
  ) AS latest_success ON true;
$$;

REVOKE ALL ON FUNCTION public.admin_hub_property_backup_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hub_property_backup_overview() TO service_role;

CREATE OR REPLACE FUNCTION public.gpm_dispatch_property_backup_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  backup_secret text;
BEGIN
  SELECT decrypted_secret
  INTO backup_secret
  FROM vault.decrypted_secrets
  WHERE name = 'gpm_backup_cron_secret';

  IF backup_secret IS NULL OR backup_secret = '' THEN
    RAISE EXCEPTION 'Store gpm_backup_cron_secret in Supabase Vault before enabling property backups.';
  END IF;

  PERFORM net.http_post(
    url := 'https://qyawsbiipskhpstnemno.supabase.co/functions/v1/gpm-property-backup-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-gpm-backup-secret', backup_secret
    ),
    body := jsonb_build_object('source', 'pg_cron')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gpm_dispatch_property_backup_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gpm_dispatch_property_backup_worker() TO postgres, service_role;

DROP POLICY IF EXISTS gilnet_backups_manager_delete ON storage.objects;
CREATE POLICY gilnet_backups_manager_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'gilnet-backups'
    AND (storage.foldername(name))[1] = public.gpm_property()
    AND public.gpm_role() IN ('Admin', 'Manager', 'Supervisor')
  );

DO $setup$
DECLARE
  existing_job bigint;
BEGIN
  SELECT jobid
  INTO existing_job
  FROM cron.job
  WHERE jobname = 'gpm-property-backup-dispatch';

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;

  PERFORM cron.schedule(
    'gpm-property-backup-dispatch',
    '* * * * *',
    'SELECT public.gpm_dispatch_property_backup_worker();'
  );
END;
$setup$;

COMMIT;
