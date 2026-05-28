-- ============================================================
-- ORG BACKFILL  (Phase 2: Single-org data migration)
-- Idempotent: safe to re-run multiple times.
-- Prerequisite: 20260528000000_multi_tenant_foundation.sql must be applied.
--
-- What this does:
--   1. Insert the primary organization record.
--   2. Add org_members rows for all existing profiles, preserving role.
--   3. Backfill org_id on all 26 business tables.
--   4. Update get_current_org_id() to resolve the primary org (non-stub).
--   5. Validate backfill completeness; RAISE EXCEPTION on any NULL.
--   6. Add DEFAULT + NOT NULL to all org_id columns.
--   7. Add composite (org_id, date) indexes on high-volume tables.
--   8. Add standalone org_id indexes on remaining tables.
--   9. Post-validation report via RAISE NOTICE.
--
-- Does NOT: rewrite RLS, change frontend, change hooks/stores.
-- ============================================================

-- ── STEP 1: Create primary organization ──────────────────────────────────────
-- slug = 'primary' is the stable selector used throughout this migration.
-- Update "name" after running if you want a different display name.
INSERT INTO public.organizations (name, slug, metadata)
VALUES (
  'My Church',
  'primary',
  '{"bootstrap": true, "phase": "backfill"}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ── STEP 2: Create org_members for all existing profiles ──────────────────────
-- Maps profiles.role (admin/accountant/viewer) directly to org_members.role.
-- ON CONFLICT DO NOTHING makes this idempotent.
INSERT INTO public.org_members (org_id, user_id, role, status)
SELECT
  o.id,
  p.id,
  p.role,
  'active'
FROM public.profiles p
CROSS JOIN (SELECT id FROM public.organizations WHERE slug = 'primary') o
ON CONFLICT (org_id, user_id) DO NOTHING;

-- ── STEP 3: Backfill org_id on all business tables ──────────────────────────
-- WHERE org_id IS NULL ensures idempotency: re-run only touches unset rows.
DO $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'primary';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Primary org not found — cannot proceed with backfill';
  END IF;

  -- Config / reference tables
  UPDATE public.category_groups       SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.categories            SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.banks                 SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.allocation_configs    SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.income_types          SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.income_type_rules     SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.outflow_types         SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.category_outflow_type_map SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.special_config_groups SET org_id = v_org_id WHERE org_id IS NULL;

  -- Transaction tables (high-volume)
  UPDATE public.inflow_transactions   SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.outflow_transactions  SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.intra_flows           SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.bank_deposits         SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.intrabank_transfers   SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.fx_transactions       SET org_id = v_org_id WHERE org_id IS NULL;

  -- Allocation / snapshot tables
  UPDATE public.transaction_allocation_snapshots SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.recalculation_logs    SET org_id = v_org_id WHERE org_id IS NULL;

  -- Supporting tables
  UPDATE public.accounts              SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.ledger_entries        SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.special_projects      SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.project_entries       SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.category_opening_balances SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.receipts              SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.invitations           SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.report_templates      SET org_id = v_org_id WHERE org_id IS NULL;
  UPDATE public.dynamic_reports       SET org_id = v_org_id WHERE org_id IS NULL;

  RAISE NOTICE 'Step 3 complete: all business tables backfilled with org_id=%', v_org_id;
END $$;

-- ── STEP 4: Update get_current_org_id() to resolve primary org ───────────────
-- Replaces Phase 1 NULL stub. Used as DEFAULT on org_id columns so frontend
-- inserts that don't explicitly set org_id continue to work unchanged.
CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT id FROM public.organizations WHERE slug = 'primary' LIMIT 1;
$$;

-- ── STEP 5: Pre-validation — abort before NOT NULL if any NULL found ─────────
DO $$
DECLARE
  v_count  integer;
  t        text;
  tables   text[] := ARRAY[
    'category_groups', 'categories', 'banks', 'allocation_configs',
    'income_types', 'income_type_rules', 'outflow_types', 'category_outflow_type_map',
    'special_config_groups', 'inflow_transactions', 'outflow_transactions',
    'intra_flows', 'bank_deposits', 'intrabank_transfers', 'fx_transactions',
    'transaction_allocation_snapshots', 'recalculation_logs', 'accounts',
    'ledger_entries', 'special_projects', 'project_entries',
    'category_opening_balances', 'receipts', 'invitations',
    'report_templates', 'dynamic_reports'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE org_id IS NULL', t) INTO v_count;
    IF v_count > 0 THEN
      RAISE EXCEPTION
        'Pre-validation FAILED: % row(s) in % have NULL org_id — backfill incomplete, NOT NULL enforcement aborted',
        v_count, t;
    END IF;
  END LOOP;
  RAISE NOTICE 'Step 5 complete: pre-validation passed — all 26 tables fully backfilled';
END $$;

-- ── STEP 6: Add DEFAULT + NOT NULL to all org_id columns ─────────────────────
-- SET DEFAULT ensures new frontend inserts (which don't pass org_id yet) get
-- the primary org automatically — preserving current app behavior.
-- SET NOT NULL is idempotent if column already has the constraint.

ALTER TABLE public.category_groups
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.categories
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.banks
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.allocation_configs
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.income_types
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.income_type_rules
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.outflow_types
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.category_outflow_type_map
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.special_config_groups
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.inflow_transactions
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.outflow_transactions
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.intra_flows
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.bank_deposits
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.intrabank_transfers
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.fx_transactions
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.transaction_allocation_snapshots
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.recalculation_logs
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.accounts
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.ledger_entries
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.special_projects
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.project_entries
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.category_opening_balances
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.receipts
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.invitations
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.report_templates
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE public.dynamic_reports
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id(),
  ALTER COLUMN org_id SET NOT NULL;

-- ── STEP 7: Composite (org_id, date) indexes on high-volume tables ────────────
-- Supports efficient org-scoped date-range queries (Phase 3 RLS + future queries).
CREATE INDEX IF NOT EXISTS idx_inflow_org_date       ON public.inflow_transactions(org_id, date);
CREATE INDEX IF NOT EXISTS idx_outflow_org_date      ON public.outflow_transactions(org_id, date);
CREATE INDEX IF NOT EXISTS idx_intra_org_date        ON public.intra_flows(org_id, date);
CREATE INDEX IF NOT EXISTS idx_bank_dep_org_date     ON public.bank_deposits(org_id, date);
CREATE INDEX IF NOT EXISTS idx_intrabank_org_date    ON public.intrabank_transfers(org_id, date);
CREATE INDEX IF NOT EXISTS idx_fx_org_date           ON public.fx_transactions(org_id, date);
CREATE INDEX IF NOT EXISTS idx_proj_entries_org_date ON public.project_entries(org_id, date);
CREATE INDEX IF NOT EXISTS idx_ledger_org_date       ON public.ledger_entries(org_id, date);

-- ── STEP 8: Standalone org_id indexes on remaining tables ─────────────────────
-- Phase 1 already indexed high-volume tables; filling the rest.
CREATE INDEX IF NOT EXISTS idx_category_groups_org    ON public.category_groups(org_id);
CREATE INDEX IF NOT EXISTS idx_income_types_org       ON public.income_types(org_id);
CREATE INDEX IF NOT EXISTS idx_income_type_rules_org  ON public.income_type_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_intrabank_org          ON public.intrabank_transfers(org_id);
CREATE INDEX IF NOT EXISTS idx_accounts_org           ON public.accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_org     ON public.ledger_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_special_projects_org   ON public.special_projects(org_id);
CREATE INDEX IF NOT EXISTS idx_project_entries_org    ON public.project_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_receipts_org           ON public.receipts(org_id);
CREATE INDEX IF NOT EXISTS idx_invitations_org        ON public.invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_report_templates_org   ON public.report_templates(org_id);
CREATE INDEX IF NOT EXISTS idx_special_config_groups_org ON public.special_config_groups(org_id);
CREATE INDEX IF NOT EXISTS idx_tas_org                ON public.transaction_allocation_snapshots(org_id);
CREATE INDEX IF NOT EXISTS idx_recalc_logs_org        ON public.recalculation_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_dynamic_reports_org    ON public.dynamic_reports(org_id);
CREATE INDEX IF NOT EXISTS idx_outflow_types_org      ON public.outflow_types(org_id);
CREATE INDEX IF NOT EXISTS idx_cotm_org               ON public.category_outflow_type_map(org_id);
CREATE INDEX IF NOT EXISTS idx_cob_org                ON public.category_opening_balances(org_id);

-- ── STEP 9: Post-validation report ───────────────────────────────────────────
DO $$
DECLARE
  v_org_id       uuid;
  v_org_count    integer;
  v_member_count integer;
  v_profile_count integer;
  v_dup_count    integer;
  v_null_count   integer;
  t              text;
  tables         text[] := ARRAY[
    'category_groups', 'categories', 'banks', 'allocation_configs',
    'income_types', 'income_type_rules', 'outflow_types', 'category_outflow_type_map',
    'special_config_groups', 'inflow_transactions', 'outflow_transactions',
    'intra_flows', 'bank_deposits', 'intrabank_transfers', 'fx_transactions',
    'transaction_allocation_snapshots', 'recalculation_logs', 'accounts',
    'ledger_entries', 'special_projects', 'project_entries',
    'category_opening_balances', 'receipts', 'invitations',
    'report_templates', 'dynamic_reports'
  ];
  all_ok         boolean := true;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'primary';
  SELECT COUNT(*) INTO v_org_count    FROM public.organizations;
  SELECT COUNT(*) INTO v_profile_count FROM public.profiles;
  SELECT COUNT(*) INTO v_member_count FROM public.org_members WHERE org_id = v_org_id;

  RAISE NOTICE '=== Phase 2 Post-Validation ===';
  RAISE NOTICE 'Organizations total : %', v_org_count;
  RAISE NOTICE 'Primary org id      : %', v_org_id;
  RAISE NOTICE 'Profiles total      : %', v_profile_count;
  RAISE NOTICE 'Org members (primary): %', v_member_count;

  -- Warn if any profile has no org_member entry
  IF v_member_count < v_profile_count THEN
    RAISE WARNING 'WARN: % profile(s) have no org_member entry (may be system/service accounts)',
      v_profile_count - v_member_count;
  END IF;

  -- Check for duplicate memberships (UNIQUE constraint should prevent this, but verify)
  SELECT COUNT(*) INTO v_dup_count FROM (
    SELECT org_id, user_id FROM public.org_members
    GROUP BY org_id, user_id HAVING COUNT(*) > 1
  ) dups;
  IF v_dup_count > 0 THEN
    RAISE WARNING 'DUPLICATE MEMBERSHIPS: % pair(s) found', v_dup_count;
    all_ok := false;
  ELSE
    RAISE NOTICE 'OK: no duplicate org_members entries';
  END IF;

  -- Verify no orphaned rows (NULL org_id) in any business table
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE org_id IS NULL', t) INTO v_null_count;
    IF v_null_count > 0 THEN
      RAISE WARNING 'ORPHAN: % row(s) in % have NULL org_id', v_null_count, t;
      all_ok := false;
    END IF;
  END LOOP;

  -- Verify no org_id FK mismatches (referencing non-existent org)
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM public.%I bt
       WHERE bt.org_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = bt.org_id)',
      t
    ) INTO v_null_count;
    IF v_null_count > 0 THEN
      RAISE WARNING 'FK MISMATCH: % row(s) in % reference a non-existent org', v_null_count, t;
      all_ok := false;
    END IF;
  END LOOP;

  IF all_ok THEN
    RAISE NOTICE '=== Phase 2 PASSED — all checks clean ===';
  ELSE
    RAISE WARNING '=== Phase 2 completed with WARNINGS — review above ===';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
