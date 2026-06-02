-- ============================================================
-- Fix: accept_invitation() fails for users with an existing profile.
--
-- Two problems addressed:
--
-- 1. profiles.role UPDATE fails under RLS for non-admin existing users.
--    When SECURITY DEFINER doesn't fully bypass RLS (function owner lacks
--    bypassrls), the UPDATE profiles SET role = v_invite.role is blocked by
--    profiles_update_self WITH CHECK (which prevents self-role-escalation).
--    Fix: wrap the UPDATE in a non-fatal exception handler — org_members.role
--    is the authoritative source for all RLS checks anyway (Phase 5+).
--
-- 2. Double-accept: user accepts, is redirected, org context doesn't refresh,
--    user tries again → invite is now 'accepted' → "already used" error.
--    Fix: if the invite is already accepted AND the user is already an org
--    member, return success silently (idempotent).
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

  -- Lock the invite row for update.
  SELECT * INTO v_invite
  FROM   public.invitations
  WHERE  token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired invitation';
  END IF;

  -- Resolve org_id: invite field → slug 'primary' → any org.
  v_org_id := v_invite.org_id;
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'primary' LIMIT 1;
  END IF;
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
  END IF;

  -- Idempotency: if already accepted and user is already a member, succeed.
  IF v_invite.status = 'accepted' THEN
    IF v_org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id = v_org_id AND user_id = p_user_id AND status = 'active'
    ) THEN
      RETURN; -- already a member — treat as success
    END IF;
    RAISE EXCEPTION 'This invitation has already been used';
  END IF;

  IF v_invite.status = 'expired' OR (v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now()) THEN
    RAISE EXCEPTION 'This invitation has expired';
  END IF;

  IF v_invite.status != 'pending' THEN
    RAISE EXCEPTION 'Invalid invitation';
  END IF;

  -- Verify the accepting user's email matches the invite email.
  IF lower(v_invite.email) != lower((SELECT email FROM auth.users WHERE id = p_user_id)) THEN
    RAISE EXCEPTION 'This invitation is for a different email address';
  END IF;

  -- Guarantee profile row exists; fill username from auth metadata (COALESCE never clobbers).
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, username)
    SELECT p_user_id,
           u.email,
           u.raw_user_meta_data->>'full_name',
           u.raw_user_meta_data->>'username'
    FROM   auth.users u
    WHERE  u.id = p_user_id
    ON CONFLICT (id) DO UPDATE
      SET full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
          username  = COALESCE(EXCLUDED.username,  profiles.username);
  EXCEPTION
    WHEN unique_violation THEN
      RAISE WARNING '[accept_invitation] username conflict for user=% — upserting without username', p_user_id;
      INSERT INTO public.profiles (id, email, full_name)
      SELECT p_user_id, u.email, u.raw_user_meta_data->>'full_name'
      FROM   auth.users u
      WHERE  u.id = p_user_id
      ON CONFLICT (id) DO UPDATE
        SET full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);
  END;

  -- Sync profiles.role for backward-compat with legacy code reading it.
  -- Non-fatal: org_members.role is the authoritative source for RLS checks.
  -- The UPDATE can be blocked by profiles_update_self RLS for non-admin
  -- existing users; wrapping it ensures the rest of the accept still succeeds.
  BEGIN
    UPDATE public.profiles
      SET role       = v_invite.role,
          updated_at = now()
    WHERE id = p_user_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[accept_invitation] profiles.role update failed (non-fatal) user=% sqlstate=% err=%',
      p_user_id, SQLSTATE, SQLERRM;
  END;

  -- Upsert org_members — sole authoritative role source for RLS checks.
  IF v_org_id IS NOT NULL THEN
    INSERT INTO public.org_members (org_id, user_id, role, status)
    VALUES (v_org_id, p_user_id, v_invite.role, 'active')
    ON CONFLICT (org_id, user_id) DO UPDATE
      SET role   = EXCLUDED.role,
          status = 'active';
  ELSE
    RAISE WARNING '[accept_invitation] no organization found — org_members skipped for user=% token=%',
      p_user_id, p_token;
  END IF;

  UPDATE public.invitations
    SET status      = 'accepted',
        accepted_at = now()
  WHERE token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(uuid)  TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
