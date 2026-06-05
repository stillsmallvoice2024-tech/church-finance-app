-- ============================================================
-- LB-9 / S-H1: Server-side audit triggers
--
-- Before: logAudit/logFieldChanges inserted from the browser;
--   any org member could forge user_id, old_data, new_data,
--   table_name, record_id, and created_at.
--
-- After: AFTER triggers on all audited tables write to
--   audit_log and field_changes using SECURITY DEFINER functions.
--   auth.uid() and now() are captured server-side and cannot be
--   overridden by the client.  The client INSERT policies are
--   dropped — no authenticated user can directly write to
--   audit_log or field_changes.
-- ============================================================

-- ── 1. Generic audit trigger function ────────────────────────────────────────
-- SECURITY DEFINER runs as the function owner (postgres), bypassing RLS.
-- SET search_path guards against search-path injection.

CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid;
  v_org_id    uuid;
  v_record_id uuid;
  v_old_data  jsonb;
  v_new_data  jsonb;
  v_row_json  jsonb;
BEGIN
  -- Server-captured — cannot be supplied by the client
  v_user_id := auth.uid();

  IF TG_OP = 'DELETE' THEN
    v_row_json := row_to_json(OLD)::jsonb;
    v_old_data := v_row_json;
    v_new_data := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_row_json := row_to_json(NEW)::jsonb;
    v_old_data := NULL;
    v_new_data := v_row_json;
  ELSE
    v_row_json := row_to_json(NEW)::jsonb;
    v_old_data := row_to_json(OLD)::jsonb;
    v_new_data := v_row_json;
  END IF;

  BEGIN v_record_id := (v_row_json->>'id')::uuid; EXCEPTION WHEN OTHERS THEN v_record_id := NULL; END;
  BEGIN v_org_id    := (v_row_json->>'org_id')::uuid; EXCEPTION WHEN OTHERS THEN v_org_id := NULL; END;

  INSERT INTO public.audit_log (user_id, action, table_name, record_id, old_data, new_data, org_id)
  VALUES (v_user_id, TG_OP, TG_TABLE_NAME, v_record_id, v_old_data, v_new_data, v_org_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── 2. Field-change diff trigger function (UPDATE only) ───────────────────────

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
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;

  v_user_id   := auth.uid();
  v_old_json  := row_to_json(OLD)::jsonb;
  v_new_json  := row_to_json(NEW)::jsonb;
  v_record_id := v_new_json->>'id';
  BEGIN v_org_id := (v_new_json->>'org_id')::uuid; EXCEPTION WHEN OTHERS THEN v_org_id := NULL; END;

  FOR v_key IN SELECT key FROM jsonb_object_keys(v_new_json) AS key LOOP
    IF (v_old_json->>v_key) IS DISTINCT FROM (v_new_json->>v_key) THEN
      INSERT INTO public.field_changes (user_id, table_name, record_id, field_name, old_value, new_value, org_id)
      VALUES (v_user_id, TG_TABLE_NAME, v_record_id, v_key, v_old_json->>v_key, v_new_json->>v_key, v_org_id);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── 3. Attach triggers to all audited tables ──────────────────────────────────

-- inflow_transactions
DROP TRIGGER IF EXISTS trg_audit_inflow_transactions         ON public.inflow_transactions;
DROP TRIGGER IF EXISTS trg_field_changes_inflow_transactions ON public.inflow_transactions;
CREATE TRIGGER trg_audit_inflow_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.inflow_transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER trg_field_changes_inflow_transactions
  AFTER UPDATE ON public.inflow_transactions
  FOR EACH ROW EXECUTE FUNCTION public.field_changes_trigger_fn();

-- outflow_transactions
DROP TRIGGER IF EXISTS trg_audit_outflow_transactions         ON public.outflow_transactions;
DROP TRIGGER IF EXISTS trg_field_changes_outflow_transactions ON public.outflow_transactions;
CREATE TRIGGER trg_audit_outflow_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.outflow_transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER trg_field_changes_outflow_transactions
  AFTER UPDATE ON public.outflow_transactions
  FOR EACH ROW EXECUTE FUNCTION public.field_changes_trigger_fn();

-- intra_flows
DROP TRIGGER IF EXISTS trg_audit_intra_flows         ON public.intra_flows;
DROP TRIGGER IF EXISTS trg_field_changes_intra_flows ON public.intra_flows;
CREATE TRIGGER trg_audit_intra_flows
  AFTER INSERT OR UPDATE OR DELETE ON public.intra_flows
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER trg_field_changes_intra_flows
  AFTER UPDATE ON public.intra_flows
  FOR EACH ROW EXECUTE FUNCTION public.field_changes_trigger_fn();

-- banks
DROP TRIGGER IF EXISTS trg_audit_banks         ON public.banks;
DROP TRIGGER IF EXISTS trg_field_changes_banks ON public.banks;
CREATE TRIGGER trg_audit_banks
  AFTER INSERT OR UPDATE OR DELETE ON public.banks
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER trg_field_changes_banks
  AFTER UPDATE ON public.banks
  FOR EACH ROW EXECUTE FUNCTION public.field_changes_trigger_fn();

-- categories
DROP TRIGGER IF EXISTS trg_audit_categories         ON public.categories;
DROP TRIGGER IF EXISTS trg_field_changes_categories ON public.categories;
CREATE TRIGGER trg_audit_categories
  AFTER INSERT OR UPDATE OR DELETE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER trg_field_changes_categories
  AFTER UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.field_changes_trigger_fn();

-- allocation_configs
DROP TRIGGER IF EXISTS trg_audit_allocation_configs         ON public.allocation_configs;
DROP TRIGGER IF EXISTS trg_field_changes_allocation_configs ON public.allocation_configs;
CREATE TRIGGER trg_audit_allocation_configs
  AFTER INSERT OR UPDATE OR DELETE ON public.allocation_configs
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER trg_field_changes_allocation_configs
  AFTER UPDATE ON public.allocation_configs
  FOR EACH ROW EXECUTE FUNCTION public.field_changes_trigger_fn();

-- fx_transactions
DROP TRIGGER IF EXISTS trg_audit_fx_transactions         ON public.fx_transactions;
DROP TRIGGER IF EXISTS trg_field_changes_fx_transactions ON public.fx_transactions;
CREATE TRIGGER trg_audit_fx_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.fx_transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER trg_field_changes_fx_transactions
  AFTER UPDATE ON public.fx_transactions
  FOR EACH ROW EXECUTE FUNCTION public.field_changes_trigger_fn();

-- bank_deposits
DROP TRIGGER IF EXISTS trg_audit_bank_deposits ON public.bank_deposits;
CREATE TRIGGER trg_audit_bank_deposits
  AFTER INSERT OR UPDATE OR DELETE ON public.bank_deposits
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- intrabank_transfers
DROP TRIGGER IF EXISTS trg_audit_intrabank_transfers ON public.intrabank_transfers;
CREATE TRIGGER trg_audit_intrabank_transfers
  AFTER INSERT OR UPDATE OR DELETE ON public.intrabank_transfers
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- accounts
DROP TRIGGER IF EXISTS trg_audit_accounts ON public.accounts;
CREATE TRIGGER trg_audit_accounts
  AFTER INSERT OR UPDATE OR DELETE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- ledger_entries
DROP TRIGGER IF EXISTS trg_audit_ledger_entries ON public.ledger_entries;
CREATE TRIGGER trg_audit_ledger_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- ── 4. Drop client INSERT policies — triggers write directly via postgres ─────

DROP POLICY IF EXISTS "audit_insert"         ON public.audit_log;
DROP POLICY IF EXISTS "audit_write"          ON public.audit_log;
DROP POLICY IF EXISTS "field_changes_insert" ON public.field_changes;
DROP POLICY IF EXISTS "field_changes_write"  ON public.field_changes;

-- ── 5. Reload schema cache ────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
