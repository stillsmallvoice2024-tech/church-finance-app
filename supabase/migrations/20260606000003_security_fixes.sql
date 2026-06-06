-- ============================================================
-- Security fixes: C2, C3, C4, C5, H1, H4, H5, H6
-- All changes are idempotent (DROP IF EXISTS / CREATE OR REPLACE).
-- ============================================================

-- ── C3: allocation_configs missing columns ────────────────────────────────────
-- is_special distinguishes special configs from regular; allocation_type and
-- total_amount drive the allocation calculation logic client-side.

ALTER TABLE public.allocation_configs
  ADD COLUMN IF NOT EXISTS is_special      boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allocation_type text,
  ADD COLUMN IF NOT EXISTS total_amount    numeric(15,2);

-- ── C5: orgs_insert must block direct client INSERTs ─────────────────────────
-- create_organization() is SECURITY DEFINER and bypasses RLS; direct INSERTs
-- from clients (anon/authenticated JWT) must be rejected.

DROP POLICY IF EXISTS "orgs_insert" ON public.organizations;
CREATE POLICY "orgs_insert" ON public.organizations
  FOR INSERT WITH CHECK (false);

-- ── H4: profiles_update_admin missing WITH CHECK ──────────────────────────────
-- Without WITH CHECK an org admin could escalate any user's role via direct UPDATE.

DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.org_members caller
      JOIN   public.org_members target
        ON   target.org_id  = caller.org_id
        AND  target.user_id = profiles.id
        AND  target.status  = 'active'
      WHERE  caller.user_id = auth.uid()
        AND  caller.role    IN ('owner', 'admin')
        AND  caller.status  = 'active'
    )
  )
  WITH CHECK (
    role = (SELECT p2.role FROM public.profiles p2 WHERE p2.id = profiles.id)
    AND EXISTS (
      SELECT 1 FROM public.org_members caller
      JOIN   public.org_members target
        ON   target.org_id  = caller.org_id
        AND  target.user_id = profiles.id
        AND  target.status  = 'active'
      WHERE  caller.user_id = auth.uid()
        AND  caller.role    IN ('owner', 'admin')
        AND  caller.status  = 'active'
    )
  );

-- ── H5: accept_invitation must check org status ───────────────────────────────
-- Prevents users joining orgs that are pending deletion or otherwise inactive.

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
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
    SELECT id INTO v_org_id
    FROM   public.organizations
    WHERE  slug = 'primary' AND status = 'active'
    LIMIT  1;
  END IF;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No active organisation found for invitation';
  END IF;

  -- Verify the target org is still active
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id AND status = 'active') THEN
    RAISE EXCEPTION 'The organisation for this invitation is no longer active';
  END IF;

  IF v_invite.status = 'accepted' THEN
    IF EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id = v_org_id AND user_id = p_user_id AND status = 'active'
    ) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'This invitation has already been used';
  END IF;

  IF v_invite.status = 'expired' OR (v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now()) THEN
    RAISE EXCEPTION 'This invitation has expired';
  END IF;

  IF v_invite.status != 'pending' THEN
    RAISE EXCEPTION 'Invalid invitation';
  END IF;

  IF lower(v_invite.email) != lower((SELECT email FROM auth.users WHERE id = p_user_id)) THEN
    RAISE EXCEPTION 'This invitation is for a different email address';
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, email, full_name, username)
    SELECT p_user_id,
           u.email,
           u.raw_user_meta_data->>'full_name',
           u.raw_user_meta_data->>'username'
    FROM   auth.users u
    WHERE  u.id = p_user_id
    ON CONFLICT (id) DO UPDATE
      SET full_name = COALESCE(excluded.full_name, profiles.full_name),
          username  = COALESCE(excluded.username,  profiles.username);
  EXCEPTION
    WHEN unique_violation THEN
      RAISE WARNING '[accept_invitation] username conflict user=% — upserting without username', p_user_id;
      INSERT INTO public.profiles (id, email, full_name)
      SELECT p_user_id, u.email, u.raw_user_meta_data->>'full_name'
      FROM   auth.users u
      WHERE  u.id = p_user_id
      ON CONFLICT (id) DO UPDATE
        SET full_name = COALESCE(excluded.full_name, profiles.full_name);
  END;

  BEGIN
    UPDATE public.profiles
      SET role       = v_invite.role,
          updated_at = now()
    WHERE id = p_user_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[accept_invitation] profiles.role update failed (non-fatal) user=% err=%', p_user_id, SQLERRM;
  END;

  INSERT INTO public.org_members (org_id, user_id, role, status)
  VALUES (v_org_id, p_user_id, v_invite.role, 'active')
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET role   = excluded.role,
        status = 'active';

  UPDATE public.invitations
    SET status      = 'accepted',
        accepted_at = now()
  WHERE token = p_token;
END;
$$;

-- ── C2: purge_old_audit_logs — scope to caller's org when authenticated ───────
-- Unauthenticated callers (pg_cron service role) still purge across all orgs.

CREATE OR REPLACE FUNCTION public.purge_old_audit_logs(
  p_retention_interval interval DEFAULT '7 years'
)
RETURNS TABLE(audit_rows_deleted bigint, field_change_rows_deleted bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audit_deleted bigint := 0;
  v_fc_deleted    bigint := 0;
  v_cutoff        timestamptz;
  v_caller_org    uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'purge_old_audit_logs: caller must be an org admin';
    END IF;
    SELECT org_id INTO v_caller_org
    FROM   public.org_members
    WHERE  user_id = auth.uid()
      AND  role IN ('owner', 'admin')
      AND  status = 'active'
    ORDER BY joined_at
    LIMIT 1;
    IF v_caller_org IS NULL THEN
      RAISE EXCEPTION 'purge_old_audit_logs: no active admin membership found for caller';
    END IF;
  END IF;

  v_cutoff := now() - p_retention_interval;
  SET LOCAL app.audit_maintenance = 'true';

  IF v_caller_org IS NOT NULL THEN
    DELETE FROM public.audit_log WHERE created_at < v_cutoff AND org_id = v_caller_org;
  ELSE
    DELETE FROM public.audit_log WHERE created_at < v_cutoff;
  END IF;
  GET DIAGNOSTICS v_audit_deleted = ROW_COUNT;

  IF v_caller_org IS NOT NULL THEN
    DELETE FROM public.field_changes WHERE changed_at < v_cutoff AND org_id = v_caller_org;
  ELSE
    DELETE FROM public.field_changes WHERE changed_at < v_cutoff;
  END IF;
  GET DIAGNOSTICS v_fc_deleted = ROW_COUNT;

  INSERT INTO public.audit_maintenance_log
    (retention_interval, audit_rows_deleted, field_change_rows_deleted, performed_by)
  VALUES
    (p_retention_interval, v_audit_deleted, v_fc_deleted, auth.uid());

  RETURN QUERY SELECT v_audit_deleted, v_fc_deleted;
END;
$$;

REVOKE ALL   ON FUNCTION public.purge_old_audit_logs(interval) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.purge_old_audit_logs(interval) TO authenticated;

-- ── C4: purge_org — audit-before-delete, no explicit audit_log DELETE ─────────
-- Errors propagate and roll back the transaction (no EXCEPTION WHEN OTHERS).

CREATE OR REPLACE FUNCTION public.purge_org(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org  record;
  v_snap jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'purge_org may only be called by the service role';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Organisation not found');
  END IF;

  IF v_org.status != 'pending_deletion' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Organisation is not pending deletion');
  END IF;

  IF v_org.purge_at IS NULL OR v_org.purge_at > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Purge window has not passed yet (purge_at = %s)', v_org.purge_at)
    );
  END IF;

  v_snap := row_to_json(v_org)::jsonb;

  -- Write audit entry BEFORE any deletions
  INSERT INTO public.audit_log (
    table_name, record_id, action, old_data, new_data, user_id, created_at
  ) VALUES (
    'organizations', p_org_id, 'PURGE_INITIATED', v_snap, NULL, NULL, now()
  );

  DELETE FROM public.receipts                          WHERE org_id = p_org_id;
  DELETE FROM public.transaction_allocation_snapshots  WHERE org_id = p_org_id;
  DELETE FROM public.recalculation_logs                WHERE org_id = p_org_id;

  DELETE FROM public.dynamic_report_snapshots
    WHERE report_id IN (SELECT id FROM public.dynamic_reports WHERE org_id = p_org_id);
  DELETE FROM public.dynamic_report_blocks
    WHERE report_id IN (SELECT id FROM public.dynamic_reports WHERE org_id = p_org_id);
  DELETE FROM public.dynamic_reports                   WHERE org_id = p_org_id;

  DELETE FROM public.report_templates                  WHERE org_id = p_org_id;
  DELETE FROM public.project_entries                   WHERE org_id = p_org_id;
  DELETE FROM public.special_projects                  WHERE org_id = p_org_id;
  DELETE FROM public.fx_conversions                    WHERE org_id = p_org_id;
  DELETE FROM public.fx_transactions                   WHERE org_id = p_org_id;
  DELETE FROM public.intrabank_transfers               WHERE org_id = p_org_id;
  DELETE FROM public.bank_deposits                     WHERE org_id = p_org_id;
  DELETE FROM public.intra_flows                       WHERE org_id = p_org_id;
  DELETE FROM public.outflow_transactions              WHERE org_id = p_org_id;
  DELETE FROM public.inflow_transactions               WHERE org_id = p_org_id;
  DELETE FROM public.income_type_rules                 WHERE org_id = p_org_id;
  DELETE FROM public.income_types                      WHERE org_id = p_org_id;
  DELETE FROM public.category_outflow_type_map         WHERE org_id = p_org_id;
  DELETE FROM public.outflow_types                     WHERE org_id = p_org_id;
  DELETE FROM public.allocation_configs                WHERE org_id = p_org_id;
  DELETE FROM public.special_config_groups             WHERE org_id = p_org_id;
  DELETE FROM public.category_opening_balances         WHERE org_id = p_org_id;
  DELETE FROM public.categories                        WHERE org_id = p_org_id;
  DELETE FROM public.category_groups                   WHERE org_id = p_org_id;
  DELETE FROM public.banks                             WHERE org_id = p_org_id;
  DELETE FROM public.departments                       WHERE org_id = p_org_id;
  DELETE FROM public.ledger_entries                    WHERE org_id = p_org_id;
  DELETE FROM public.accounts                          WHERE org_id = p_org_id;
  DELETE FROM public.invitations                       WHERE org_id = p_org_id;
  DELETE FROM public.org_deletion_backups              WHERE org_id = p_org_id;

  -- audit_log.org_id ON DELETE SET NULL: FK cascade nullifies org_id when
  -- organizations row is deleted. Explicit DELETE blocked by trg_audit_log_no_delete.

  DELETE FROM public.org_members                       WHERE org_id = p_org_id;
  DELETE FROM public.organizations                     WHERE id     = p_org_id;

  RETURN jsonb_build_object('ok', true, 'org_id', p_org_id, 'purged_at', now());
END;
$$;

-- ── H6: request_gdpr_erasure — require explicit p_org_id ─────────────────────
-- Old 2-arg signature (uuid, text) is dropped to force callers to supply org_id.
-- Prevents non-deterministic org resolution when admin belongs to multiple orgs.

DROP FUNCTION IF EXISTS public.request_gdpr_erasure(uuid, text);

CREATE OR REPLACE FUNCTION public.request_gdpr_erasure(
  p_org_id         uuid,
  p_target_user_id uuid,
  p_notes          text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audit_count bigint := 0;
  v_fc_count    bigint := 0;
  v_request_id  uuid;
  v_pii_keys    CONSTANT text[] := ARRAY[
    'email', 'full_name', 'username', 'phone', 'avatar_url'
  ];
BEGIN
  IF NOT public.is_org_admin(p_org_id) THEN
    RAISE EXCEPTION 'request_gdpr_erasure: caller must be an admin of the specified org';
  END IF;

  WITH updated AS (
    UPDATE public.audit_log
    SET
      user_id  = NULL,
      old_data = CASE WHEN old_data IS NOT NULL THEN old_data - v_pii_keys ELSE NULL END,
      new_data = CASE WHEN new_data IS NOT NULL THEN new_data - v_pii_keys ELSE NULL END
    WHERE user_id = p_target_user_id AND org_id = p_org_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_audit_count FROM updated;

  WITH updated AS (
    UPDATE public.field_changes
    SET
      user_id   = NULL,
      old_value = CASE WHEN field_name = ANY(v_pii_keys) THEN NULL ELSE old_value END,
      new_value = CASE WHEN field_name = ANY(v_pii_keys) THEN NULL ELSE new_value END
    WHERE user_id = p_target_user_id AND org_id = p_org_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_fc_count FROM updated;

  INSERT INTO public.gdpr_erasure_requests
    (org_id, requested_by, target_user_id, completed_at, notes,
     anonymized_audit_count, anonymized_field_change_count)
  VALUES
    (p_org_id, auth.uid(), p_target_user_id, now(), p_notes,
     v_audit_count, v_fc_count)
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL   ON FUNCTION public.request_gdpr_erasure(uuid, uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.request_gdpr_erasure(uuid, uuid, text) TO authenticated;

-- ── H1: create_special_config_version — atomic RPC ───────────────────────────
-- Client-side createNewVersion used two separate non-atomic calls.
-- This RPC runs both operations in a single transaction, using FOR UPDATE on
-- the group row to prevent concurrent version creation.

CREATE OR REPLACE FUNCTION public.create_special_config_version(
  p_group_id       uuid,
  p_org_id         uuid,
  p_name           text,
  p_allocation_type text,
  p_total_amount   numeric(15,2),
  p_rows           jsonb,
  p_effective_from date,
  p_status         text DEFAULT 'draft'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_covering_id   uuid;
  v_covering_from date;
  v_next_from     date;
  v_new_to        date;
  v_max_ver       integer;
  v_new_id        uuid;
BEGIN
  IF NOT public.is_org_admin(p_org_id) THEN
    RAISE EXCEPTION 'create_special_config_version: caller must be an org admin';
  END IF;

  IF p_status NOT IN ('draft', 'locked') THEN
    RAISE EXCEPTION 'create_special_config_version: invalid status %', p_status;
  END IF;

  -- Lock the group row to prevent concurrent version creation
  PERFORM id FROM public.special_config_groups
  WHERE id = p_group_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_special_config_version: group % not found in org %', p_group_id, p_org_id;
  END IF;

  -- Find covering version (the one whose date range contains p_effective_from)
  SELECT id, effective_from INTO v_covering_id, v_covering_from
  FROM   public.allocation_configs
  WHERE  config_group_id = p_group_id
    AND  org_id          = p_org_id
    AND  effective_from <= p_effective_from
    AND  (effective_to IS NULL OR effective_to >= p_effective_from)
  LIMIT  1;

  -- Find the immediately following version to determine new effective_to
  SELECT effective_from INTO v_next_from
  FROM   public.allocation_configs
  WHERE  config_group_id = p_group_id
    AND  org_id          = p_org_id
    AND  effective_from  > p_effective_from
  ORDER BY effective_from
  LIMIT  1;

  v_new_to := CASE WHEN v_next_from IS NOT NULL
                   THEN v_next_from - 1
                   ELSE NULL END;

  -- Close the covering version
  IF v_covering_id IS NOT NULL THEN
    UPDATE public.allocation_configs
    SET    effective_to = p_effective_from - 1
    WHERE  id = v_covering_id;
  END IF;

  -- Compute next version number server-side (no client-supplied race window)
  SELECT COALESCE(MAX(version_number), 0) INTO v_max_ver
  FROM   public.allocation_configs
  WHERE  config_group_id = p_group_id AND org_id = p_org_id;

  -- Insert new version
  INSERT INTO public.allocation_configs (
    name, is_special, allocation_type, total_amount, rows,
    effective_from, effective_to, version_number,
    config_group_id, start_date, status, org_id
  ) VALUES (
    p_name, true, p_allocation_type, p_total_amount, p_rows,
    p_effective_from, v_new_to, v_max_ver + 1,
    p_group_id, p_effective_from, p_status, p_org_id
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL   ON FUNCTION public.create_special_config_version(uuid,uuid,text,text,numeric,jsonb,date,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_special_config_version(uuid,uuid,text,text,numeric,jsonb,date,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
