-- ============================================================
-- Fix: accept_invitation() LIMIT 1 org fallback causes new users to be
-- silently assigned to an arbitrary existing org when the invite has
-- org_id = NULL and no org has slug = 'primary'.
--
-- Change: replace the LIMIT 1 fallback with a hard RAISE EXCEPTION so
-- the acceptance fails loudly rather than joining the wrong org.
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

  -- Resolve org_id: invite field → slug 'primary' → hard error.
  -- The LIMIT 1 (any org) fallback has been removed: silently joining
  -- a random org causes data from other tenants to appear for the new user.
  v_org_id := v_invite.org_id;
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'primary' LIMIT 1;
  END IF;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve organisation for this invitation. Ask an administrator to re-send the invite.';
  END IF;

  -- Idempotency: if already accepted and user is already a member, succeed.
  IF v_invite.status = 'accepted' THEN
    IF EXISTS (
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
  INSERT INTO public.org_members (org_id, user_id, role, status)
  VALUES (v_org_id, p_user_id, v_invite.role, 'active')
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET role   = EXCLUDED.role,
        status = 'active';

  UPDATE public.invitations
    SET status      = 'accepted',
        accepted_at = now()
  WHERE token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid, uuid) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
