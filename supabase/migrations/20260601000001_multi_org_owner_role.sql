-- ============================================================
-- Phase: Multi-org owner role
-- Adds 'owner' as a 4th role tier above 'admin'.
-- Updates helper functions, RPCs, and backfills existing data.
-- Idempotent: safe to re-run.
-- ============================================================

-- ── 1. Extend role CHECK constraints ─────────────────────────────────────────

ALTER TABLE public.org_members
  DROP CONSTRAINT IF EXISTS org_members_role_check;
ALTER TABLE public.org_members
  ADD CONSTRAINT org_members_role_check
    CHECK (role IN ('owner', 'admin', 'accountant', 'viewer'));

ALTER TABLE public.invitations
  DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_role_check
    CHECK (role IN ('owner', 'admin', 'accountant', 'viewer'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('owner', 'admin', 'accountant', 'viewer'));

-- ── 2. Update helper functions ────────────────────────────────────────────────
-- Owner inherits all admin and finance-user capabilities.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = auth.uid()
      AND role    IN ('owner', 'admin')
      AND status  = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_finance_user()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = auth.uid()
      AND role    IN ('owner', 'admin', 'accountant')
      AND status  = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = auth.uid()
      AND role    IN ('owner', 'admin')
      AND status  = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_finance_user(p_org_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = auth.uid()
      AND role    IN ('owner', 'admin', 'accountant')
      AND status  = 'active'
  );
$$;

-- ── 3. Update create_organization(): new orgs assign 'owner' role ─────────────

CREATE OR REPLACE FUNCTION public.create_organization(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_org_id   uuid;
  v_slug     text;
  v_attempt  int  := 0;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF length(trim(p_name)) = 0 THEN RAISE EXCEPTION 'Organisation name cannot be empty'; END IF;

  v_slug := lower(regexp_replace(trim(p_name), '[^a-z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' OR v_slug = 'primary' THEN v_slug := 'org'; END IF;

  LOOP
    BEGIN
      INSERT INTO public.organizations (name, slug, created_by, onboarding_complete)
      VALUES (
        trim(p_name),
        CASE WHEN v_attempt = 0 THEN v_slug ELSE v_slug || '-' || v_attempt END,
        v_user_id,
        false
      )
      RETURNING id INTO v_org_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_attempt := v_attempt + 1;
      IF v_attempt > 9 THEN RAISE EXCEPTION 'Could not generate a unique slug for: %', p_name; END IF;
    END;
  END LOOP;

  INSERT INTO public.org_members (org_id, user_id, role, status)
  VALUES (v_org_id, v_user_id, 'owner', 'active')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner', status = 'active';

  -- Remove any auto-created viewer membership on the bootstrap org
  DELETE FROM public.org_members
  WHERE  org_id  = (SELECT id FROM public.organizations WHERE slug = 'primary' LIMIT 1)
    AND  user_id = v_user_id
    AND  role    = 'viewer';

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(text) TO authenticated;

-- ── 4. Update get_invitation_by_token(): include org_name ─────────────────────

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token uuid)
RETURNS TABLE(
  id         uuid,
  email      text,
  role       text,
  org_id     uuid,
  org_name   text,
  status     text,
  expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  RETURN QUERY
    SELECT
      i.id,
      i.email,
      i.role,
      i.org_id,
      o.name AS org_name,
      i.status,
      i.expires_at
    FROM   public.invitations i
    LEFT JOIN public.organizations o ON o.id = i.org_id
    WHERE  i.token      = p_token
      AND  i.status     = 'pending'
      AND  i.expires_at > now();
END;
$$;

-- ── 5. Update accept_invitation(): handle 'owner' role ────────────────────────

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

  -- Sync profiles.role for backward-compat with any legacy code reading it.
  UPDATE public.profiles
    SET role       = v_invite.role,
        updated_at = now()
  WHERE id = p_user_id;

  -- Resolve org_id: invite field → slug 'primary' → any org.
  v_org_id := v_invite.org_id;
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'primary' LIMIT 1;
  END IF;
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
  END IF;

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

-- ── 6. New RPC: update_org_member_role ────────────────────────────────────────
-- Updates a member's role within an org. Enforces:
--   • Caller must be owner or admin of the org.
--   • Only owners can promote to 'owner'.
--   • Cannot demote the last owner.

CREATE OR REPLACE FUNCTION public.update_org_member_role(
  p_member_id uuid,  -- org_members.id
  p_new_role  text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_member        public.org_members;
  v_caller_role   text;
  v_owner_count   int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF p_new_role NOT IN ('owner', 'admin', 'accountant', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  SELECT * INTO v_member FROM public.org_members WHERE id = p_member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;

  -- Caller's role in this org
  SELECT role INTO v_caller_role
  FROM public.org_members
  WHERE org_id = v_member.org_id AND user_id = auth.uid() AND status = 'active';

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: only org owners and admins can change roles';
  END IF;

  -- Admins cannot promote to owner
  IF v_caller_role = 'admin' AND p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Only an org owner can promote members to owner';
  END IF;

  -- Cannot demote/remove the last owner
  IF v_member.role = 'owner' AND p_new_role != 'owner' THEN
    SELECT COUNT(*) INTO v_owner_count
    FROM public.org_members
    WHERE org_id = v_member.org_id AND role = 'owner' AND status = 'active';

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last owner of an organisation';
    END IF;
  END IF;

  UPDATE public.org_members
    SET role       = p_new_role,
        -- joined_at unchanged — only role changes
        status     = status  -- preserve
  WHERE id = p_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_org_member_role(uuid, text) TO authenticated;

-- ── 7. New RPC: remove_org_member ────────────────────────────────────────────
-- Removes a member from an org. Enforces:
--   • Caller must be owner or admin.
--   • Cannot remove self if last owner.
--   • Cannot remove the last owner.

CREATE OR REPLACE FUNCTION public.remove_org_member(
  p_member_id uuid  -- org_members.id
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_member      public.org_members;
  v_caller_role text;
  v_owner_count int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_member FROM public.org_members WHERE id = p_member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;

  -- Caller's role in this org
  SELECT role INTO v_caller_role
  FROM public.org_members
  WHERE org_id = v_member.org_id AND user_id = auth.uid() AND status = 'active';

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: only org owners and admins can remove members';
  END IF;

  -- Cannot remove last owner
  IF v_member.role = 'owner' THEN
    SELECT COUNT(*) INTO v_owner_count
    FROM public.org_members
    WHERE org_id = v_member.org_id AND role = 'owner' AND status = 'active';

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last owner of an organisation';
    END IF;
  END IF;

  DELETE FROM public.org_members WHERE id = p_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_org_member(uuid) TO authenticated;

-- ── 8. New RPC: transfer_org_ownership ───────────────────────────────────────
-- Promotes a member to owner (caller retains their role).
-- Only existing owners may call this.

CREATE OR REPLACE FUNCTION public.transfer_org_ownership(
  p_org_id        uuid,
  p_target_user_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller_role text;
  v_target      public.org_members;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT role INTO v_caller_role
  FROM public.org_members
  WHERE org_id = p_org_id AND user_id = auth.uid() AND status = 'active';

  IF v_caller_role != 'owner' THEN
    RAISE EXCEPTION 'Unauthorized: only an org owner can transfer ownership';
  END IF;

  SELECT * INTO v_target
  FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_target_user_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user is not an active member of this organisation';
  END IF;

  UPDATE public.org_members
    SET role = 'owner'
  WHERE org_id = p_org_id AND user_id = p_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_org_ownership(uuid, uuid) TO authenticated;

-- ── 9. Data migration: promote org creators to 'owner' ───────────────────────
-- Any existing admin who created the org becomes owner.
UPDATE public.org_members om
SET role = 'owner'
FROM public.organizations o
WHERE om.org_id  = o.id
  AND om.user_id = o.created_by
  AND om.role    = 'admin'
  AND om.status  = 'active';

-- Fallback: if an org still has no owner (created_by was null or member left),
-- promote all its admins to owner.
UPDATE public.org_members
SET role = 'owner'
WHERE role   = 'admin'
  AND status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.org_members o2
    WHERE o2.org_id = org_members.org_id AND o2.role = 'owner'
  );

NOTIFY pgrst, 'reload schema';
