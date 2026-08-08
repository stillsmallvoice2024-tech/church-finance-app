// Historical migration SQL for existing self-hosted databases.
// Canonical copies live in supabase/migrations/. Kept exported for reference.

// SUPERSEDED by supabase/migrations/20260807000001_org_scope_currencies.sql,
// which replaces this global table with a per-organisation one. Kept only as a
// record of the original shape — do not run it on a current database.
export const CURRENCIES_MIGRATION_SQL =
`-- Create currencies table
CREATE TABLE IF NOT EXISTS public.currencies (
  code       text PRIMARY KEY,
  name       text NOT NULL,
  symbol     text NOT NULL DEFAULT '',
  flag       text,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer DEFAULT 100
);
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "currencies_read"  ON public.currencies FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY IF NOT EXISTS "currencies_write" ON public.currencies FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Seed default currencies (skip if already present)
INSERT INTO public.currencies (code, name, symbol, flag, sort_order) VALUES
  ('NGN', 'Nigerian Naira', '₦', '🇳🇬', 0),
  ('USD', 'US Dollar',      '$', '🇺🇸', 1),
  ('GBP', 'British Pound',  '£', '🇬🇧', 2),
  ('EUR', 'Euro',           '€', '🇪🇺', 3),
  ('CNY', 'Chinese Yuan',   '¥', '🇨🇳', 4)
ON CONFLICT (code) DO NOTHING;

-- Remove hardcoded currency check constraints (if they exist)
ALTER TABLE public.banks          DROP CONSTRAINT IF EXISTS banks_currency_check;
ALTER TABLE public.fx_transactions DROP CONSTRAINT IF EXISTS fx_transactions_currency_check;`

// ── Distribution Rules Unification — Phase 1 migration ────────────────────────────────
// Run this ONCE in Supabase SQL editor on each existing database.
// Safe to re-run (all ops are idempotent).
export const DISTRIBUTION_RULES_MIGRATION_SQL = `-- ── Distribution Rules Unification — Phase 1 ────────────────────────────────
-- Run once in Supabase SQL editor. Safe to re-run (idempotent).

-- 1. New columns
ALTER TABLE public.special_config_groups
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- 2. Performance indexes
CREATE INDEX IF NOT EXISTS idx_alloc_configs_group_date
  ON public.allocation_configs(config_group_id, status, effective_from, effective_to)
  WHERE config_group_id IS NOT NULL;

DO $$ BEGIN
  CREATE UNIQUE INDEX idx_alloc_configs_group_effrom_unique
    ON public.allocation_configs(config_group_id, effective_from)
    WHERE status = 'locked';
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

-- 3. Per-org migration: create General rule group + version history
DO $$
DECLARE
  v_org         record;
  v_group_id    uuid;
  v_cfg         record;
  v_next_effrom date;
  v_idx         int;
BEGIN
  FOR v_org IN
    SELECT id, created_at FROM public.organizations
    WHERE status IS NULL OR status = 'active'
  LOOP

    IF EXISTS (
      SELECT 1 FROM public.special_config_groups
      WHERE org_id = v_org.id AND is_default = true
    ) THEN CONTINUE; END IF;

    INSERT INTO public.special_config_groups (org_id, name, is_default)
    VALUES (v_org.id, 'General', true)
    RETURNING id INTO v_group_id;

    IF EXISTS (
      SELECT 1 FROM public.allocation_configs
      WHERE org_id = v_org.id
        AND (is_special = false OR is_special IS NULL)
        AND config_group_id IS NULL
    ) THEN
      -- Scenario A/B: migrate existing general configs
      v_idx := 1;
      FOR v_cfg IN
        SELECT * FROM public.allocation_configs
        WHERE org_id = v_org.id
          AND (is_special = false OR is_special IS NULL)
          AND config_group_id IS NULL
        ORDER BY start_date ASC, created_at ASC
      LOOP
        UPDATE public.allocation_configs
        SET config_group_id = v_group_id,
            effective_from  = COALESCE(effective_from, v_cfg.start_date),
            version_number  = v_idx
        WHERE id = v_cfg.id;
        v_idx := v_idx + 1;
      END LOOP;

      FOR v_cfg IN
        SELECT id, COALESCE(effective_from, start_date) AS eff_from
        FROM public.allocation_configs
        WHERE config_group_id = v_group_id AND org_id = v_org.id
        ORDER BY COALESCE(effective_from, start_date) ASC
      LOOP
        SELECT COALESCE(effective_from, start_date)
        INTO   v_next_effrom
        FROM   public.allocation_configs
        WHERE  config_group_id = v_group_id
          AND  org_id = v_org.id
          AND  COALESCE(effective_from, start_date) > v_cfg.eff_from
        ORDER BY COALESCE(effective_from, start_date) ASC
        LIMIT 1;

        IF v_next_effrom IS NOT NULL THEN
          UPDATE public.allocation_configs
          SET effective_to = v_next_effrom - INTERVAL '1 day'
          WHERE id = v_cfg.id;
        END IF;
      END LOOP;

    ELSE
      -- Scenario C: no general configs — create draft placeholder
      INSERT INTO public.allocation_configs (
        org_id, config_group_id, name,
        start_date, effective_from, effective_to,
        status, is_special, allocation_type, rows, version_number
      ) VALUES (
        v_org.id, v_group_id, 'General Distribution Rule',
        v_org.created_at::date, v_org.created_at::date, NULL,
        'draft', false, 'percentage', '[]'::jsonb, 1
      );
    END IF;

  END LOOP;
END $$;

-- 4. Update complete_org_onboarding() for new orgs
DROP FUNCTION IF EXISTS public.complete_org_onboarding(uuid, text, text, int, text);

CREATE OR REPLACE FUNCTION public.complete_org_onboarding(
  p_org_id            uuid,
  p_name              text,
  p_default_currency  text,
  p_fiscal_year_start int  DEFAULT 1,
  p_timezone          text DEFAULT 'Africa/Lagos'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_group_id uuid;
  v_org_date date;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = v_user_id
      AND role IN ('owner','admin') AND status = 'active'
  ) THEN RAISE EXCEPTION 'Unauthorized: only org admins can complete onboarding'; END IF;

  UPDATE public.organizations
  SET name = trim(p_name), default_currency = p_default_currency,
      fiscal_year_start = p_fiscal_year_start, timezone = p_timezone,
      onboarding_complete = true, updated_at = now()
  WHERE id = p_org_id;

  SELECT created_at::date INTO v_org_date
  FROM public.organizations WHERE id = p_org_id;

  IF NOT EXISTS (SELECT 1 FROM public.income_types WHERE org_id = p_org_id LIMIT 1) THEN
    INSERT INTO public.income_types (org_id, name, color) VALUES
      (p_org_id,'Tithe','#6366f1'),(p_org_id,'Offering','#10b981'),
      (p_org_id,'Donation','#f59e0b'),(p_org_id,'Special Giving','#ec4899'),
      (p_org_id,'Thanksgiving','#3b82f6'),(p_org_id,'Project','#8b5cf6');
  END IF;

  INSERT INTO public.outflow_types (org_id, name, color, is_system, is_locked)
  VALUES (p_org_id,'General','#64748b',true,true)
  ON CONFLICT (org_id, name) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.categories WHERE org_id = p_org_id AND is_default = true) THEN
    INSERT INTO public.categories (org_id, name, is_default)
    VALUES (p_org_id, 'General', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.special_config_groups WHERE org_id = p_org_id AND is_default = true) THEN
    INSERT INTO public.special_config_groups (org_id, name, is_default)
    VALUES (p_org_id, 'General', true)
    RETURNING id INTO v_group_id;

    INSERT INTO public.allocation_configs (
      org_id, config_group_id, name,
      start_date, effective_from, effective_to,
      status, is_special, allocation_type, rows, version_number
    ) VALUES (
      p_org_id, v_group_id, 'General Distribution Rule',
      v_org_date, v_org_date, NULL,
      'draft', false, 'percentage',
      '[]'::jsonb,
      1
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_org_onboarding(uuid,text,text,int,text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Distribution Rules — Phase 2: Supersede / Amendment / Date-split audit ────
-- Add columns for version lineage and audit trail. Safe to re-run (idempotent).

ALTER TABLE public.allocation_configs
  ADD COLUMN IF NOT EXISTS superseded_by_id  uuid
    REFERENCES public.allocation_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at     timestamptz,
  ADD COLUMN IF NOT EXISTS change_type       text
    CHECK (change_type IN ('initial','new_version','date_split','amendment'))
    DEFAULT 'initial',
  ADD COLUMN IF NOT EXISTS source_version_id uuid
    REFERENCES public.allocation_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amendment_reason  text;

NOTIFY pgrst, 'reload schema';`

export const SYSTEM_DEFAULTS_MIGRATION_SQL =
`-- ── System Defaults: is_system columns + protected seeds ────────────────────
-- Adds is_system flag to income_types and categories.
-- Marks the "General Donation" income type and "General" category as system-protected.
-- Safe to re-run (idempotent).

ALTER TABLE public.income_types
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

-- Mark existing "General Donation" rows as system-protected (no data overridden)
UPDATE public.income_types
SET is_system = true
WHERE name = 'General Donation' AND (is_system = false OR is_system IS NULL);

-- Insert "General Donation" only for orgs that don't have one yet
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT o.id FROM public.organizations o
    WHERE NOT EXISTS (
      SELECT 1 FROM public.income_types i
      WHERE i.org_id = o.id AND i.name = 'General Donation'
    )
  LOOP
    BEGIN
      INSERT INTO public.income_types (org_id, name, color, is_system)
      VALUES (r.id, 'General Donation', '#6b7280', true);
    EXCEPTION WHEN OTHERS THEN NULL; -- skip locked/deleted orgs
    END;
  END LOOP;
END;
$$;

-- Mark "General" category as system-protected for all orgs (idempotent)
UPDATE public.categories
SET is_system = true
WHERE name = 'General' AND is_default = true AND is_system = false;

-- Update complete_org_onboarding() to seed General Donation for new orgs
DROP FUNCTION IF EXISTS public.complete_org_onboarding(uuid, text, text, int, text);

CREATE OR REPLACE FUNCTION public.complete_org_onboarding(
  p_org_id            uuid,
  p_name              text,
  p_default_currency  text,
  p_fiscal_year_start int  DEFAULT 1,
  p_timezone          text DEFAULT 'Africa/Lagos'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_group_id uuid;
  v_org_date date;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = v_user_id
      AND role IN ('owner','admin') AND status = 'active'
  ) THEN RAISE EXCEPTION 'Unauthorized: only org admins can complete onboarding'; END IF;

  UPDATE public.organizations
  SET name = trim(p_name), default_currency = p_default_currency,
      fiscal_year_start = p_fiscal_year_start, timezone = p_timezone,
      onboarding_complete = true, updated_at = now()
  WHERE id = p_org_id;

  SELECT created_at::date INTO v_org_date
  FROM public.organizations WHERE id = p_org_id;

  IF NOT EXISTS (SELECT 1 FROM public.income_types WHERE org_id = p_org_id LIMIT 1) THEN
    INSERT INTO public.income_types (org_id, name, color, is_system) VALUES
      (p_org_id,'General Donation','#6b7280',true);
    INSERT INTO public.income_types (org_id, name, color) VALUES
      (p_org_id,'Tithe','#6366f1'),(p_org_id,'Offering','#10b981'),
      (p_org_id,'Donation','#f59e0b'),(p_org_id,'Special Giving','#ec4899'),
      (p_org_id,'Thanksgiving','#3b82f6'),(p_org_id,'Project','#8b5cf6');
  END IF;

  INSERT INTO public.outflow_types (org_id, name, color, is_system, is_locked)
  VALUES (p_org_id,'General','#64748b',true,true)
  ON CONFLICT (org_id, name) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.categories WHERE org_id = p_org_id AND is_default = true) THEN
    INSERT INTO public.categories (org_id, name, is_default, is_system)
    VALUES (p_org_id, 'General', true, true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.special_config_groups WHERE org_id = p_org_id AND is_default = true) THEN
    INSERT INTO public.special_config_groups (org_id, name, is_default)
    VALUES (p_org_id, 'General', true)
    RETURNING id INTO v_group_id;

    INSERT INTO public.allocation_configs (
      org_id, config_group_id, name,
      start_date, effective_from, effective_to,
      status, is_special, allocation_type, rows, version_number
    ) VALUES (
      p_org_id, v_group_id, 'General Distribution Rule',
      v_org_date, v_org_date, NULL,
      'draft', false, 'percentage',
      '[]'::jsonb,
      1
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_org_onboarding(uuid,text,text,int,text) TO authenticated;`

export const SPECIAL_CONFIG_RPC_MIGRATION_SQL =
`-- ── Special Config Version RPC ───────────────────────────────────────────────
-- Atomic function to create a new special config version.
-- Required for "Create New Version" (including from past versions) to work.
-- Safe to re-run (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.create_special_config_version(
  p_group_id       uuid,
  p_org_id         uuid,
  p_name           text,
  p_allocation_type text,
  p_total_amount   numeric(15,2),
  p_rows           jsonb,
  p_effective_from date,
  p_status         text DEFAULT 'draft'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $$
DECLARE
  v_covering_id   uuid;
  v_next_from     date;
  v_new_to        date;
  v_max_ver       integer;
  v_new_id        uuid;
BEGIN
  IF NOT public.is_org_admin(p_org_id) THEN
    RAISE EXCEPTION 'create_special_config_version: caller must be an org admin';
  END IF;

  IF p_status NOT IN ('draft', 'locked') THEN
    RAISE EXCEPTION 'create_special_config_version: invalid status %', p_status;
  END IF;

  -- Lock the group row to prevent concurrent version creation. lock_timeout
  -- turns contention into a fast, readable error instead of a hang that the
  -- browser eventually cancels with an opaque AbortError.
  BEGIN
    PERFORM id FROM public.special_config_groups
    WHERE id = p_group_id AND org_id = p_org_id
    FOR UPDATE;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION
      'Another change to this distribution rule is still in progress. Wait a moment and try again.';
  END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_special_config_version: group % not found in org %', p_group_id, p_org_id;
  END IF;

  -- Compute next version number server-side
  SELECT COALESCE(MAX(version_number), 0) INTO v_max_ver
  FROM   public.allocation_configs
  WHERE  config_group_id = p_group_id AND org_id = p_org_id;

  IF p_status = 'locked' THEN
    -- Covering version = the locked version whose range contains the new
    -- start date. Only locked versions define the live timeline.
    SELECT id INTO v_covering_id
    FROM   public.allocation_configs
    WHERE  config_group_id = p_group_id
      AND  org_id          = p_org_id
      AND  status          = 'locked'
      AND  superseded_by_id IS NULL
      AND  effective_from <= p_effective_from
      AND  (effective_to IS NULL OR effective_to >= p_effective_from)
    ORDER BY effective_from DESC
    LIMIT  1;

    SELECT effective_from INTO v_next_from
    FROM   public.allocation_configs
    WHERE  config_group_id = p_group_id
      AND  org_id          = p_org_id
      AND  status          = 'locked'
      AND  superseded_by_id IS NULL
      AND  effective_from  > p_effective_from
    ORDER BY effective_from
    LIMIT  1;

    v_new_to := CASE WHEN v_next_from IS NOT NULL
                     THEN v_next_from - 1
                     ELSE NULL END;

    -- Close the covering version. Never done for drafts — a draft applies to
    -- nothing and must not shorten the rule that is currently live.
    IF v_covering_id IS NOT NULL THEN
      UPDATE public.allocation_configs
      SET    effective_to = p_effective_from - 1
      WHERE  id = v_covering_id
        AND  effective_from < p_effective_from;
    END IF;
  ELSE
    v_new_to := NULL;
  END IF;

  -- Insert new version
  INSERT INTO public.allocation_configs (
    name, is_special, allocation_type, total_amount, rows,
    effective_from, effective_to, version_number,
    config_group_id, start_date, status, org_id
  ) VALUES (
    p_name,
    NOT COALESCE((SELECT is_default FROM public.special_config_groups WHERE id = p_group_id), false),
    p_allocation_type, p_total_amount, p_rows,
    p_effective_from, v_new_to, v_max_ver + 1,
    p_group_id, p_effective_from, p_status, p_org_id
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL   ON FUNCTION public.create_special_config_version(uuid,uuid,text,text,numeric,jsonb,date,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_special_config_version(uuid,uuid,text,text,numeric,jsonb,date,text) TO authenticated;

NOTIFY pgrst, 'reload schema';`

export const ARCHIVE_GROUPS_MIGRATION_SQL =
`-- ── Config Group Archive / Hide ──────────────────────────────────────────────
-- Adds is_archived flag to special_config_groups.
-- Archived groups are hidden from the active list but all data is preserved.
-- Safe to re-run (idempotent).

ALTER TABLE public.special_config_groups
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';`
