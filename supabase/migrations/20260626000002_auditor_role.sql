-- ============================================================
-- Auditor role: read-only access to ledger + write access to
-- audit_sessions and audit_findings only.
-- Sits between viewer (read-only) and accountant (full write).
-- Idempotent: safe to re-run.
-- ============================================================

-- ── 1. Extend role CHECK constraints ─────────────────────────────────────────

ALTER TABLE public.org_members
  DROP CONSTRAINT IF EXISTS org_members_role_check;
ALTER TABLE public.org_members
  ADD CONSTRAINT org_members_role_check
    CHECK (role IN ('owner', 'admin', 'accountant', 'auditor', 'viewer'));

ALTER TABLE public.invitations
  DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_role_check
    CHECK (role IN ('owner', 'admin', 'accountant', 'auditor', 'viewer'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('owner', 'admin', 'accountant', 'auditor', 'viewer'));

-- ── 2. New helper function ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_auditor()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = auth.uid()
      AND role    = 'auditor'
      AND status  = 'active'
  );
$$;

-- ── 3. Update audit_sessions RLS ─────────────────────────────────────────────
-- Auditors may create, read, and update sessions (not delete — admin only).

DROP POLICY IF EXISTS "audit_sessions_insert" ON public.audit_sessions;
DROP POLICY IF EXISTS "audit_sessions_update" ON public.audit_sessions;

CREATE POLICY "audit_sessions_insert" ON public.audit_sessions
  FOR INSERT WITH CHECK (is_finance_user() OR is_auditor());

CREATE POLICY "audit_sessions_update" ON public.audit_sessions
  FOR UPDATE USING (is_finance_user() OR is_auditor());

-- ── 4. Update audit_findings RLS ─────────────────────────────────────────────
-- Auditors may insert, update, and delete findings.

DROP POLICY IF EXISTS "audit_findings_insert" ON public.audit_findings;
DROP POLICY IF EXISTS "audit_findings_update" ON public.audit_findings;
DROP POLICY IF EXISTS "audit_findings_delete" ON public.audit_findings;

CREATE POLICY "audit_findings_insert" ON public.audit_findings
  FOR INSERT WITH CHECK (is_finance_user() OR is_auditor());

CREATE POLICY "audit_findings_update" ON public.audit_findings
  FOR UPDATE USING (is_finance_user() OR is_auditor());

CREATE POLICY "audit_findings_delete" ON public.audit_findings
  FOR DELETE USING (is_finance_user() OR is_auditor());

-- ── 5. Update update_org_member_role() to accept 'auditor' ───────────────────

CREATE OR REPLACE FUNCTION public.update_org_member_role(
  p_member_id uuid,
  p_new_role  text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_member        public.org_members;
  v_caller_role   text;
  v_owner_count   int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF p_new_role NOT IN ('owner', 'admin', 'accountant', 'auditor', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: %', p_new_role;
  END IF;

  SELECT * INTO v_member FROM public.org_members WHERE id = p_member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;

  SELECT role INTO v_caller_role
  FROM public.org_members
  WHERE org_id = v_member.org_id AND user_id = auth.uid() AND status = 'active';

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: only org owners and admins can change roles';
  END IF;

  IF v_caller_role = 'admin' AND p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Only an org owner can promote members to owner';
  END IF;

  IF v_member.role = 'owner' AND p_new_role != 'owner' THEN
    SELECT COUNT(*) INTO v_owner_count
    FROM public.org_members
    WHERE org_id = v_member.org_id AND role = 'owner' AND status = 'active';

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last owner of an organisation';
    END IF;
  END IF;

  UPDATE public.org_members
    SET role   = p_new_role,
        status = status
  WHERE id = p_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_org_member_role(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
