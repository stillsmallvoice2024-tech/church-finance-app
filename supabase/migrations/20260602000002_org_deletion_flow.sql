-- ============================================================
-- Organisation Deletion Flow
-- Adds soft-delete lifecycle, backup tracking, lock trigger,
-- and RPCs for request / restore / purge operations.
-- Idempotent: safe to re-run.
-- ============================================================

-- ── 1. Add deletion columns to organizations ──────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending_deletion')),
  ADD COLUMN IF NOT EXISTS deleted_at            timestamptz,
  ADD COLUMN IF NOT EXISTS purge_at              timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_backup_path  text;

CREATE INDEX IF NOT EXISTS idx_organizations_status   ON public.organizations(status);
CREATE INDEX IF NOT EXISTS idx_organizations_purge_at ON public.organizations(purge_at);

-- ── 2. Add org_id to audit_log for deletion-event tracking ───────────────────

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_org_id ON public.audit_log(org_id);

-- ── 3. Org deletion backups table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.org_deletion_backups (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by       uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  backup_path      text        NOT NULL,
  file_size_bytes  bigint,
  status           text        NOT NULL DEFAULT 'available'
                               CHECK (status IN ('generating', 'available', 'expired', 'failed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_org_del_backups_org    ON public.org_deletion_backups(org_id);
CREATE INDEX IF NOT EXISTS idx_org_del_backups_exp    ON public.org_deletion_backups(expires_at);

ALTER TABLE public.org_deletion_backups ENABLE ROW LEVEL SECURITY;

-- Owner can read their org's deletion backups
DROP POLICY IF EXISTS "del_backup_owner_select" ON public.org_deletion_backups;
CREATE POLICY "del_backup_owner_select" ON public.org_deletion_backups
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id  = org_deletion_backups.org_id
        AND user_id = auth.uid()
        AND role    = 'owner'
        AND status  = 'active'
    )
  );

-- SECURITY DEFINER RPCs perform inserts; block all direct client inserts
DROP POLICY IF EXISTS "del_backup_rpc_insert" ON public.org_deletion_backups;
CREATE POLICY "del_backup_rpc_insert" ON public.org_deletion_backups
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "del_backup_owner_delete" ON public.org_deletion_backups;
CREATE POLICY "del_backup_owner_delete" ON public.org_deletion_backups
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id  = org_deletion_backups.org_id
        AND user_id = auth.uid()
        AND role    = 'owner'
        AND status  = 'active'
    )
  );

-- ── 4. Helper: check if caller is org owner ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_org_owner(p_org_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = auth.uid()
      AND role    = 'owner'
      AND status  = 'active'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid) TO authenticated;

-- ── 5. Lock trigger: block writes when org is pending_deletion ────────────────

CREATE OR REPLACE FUNCTION public.check_org_not_locked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only check rows that have an org_id set; legacy null-org rows are unscoped
  IF NEW.org_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = NEW.org_id AND status != 'active'
  ) THEN
    RAISE EXCEPTION 'Organisation is locked pending deletion — no edits are permitted.';
  END IF;

  RETURN NEW;
END;
$$;

-- Apply to all org-scoped business tables (idempotent via DROP IF EXISTS)
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'inflow_transactions',
    'outflow_transactions',
    'intra_flows',
    'bank_deposits',
    'intrabank_transfers',
    'fx_transactions',
    'fx_conversions',
    'banks',
    'categories',
    'category_groups',
    'category_opening_balances',
    'category_outflow_type_map',
    'allocation_configs',
    'income_types',
    'income_type_rules',
    'outflow_types',
    'special_config_groups',
    'transaction_allocation_snapshots',
    'recalculation_logs',
    'special_projects',
    'project_entries',
    'report_templates',
    'dynamic_reports',
    'dynamic_report_blocks',
    'dynamic_report_snapshots',
    'departments',
    'receipts'
  ]
  LOOP
    -- Skip if table doesn't exist (optional/migrated tables)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN CONTINUE;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_check_org_locked ON public.%I;
       CREATE TRIGGER trg_check_org_locked
         BEFORE INSERT OR UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.check_org_not_locked();',
      tbl, tbl
    );
  END LOOP;
END $$;

-- ── 6. RPC: request_org_deletion ─────────────────────────────────────────────
-- Called by the organisation owner via the deletion modal.
-- Verifies ownership and name confirmation, then marks org as pending_deletion.
-- Returns: { ok, org_id, org_name, deleted_at, purge_at }

DROP FUNCTION IF EXISTS public.request_org_deletion(uuid, text);
CREATE OR REPLACE FUNCTION public.request_org_deletion(
  p_org_id          uuid,
  p_org_name_confirm text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_org      record;
  v_purge_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation not found';
  END IF;

  -- Ownership check
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = v_user_id
      AND role    = 'owner'
      AND status  = 'active'
  ) THEN
    RAISE EXCEPTION 'Only the organisation owner can request deletion';
  END IF;

  -- Name confirmation
  IF v_org.name IS DISTINCT FROM p_org_name_confirm THEN
    RAISE EXCEPTION 'Organisation name confirmation does not match';
  END IF;

  IF v_org.status = 'pending_deletion' THEN
    RAISE EXCEPTION 'Organisation is already pending deletion';
  END IF;

  v_purge_at := now() + interval '30 days';

  UPDATE public.organizations
  SET
    status                 = 'pending_deletion',
    deleted_at             = now(),
    purge_at               = v_purge_at,
    deletion_requested_by  = v_user_id
  WHERE id = p_org_id;

  -- Immutable audit entry
  INSERT INTO public.audit_log (
    org_id, table_name, record_id, action, old_data, new_data, user_id, created_at
  ) VALUES (
    p_org_id,
    'organizations',
    p_org_id,
    'DELETION_REQUESTED',
    jsonb_build_object('status', 'active'),
    jsonb_build_object(
      'status',     'pending_deletion',
      'deleted_at', now(),
      'purge_at',   v_purge_at
    ),
    v_user_id,
    now()
  );

  RETURN jsonb_build_object(
    'ok',         true,
    'org_id',     p_org_id,
    'org_name',   v_org.name,
    'deleted_at', now(),
    'purge_at',   v_purge_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_org_deletion(uuid, text) TO authenticated;

-- ── 7. RPC: record_deletion_backup ───────────────────────────────────────────
-- Called by the frontend after uploading a deletion backup to storage.
-- Only the org owner can call this while org is pending_deletion.

DROP FUNCTION IF EXISTS public.record_deletion_backup(uuid, text, bigint);
CREATE OR REPLACE FUNCTION public.record_deletion_backup(
  p_org_id    uuid,
  p_path      text,
  p_file_size bigint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org     record;
  v_id      uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = v_user_id
      AND role    = 'owner'
      AND status  = 'active'
  ) THEN
    RAISE EXCEPTION 'Only the organisation owner can record a deletion backup';
  END IF;

  -- Store backup reference; expires when org would be purged
  INSERT INTO public.org_deletion_backups (
    org_id, created_by, backup_path, file_size_bytes, status, expires_at
  ) VALUES (
    p_org_id,
    v_user_id,
    p_path,
    p_file_size,
    'available',
    COALESCE(v_org.purge_at, now() + interval '30 days')
  )
  RETURNING id INTO v_id;

  -- Store path on org record for quick access
  UPDATE public.organizations
  SET deletion_backup_path = p_path
  WHERE id = p_org_id;

  RETURN jsonb_build_object('ok', true, 'backup_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_deletion_backup(uuid, text, bigint) TO authenticated;

-- ── 8. RPC: restore_org ──────────────────────────────────────────────────────
-- Reverts org from pending_deletion → active.
-- Only the owner can call this before purge_at.

DROP FUNCTION IF EXISTS public.restore_org(uuid);
CREATE OR REPLACE FUNCTION public.restore_org(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org     record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = v_user_id
      AND role    = 'owner'
      AND status  = 'active'
  ) THEN
    RAISE EXCEPTION 'Only the organisation owner can restore a pending deletion';
  END IF;

  IF v_org.status != 'pending_deletion' THEN
    RAISE EXCEPTION 'Organisation is not in pending_deletion status';
  END IF;

  IF v_org.purge_at IS NOT NULL AND v_org.purge_at < now() THEN
    RAISE EXCEPTION 'Purge window has passed — this organisation can no longer be restored';
  END IF;

  UPDATE public.organizations
  SET
    status                = 'active',
    deleted_at            = NULL,
    purge_at              = NULL,
    deletion_requested_by = NULL,
    deletion_backup_path  = NULL
  WHERE id = p_org_id;

  -- Immutable audit entry
  INSERT INTO public.audit_log (
    org_id, table_name, record_id, action, old_data, new_data, user_id, created_at
  ) VALUES (
    p_org_id,
    'organizations',
    p_org_id,
    'DELETION_RESTORED',
    jsonb_build_object('status', 'pending_deletion', 'deleted_at', v_org.deleted_at),
    jsonb_build_object('status', 'active'),
    v_user_id,
    now()
  );

  RETURN jsonb_build_object('ok', true, 'org_id', p_org_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_org(uuid) TO authenticated;

-- ── 9. RPC: purge_org ────────────────────────────────────────────────────────
-- Permanently deletes all org data in correct dependency order.
-- Designed to be called by service-role Edge Function after purge_at.
-- Verifies purge_at has passed before proceeding.
-- Returns: { ok, org_id, purged_at } or { ok: false, error, step }

DROP FUNCTION IF EXISTS public.purge_org(uuid);
CREATE OR REPLACE FUNCTION public.purge_org(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org     record;
  v_step    text := 'init';
  v_snap    jsonb;
BEGIN
  -- Only callable by service role (auth.uid() is NULL for service_role JWT)
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

  -- Snapshot org record before permanent removal (for the final audit entry)
  v_snap := row_to_json(v_org)::jsonb;

  -- Delete in reverse dependency order (children before parents)
  -- Tables with ON DELETE CASCADE from organizations are auto-deleted; explicit
  -- deletes ensure correct ordering and that triggers do not interfere.

  v_step := 'receipts';
  DELETE FROM public.receipts                       WHERE org_id = p_org_id;

  v_step := 'transaction_allocation_snapshots';
  DELETE FROM public.transaction_allocation_snapshots WHERE org_id = p_org_id;

  v_step := 'recalculation_logs';
  DELETE FROM public.recalculation_logs             WHERE org_id = p_org_id;

  -- blocks/snapshots have no org_id — delete via parent dynamic_reports
  v_step := 'dynamic_report_snapshots';
  DELETE FROM public.dynamic_report_snapshots
    WHERE report_id IN (SELECT id FROM public.dynamic_reports WHERE org_id = p_org_id);

  v_step := 'dynamic_report_blocks';
  DELETE FROM public.dynamic_report_blocks
    WHERE report_id IN (SELECT id FROM public.dynamic_reports WHERE org_id = p_org_id);

  v_step := 'dynamic_reports';
  DELETE FROM public.dynamic_reports                WHERE org_id = p_org_id;

  v_step := 'report_templates';
  DELETE FROM public.report_templates               WHERE org_id = p_org_id;

  v_step := 'project_entries';
  DELETE FROM public.project_entries                WHERE org_id = p_org_id;

  v_step := 'special_projects';
  DELETE FROM public.special_projects               WHERE org_id = p_org_id;

  v_step := 'fx_conversions';
  DELETE FROM public.fx_conversions                 WHERE org_id = p_org_id;

  v_step := 'fx_transactions';
  DELETE FROM public.fx_transactions                WHERE org_id = p_org_id;

  v_step := 'intrabank_transfers';
  DELETE FROM public.intrabank_transfers            WHERE org_id = p_org_id;

  v_step := 'bank_deposits';
  DELETE FROM public.bank_deposits                  WHERE org_id = p_org_id;

  v_step := 'intra_flows';
  DELETE FROM public.intra_flows                    WHERE org_id = p_org_id;

  v_step := 'outflow_transactions';
  DELETE FROM public.outflow_transactions           WHERE org_id = p_org_id;

  v_step := 'inflow_transactions';
  DELETE FROM public.inflow_transactions            WHERE org_id = p_org_id;

  v_step := 'income_type_rules';
  DELETE FROM public.income_type_rules              WHERE org_id = p_org_id;

  v_step := 'income_types';
  DELETE FROM public.income_types                   WHERE org_id = p_org_id;

  v_step := 'category_outflow_type_map';
  DELETE FROM public.category_outflow_type_map      WHERE org_id = p_org_id;

  v_step := 'outflow_types';
  DELETE FROM public.outflow_types                  WHERE org_id = p_org_id;

  v_step := 'allocation_configs';
  DELETE FROM public.allocation_configs             WHERE org_id = p_org_id;

  v_step := 'special_config_groups';
  DELETE FROM public.special_config_groups          WHERE org_id = p_org_id;

  v_step := 'category_opening_balances';
  DELETE FROM public.category_opening_balances      WHERE org_id = p_org_id;

  v_step := 'categories';
  DELETE FROM public.categories                     WHERE org_id = p_org_id;

  v_step := 'category_groups';
  DELETE FROM public.category_groups                WHERE org_id = p_org_id;

  v_step := 'banks';
  DELETE FROM public.banks                          WHERE org_id = p_org_id;

  v_step := 'departments';
  DELETE FROM public.departments                    WHERE org_id = p_org_id;

  v_step := 'invitations';
  DELETE FROM public.invitations                    WHERE org_id = p_org_id;

  v_step := 'org_deletion_backups';
  DELETE FROM public.org_deletion_backups           WHERE org_id = p_org_id;

  -- audit_log.org_id has ON DELETE SET NULL — FK cascade handles nullification
  -- when organizations row is deleted below. Explicit DELETE would be blocked
  -- by trg_audit_log_no_delete.

  v_step := 'org_members';
  DELETE FROM public.org_members                    WHERE org_id = p_org_id;

  v_step := 'organizations';
  DELETE FROM public.organizations                  WHERE id = p_org_id;

  -- Final immutable audit entry (no org_id — org no longer exists)
  INSERT INTO public.audit_log (
    table_name, record_id, action, old_data, new_data, user_id, created_at
  ) VALUES (
    'organizations',
    p_org_id,
    'PURGED',
    v_snap,
    NULL,
    NULL,
    now()
  );

  RETURN jsonb_build_object(
    'ok',        true,
    'org_id',    p_org_id,
    'purged_at', now()
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok',       false,
    'error',    SQLERRM,
    'step',     v_step,
    'sqlstate', SQLSTATE
  );
END;
$$;

-- purge_org is NOT granted to authenticated — service-role only via Edge Function

-- ── 10. Update organizations RLS: owner can still read locked org ─────────────

-- Allow org owner SELECT even when pending_deletion (for restore/download UI)
DROP POLICY IF EXISTS "orgs_select" ON public.organizations;
DO $$ BEGIN
  CREATE POLICY "orgs_select" ON public.organizations
    FOR SELECT USING (public.is_org_member(id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Update must remain restricted; restore goes through SECURITY DEFINER RPC
-- (existing orgs_update policy is already permissive enough for the RPC to bypass it)

NOTIFY pgrst, 'reload schema';
