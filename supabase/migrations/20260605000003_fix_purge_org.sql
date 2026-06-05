-- Fix purge_org:
--   C-1: dynamic_report_blocks/snapshots have no org_id; delete via parent report_id
--   C-2: audit_log.org_id has ON DELETE SET NULL — explicit delete blocked by
--        trg_audit_log_no_delete; remove the explicit DELETE and rely on FK cascade

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

  v_snap := row_to_json(v_org)::jsonb;

  v_step := 'receipts';
  DELETE FROM public.receipts                          WHERE org_id = p_org_id;

  v_step := 'transaction_allocation_snapshots';
  DELETE FROM public.transaction_allocation_snapshots  WHERE org_id = p_org_id;

  v_step := 'recalculation_logs';
  DELETE FROM public.recalculation_logs                WHERE org_id = p_org_id;

  -- C-1: blocks/snapshots have no org_id — delete via parent dynamic_reports
  v_step := 'dynamic_report_snapshots';
  DELETE FROM public.dynamic_report_snapshots
    WHERE report_id IN (SELECT id FROM public.dynamic_reports WHERE org_id = p_org_id);

  v_step := 'dynamic_report_blocks';
  DELETE FROM public.dynamic_report_blocks
    WHERE report_id IN (SELECT id FROM public.dynamic_reports WHERE org_id = p_org_id);

  v_step := 'dynamic_reports';
  DELETE FROM public.dynamic_reports                   WHERE org_id = p_org_id;

  v_step := 'report_templates';
  DELETE FROM public.report_templates                  WHERE org_id = p_org_id;

  v_step := 'project_entries';
  DELETE FROM public.project_entries                   WHERE org_id = p_org_id;

  v_step := 'special_projects';
  DELETE FROM public.special_projects                  WHERE org_id = p_org_id;

  v_step := 'fx_conversions';
  DELETE FROM public.fx_conversions                    WHERE org_id = p_org_id;

  v_step := 'fx_transactions';
  DELETE FROM public.fx_transactions                   WHERE org_id = p_org_id;

  v_step := 'intrabank_transfers';
  DELETE FROM public.intrabank_transfers               WHERE org_id = p_org_id;

  v_step := 'bank_deposits';
  DELETE FROM public.bank_deposits                     WHERE org_id = p_org_id;

  v_step := 'intra_flows';
  DELETE FROM public.intra_flows                       WHERE org_id = p_org_id;

  v_step := 'outflow_transactions';
  DELETE FROM public.outflow_transactions              WHERE org_id = p_org_id;

  v_step := 'inflow_transactions';
  DELETE FROM public.inflow_transactions               WHERE org_id = p_org_id;

  v_step := 'income_type_rules';
  DELETE FROM public.income_type_rules                 WHERE org_id = p_org_id;

  v_step := 'income_types';
  DELETE FROM public.income_types                      WHERE org_id = p_org_id;

  v_step := 'category_outflow_type_map';
  DELETE FROM public.category_outflow_type_map         WHERE org_id = p_org_id;

  v_step := 'outflow_types';
  DELETE FROM public.outflow_types                     WHERE org_id = p_org_id;

  v_step := 'allocation_configs';
  DELETE FROM public.allocation_configs                WHERE org_id = p_org_id;

  v_step := 'special_config_groups';
  DELETE FROM public.special_config_groups             WHERE org_id = p_org_id;

  v_step := 'category_opening_balances';
  DELETE FROM public.category_opening_balances         WHERE org_id = p_org_id;

  v_step := 'categories';
  DELETE FROM public.categories                        WHERE org_id = p_org_id;

  v_step := 'category_groups';
  DELETE FROM public.category_groups                   WHERE org_id = p_org_id;

  v_step := 'banks';
  DELETE FROM public.banks                             WHERE org_id = p_org_id;

  v_step := 'departments';
  DELETE FROM public.departments                       WHERE org_id = p_org_id;

  v_step := 'invitations';
  DELETE FROM public.invitations                       WHERE org_id = p_org_id;

  v_step := 'org_deletion_backups';
  DELETE FROM public.org_deletion_backups              WHERE org_id = p_org_id;

  -- C-2: audit_log.org_id has ON DELETE SET NULL — the FK cascade nullifies
  -- org_id when the organizations row is deleted below. An explicit DELETE is
  -- blocked by trg_audit_log_no_delete and is unnecessary.

  v_step := 'org_members';
  DELETE FROM public.org_members                       WHERE org_id = p_org_id;

  v_step := 'organizations';
  DELETE FROM public.organizations                     WHERE id    = p_org_id;

  -- Final audit entry (no org_id — org no longer exists)
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
