-- ============================================================
-- resolve_username: unauthenticated username → email lookup
-- Idempotent — safe to re-run.
--
-- WHY
-- profiles_select RLS requires auth.uid() IS NOT NULL.  The login page must
-- resolve a username to an email BEFORE the user authenticates, so a direct
-- table query returns 0 rows (RLS denies, no error) → "No account found".
--
-- A SECURITY DEFINER function runs as the postgres role (BYPASSRLS) and can
-- be called by the anon key.  It returns only the email column (not the full
-- profile row) to minimise data exposure.
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_username(p_username text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT email
  FROM   public.profiles
  WHERE  username = lower(trim(p_username))
  LIMIT  1;
$$;

-- Allow the anon role to call this function.
GRANT EXECUTE ON FUNCTION public.resolve_username(text) TO anon;

NOTIFY pgrst, 'reload schema';
