-- ============================================================
-- FIX v2: Fully defensive handle_new_user + accept_invitation profile guarantee
-- Idempotent — safe to re-run.
-- Prerequisites: Phases 1–5 applied.
--
-- WHY v1 WAS INSUFFICIENT
-- v1 only caught unique_violation on profiles.username.  Three other failure
-- paths remain:
--
--   a) The NULL-username fallback INSERT itself can fail (any other constraint).
--   b) The org_members INSERT can fail (e.g. FK violation when profile row did
--      not end up created, or org_members table missing in partial migrations).
--   c) v1 gave no diagnostic: the Supabase log still showed only the generic
--      "Database error saving new user" with no inner SQLSTATE/SQLERRM.
--
-- THIS MIGRATION
-- 1. Wraps BOTH the profiles INSERT and the org_members INSERT in independent
--    WHEN OTHERS handlers.  Each failure is logged as RAISE WARNING (visible in
--    Supabase Dashboard → Logs → Postgres) but never re-raised.  Auth user
--    creation ALWAYS succeeds regardless of profile/org_members errors.
--
-- 2. Updates accept_invitation() to INSERT the profile row if it is missing
--    (using auth.users as source of email).  This ensures the org_members FK
--    (user_id → profiles.id) never fires even if handle_new_user's profile
--    insert silently failed.
-- ============================================================


-- ── 1. handle_new_user: never block auth user creation ───────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id uuid;
BEGIN

  -- ── Profile insert ──────────────────────────────────────────────────────────
  -- Attempt A: include username from signup metadata.
  -- On unique_violation (username already taken), attempt B with NULL username.
  -- On any other error, log and continue — do NOT re-raise.
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, username)
    VALUES (
      new.id,
      new.email,
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'username'
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE WARNING
        '[handle_new_user] username conflict user=% — retrying with NULL username',
        new.id;
      BEGIN
        INSERT INTO public.profiles (id, email, full_name, username)
        VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name', NULL)
        ON CONFLICT (id) DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING
          '[handle_new_user] profile fallback insert failed user=% sqlstate=% err=%',
          new.id, SQLSTATE, SQLERRM;
      END;
    WHEN OTHERS THEN
      RAISE WARNING
        '[handle_new_user] profile insert failed user=% sqlstate=% err=%',
        new.id, SQLSTATE, SQLERRM;
  END;

  -- ── Org-members insert ──────────────────────────────────────────────────────
  -- Errors here (e.g. FK violation if profile above failed, or missing table)
  -- are logged and swallowed.  accept_invitation() guarantees the profile and
  -- org_members rows are created atomically when the user accepts the invite.
  BEGIN
    SELECT id INTO v_org_id
    FROM   public.organizations
    WHERE  slug = 'primary'
    LIMIT  1;

    IF v_org_id IS NOT NULL THEN
      INSERT INTO public.org_members (org_id, user_id, role, status)
      VALUES (v_org_id, new.id, 'viewer', 'active')
      ON CONFLICT (org_id, user_id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      '[handle_new_user] org_members insert failed user=% sqlstate=% err=%',
      new.id, SQLSTATE, SQLERRM;
  END;

  RETURN new;
END;
$$;


-- ── 2. accept_invitation: guarantee profile row exists ───────────────────────
-- If handle_new_user failed to create the profile (now logged but non-fatal),
-- the subsequent UPDATE profiles SET role = ... WHERE id = p_user_id would
-- update 0 rows, and the org_members INSERT would fail the FK constraint
-- (user_id → profiles.id).
--
-- This version upserts the profile first (sourcing email from auth.users which
-- is accessible to SECURITY DEFINER / postgres role), so the rest of the
-- function always has a profile to work with.

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_invite public.invitations;
  v_org_id uuid;
BEGIN
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_invite
  FROM   public.invitations
  WHERE  token      = p_token
    AND  status     = 'pending'
    AND  expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired invitation';
  END IF;

  -- Guarantee profile row exists before we UPDATE it and before org_members
  -- tries to reference it via FK.  Pulls email + full_name from auth.users
  -- (accessible via SECURITY DEFINER / postgres role).  ON CONFLICT DO NOTHING
  -- so this is a no-op when handle_new_user already created the profile.
  INSERT INTO public.profiles (id, email, full_name)
  SELECT p_user_id, u.email, u.raw_user_meta_data->>'full_name'
  FROM   auth.users u
  WHERE  u.id = p_user_id
  ON CONFLICT (id) DO NOTHING;

  -- Backward compat: keep profiles.role synced (Phase 6 will remove this).
  UPDATE public.profiles
    SET role       = v_invite.role,
        updated_at = now()
  WHERE id = p_user_id;

  -- Resolve org_id — fall back to primary org for pre-Phase 5 invites.
  v_org_id := v_invite.org_id;
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id
    FROM   public.organizations
    WHERE  slug = 'primary'
    LIMIT  1;
  END IF;

  -- Upsert org_members — sole authoritative role source for RLS checks.
  IF v_org_id IS NOT NULL THEN
    INSERT INTO public.org_members (org_id, user_id, role, status)
    VALUES (v_org_id, p_user_id, v_invite.role, 'active')
    ON CONFLICT (org_id, user_id) DO UPDATE
      SET role   = EXCLUDED.role,
          status = 'active';
  END IF;

  UPDATE public.invitations
    SET status      = 'accepted',
        accepted_at = now()
  WHERE token = p_token;
END;
$$;


NOTIFY pgrst, 'reload schema';
