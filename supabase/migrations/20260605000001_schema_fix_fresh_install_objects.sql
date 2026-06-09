-- ── LB-4/S-C1: Schema fix — ensure objects present on existing DBs ───────────
-- Companion to the schema.sql rewrite.  Idempotent; safe on any existing DB.
-- Creates tables that were missing from the original schema.sql but are
-- referenced by migrations / RPCs:
--   • fx_conversions          (referenced by perform_fx_conversion)
--   • user_preferences        (added via 20260602000002_user_preferences.sql)
--   • org_deletion_backups    (added via 20260602000001_org_deletion_flow.sql)
-- Also fixes the purge_org RPC to remove the broken explicit deletes of
-- dynamic_report_blocks/snapshots (those tables have no org_id column).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. fx_conversions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fx_conversions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date                  date NOT NULL,
  fx_currency           text NOT NULL,
  fx_amount             numeric(15,4) NOT NULL CHECK (fx_amount > 0),
  exchange_rate         numeric(15,6) NOT NULL CHECK (exchange_rate > 0),
  naira_amount          numeric(15,4) NOT NULL CHECK (naira_amount > 0),
  fx_withdrawal_id      uuid REFERENCES public.fx_transactions(id) ON DELETE SET NULL,
  naira_inflow_id       uuid REFERENCES public.inflow_transactions(id) ON DELETE SET NULL,
  notes                 text,
  allocation_config_id  uuid REFERENCES public.allocation_configs(id) ON DELETE SET NULL,
  is_partial            boolean NOT NULL DEFAULT false,
  created_by            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fx_conversions
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.fx_conversions
  ALTER COLUMN org_id SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.fx_conversions ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY fx_conversions_select ON public.fx_conversions FOR SELECT
    USING (public.is_org_member(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY fx_conversions_insert ON public.fx_conversions FOR INSERT
    WITH CHECK (public.is_org_finance_user(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY fx_conversions_delete ON public.fx_conversions FOR DELETE
    USING (public.is_org_admin(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_fx_conversions_org      ON public.fx_conversions(org_id);
CREATE INDEX IF NOT EXISTS idx_fx_conversions_org_date ON public.fx_conversions(org_id, date);

-- ── 2. user_preferences ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_preferences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id)
);

DO $$ BEGIN
  ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY user_preferences_select ON public.user_preferences FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY user_preferences_upsert ON public.user_preferences FOR INSERT
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY user_preferences_update ON public.user_preferences FOR UPDATE
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS user_preferences_user_id_idx ON public.user_preferences (user_id);
CREATE INDEX IF NOT EXISTS user_preferences_org_id_idx  ON public.user_preferences (org_id);

CREATE OR REPLACE FUNCTION public.set_user_preferences_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON public.user_preferences;
CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_user_preferences_updated_at();

-- ── 3. org_deletion_backups (already created by 20260602000001 on existing   ──
--        DBs, but needed here for fresh installs that skipped that migration) ──

CREATE TABLE IF NOT EXISTS public.org_deletion_backups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  backup_path text NOT NULL,
  backup_size bigint,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.org_deletion_backups ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY org_deletion_backups_select ON public.org_deletion_backups FOR SELECT
    USING (public.is_org_owner(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_org_deletion_backups_org ON public.org_deletion_backups(org_id);

-- ── 4. Fix purge_org: remove broken explicit deletes of tables with no org_id ─
-- dynamic_report_blocks and dynamic_report_snapshots have no org_id column.
-- Drop + recreate preserves the original RETURNS jsonb / service-role-only contract.

DROP FUNCTION IF EXISTS public.purge_org(uuid);
CREATE OR REPLACE FUNCTION public.purge_org(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
  -- dynamic_report_blocks / dynamic_report_snapshots have no org_id column;
  -- deleting dynamic_reports cascades both child tables automatically.
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
  v_step := 'user_preferences';
  DELETE FROM public.user_preferences                  WHERE org_id = p_org_id;
  v_step := 'invitations';
  DELETE FROM public.invitations                       WHERE org_id = p_org_id;
  v_step := 'org_deletion_backups';
  DELETE FROM public.org_deletion_backups              WHERE org_id = p_org_id;
  v_step := 'audit_log (org entries)';
  DELETE FROM public.audit_log                         WHERE org_id = p_org_id;
  v_step := 'org_members';
  DELETE FROM public.org_members                       WHERE org_id = p_org_id;
  v_step := 'organizations';
  DELETE FROM public.organizations                     WHERE id = p_org_id;

  INSERT INTO public.audit_log (
    table_name, record_id, action, old_data, new_data, user_id, created_at
  ) VALUES (
    'organizations', p_org_id, 'PURGED', v_snap, NULL, NULL, now()
  );

  RETURN jsonb_build_object('ok', true, 'org_id', p_org_id, 'purged_at', now());

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false, 'error', SQLERRM, 'step', v_step, 'sqlstate', SQLSTATE
  );
END;
$$;

-- purge_org is NOT granted to authenticated — service-role only via Edge Function

NOTIFY pgrst, 'reload schema';
