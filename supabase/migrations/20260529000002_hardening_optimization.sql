-- ============================================================
-- HARDENING + OPTIMIZATION MIGRATION
-- Idempotent — safe to re-run.
-- Prerequisites: Phases 1–5 (multi_tenant_foundation, org_backfill,
--   phase3_rls_tenant_isolation, phase5_org_invite) applied.
--
-- Changes:
--   1. Add org_id to fx_conversions (missing from foundation migration)
--   2. Enable RLS on fx_conversions with org-scoped policies
--   3. Add composite indexes for high-frequency multi-tenant queries
-- ============================================================


-- ── 1. fx_conversions: add org_id (skip silently if table does not exist) ──────

DO $$ BEGIN
  ALTER TABLE public.fx_conversions
    ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  UPDATE public.fx_conversions fc
  SET    org_id = COALESCE(
           (SELECT it.org_id FROM public.inflow_transactions it WHERE it.id = fc.naira_inflow_id::uuid LIMIT 1),
           (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1)
         )
  WHERE  fc.org_id IS NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_fx_conversions_org      ON public.fx_conversions(org_id);
  CREATE INDEX IF NOT EXISTS idx_fx_conversions_org_date ON public.fx_conversions(org_id, date);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 2. Enable RLS on fx_conversions (skip silently if table does not exist) ────

DO $$ BEGIN
  ALTER TABLE public.fx_conversions ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "fxc_select" ON public.fx_conversions;
  DROP POLICY IF EXISTS "fxc_insert" ON public.fx_conversions;
  DROP POLICY IF EXISTS "fxc_update" ON public.fx_conversions;
  DROP POLICY IF EXISTS "fxc_delete" ON public.fx_conversions;

  CREATE POLICY "fxc_select" ON public.fx_conversions
    FOR SELECT USING (public.is_org_member(org_id));
  CREATE POLICY "fxc_insert" ON public.fx_conversions
    FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
  CREATE POLICY "fxc_update" ON public.fx_conversions
    FOR UPDATE USING (public.is_org_finance_user(org_id));
  CREATE POLICY "fxc_delete" ON public.fx_conversions
    FOR DELETE USING (public.is_org_admin(org_id));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 3. Composite indexes for common multi-tenant filter patterns ───────────────

-- outflow_types: name lookups within org
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_outflow_types_org_name
    ON public.outflow_types(org_id, name);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- category_outflow_type_map: category → type lookups within org
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_cotm_org_category
    ON public.category_outflow_type_map(org_id, category_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- dynamic_reports: list queries sort by updated_at within org
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_dynamic_reports_org_updated
    ON public.dynamic_reports(org_id, updated_at DESC);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- report_templates: sorted by name within org
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_report_templates_org_name
    ON public.report_templates(org_id, name);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- inflow_transactions: reversals/refunds page filters by transaction_type within org
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_inflow_org_txn_type
    ON public.inflow_transactions(org_id, transaction_type);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- outflow_transactions: pending deductions filter within org
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_outflow_org_pending
    ON public.outflow_transactions(org_id, is_pending_deduction)
    WHERE is_pending_deduction = true;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- allocation_configs: date-range version queries within org
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_alloc_configs_org_effective
    ON public.allocation_configs(org_id, effective_from, effective_to);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- receipts: entity lookups within org
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_receipts_org_entity
    ON public.receipts(org_id, entity_type, entity_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- intra_flows: batch grouping within org
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_intra_flows_org_batch
    ON public.intra_flows(org_id, batch_id)
    WHERE batch_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- transaction_allocation_snapshots: transaction lookup within org
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_tas_org_txn
    ON public.transaction_allocation_snapshots(org_id, transaction_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- org_members: status-filtered role lookups (used heavily in RLS helpers)
CREATE INDEX IF NOT EXISTS idx_org_members_uid_status
  ON public.org_members(user_id, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_org_members_org_uid_status
  ON public.org_members(org_id, user_id, status)
  WHERE status = 'active';


NOTIFY pgrst, 'reload schema';
