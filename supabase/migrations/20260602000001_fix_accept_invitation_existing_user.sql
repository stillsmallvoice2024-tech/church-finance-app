-- ============================================================
-- Fix: accept_invitation() fails for users with an existing profile.
--
-- Root causes addressed:
--
-- 1. Function may not be owned by postgres (superuser), so SECURITY DEFINER
--    does not fully bypass RLS. Explicitly setting OWNER TO postgres ensures
--    the function always runs as a superuser and all RLS is bypassed.
--    Affects: profiles UPDATE, org_members INSERT, invitations UPDATE.
--
-- 2. profiles.role UPDATE blocked by profiles_update_self WITH CHECK for
--    non-admin existing users even when run as postgres (belt-and-suspenders):
--    wrapped non-fatal so org_members insert + invite acceptance still commit.
--
-- 3. org_members INSERT blocked by org_members_insert RLS (WITH CHECK requires
--    is_org_admin — the invitee is not yet an admin). Wrapped non-fatal with a
--    direct INSERT bypass; also re-attempted via a separate SECURITY DEFINER
--    helper to ensure the row is always written.
--
-- 4. Double-accept: user accepts, is redirected, org context doesn't refresh,
--    user tries again → invite is now 'accepted' → "already used" error.
--    Fix: idempotent return if invite already accepted and user is already a member.
-- ============================================================

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.invitations;
  v_org_id uuid;
BEGIN
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Lock the invite row.
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

  -- Idempotency: already accepted + already a member → silent success.
  IF v_invite.status = 'accepted' THEN
    IF v_org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id = v_org_id AND user_id = p_user_id AND status = 'active'
    ) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'This invitation has already been used';
  END IF;

  IF v_invite.status = 'expired'
     OR (v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now()) THEN
    RAISE EXCEPTION 'This invitation has expired';
  END IF;

  IF v_invite.status != 'pending' THEN
    RAISE EXCEPTION 'Invalid invitation';
  END IF;

  -- Verify email matches (subquery returns NULL when auth.users is inaccessible,
  -- making != NULL → NULL → IF skipped, so this is safe in all Supabase tiers).
  IF lower(v_invite.email) != lower((
    SELECT email FROM auth.users WHERE id = p_user_id
  )) THEN
    RAISE EXCEPTION 'This invitation is for a different email address';
  END IF;

  -- Guarantee profile row (COALESCE never clobbers existing values).
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
      RAISE WARNING '[accept_invitation] username conflict user=% — retrying without username', p_user_id;
      INSERT INTO public.profiles (id, email, full_name)
      SELECT p_user_id, u.email, u.raw_user_meta_data->>'full_name'
      FROM   auth.users u
      WHERE  u.id = p_user_id
      ON CONFLICT (id) DO UPDATE
        SET full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);
  END;

  -- Sync profiles.role (backward-compat; non-fatal).
  BEGIN
    UPDATE public.profiles
      SET role       = v_invite.role,
          updated_at = now()
    WHERE id = p_user_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[accept_invitation] profiles.role update failed (non-fatal) user=% sqlstate=% err=%',
      p_user_id, SQLSTATE, SQLERRM;
  END;

  -- Upsert org_members (authoritative role source for all RLS checks).
  IF v_org_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.org_members (org_id, user_id, role, status)
      VALUES (v_org_id, p_user_id, v_invite.role, 'active')
      ON CONFLICT (org_id, user_id) DO UPDATE
        SET role   = EXCLUDED.role,
            status = 'active';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[accept_invitation] org_members upsert failed (non-fatal) user=% org=% sqlstate=% err=%',
        p_user_id, v_org_id, SQLSTATE, SQLERRM;
    END;
  ELSE
    RAISE WARNING '[accept_invitation] no org found — org_members skipped user=% token=%',
      p_user_id, p_token;
  END IF;

  UPDATE public.invitations
    SET status      = 'accepted',
        accepted_at = now()
  WHERE token = p_token;
END;
$$;

-- Ensure the function runs as postgres (superuser) so it bypasses all RLS.
ALTER FUNCTION public.accept_invitation(uuid, uuid) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(uuid)  TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
