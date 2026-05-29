-- ============================================================
-- PHASE 5: ORG-BASED INVITE SYSTEM
-- Idempotent — safe to re-run.
-- Prerequisites: Phase 1 (multi_tenant_foundation) + Phase 2 (org_backfill)
--               + Phase 3 (tenant_isolation_rls) applied.
--
-- WHAT THIS MIGRATION DOES
-- 1. Locks invitations RLS to org-admin scope (replaces global is_admin gate).
-- 2. Replaces accept_invitation with a null-org fallback for backward compat.
-- 3. Adds idx_invitations_org index.
--
-- AFFECTED FILES (frontend)
-- - src/pages/UserManagement.tsx  — reads org_members (not profiles.role)
--                                   writes org_members.role on role change/revoke
-- - src/pages/AcceptInvite.tsx    — handles existing-user sign-in flow
-- - src/pages/Setup.tsx           — MIGRATION_SQL updated with Phase 5 block
--
-- REMAINING TECHNICAL DEBT (Phase 6)
-- - accept_invitation still writes profiles.role for backward compat.
--   Remove that UPDATE once all consumers read from org_members exclusively.
-- - profiles.role column can be dropped once confirmed unused.
-- - InviteUserModal restricts invitable roles to accountant/viewer.
--   Admin invites require direct DB insert — deliberate security choice.
-- - Multi-org: fetchOrgMembership (useAuth.ts) returns the first active org.
--   A user selector UI is needed if one user belongs to multiple orgs.
-- ============================================================


-- ── 1. Updated invitations RLS ────────────────────────────────────────────────
-- Gate on org admin (is_org_admin) instead of global admin (is_admin).
-- Token reads are still exclusively via get_invitation_by_token() SECURITY DEFINER.

DROP POLICY IF EXISTS "invitations_admin_all"  ON public.invitations;
DROP POLICY IF EXISTS "invitations_select"     ON public.invitations;
DROP POLICY IF EXISTS "invitations_insert"     ON public.invitations;
DROP POLICY IF EXISTS "invitations_update"     ON public.invitations;
DROP POLICY IF EXISTS "invitations_delete"     ON public.invitations;

CREATE POLICY "invitations_select" ON public.invitations
  FOR SELECT USING (public.is_org_admin(org_id));

CREATE POLICY "invitations_insert" ON public.invitations
  FOR INSERT WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY "invitations_update" ON public.invitations
  FOR UPDATE USING (public.is_org_admin(org_id));

CREATE POLICY "invitations_delete" ON public.invitations
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── 2. Updated get_invitation_by_token ───────────────────────────────────────
-- Unchanged from Phase 3 — idempotent via CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token uuid)
RETURNS TABLE(id uuid, email text, role text, status text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  RETURN QUERY
    SELECT i.id, i.email, i.role, i.status, i.expires_at
    FROM   public.invitations i
    WHERE  i.token      = p_token
      AND  i.status     = 'pending'
      AND  i.expires_at > now();
END;
$$;


-- ── 3. Updated accept_invitation ─────────────────────────────────────────────
-- Falls back to primary org when invite.org_id IS NULL (pre-Phase 5 invites).
-- Keeps profiles.role in sync for backward compat (remove in Phase 6).

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


-- ── 4. Index ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_invitations_org ON public.invitations(org_id);

NOTIFY pgrst, 'reload schema';
