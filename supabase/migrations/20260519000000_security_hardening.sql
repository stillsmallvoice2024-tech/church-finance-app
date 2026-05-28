-- =============================================================
-- Security Hardening Migration
-- Apply once in Supabase SQL Editor (safe to re-run: uses IF EXISTS / OR REPLACE).
-- =============================================================

-- ──────────────────────────────────────────────────────────────
-- 1.  profiles — tighten UPDATE and DELETE
-- ──────────────────────────────────────────────────────────────
-- Was: USING (auth.uid() IS NOT NULL) — any authenticated user could
-- update any row, including changing another user's role to 'admin'.

DROP POLICY IF EXISTS "profiles_update"       ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;

-- Users may only edit their own row; role is immutable via this path
-- (WITH CHECK subquery enforces new_role = existing_role).
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE
  USING  (id = auth.uid())
  WITH CHECK (
    id   = auth.uid()
    AND  role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
  );

-- Admins may update any profile, including role changes.
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE
  USING (public.is_admin());

-- Was: any authenticated user could delete any profile.
DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;
CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE USING (public.is_admin());


-- ──────────────────────────────────────────────────────────────
-- 2.  invitations — remove global anonymous read
-- ──────────────────────────────────────────────────────────────
-- Was: USING (true) — exposed all invitation rows (email, role, token)
-- to any caller including unauthenticated users; full enumeration possible.

DROP POLICY IF EXISTS "invitations_read_by_token" ON public.invitations;


-- ──────────────────────────────────────────────────────────────
-- 3.  Security-definer RPCs for the invite-acceptance flow
-- ──────────────────────────────────────────────────────────────

-- Returns minimal invite data for a PENDING non-expired token.
-- Safe for anonymous callers; filters at DB level.
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token uuid)
RETURNS TABLE(
  id         uuid,
  email      text,
  role       text,
  status     text,
  expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $$
BEGIN
  RETURN QUERY
    SELECT i.id, i.email, i.role, i.status, i.expires_at
    FROM   public.invitations i
    WHERE  i.token      = p_token
      AND  i.status     = 'pending'
      AND  i.expires_at > now();
END;
$$;

-- Atomically sets role from invite and marks it consumed.
-- Enforces p_user_id = auth.uid() to block impersonation.
CREATE OR REPLACE FUNCTION public.accept_invitation(
  p_token   uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_invite public.invitations;
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

  -- Bypasses the self-role-change lock on profiles_update_self.
  UPDATE public.profiles
    SET role       = v_invite.role,
        updated_at = now()
  WHERE id = p_user_id;

  UPDATE public.invitations
    SET status      = 'accepted',
        accepted_at = now()
  WHERE token = p_token;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- 4.  Enable RLS on tables that were missing it entirely
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.outflow_types             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_outflow_type_map ENABLE ROW LEVEL SECURITY;

-- outflow_types: read for all auth users; write/update for finance users; delete for admins.
DROP POLICY IF EXISTS "outflow_types_read"   ON public.outflow_types;
DROP POLICY IF EXISTS "outflow_types_write"  ON public.outflow_types;
DROP POLICY IF EXISTS "outflow_types_update" ON public.outflow_types;
DROP POLICY IF EXISTS "outflow_types_delete" ON public.outflow_types;
CREATE POLICY "outflow_types_read"   ON public.outflow_types FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "outflow_types_write"  ON public.outflow_types FOR INSERT WITH CHECK (public.is_finance_user());
CREATE POLICY "outflow_types_update" ON public.outflow_types FOR UPDATE USING (public.is_finance_user());
CREATE POLICY "outflow_types_delete" ON public.outflow_types FOR DELETE USING (public.is_admin());

-- category_outflow_type_map: same pattern (mapping table, no admin-only delete needed).
DROP POLICY IF EXISTS "cotm_read"  ON public.category_outflow_type_map;
DROP POLICY IF EXISTS "cotm_write" ON public.category_outflow_type_map;
DROP POLICY IF EXISTS "cotm_delete" ON public.category_outflow_type_map;
CREATE POLICY "cotm_read"  ON public.category_outflow_type_map FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "cotm_write" ON public.category_outflow_type_map FOR INSERT WITH CHECK (public.is_finance_user());
CREATE POLICY "cotm_delete" ON public.category_outflow_type_map FOR DELETE USING (public.is_finance_user());


-- ──────────────────────────────────────────────────────────────
-- 5.  Tighten dangerous DELETE policies on transaction tables
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "inflow_delete" ON public.inflow_transactions;
CREATE POLICY "inflow_delete" ON public.inflow_transactions
  FOR DELETE USING (public.is_finance_user());

DROP POLICY IF EXISTS "outflow_delete" ON public.outflow_transactions;
CREATE POLICY "outflow_delete" ON public.outflow_transactions
  FOR DELETE USING (public.is_finance_user());

DROP POLICY IF EXISTS "intraflow_delete" ON public.intra_flows;
CREATE POLICY "intraflow_delete" ON public.intra_flows
  FOR DELETE USING (public.is_finance_user());

DROP POLICY IF EXISTS "receipts_write" ON public.receipts;
CREATE POLICY "receipts_write" ON public.receipts
  FOR INSERT WITH CHECK (public.is_finance_user());

DROP POLICY IF EXISTS "receipts_delete" ON public.receipts;
CREATE POLICY "receipts_delete" ON public.receipts
  FOR DELETE USING (public.is_finance_user());


-- ──────────────────────────────────────────────────────────────
-- 6.  Fix over-permissive "any authenticated user" write policies
-- ──────────────────────────────────────────────────────────────

-- category_opening_balances
DROP POLICY IF EXISTS "cob_write"   ON public.category_opening_balances;
DROP POLICY IF EXISTS "cob_insert"  ON public.category_opening_balances;
DROP POLICY IF EXISTS "cob_update"  ON public.category_opening_balances;
DROP POLICY IF EXISTS "cob_delete"  ON public.category_opening_balances;
CREATE POLICY "cob_insert" ON public.category_opening_balances FOR INSERT WITH CHECK (public.is_finance_user());
CREATE POLICY "cob_update" ON public.category_opening_balances FOR UPDATE USING (public.is_finance_user());
CREATE POLICY "cob_delete" ON public.category_opening_balances FOR DELETE USING (public.is_admin());

-- report_templates
DROP POLICY IF EXISTS "report_templates_all"    ON public.report_templates;
DROP POLICY IF EXISTS "report_templates_write"  ON public.report_templates;
DROP POLICY IF EXISTS "report_templates_update" ON public.report_templates;
DROP POLICY IF EXISTS "report_templates_delete" ON public.report_templates;
CREATE POLICY "report_templates_write"  ON public.report_templates FOR INSERT WITH CHECK (public.is_finance_user());
CREATE POLICY "report_templates_update" ON public.report_templates FOR UPDATE USING (public.is_finance_user());
CREATE POLICY "report_templates_delete" ON public.report_templates FOR DELETE USING (public.is_admin());

-- special_config_groups — configuration data, admin only
DROP POLICY IF EXISTS "scg_write" ON public.special_config_groups;
CREATE POLICY "scg_write" ON public.special_config_groups
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- transaction_allocation_snapshots — written by import pipeline
DROP POLICY IF EXISTS "tas_write"  ON public.transaction_allocation_snapshots;
DROP POLICY IF EXISTS "tas_insert" ON public.transaction_allocation_snapshots;
DROP POLICY IF EXISTS "tas_update" ON public.transaction_allocation_snapshots;
DROP POLICY IF EXISTS "tas_delete" ON public.transaction_allocation_snapshots;
CREATE POLICY "tas_insert" ON public.transaction_allocation_snapshots FOR INSERT WITH CHECK (public.is_finance_user());
CREATE POLICY "tas_update" ON public.transaction_allocation_snapshots FOR UPDATE USING (public.is_finance_user());
CREATE POLICY "tas_delete" ON public.transaction_allocation_snapshots FOR DELETE USING (public.is_admin());

-- recalculation_logs — immutable append-only audit trail
DROP POLICY IF EXISTS "rl_write"  ON public.recalculation_logs;
DROP POLICY IF EXISTS "rl_insert" ON public.recalculation_logs;
CREATE POLICY "rl_insert" ON public.recalculation_logs
  FOR INSERT WITH CHECK (public.is_finance_user());
-- Intentionally no UPDATE or DELETE policy.

-- dynamic_reports
DROP POLICY IF EXISTS "dr_all"    ON public.dynamic_reports;
DROP POLICY IF EXISTS "dr_write"  ON public.dynamic_reports;
DROP POLICY IF EXISTS "dr_update" ON public.dynamic_reports;
DROP POLICY IF EXISTS "dr_delete" ON public.dynamic_reports;
CREATE POLICY "dr_write"  ON public.dynamic_reports FOR INSERT WITH CHECK (public.is_finance_user());
CREATE POLICY "dr_update" ON public.dynamic_reports FOR UPDATE USING (public.is_finance_user());
CREATE POLICY "dr_delete" ON public.dynamic_reports FOR DELETE USING (public.is_admin());

-- dynamic_report_blocks
DROP POLICY IF EXISTS "drb_all"    ON public.dynamic_report_blocks;
DROP POLICY IF EXISTS "drb_write"  ON public.dynamic_report_blocks;
DROP POLICY IF EXISTS "drb_update" ON public.dynamic_report_blocks;
DROP POLICY IF EXISTS "drb_delete" ON public.dynamic_report_blocks;
CREATE POLICY "drb_write"  ON public.dynamic_report_blocks FOR INSERT WITH CHECK (public.is_finance_user());
CREATE POLICY "drb_update" ON public.dynamic_report_blocks FOR UPDATE USING (public.is_finance_user());
CREATE POLICY "drb_delete" ON public.dynamic_report_blocks FOR DELETE USING (public.is_admin());

-- dynamic_report_snapshots — generated snapshots (no update semantics)
DROP POLICY IF EXISTS "drs_all"    ON public.dynamic_report_snapshots;
DROP POLICY IF EXISTS "drs_write"  ON public.dynamic_report_snapshots;
DROP POLICY IF EXISTS "drs_delete" ON public.dynamic_report_snapshots;
CREATE POLICY "drs_write"  ON public.dynamic_report_snapshots FOR INSERT WITH CHECK (public.is_finance_user());
CREATE POLICY "drs_delete" ON public.dynamic_report_snapshots FOR DELETE USING (public.is_admin());
