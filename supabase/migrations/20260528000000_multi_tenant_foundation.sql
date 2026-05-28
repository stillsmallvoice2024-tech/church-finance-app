-- ============================================================
-- MULTI-TENANT FOUNDATION  (Phase 1: Structural only)
-- Safe to run multiple times — all statements are idempotent.
-- Does NOT enforce tenant isolation. Existing queries unchanged.
-- ============================================================

-- ── 1. Organizations ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  slug       text        NOT NULL UNIQUE,
  created_by uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  metadata   jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_organizations_slug       ON public.organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_created_by ON public.organizations(created_by);

-- Permissive policies for Phase 1; will tighten in Phase 2
DROP POLICY IF EXISTS "orgs_select" ON public.organizations;
DROP POLICY IF EXISTS "orgs_insert" ON public.organizations;
DROP POLICY IF EXISTS "orgs_update" ON public.organizations;
DROP POLICY IF EXISTS "orgs_delete" ON public.organizations;
CREATE POLICY "orgs_select" ON public.organizations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "orgs_insert" ON public.organizations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "orgs_update" ON public.organizations FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "orgs_delete" ON public.organizations FOR DELETE USING (public.is_admin());

-- ── 2. Org Members ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_members (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'viewer'
                         CHECK (role IN ('admin', 'accountant', 'viewer')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  invited_by uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  status     text        NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'invited', 'suspended')),
  UNIQUE (org_id, user_id)
);

ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_org_members_org_id  ON public.org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON public.org_members(user_id);

DROP POLICY IF EXISTS "org_members_select" ON public.org_members;
DROP POLICY IF EXISTS "org_members_insert" ON public.org_members;
DROP POLICY IF EXISTS "org_members_update" ON public.org_members;
DROP POLICY IF EXISTS "org_members_delete" ON public.org_members;
CREATE POLICY "org_members_select" ON public.org_members FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "org_members_insert" ON public.org_members FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "org_members_update" ON public.org_members FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "org_members_delete" ON public.org_members FOR DELETE USING (public.is_admin());

-- ── 3. Nullable org_id on all business tables ─────────────────
-- IMPORTANT: nullable only; no NOT NULL; no query rewrites; no RLS changes.

ALTER TABLE public.category_groups           ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.categories                ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.banks                     ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.allocation_configs        ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.income_types              ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.income_type_rules         ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.inflow_transactions       ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.outflow_transactions      ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.intra_flows               ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.bank_deposits             ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.intrabank_transfers       ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.accounts                  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.ledger_entries            ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.fx_transactions           ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.special_projects          ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.project_entries           ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.receipts                  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.invitations               ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.report_templates          ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.special_config_groups     ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.transaction_allocation_snapshots ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.recalculation_logs        ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.dynamic_reports           ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.outflow_types             ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.category_outflow_type_map ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.category_opening_balances ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Indexes on high-volume tables for future org-scoped queries
CREATE INDEX IF NOT EXISTS idx_inflow_org        ON public.inflow_transactions(org_id);
CREATE INDEX IF NOT EXISTS idx_outflow_org       ON public.outflow_transactions(org_id);
CREATE INDEX IF NOT EXISTS idx_intra_flows_org   ON public.intra_flows(org_id);
CREATE INDEX IF NOT EXISTS idx_banks_org         ON public.banks(org_id);
CREATE INDEX IF NOT EXISTS idx_categories_org    ON public.categories(org_id);
CREATE INDEX IF NOT EXISTS idx_alloc_configs_org ON public.allocation_configs(org_id);
CREATE INDEX IF NOT EXISTS idx_fx_org            ON public.fx_transactions(org_id);
CREATE INDEX IF NOT EXISTS idx_bank_deposits_org ON public.bank_deposits(org_id);

-- ── 4. Org-aware helper functions ─────────────────────────────
-- Phase 1 stubs: functions exist but enforce nothing yet.
-- Phase 2 will replace get_current_org_id() with session-variable resolution.

CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT NULL::uuid;
$$;

-- True if calling user is an admin member of the given org (uses org_members, not profiles.role).
CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = auth.uid()
      AND role    = 'admin'
      AND status  = 'active'
  );
$$;

-- True if calling user is admin or accountant in the given org.
CREATE OR REPLACE FUNCTION public.is_org_finance_user(p_org_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = auth.uid()
      AND role    IN ('admin', 'accountant')
      AND status  = 'active'
  );
$$;

NOTIFY pgrst, 'reload schema';
