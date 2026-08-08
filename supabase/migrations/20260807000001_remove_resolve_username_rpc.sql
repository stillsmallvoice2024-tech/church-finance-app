-- ============================================================
-- Close the resolve_username() email-disclosure hole.
-- Idempotent — safe to re-run.
--
-- PROBLEM
-- 20260530000002_resolve_username_rpc.sql granted EXECUTE on
-- public.resolve_username(text) to the `anon` role.  That turned any
-- unauthenticated caller holding the (publicly shipped) anon key into the
-- owner of an unmetered username → email oracle: run a wordlist of likely
-- usernames (admin, pastor, treasurer, finance, common first names) and
-- harvest verified email addresses of church finance administrators.  It was
-- also a membership oracle — a hit proves the account exists.
--
-- FIX
-- Username login now runs entirely inside the `username-auth` Edge Function,
-- which resolves the username with the service role and returns a session —
-- never an email address.  The RPC has no remaining callers, so it is dropped
-- outright rather than merely revoked.
--
-- DEPLOY ORDER — the Edge Function must be live BEFORE this migration runs,
-- or username login breaks in the gap.  Email login is unaffected either way:
--   1. supabase functions deploy username-auth --no-verify-jwt
--   2. supabase db push
--   3. deploy the frontend
-- ============================================================

-- ── 1. Remove the oracle ──────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.resolve_username(text);

-- ── 2. Rate-limit ledger ──────────────────────────────────────────────────────
-- Written only by the service role via check_auth_rate_limit().  IPs are
-- stored as salted SHA-256 hashes, never in the clear — the salt lives in the
-- Edge Function's AUTH_RATE_LIMIT_SALT env var, so a database leak alone does
-- not reverse them.

CREATE TABLE IF NOT EXISTS public.auth_attempts (
  id            bigserial   PRIMARY KEY,
  ip_hash       text        NOT NULL,
  username_hash text        NOT NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_attempts_ip_idx
  ON public.auth_attempts (ip_hash, attempted_at DESC);

CREATE INDEX IF NOT EXISTS auth_attempts_username_idx
  ON public.auth_attempts (username_hash, attempted_at DESC);

CREATE INDEX IF NOT EXISTS auth_attempts_attempted_at_idx
  ON public.auth_attempts (attempted_at);

-- RLS on with no policies: nothing but the service role (BYPASSRLS) gets in.
ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.auth_attempts FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.auth_attempts_id_seq FROM anon, authenticated;

-- ── 3. Rate-limit gate ────────────────────────────────────────────────────────
-- Records the attempt and reports whether the caller is still under the caps.
-- Enforced in Postgres rather than in the function's memory so the limits
-- survive Edge Function cold starts and span all worker instances.
--
-- Caps: 10 attempts/minute and 60/hour per IP, 20/hour per username.
-- A legitimate person fumbling their password stays far below these; a
-- wordlist attack hits the ceiling within seconds.

CREATE OR REPLACE FUNCTION public.check_auth_rate_limit(
  p_ip_hash       text,
  p_username_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ip_minute   int;
  v_ip_hour     int;
  v_user_hour   int;
BEGIN
  -- Opportunistic cleanup: ~1 call in 100 trims the table. Cheap on average
  -- and keeps the ledger from growing without bound.
  IF random() < 0.01 THEN
    DELETE FROM public.auth_attempts
    WHERE  attempted_at < now() - interval '24 hours';
  END IF;

  SELECT count(*) INTO v_ip_minute
  FROM   public.auth_attempts
  WHERE  ip_hash = p_ip_hash
    AND  attempted_at > now() - interval '1 minute';

  SELECT count(*) INTO v_ip_hour
  FROM   public.auth_attempts
  WHERE  ip_hash = p_ip_hash
    AND  attempted_at > now() - interval '1 hour';

  SELECT count(*) INTO v_user_hour
  FROM   public.auth_attempts
  WHERE  username_hash = p_username_hash
    AND  attempted_at > now() - interval '1 hour';

  INSERT INTO public.auth_attempts (ip_hash, username_hash)
  VALUES (p_ip_hash, p_username_hash);

  RETURN v_ip_minute < 10 AND v_ip_hour < 60 AND v_user_hour < 20;
END;
$$;

-- Callable by the Edge Function's service role only — never from a browser.
REVOKE ALL ON FUNCTION public.check_auth_rate_limit(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_auth_rate_limit(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
