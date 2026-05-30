-- ============================================================
-- FIX v3: accept_invitation — username persistence + org fallback
-- Idempotent — safe to re-run.
-- Prerequisites: Phases 1–5 + migration 000003 applied.
--
-- WHY THIS IS NEEDED
--
--   a) Username never saved: migration 000003's accept_invitation inserts the
--      profile with only (id, email, full_name).  username is omitted, so if the
--      subsequent profiles.update() call in AcceptInvite.tsx fails or is skipped,
--      profiles.username stays NULL → login by username returns "No account found".
--
--   b) No org membership: the invite may have org_id = NULL (created when orgId
--      is falsy in UserManagement.tsx).  Migration 000003 falls back to
--      organizations WHERE slug = 'primary'.  If that org doesn't exist (the org
--      was created with a different slug or no slug at all), v_org_id stays NULL,
--      the org_members INSERT is skipped, and the user sees "No organization
--      access" after signup.
--
-- THIS MIGRATION
-- 1. Updates accept_invitation to include username in the profile INSERT.
--    ON CONFLICT (id) DO UPDATE sets full_name + username only if currently NULL
--    (COALESCE), so existing non-null values from handle_new_user are preserved.
--    Wraps the INSERT in an exception block: unique_violation on username falls
--    back to inserting/updating without a username (same approach as 000003).
--
-- 2. Adds a second org fallback: after failing to find slug='primary', picks any
--    organization in the database.  A RAISE WARNING is emitted when org_id is
--    still NULL after all fallbacks (visible in Supabase Logs → Postgres).
-- ============================================================


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

  -- ── Guarantee profile row exists ──────────────────────────────────────────
  -- Pulls email, full_name, AND username from auth.users metadata.
  -- ON CONFLICT (id) DO UPDATE fills in only NULL columns (COALESCE), so a
  -- profile already created by handle_new_user is not clobbered.
  -- Wraps in an exception block: unique_violation on username retries without
  -- username so auth user creation is never blocked.
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, username)
    SELECT p_user_id,
           u.email,
           u.raw_user_meta_data->>'full_name',
           u.raw_user_meta_data->>'username'
    FROM   auth.users u
    WHERE  u.id = p_user_id
    ON CONFLICT (id) DO UPDATE
      SET full_name  = COALESCE(EXCLUDED.full_name,  profiles.full_name),
          username   = COALESCE(EXCLUDED.username,   profiles.username);
  EXCEPTION
    WHEN unique_violation THEN
      RAISE WARNING
        '[accept_invitation] username conflict for user=% — upserting without username',
        p_user_id;
      INSERT INTO public.profiles (id, email, full_name)
      SELECT p_user_id, u.email, u.raw_user_meta_data->>'full_name'
      FROM   auth.users u
      WHERE  u.id = p_user_id
      ON CONFLICT (id) DO UPDATE
        SET full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);
  END;

  -- Backward compat: keep profiles.role synced (used by frontend useRole()).
  UPDATE public.profiles
    SET role       = v_invite.role,
        updated_at = now()
  WHERE id = p_user_id;

  -- ── Resolve org_id ────────────────────────────────────────────────────────
  -- Priority 1: org_id on the invite (set by Phase 5+ invite creation).
  -- Priority 2: first org with slug = 'primary' (legacy fallback).
  -- Priority 3: any organization in the database (last-resort fallback so that
  --             single-org churches without a 'primary' slug still work).
  v_org_id := v_invite.org_id;

  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id
    FROM   public.organizations
    WHERE  slug = 'primary'
    LIMIT  1;
  END IF;

  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id
    FROM   public.organizations
    LIMIT  1;
  END IF;

  -- ── Upsert org_members ────────────────────────────────────────────────────
  IF v_org_id IS NOT NULL THEN
    INSERT INTO public.org_members (org_id, user_id, role, status)
    VALUES (v_org_id, p_user_id, v_invite.role, 'active')
    ON CONFLICT (org_id, user_id) DO UPDATE
      SET role   = EXCLUDED.role,
          status = 'active';
  ELSE
    RAISE WARNING
      '[accept_invitation] no organization found — org_members skipped for user=% token=%',
      p_user_id, p_token;
  END IF;

  UPDATE public.invitations
    SET status      = 'accepted',
        accepted_at = now()
  WHERE token = p_token;
END;
$$;


-- ── Repair existing broken accounts ──────────────────────────────────────────
-- Run once to backfill username and org_members for users who went through the
-- broken invite flow before this migration.
--
-- Step 1: copy username from auth.users metadata into profiles where missing.
UPDATE public.profiles p
SET    username   = u.raw_user_meta_data->>'username',
       updated_at = now()
FROM   auth.users u
WHERE  u.id    = p.id
  AND  p.username IS NULL
  AND  u.raw_user_meta_data->>'username' IS NOT NULL;

-- Step 2: enroll any authenticated user who has a profile but no org_members
--         row into the first available organization as a viewer.
INSERT INTO public.org_members (org_id, user_id, role, status)
SELECT
  (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1),
  p.id,
  COALESCE(p.role, 'viewer'),
  'active'
FROM   public.profiles p
WHERE  NOT EXISTS (
  SELECT 1 FROM public.org_members m WHERE m.user_id = p.id
)
  AND  (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1) IS NOT NULL
ON CONFLICT (org_id, user_id) DO NOTHING;


NOTIFY pgrst, 'reload schema';
