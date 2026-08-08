-- ============================================================
-- ROLLBACK: Phase 2 org backfill
-- Run ONLY if Phase 2 (20260528000001_org_backfill.sql) must be undone.
-- Restores Phase 1 state: org_id columns become nullable, org/member data removed.
-- ============================================================

-- ── R1: Drop DEFAULT + NOT NULL from all org_id columns ──────────────────────
ALTER TABLE public.category_groups           ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.categories                ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.banks                     ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.allocation_configs        ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.income_types              ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.income_type_rules         ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.outflow_types             ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.category_outflow_type_map ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.special_config_groups     ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.inflow_transactions       ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.outflow_transactions      ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.intra_flows               ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.bank_deposits             ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.intrabank_transfers       ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.fx_transactions           ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.transaction_allocation_snapshots ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.recalculation_logs        ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.accounts                  ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.ledger_entries            ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.special_projects          ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.project_entries           ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.category_opening_balances ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.receipts                  ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.invitations               ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.report_templates          ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.dynamic_reports           ALTER COLUMN org_id DROP NOT NULL, ALTER COLUMN org_id DROP DEFAULT;

-- ── R2: NULL out org_id on all business tables ───────────────────────────────
DO $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'primary';
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'Primary org not found — skipping org_id NULL-out';
    RETURN;
  END IF;

  UPDATE public.category_groups       SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.categories            SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.banks                 SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.allocation_configs    SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.income_types          SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.income_type_rules     SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.outflow_types         SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.category_outflow_type_map SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.special_config_groups SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.inflow_transactions   SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.outflow_transactions  SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.intra_flows           SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.bank_deposits         SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.intrabank_transfers   SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.fx_transactions       SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.transaction_allocation_snapshots SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.recalculation_logs    SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.accounts              SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.ledger_entries        SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.special_projects      SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.project_entries       SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.category_opening_balances SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.receipts              SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.invitations           SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.report_templates      SET org_id = NULL WHERE org_id = v_org_id;
  UPDATE public.dynamic_reports       SET org_id = NULL WHERE org_id = v_org_id;

  RAISE NOTICE 'R2 complete: org_id cleared on all business tables';
END $$;

-- ── R3: Delete org_members for bootstrap org ─────────────────────────────────
DELETE FROM public.org_members
WHERE org_id = (SELECT id FROM public.organizations WHERE slug = 'primary');

-- ── R4: Delete bootstrap organization ────────────────────────────────────────
DELETE FROM public.organizations WHERE slug = 'primary';

-- ── R5: Drop Phase 2 composite (org_id, date) indexes ────────────────────────
DROP INDEX IF EXISTS public.idx_inflow_org_date;
DROP INDEX IF EXISTS public.idx_outflow_org_date;
DROP INDEX IF EXISTS public.idx_intra_org_date;
DROP INDEX IF EXISTS public.idx_bank_dep_org_date;
DROP INDEX IF EXISTS public.idx_intrabank_org_date;
DROP INDEX IF EXISTS public.idx_fx_org_date;
DROP INDEX IF EXISTS public.idx_proj_entries_org_date;
DROP INDEX IF EXISTS public.idx_ledger_org_date;

-- ── R6: Drop Phase 2 standalone org_id indexes ───────────────────────────────
DROP INDEX IF EXISTS public.idx_category_groups_org;
DROP INDEX IF EXISTS public.idx_income_types_org;
DROP INDEX IF EXISTS public.idx_income_type_rules_org;
DROP INDEX IF EXISTS public.idx_intrabank_org;
DROP INDEX IF EXISTS public.idx_accounts_org;
DROP INDEX IF EXISTS public.idx_ledger_entries_org;
DROP INDEX IF EXISTS public.idx_special_projects_org;
DROP INDEX IF EXISTS public.idx_project_entries_org;
DROP INDEX IF EXISTS public.idx_receipts_org;
DROP INDEX IF EXISTS public.idx_invitations_org;
DROP INDEX IF EXISTS public.idx_report_templates_org;
DROP INDEX IF EXISTS public.idx_special_config_groups_org;
DROP INDEX IF EXISTS public.idx_tas_org;
DROP INDEX IF EXISTS public.idx_recalc_logs_org;
DROP INDEX IF EXISTS public.idx_dynamic_reports_org;
DROP INDEX IF EXISTS public.idx_outflow_types_org;
DROP INDEX IF EXISTS public.idx_cotm_org;
DROP INDEX IF EXISTS public.idx_cob_org;

-- ── R7: Revert get_current_org_id() to Phase 1 NULL stub ─────────────────────
CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT NULL::uuid;
$$;

NOTIFY pgrst, 'reload schema';
