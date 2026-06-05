-- ============================================================
-- N-3: Audit log growth — retention & metadata field exclusion
--
-- Changes:
--   1. field_changes_trigger_fn: skip metadata-only fields
--      (updated_at, created_at, recorded_at, recalculated_at,
--       sent_at, snapshot_at, changed_at) — eliminates junk rows
--      generated on every touch-update (bulk recalculations etc.)
--   2. audit_log_no_delete_fn: allow bypass via transaction-local
--      session variable `app.audit_maintenance = 'true'` so the
--      maintenance function can prune expired rows without granting
--      blanket delete rights.
--   3. audit_maintenance_log: records every purge run for traceability.
--   4. purge_old_audit_logs(): SECURITY DEFINER maintenance function.
--      Callable by org admins and by pg_cron (service role).
--      Default retention: 7 years (configurable via parameter).
--   5. pg_cron schedule (guarded: skipped if extension not present).
--
-- Idempotent: all DDL uses CREATE OR REPLACE / CREATE TABLE IF NOT EXISTS.
-- Rollback: DROP FUNCTION purge_old_audit_logs; DROP TABLE audit_maintenance_log;
--   then restore previous field_changes_trigger_fn and audit_log_no_delete_fn
--   bodies from 20260605000001 / 20260605000002.
-- ============================================================

-- ── 1. field_changes_trigger_fn: skip metadata fields ────────────────────────
-- Prevents noise rows for columns that change on every UPDATE but carry
-- no meaningful business change (timestamps, auto-maintained metadata).

CREATE OR REPLACE FUNCTION public.field_changes_trigger_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid;
  v_org_id    uuid;
  v_record_id text;
  v_old_json  jsonb;
  v_new_json  jsonb;
  v_key       text;
  -- Metadata-only fields: never meaningful to diff per field
  v_skip      CONSTANT text[] := ARRAY[
    'updated_at', 'created_at', 'recorded_at',
    'recalculated_at', 'sent_at', 'snapshot_at', 'changed_at'
  ];
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;

  v_user_id   := auth.uid();
  v_old_json  := row_to_json(OLD)::jsonb;
  v_new_json  := row_to_json(NEW)::jsonb;
  v_record_id := v_new_json->>'id';
  BEGIN v_org_id := (v_new_json->>'org_id')::uuid; EXCEPTION WHEN OTHERS THEN v_org_id := NULL; END;

  FOR v_key IN SELECT key FROM jsonb_object_keys(v_new_json) AS key LOOP
    CONTINUE WHEN v_key = ANY(v_skip);
    IF (v_old_json->>v_key) IS DISTINCT FROM (v_new_json->>v_key) THEN
      INSERT INTO public.field_changes (user_id, table_name, record_id, field_name, old_value, new_value, org_id)
      VALUES (v_user_id, TG_TABLE_NAME, v_record_id, v_key, v_old_json->>v_key, v_new_json->>v_key, v_org_id);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── 2. audit_log_no_delete_fn: maintenance bypass ────────────────────────────
-- purge_old_audit_logs() sets app.audit_maintenance = 'true' (transaction-local)
-- before executing the DELETE. The trigger allows the delete only for that
-- transaction; the variable reverts automatically when the transaction ends.
-- Direct DELETEs from clients still raise the exception because the variable
-- is not set in their sessions.

CREATE OR REPLACE FUNCTION public.audit_log_no_delete_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.audit_maintenance', true) = 'true' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log rows cannot be deleted';
END;
$$;

-- ── 3. audit_maintenance_log ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_maintenance_log (
  id                        uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  run_at                    timestamptz DEFAULT now() NOT NULL,
  retention_interval        interval    NOT NULL,
  audit_rows_deleted        bigint      NOT NULL DEFAULT 0,
  field_change_rows_deleted bigint      NOT NULL DEFAULT 0,
  performed_by              uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.audit_maintenance_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aml_admin_read" ON public.audit_maintenance_log;
CREATE POLICY "aml_admin_read" ON public.audit_maintenance_log
  FOR SELECT USING (public.is_admin());

-- ── 4. purge_old_audit_logs() ─────────────────────────────────────────────────
-- Deletes audit_log and field_changes rows older than p_retention_interval.
-- Uses SET LOCAL to enable the immutability-trigger bypass for this transaction
-- only. Logs a summary row to audit_maintenance_log.
--
-- Callable by:
--   - pg_cron (service role, auth.uid() = NULL) — no admin check applied
--   - Authenticated org admins via RPC
--
-- Example manual call:
--   SELECT * FROM public.purge_old_audit_logs('7 years');

CREATE OR REPLACE FUNCTION public.purge_old_audit_logs(
  p_retention_interval interval DEFAULT '7 years'
)
RETURNS TABLE(audit_rows_deleted bigint, field_change_rows_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audit_deleted bigint := 0;
  v_fc_deleted    bigint := 0;
  v_cutoff        timestamptz;
BEGIN
  -- Authenticated callers must be org admins; service role (pg_cron) has uid = NULL
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'purge_old_audit_logs: caller must be an org admin';
  END IF;

  v_cutoff := now() - p_retention_interval;

  -- Authorise this transaction to bypass the audit_log immutability trigger
  SET LOCAL app.audit_maintenance = 'true';

  DELETE FROM public.audit_log WHERE created_at < v_cutoff;
  GET DIAGNOSTICS v_audit_deleted = ROW_COUNT;

  DELETE FROM public.field_changes WHERE changed_at < v_cutoff;
  GET DIAGNOSTICS v_fc_deleted = ROW_COUNT;

  INSERT INTO public.audit_maintenance_log
    (retention_interval, audit_rows_deleted, field_change_rows_deleted, performed_by)
  VALUES
    (p_retention_interval, v_audit_deleted, v_fc_deleted, auth.uid());

  RETURN QUERY SELECT v_audit_deleted, v_fc_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_audit_logs(interval) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.purge_old_audit_logs(interval) TO authenticated;

-- ── 5. pg_cron schedule (guarded) ────────────────────────────────────────────
-- Runs on the 1st of every month at 02:00 UTC with 7-year retention.
-- Silently skipped if pg_cron is not installed on this Supabase project.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'purge-old-audit-logs',
      '0 2 1 * *',
      $cmd$SELECT public.purge_old_audit_logs('7 years')$cmd$
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
