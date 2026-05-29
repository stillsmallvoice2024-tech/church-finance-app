-- ============================================================
-- PHASE 3: TENANT ISOLATION RLS REWRITE
-- Idempotent — safe to re-run.
-- Prerequisites: Phase 1 (multi_tenant_foundation) + Phase 2 (org_backfill) applied.
--
-- ROLE MATRIX
-- ┌──────────────────────────────┬────────────────────────────────────────┐
-- │ Operation                    │ Admin │ Accountant │ Viewer             │
-- ├──────────────────────────────┼───────┼────────────┼────────────────────┤
-- │ SELECT (all business tables) │  ✓    │     ✓      │  ✓  (read-only)   │
-- │ INSERT transactions          │  ✓    │     ✓      │  ✗                 │
-- │ UPDATE transactions          │  ✓    │     ✓      │  ✗                 │
-- │ DELETE transactions          │  ✓    │     ✓      │  ✗                 │
-- │ INSERT config/reference      │  ✓    │     ✗*     │  ✗                 │
-- │ UPDATE config/reference      │  ✓    │     ✗*     │  ✗                 │
-- │ DELETE config/reference      │  ✓    │     ✗      │  ✗                 │
-- │ Manage users / invitations   │  ✓    │     ✗      │  ✗                 │
-- │ View audit log / changes     │  ✓    │     ✗      │  ✗                 │
-- └──────────────────────────────┴───────┴────────────┴────────────────────┘
-- *allocation_configs, categories, outflow_types, cotm, receipts,
--  ledger_entries, project_entries, fx_tx, tx snapshots: accountants can write.
--
-- CROSS-ORG ISOLATION
-- All SELECT policies use is_org_member(org_id): data visible only to
-- users who are active members of the row's org.
-- All write policies use is_org_finance_user(org_id) or is_org_admin(org_id):
-- writes accepted only from users who are active members of the row's org
-- with the required role.
-- dynamic_report_blocks and dynamic_report_snapshots join through
-- dynamic_reports.org_id (they have no direct org_id column).
-- audit_log and field_changes have no org_id; they use updated global
-- is_admin() / is_finance_user() which now check org_members (active status).
--
-- BOOTSTRAP NOTE
-- After applying this migration, every user must have an active org_members
-- row (Phase 2 backfill created these for all existing profiles). For the
-- first admin on a fresh install: set BOTH profiles.role = 'admin' AND
-- org_members.role = 'admin' in the Supabase SQL editor. The handle_new_user
-- trigger auto-enrolls new sign-ups as viewers; accept_invitation() promotes
-- them to the invited role.
-- ============================================================


-- ── 1. is_org_member helper ───────────────────────────────────────────────────
-- Returns true if the calling user is an active member of p_org_id (any role).
-- Used by SELECT policies to isolate reads to the user's own org.
-- SECURITY DEFINER so it can read org_members without triggering recursion
-- when used in the org_members policy itself.

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = auth.uid()
      AND status  = 'active'
  );
$$;


-- ── 2. Update global helpers to use org_members (status-aware) ───────────────
-- is_admin() and is_finance_user() now check org_members rather than
-- profiles.role so that suspended / removed users lose access immediately.
-- Used by tables without an org_id column (profiles, audit_log, field_changes).

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = auth.uid()
      AND role    = 'admin'
      AND status  = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_finance_user()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = auth.uid()
      AND role    IN ('admin', 'accountant')
      AND status  = 'active'
  );
$$;


-- ── 3. handle_new_user: auto-enroll new sign-ups in primary org as viewer ─────
-- Ensures every authenticated user immediately has an org_members row so the
-- Phase 3 RLS helper functions work on first request.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id uuid;
BEGIN
  INSERT INTO public.profiles (id, email, full_name, username)
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'username'
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT id INTO v_org_id
  FROM   public.organizations
  WHERE  slug = 'primary'
  LIMIT  1;

  IF v_org_id IS NOT NULL THEN
    INSERT INTO public.org_members (org_id, user_id, role, status)
    VALUES (v_org_id, new.id, 'viewer', 'active')
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;

  RETURN new;
END;
$$;


-- ── 4. accept_invitation: sync org_members.role on invite acceptance ──────────
-- Keeps profiles.role (used by frontend useRole()) and org_members.role
-- (used by Phase 3 RLS helpers) in sync atomically.

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
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

  -- Keep profiles.role in sync for frontend useRole() hook
  UPDATE public.profiles
    SET role       = v_invite.role,
        updated_at = now()
  WHERE id = p_user_id;

  -- Set/promote org_members.role (authoritative for Phase 3 RLS)
  INSERT INTO public.org_members (org_id, user_id, role, status)
  VALUES (v_invite.org_id, p_user_id, v_invite.role, 'active')
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET role   = EXCLUDED.role,
        status = 'active';

  UPDATE public.invitations
    SET status      = 'accepted',
        accepted_at = now()
  WHERE token = p_token;
END;
$$;


-- ── 5. RLS policies ───────────────────────────────────────────────────────────
-- Pattern:
--   SELECT  → is_org_member(org_id)          all roles see their org's data
--   INSERT  → is_org_finance_user(org_id)     admin + accountant
--   UPDATE  → is_org_finance_user(org_id)
--   DELETE  → is_org_finance_user(org_id) OR is_org_admin(org_id) per table
-- Config / reference tables use is_org_admin for INSERT/UPDATE/DELETE.
-- Tables without org_id (profiles, audit_log, field_changes) keep
-- auth.uid()-based or updated global helper patterns.


-- ── organizations ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "orgs_select" ON public.organizations;
DROP POLICY IF EXISTS "orgs_insert" ON public.organizations;
DROP POLICY IF EXISTS "orgs_update" ON public.organizations;
DROP POLICY IF EXISTS "orgs_delete" ON public.organizations;

CREATE POLICY "orgs_select" ON public.organizations
  FOR SELECT USING (public.is_org_member(id));

CREATE POLICY "orgs_insert" ON public.organizations
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "orgs_update" ON public.organizations
  FOR UPDATE USING (public.is_org_admin(id));

CREATE POLICY "orgs_delete" ON public.organizations
  FOR DELETE USING (public.is_org_admin(id));


-- ── org_members ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_members_select" ON public.org_members;
DROP POLICY IF EXISTS "org_members_insert" ON public.org_members;
DROP POLICY IF EXISTS "org_members_update" ON public.org_members;
DROP POLICY IF EXISTS "org_members_delete" ON public.org_members;

CREATE POLICY "org_members_select" ON public.org_members
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "org_members_insert" ON public.org_members
  FOR INSERT WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY "org_members_update" ON public.org_members
  FOR UPDATE USING (public.is_org_admin(org_id));

CREATE POLICY "org_members_delete" ON public.org_members
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── profiles (no org_id — global user registry; cross-org read is acceptable) ─
DROP POLICY IF EXISTS "profiles_select"       ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert"       ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete"       ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Self-update: own row only; role immutable via this path (blocks escalation).
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE
  USING  (id = auth.uid())
  WITH CHECK (
    id   = auth.uid()
    AND  role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
  );

-- Org admin may update any profile (e.g. role changes via UserManagement).
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE USING (public.is_admin());


-- ── category_groups ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "category_groups_read"   ON public.category_groups;
DROP POLICY IF EXISTS "category_groups_write"  ON public.category_groups;
DROP POLICY IF EXISTS "category_groups_select" ON public.category_groups;
DROP POLICY IF EXISTS "category_groups_insert" ON public.category_groups;
DROP POLICY IF EXISTS "category_groups_update" ON public.category_groups;
DROP POLICY IF EXISTS "category_groups_delete" ON public.category_groups;

CREATE POLICY "category_groups_select" ON public.category_groups
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "category_groups_insert" ON public.category_groups
  FOR INSERT WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY "category_groups_update" ON public.category_groups
  FOR UPDATE USING (public.is_org_admin(org_id));
CREATE POLICY "category_groups_delete" ON public.category_groups
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── categories ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "categories_read"   ON public.categories;
DROP POLICY IF EXISTS "categories_write"  ON public.categories;
DROP POLICY IF EXISTS "categories_delete" ON public.categories;
DROP POLICY IF EXISTS "categories_select" ON public.categories;
DROP POLICY IF EXISTS "categories_insert" ON public.categories;
DROP POLICY IF EXISTS "categories_update" ON public.categories;

CREATE POLICY "categories_select" ON public.categories
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "categories_insert" ON public.categories
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "categories_update" ON public.categories
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "categories_delete" ON public.categories
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── banks ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "banks_read"   ON public.banks;
DROP POLICY IF EXISTS "banks_write"  ON public.banks;
DROP POLICY IF EXISTS "banks_select" ON public.banks;
DROP POLICY IF EXISTS "banks_insert" ON public.banks;
DROP POLICY IF EXISTS "banks_update" ON public.banks;
DROP POLICY IF EXISTS "banks_delete" ON public.banks;

CREATE POLICY "banks_select" ON public.banks
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "banks_insert" ON public.banks
  FOR INSERT WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY "banks_update" ON public.banks
  FOR UPDATE USING (public.is_org_admin(org_id));
CREATE POLICY "banks_delete" ON public.banks
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── allocation_configs ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allocation_configs_read"   ON public.allocation_configs;
DROP POLICY IF EXISTS "allocation_configs_write"  ON public.allocation_configs;
DROP POLICY IF EXISTS "allocation_configs_delete" ON public.allocation_configs;
DROP POLICY IF EXISTS "allocation_configs_select" ON public.allocation_configs;
DROP POLICY IF EXISTS "allocation_configs_insert" ON public.allocation_configs;
DROP POLICY IF EXISTS "allocation_configs_update" ON public.allocation_configs;

CREATE POLICY "allocation_configs_select" ON public.allocation_configs
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "allocation_configs_insert" ON public.allocation_configs
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "allocation_configs_update" ON public.allocation_configs
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "allocation_configs_delete" ON public.allocation_configs
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── income_types ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "income_types_read"   ON public.income_types;
DROP POLICY IF EXISTS "income_types_write"  ON public.income_types;
DROP POLICY IF EXISTS "income_types_select" ON public.income_types;
DROP POLICY IF EXISTS "income_types_insert" ON public.income_types;
DROP POLICY IF EXISTS "income_types_update" ON public.income_types;
DROP POLICY IF EXISTS "income_types_delete" ON public.income_types;

CREATE POLICY "income_types_select" ON public.income_types
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "income_types_insert" ON public.income_types
  FOR INSERT WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY "income_types_update" ON public.income_types
  FOR UPDATE USING (public.is_org_admin(org_id));
CREATE POLICY "income_types_delete" ON public.income_types
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── income_type_rules ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "income_type_rules_read"   ON public.income_type_rules;
DROP POLICY IF EXISTS "income_type_rules_write"  ON public.income_type_rules;
DROP POLICY IF EXISTS "income_type_rules_select" ON public.income_type_rules;
DROP POLICY IF EXISTS "income_type_rules_insert" ON public.income_type_rules;
DROP POLICY IF EXISTS "income_type_rules_update" ON public.income_type_rules;
DROP POLICY IF EXISTS "income_type_rules_delete" ON public.income_type_rules;

CREATE POLICY "income_type_rules_select" ON public.income_type_rules
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "income_type_rules_insert" ON public.income_type_rules
  FOR INSERT WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY "income_type_rules_update" ON public.income_type_rules
  FOR UPDATE USING (public.is_org_admin(org_id));
CREATE POLICY "income_type_rules_delete" ON public.income_type_rules
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── outflow_types ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "outflow_types_read"   ON public.outflow_types;
DROP POLICY IF EXISTS "outflow_types_write"  ON public.outflow_types;
DROP POLICY IF EXISTS "outflow_types_update" ON public.outflow_types;
DROP POLICY IF EXISTS "outflow_types_delete" ON public.outflow_types;
DROP POLICY IF EXISTS "outflow_types_select" ON public.outflow_types;
DROP POLICY IF EXISTS "outflow_types_insert" ON public.outflow_types;

CREATE POLICY "outflow_types_select" ON public.outflow_types
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "outflow_types_insert" ON public.outflow_types
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "outflow_types_update" ON public.outflow_types
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "outflow_types_delete" ON public.outflow_types
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── category_outflow_type_map ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "cotm_read"   ON public.category_outflow_type_map;
DROP POLICY IF EXISTS "cotm_write"  ON public.category_outflow_type_map;
DROP POLICY IF EXISTS "cotm_delete" ON public.category_outflow_type_map;
DROP POLICY IF EXISTS "cotm_select" ON public.category_outflow_type_map;
DROP POLICY IF EXISTS "cotm_insert" ON public.category_outflow_type_map;
DROP POLICY IF EXISTS "cotm_update" ON public.category_outflow_type_map;

CREATE POLICY "cotm_select" ON public.category_outflow_type_map
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "cotm_insert" ON public.category_outflow_type_map
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "cotm_delete" ON public.category_outflow_type_map
  FOR DELETE USING (public.is_org_finance_user(org_id));


-- ── inflow_transactions ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "inflow_read"   ON public.inflow_transactions;
DROP POLICY IF EXISTS "inflow_write"  ON public.inflow_transactions;
DROP POLICY IF EXISTS "inflow_update" ON public.inflow_transactions;
DROP POLICY IF EXISTS "inflow_delete" ON public.inflow_transactions;
DROP POLICY IF EXISTS "inflow_select" ON public.inflow_transactions;
DROP POLICY IF EXISTS "inflow_insert" ON public.inflow_transactions;

CREATE POLICY "inflow_select" ON public.inflow_transactions
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "inflow_insert" ON public.inflow_transactions
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "inflow_update" ON public.inflow_transactions
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "inflow_delete" ON public.inflow_transactions
  FOR DELETE USING (public.is_org_finance_user(org_id));


-- ── outflow_transactions ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "outflow_read"   ON public.outflow_transactions;
DROP POLICY IF EXISTS "outflow_write"  ON public.outflow_transactions;
DROP POLICY IF EXISTS "outflow_update" ON public.outflow_transactions;
DROP POLICY IF EXISTS "outflow_delete" ON public.outflow_transactions;
DROP POLICY IF EXISTS "outflow_select" ON public.outflow_transactions;
DROP POLICY IF EXISTS "outflow_insert" ON public.outflow_transactions;

CREATE POLICY "outflow_select" ON public.outflow_transactions
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "outflow_insert" ON public.outflow_transactions
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "outflow_update" ON public.outflow_transactions
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "outflow_delete" ON public.outflow_transactions
  FOR DELETE USING (public.is_org_finance_user(org_id));


-- ── intra_flows ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "intraflow_read"   ON public.intra_flows;
DROP POLICY IF EXISTS "intraflow_write"  ON public.intra_flows;
DROP POLICY IF EXISTS "intraflow_update" ON public.intra_flows;
DROP POLICY IF EXISTS "intraflow_delete" ON public.intra_flows;
DROP POLICY IF EXISTS "intraflow_select" ON public.intra_flows;
DROP POLICY IF EXISTS "intraflow_insert" ON public.intra_flows;

CREATE POLICY "intraflow_select" ON public.intra_flows
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "intraflow_insert" ON public.intra_flows
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "intraflow_update" ON public.intra_flows
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "intraflow_delete" ON public.intra_flows
  FOR DELETE USING (public.is_org_finance_user(org_id));


-- ── bank_deposits ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "bank_deposits_read"   ON public.bank_deposits;
DROP POLICY IF EXISTS "bank_deposits_write"  ON public.bank_deposits;
DROP POLICY IF EXISTS "bank_deposits_update" ON public.bank_deposits;
DROP POLICY IF EXISTS "bank_deposits_delete" ON public.bank_deposits;
DROP POLICY IF EXISTS "bank_deposits_select" ON public.bank_deposits;
DROP POLICY IF EXISTS "bank_deposits_insert" ON public.bank_deposits;

CREATE POLICY "bank_deposits_select" ON public.bank_deposits
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "bank_deposits_insert" ON public.bank_deposits
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "bank_deposits_update" ON public.bank_deposits
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "bank_deposits_delete" ON public.bank_deposits
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── intrabank_transfers ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "intrabank_read"   ON public.intrabank_transfers;
DROP POLICY IF EXISTS "intrabank_write"  ON public.intrabank_transfers;
DROP POLICY IF EXISTS "intrabank_update" ON public.intrabank_transfers;
DROP POLICY IF EXISTS "intrabank_delete" ON public.intrabank_transfers;
DROP POLICY IF EXISTS "intrabank_select" ON public.intrabank_transfers;
DROP POLICY IF EXISTS "intrabank_insert" ON public.intrabank_transfers;

CREATE POLICY "intrabank_select" ON public.intrabank_transfers
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "intrabank_insert" ON public.intrabank_transfers
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "intrabank_update" ON public.intrabank_transfers
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "intrabank_delete" ON public.intrabank_transfers
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── accounts ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "accounts_read"   ON public.accounts;
DROP POLICY IF EXISTS "accounts_write"  ON public.accounts;
DROP POLICY IF EXISTS "accounts_select" ON public.accounts;
DROP POLICY IF EXISTS "accounts_insert" ON public.accounts;
DROP POLICY IF EXISTS "accounts_update" ON public.accounts;
DROP POLICY IF EXISTS "accounts_delete" ON public.accounts;

CREATE POLICY "accounts_select" ON public.accounts
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "accounts_insert" ON public.accounts
  FOR INSERT WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY "accounts_update" ON public.accounts
  FOR UPDATE USING (public.is_org_admin(org_id));
CREATE POLICY "accounts_delete" ON public.accounts
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── ledger_entries ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ledger_read"   ON public.ledger_entries;
DROP POLICY IF EXISTS "ledger_write"  ON public.ledger_entries;
DROP POLICY IF EXISTS "ledger_update" ON public.ledger_entries;
DROP POLICY IF EXISTS "ledger_delete" ON public.ledger_entries;
DROP POLICY IF EXISTS "ledger_select" ON public.ledger_entries;
DROP POLICY IF EXISTS "ledger_insert" ON public.ledger_entries;

CREATE POLICY "ledger_select" ON public.ledger_entries
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "ledger_insert" ON public.ledger_entries
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "ledger_update" ON public.ledger_entries
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "ledger_delete" ON public.ledger_entries
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── fx_transactions ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "fx_read"   ON public.fx_transactions;
DROP POLICY IF EXISTS "fx_write"  ON public.fx_transactions;
DROP POLICY IF EXISTS "fx_update" ON public.fx_transactions;
DROP POLICY IF EXISTS "fx_delete" ON public.fx_transactions;
DROP POLICY IF EXISTS "fx_select" ON public.fx_transactions;
DROP POLICY IF EXISTS "fx_insert" ON public.fx_transactions;

CREATE POLICY "fx_select" ON public.fx_transactions
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "fx_insert" ON public.fx_transactions
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "fx_update" ON public.fx_transactions
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "fx_delete" ON public.fx_transactions
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── special_projects ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "projects_read"   ON public.special_projects;
DROP POLICY IF EXISTS "projects_write"  ON public.special_projects;
DROP POLICY IF EXISTS "projects_select" ON public.special_projects;
DROP POLICY IF EXISTS "projects_insert" ON public.special_projects;
DROP POLICY IF EXISTS "projects_update" ON public.special_projects;
DROP POLICY IF EXISTS "projects_delete" ON public.special_projects;

CREATE POLICY "projects_select" ON public.special_projects
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "projects_insert" ON public.special_projects
  FOR INSERT WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY "projects_update" ON public.special_projects
  FOR UPDATE USING (public.is_org_admin(org_id));
CREATE POLICY "projects_delete" ON public.special_projects
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── project_entries ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "project_entries_read"   ON public.project_entries;
DROP POLICY IF EXISTS "project_entries_write"  ON public.project_entries;
DROP POLICY IF EXISTS "project_entries_update" ON public.project_entries;
DROP POLICY IF EXISTS "project_entries_delete" ON public.project_entries;
DROP POLICY IF EXISTS "project_entries_select" ON public.project_entries;
DROP POLICY IF EXISTS "project_entries_insert" ON public.project_entries;

CREATE POLICY "project_entries_select" ON public.project_entries
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "project_entries_insert" ON public.project_entries
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "project_entries_update" ON public.project_entries
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "project_entries_delete" ON public.project_entries
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── receipts ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "receipts_read"   ON public.receipts;
DROP POLICY IF EXISTS "receipts_write"  ON public.receipts;
DROP POLICY IF EXISTS "receipts_delete" ON public.receipts;
DROP POLICY IF EXISTS "receipts_select" ON public.receipts;
DROP POLICY IF EXISTS "receipts_insert" ON public.receipts;

CREATE POLICY "receipts_select" ON public.receipts
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "receipts_insert" ON public.receipts
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "receipts_delete" ON public.receipts
  FOR DELETE USING (public.is_org_finance_user(org_id));


-- ── invitations ───────────────────────────────────────────────────────────────
-- Token-based reads go through get_invitation_by_token() SECURITY DEFINER RPC.
-- No direct SELECT for non-admins; the RPC bypasses RLS safely.
DROP POLICY IF EXISTS "invitations_admin_all"   ON public.invitations;
DROP POLICY IF EXISTS "invitations_read_by_token" ON public.invitations;
DROP POLICY IF EXISTS "invitations_select"      ON public.invitations;
DROP POLICY IF EXISTS "invitations_insert"      ON public.invitations;
DROP POLICY IF EXISTS "invitations_update"      ON public.invitations;
DROP POLICY IF EXISTS "invitations_delete"      ON public.invitations;

CREATE POLICY "invitations_select" ON public.invitations
  FOR SELECT USING (public.is_org_admin(org_id));
CREATE POLICY "invitations_insert" ON public.invitations
  FOR INSERT WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY "invitations_update" ON public.invitations
  FOR UPDATE USING (public.is_org_admin(org_id));
CREATE POLICY "invitations_delete" ON public.invitations
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── audit_log (no org_id — uses updated global helpers) ──────────────────────
DROP POLICY IF EXISTS "audit_admin_read" ON public.audit_log;
DROP POLICY IF EXISTS "audit_write"      ON public.audit_log;
DROP POLICY IF EXISTS "audit_insert"     ON public.audit_log;

CREATE POLICY "audit_admin_read" ON public.audit_log
  FOR SELECT USING (public.is_admin());

-- Any active org member can write audit entries (app-level requirement).
CREATE POLICY "audit_insert" ON public.audit_log
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.org_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );


-- ── field_changes (no org_id — uses updated global helpers) ──────────────────
DROP POLICY IF EXISTS "field_changes_admin_read" ON public.field_changes;
DROP POLICY IF EXISTS "field_changes_write"      ON public.field_changes;
DROP POLICY IF EXISTS "field_changes_insert"     ON public.field_changes;

CREATE POLICY "field_changes_admin_read" ON public.field_changes
  FOR SELECT USING (public.is_admin());

CREATE POLICY "field_changes_insert" ON public.field_changes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.org_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );


-- ── category_opening_balances ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "cob_read"   ON public.category_opening_balances;
DROP POLICY IF EXISTS "cob_insert" ON public.category_opening_balances;
DROP POLICY IF EXISTS "cob_update" ON public.category_opening_balances;
DROP POLICY IF EXISTS "cob_delete" ON public.category_opening_balances;
DROP POLICY IF EXISTS "cob_select" ON public.category_opening_balances;

CREATE POLICY "cob_select" ON public.category_opening_balances
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "cob_insert" ON public.category_opening_balances
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "cob_update" ON public.category_opening_balances
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "cob_delete" ON public.category_opening_balances
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── report_templates ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "report_templates_select" ON public.report_templates;
DROP POLICY IF EXISTS "report_templates_write"  ON public.report_templates;
DROP POLICY IF EXISTS "report_templates_update" ON public.report_templates;
DROP POLICY IF EXISTS "report_templates_delete" ON public.report_templates;
DROP POLICY IF EXISTS "report_templates_insert" ON public.report_templates;

CREATE POLICY "report_templates_select" ON public.report_templates
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "report_templates_insert" ON public.report_templates
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "report_templates_update" ON public.report_templates
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "report_templates_delete" ON public.report_templates
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── special_config_groups ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "scg_read"   ON public.special_config_groups;
DROP POLICY IF EXISTS "scg_write"  ON public.special_config_groups;
DROP POLICY IF EXISTS "scg_select" ON public.special_config_groups;
DROP POLICY IF EXISTS "scg_insert" ON public.special_config_groups;
DROP POLICY IF EXISTS "scg_update" ON public.special_config_groups;
DROP POLICY IF EXISTS "scg_delete" ON public.special_config_groups;

CREATE POLICY "scg_select" ON public.special_config_groups
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "scg_insert" ON public.special_config_groups
  FOR INSERT WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY "scg_update" ON public.special_config_groups
  FOR UPDATE USING (public.is_org_admin(org_id));
CREATE POLICY "scg_delete" ON public.special_config_groups
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── transaction_allocation_snapshots ─────────────────────────────────────────
DROP POLICY IF EXISTS "tas_read"   ON public.transaction_allocation_snapshots;
DROP POLICY IF EXISTS "tas_insert" ON public.transaction_allocation_snapshots;
DROP POLICY IF EXISTS "tas_update" ON public.transaction_allocation_snapshots;
DROP POLICY IF EXISTS "tas_delete" ON public.transaction_allocation_snapshots;
DROP POLICY IF EXISTS "tas_select" ON public.transaction_allocation_snapshots;

CREATE POLICY "tas_select" ON public.transaction_allocation_snapshots
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "tas_insert" ON public.transaction_allocation_snapshots
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "tas_update" ON public.transaction_allocation_snapshots
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "tas_delete" ON public.transaction_allocation_snapshots
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── recalculation_logs (append-only) ─────────────────────────────────────────
DROP POLICY IF EXISTS "rl_read"   ON public.recalculation_logs;
DROP POLICY IF EXISTS "rl_insert" ON public.recalculation_logs;
DROP POLICY IF EXISTS "rl_select" ON public.recalculation_logs;

CREATE POLICY "rl_select" ON public.recalculation_logs
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "rl_insert" ON public.recalculation_logs
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));


-- ── dynamic_reports ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "dr_select" ON public.dynamic_reports;
DROP POLICY IF EXISTS "dr_write"  ON public.dynamic_reports;
DROP POLICY IF EXISTS "dr_update" ON public.dynamic_reports;
DROP POLICY IF EXISTS "dr_delete" ON public.dynamic_reports;
DROP POLICY IF EXISTS "dr_insert" ON public.dynamic_reports;

CREATE POLICY "dr_select" ON public.dynamic_reports
  FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY "dr_insert" ON public.dynamic_reports
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
CREATE POLICY "dr_update" ON public.dynamic_reports
  FOR UPDATE USING (public.is_org_finance_user(org_id));
CREATE POLICY "dr_delete" ON public.dynamic_reports
  FOR DELETE USING (public.is_org_admin(org_id));


-- ── dynamic_report_blocks (no org_id — isolate via parent dynamic_reports) ────
-- Skipped silently if the table does not exist on this database.
DO $$ BEGIN
  DROP POLICY IF EXISTS "drb_select" ON public.dynamic_report_blocks;
  DROP POLICY IF EXISTS "drb_write"  ON public.dynamic_report_blocks;
  DROP POLICY IF EXISTS "drb_update" ON public.dynamic_report_blocks;
  DROP POLICY IF EXISTS "drb_delete" ON public.dynamic_report_blocks;
  DROP POLICY IF EXISTS "drb_insert" ON public.dynamic_report_blocks;

  CREATE POLICY "drb_select" ON public.dynamic_report_blocks
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.dynamic_reports dr
        JOIN public.org_members m
          ON m.org_id = dr.org_id AND m.user_id = auth.uid() AND m.status = 'active'
        WHERE dr.id = report_id
      )
    );
  CREATE POLICY "drb_insert" ON public.dynamic_report_blocks
    FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.dynamic_reports dr
        JOIN public.org_members m
          ON m.org_id = dr.org_id AND m.user_id = auth.uid()
          AND m.role IN ('admin', 'accountant') AND m.status = 'active'
        WHERE dr.id = report_id
      )
    );
  CREATE POLICY "drb_update" ON public.dynamic_report_blocks
    FOR UPDATE USING (
      EXISTS (
        SELECT 1 FROM public.dynamic_reports dr
        JOIN public.org_members m
          ON m.org_id = dr.org_id AND m.user_id = auth.uid()
          AND m.role IN ('admin', 'accountant') AND m.status = 'active'
        WHERE dr.id = report_id
      )
    );
  CREATE POLICY "drb_delete" ON public.dynamic_report_blocks
    FOR DELETE USING (
      EXISTS (
        SELECT 1 FROM public.dynamic_reports dr
        JOIN public.org_members m
          ON m.org_id = dr.org_id AND m.user_id = auth.uid()
          AND m.role = 'admin' AND m.status = 'active'
        WHERE dr.id = report_id
      )
    );
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── dynamic_report_snapshots (no org_id — isolate via parent dynamic_reports) ─
-- Skipped silently if the table does not exist on this database.
DO $$ BEGIN
  DROP POLICY IF EXISTS "drs_select" ON public.dynamic_report_snapshots;
  DROP POLICY IF EXISTS "drs_write"  ON public.dynamic_report_snapshots;
  DROP POLICY IF EXISTS "drs_delete" ON public.dynamic_report_snapshots;
  DROP POLICY IF EXISTS "drs_insert" ON public.dynamic_report_snapshots;

  CREATE POLICY "drs_select" ON public.dynamic_report_snapshots
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.dynamic_reports dr
        JOIN public.org_members m
          ON m.org_id = dr.org_id AND m.user_id = auth.uid() AND m.status = 'active'
        WHERE dr.id = report_id
      )
    );
  CREATE POLICY "drs_insert" ON public.dynamic_report_snapshots
    FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.dynamic_reports dr
        JOIN public.org_members m
          ON m.org_id = dr.org_id AND m.user_id = auth.uid()
          AND m.role IN ('admin', 'accountant') AND m.status = 'active'
        WHERE dr.id = report_id
      )
    );
  CREATE POLICY "drs_delete" ON public.dynamic_report_snapshots
    FOR DELETE USING (
      EXISTS (
        SELECT 1 FROM public.dynamic_reports dr
        JOIN public.org_members m
          ON m.org_id = dr.org_id AND m.user_id = auth.uid()
          AND m.role = 'admin' AND m.status = 'active'
        WHERE dr.id = report_id
      )
    );
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


NOTIFY pgrst, 'reload schema';
