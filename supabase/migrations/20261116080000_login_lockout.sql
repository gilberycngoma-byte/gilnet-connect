CREATE TABLE public.gpm_auth_login_attempts (
  login_hash text PRIMARY KEY CHECK (login_hash ~ '^[0-9a-f]{64}$'),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 3),
  attempt_window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gpm_auth_login_attempts_updated_at_idx
  ON public.gpm_auth_login_attempts (updated_at);

ALTER TABLE public.gpm_auth_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gpm_auth_login_attempts FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gpm_auth_login_lockout_seconds(p_login_hash text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_failed_attempts integer;
  v_window_started_at timestamptz;
  v_locked_until timestamptz;
BEGIN
  IF p_login_hash IS NULL OR p_login_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid login hash';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gpm-login-lockout:' || p_login_hash, 0));
  DELETE FROM public.gpm_auth_login_attempts
   WHERE updated_at < v_now - interval '30 days';

  SELECT failed_attempts, attempt_window_started_at, locked_until
    INTO v_failed_attempts, v_window_started_at, v_locked_until
    FROM public.gpm_auth_login_attempts
   WHERE login_hash = p_login_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF v_locked_until IS NOT NULL AND v_locked_until > v_now THEN
    RETURN GREATEST(1, ceil(extract(epoch FROM (v_locked_until - v_now)))::integer);
  END IF;

  IF v_locked_until IS NOT NULL OR v_window_started_at <= v_now - interval '15 minutes' THEN
    UPDATE public.gpm_auth_login_attempts
       SET failed_attempts = 0,
           attempt_window_started_at = v_now,
           locked_until = NULL,
           updated_at = v_now
     WHERE login_hash = p_login_hash;
  END IF;
  RETURN 0;
END
$$;

CREATE OR REPLACE FUNCTION public.gpm_auth_record_login_failure(p_login_hash text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_failed_attempts integer;
  v_window_started_at timestamptz;
  v_locked_until timestamptz;
BEGIN
  IF p_login_hash IS NULL OR p_login_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid login hash';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gpm-login-lockout:' || p_login_hash, 0));
  SELECT failed_attempts, attempt_window_started_at, locked_until
    INTO v_failed_attempts, v_window_started_at, v_locked_until
    FROM public.gpm_auth_login_attempts
   WHERE login_hash = p_login_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.gpm_auth_login_attempts (
      login_hash, failed_attempts, attempt_window_started_at, updated_at
    ) VALUES (
      p_login_hash, 1, v_now, v_now
    );
    RETURN 0;
  END IF;

  IF v_locked_until IS NOT NULL AND v_locked_until > v_now THEN
    RETURN GREATEST(1, ceil(extract(epoch FROM (v_locked_until - v_now)))::integer);
  END IF;

  IF v_locked_until IS NOT NULL OR v_window_started_at <= v_now - interval '15 minutes' THEN
    v_failed_attempts := 1;
    v_window_started_at := v_now;
  ELSE
    v_failed_attempts := v_failed_attempts + 1;
  END IF;

  v_locked_until := CASE
    WHEN v_failed_attempts >= 3 THEN v_now + interval '15 minutes'
    ELSE NULL
  END;

  UPDATE public.gpm_auth_login_attempts
     SET failed_attempts = v_failed_attempts,
         attempt_window_started_at = v_window_started_at,
         locked_until = v_locked_until,
         updated_at = v_now
   WHERE login_hash = p_login_hash;

  IF v_locked_until IS NOT NULL THEN
    RETURN GREATEST(1, ceil(extract(epoch FROM (v_locked_until - v_now)))::integer);
  END IF;
  RETURN 0;
END
$$;

CREATE OR REPLACE FUNCTION public.gpm_auth_reset_login_failures(p_login_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_login_hash IS NULL OR p_login_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid login hash';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('gpm-login-lockout:' || p_login_hash, 0));
  DELETE FROM public.gpm_auth_login_attempts WHERE login_hash = p_login_hash;
END
$$;

REVOKE ALL ON FUNCTION public.gpm_auth_login_lockout_seconds(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gpm_auth_record_login_failure(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gpm_auth_reset_login_failures(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.gpm_auth_login_lockout_seconds(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gpm_auth_record_login_failure(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gpm_auth_reset_login_failures(text) TO service_role;
