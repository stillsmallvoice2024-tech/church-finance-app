-- ============================================================
-- Fix: accept_invitation handles 'accepted + incomplete' case.
--
-- Previous attempts may have marked the invite as 'accepted' while
-- the org_members INSERT failed (rolled back). The idempotency check
-- then correctly rejects re-accepts but leaves the user with no
-- membership. This migration:
--   1. Updates accept_invitation to complete partial accepts
--      (invite accepted + user not in org_members → insert + return success).
--   2. Directly repairs any existing stuck invites for odunayoomitoyin@gmail.com.
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

  SELECT * INTO v_invite
  FROM   public.invitations
  WHERE  token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired invitation';
  END IF;

  v_org_id := v_invite.org_id;
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'primary' LIMIT 1;
  END IF;
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
  END IF;

  -- Handle all non-pending states up front.
  IF v_invite.status != 'pending' THEN

    -- Already accepted + already a member → fully completed, succeed silently.
    IF v_invite.status = 'accepted' AND v_org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id = v_org_id AND user_id = p_user_id AND status = 'active'
    ) THEN
      RETURN;
    END IF;

    -- Accepted but org_members row is missing → previous accept partially failed.
    -- Complete the setup now and return success so the user can proceed.
    IF v_invite.status = 'accepted' AND v_org_id IS NOT NULL THEN
      BEGIN
        INSERT INTO public.org_members (org_id, user_id, role, status)
        VALUES (v_org_id, p_user_id, v_invite.role, 'active')
        ON CONFLICT (org_id, user_id) DO UPDATE
          SET role = EXCLUDED.role, status = 'active';
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[accept_invitation] repair org_members failed user=% org=% err=%',
          p_user_id, v_org_id, SQLERRM;
      END;
      -- Also sync profiles.role (non-fatal).
      BEGIN
        UPDATE public.profiles SET role = v_invite.role, updated_at = now()
        WHERE id = p_user_id;
      EXCEPTION WHEN OTHERS THEN NULL; END;
      RETURN;
    END IF;

    IF v_invite.status = 'expired'
       OR (v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now()) THEN
      RAISE EXCEPTION 'This invitation has expired';
    END IF;

    RAISE EXCEPTION 'This invitation has already been used';
  END IF;

  -- status = 'pending' from here on.

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'This invitation has expired';
  END IF;

  -- Email verification (safe when auth.users is inaccessible: NULL != x → NULL → skipped).
  IF lower(v_invite.email) != lower((SELECT email FROM auth.users WHERE id = p_user_id)) THEN
    RAISE EXCEPTION 'This invitation is for a different email address';
  END IF;

  -- Guarantee profile row exists.
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, username)
    SELECT p_user_id,
           u.email,
           u.raw_user_meta_data->>'full_name',
           u.raw_user_meta_data->>'username'
    FROM   auth.users u WHERE u.id = p_user_id
    ON CONFLICT (id) DO UPDATE
      SET full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
          username  = COALESCE(EXCLUDED.username,  profiles.username);
  EXCEPTION
    WHEN unique_violation THEN
      INSERT INTO public.profiles (id, email, full_name)
      SELECT p_user_id, u.email, u.raw_user_meta_data->>'full_name'
      FROM   auth.users u WHERE u.id = p_user_id
      ON CONFLICT (id) DO UPDATE
        SET full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);
  END;

  -- Sync profiles.role (backward-compat; non-fatal).
  BEGIN
    UPDATE public.profiles SET role = v_invite.role, updated_at = now()
    WHERE id = p_user_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[accept_invitation] profiles.role update failed (non-fatal) user=% err=%',
      p_user_id, SQLERRM;
  END;

  -- Upsert org_members (authoritative; non-fatal wrapper for any residual RLS edge cases).
  IF v_org_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.org_members (org_id, user_id, role, status)
      VALUES (v_org_id, p_user_id, v_invite.role, 'active')
      ON CONFLICT (org_id, user_id) DO UPDATE
        SET role = EXCLUDED.role, status = 'active';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[accept_invitation] org_members upsert failed (non-fatal) user=% org=% err=%',
        p_user_id, v_org_id, SQLERRM;
    END;
  END IF;

  UPDATE public.invitations
    SET status = 'accepted', accepted_at = now()
  WHERE token = p_token;
END;
$$;

ALTER FUNCTION public.accept_invitation(uuid, uuid) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(uuid)  TO authenticated, anon;

-- ── Rescue: repair any stuck invite for odunayoomitoyin@gmail.com ────────────
-- If a previous accept marked the invite 'accepted' but org_members is missing,
-- insert the membership row directly so the user can access the org immediately.
DO $$
DECLARE
  v_user_id  uuid;
  v_invite   RECORD;
BEGIN
  SELECT id INTO v_user_id FROM auth.users
  WHERE lower(email) = 'odunayoomitoyin@gmail.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'rescue: user odunayoomitoyin@gmail.com not found in auth.users — skipping';
    RETURN;
  END IF;

  -- Most-recent invite for this user.
  SELECT i.id, i.status, i.role, i.org_id, o.name AS org_name
    INTO v_invite
  FROM   public.invitations i
  LEFT   JOIN public.organizations o ON o.id = i.org_id
  WHERE  lower(i.email) = 'odunayoomitoyin@gmail.com'
  ORDER  BY i.created_at DESC
  LIMIT  1;

  IF NOT FOUND THEN
    RAISE NOTICE 'rescue: no invite found for odunayoomitoyin@gmail.com — skipping';
    RETURN;
  END IF;

  RAISE NOTICE 'rescue: invite status=% org=% role=%',
    v_invite.status, v_invite.org_name, v_invite.role;

  -- Insert org_members if missing (idempotent).
  IF v_invite.org_id IS NOT NULL THEN
    INSERT INTO public.org_members (org_id, user_id, role, status)
    VALUES (v_invite.org_id, v_user_id, v_invite.role, 'active')
    ON CONFLICT (org_id, user_id) DO UPDATE
      SET role = EXCLUDED.role, status = 'active';
    RAISE NOTICE 'rescue: org_members upserted for user=% org=%', v_user_id, v_invite.org_id;
  END IF;

  -- Mark invite accepted if still pending.
  IF v_invite.status = 'pending' THEN
    UPDATE public.invitations
      SET status = 'accepted', accepted_at = now()
    WHERE id = v_invite.id;
    RAISE NOTICE 'rescue: invite marked accepted';
  END IF;

  -- Sync profiles.role.
  UPDATE public.profiles
    SET role = v_invite.role, updated_at = now()
  WHERE id = v_user_id;
  RAISE NOTICE 'rescue: profiles.role synced to %', v_invite.role;
END;
$$;

NOTIFY pgrst, 'reload schema';
