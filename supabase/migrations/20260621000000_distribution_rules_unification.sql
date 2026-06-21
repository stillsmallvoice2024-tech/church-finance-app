-- ── Distribution Rules Unification — Phase 1 ─────────────────────────────────
-- Adds is_default to special_config_groups and categories.
-- Creates a General rule group per org and migrates existing general
-- (is_special=false) allocation configs into it with proper versioning.
-- Orgs with no general configs get a draft placeholder + a setup banner
-- will surface in the UI until they configure and lock their General rule.
-- Safe to re-run (all ops are idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Schema additions ──────────────────────────────────────────────────────────

ALTER TABLE public.special_config_groups
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- 2. Performance index for query-time version resolution ───────────────────────

CREATE INDEX IF NOT EXISTS idx_alloc_configs_group_date
  ON public.allocation_configs(config_group_id, status, effective_from, effective_to)
  WHERE config_group_id IS NOT NULL;

-- Partial unique index: no two locked versions of the same group can share
-- effective_from.  Drafts are exempt (users may draft multiple before locking).
DO $$ BEGIN
  CREATE UNIQUE INDEX idx_alloc_configs_group_effrom_unique
    ON public.allocation_configs(config_group_id, effective_from)
    WHERE status = 'locked';
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

-- 3. Per-org migration ─────────────────────────────────────────────────────────

DO $$
DECLARE
  v_org            record;
  v_group_id       uuid;
  v_cfg            record;
  v_next_effrom    date;
  v_idx            int;
BEGIN
  FOR v_org IN SELECT id, created_at FROM public.organizations LOOP

    -- Skip if General group already exists for this org (idempotent re-run)
    IF EXISTS (
      SELECT 1 FROM public.special_config_groups
      WHERE org_id = v_org.id AND is_default = true
    ) THEN
      CONTINUE;
    END IF;

    -- Create the General rule group
    INSERT INTO public.special_config_groups (org_id, name, is_default)
    VALUES (v_org.id, 'General', true)
    RETURNING id INTO v_group_id;

    IF EXISTS (
      SELECT 1 FROM public.allocation_configs
      WHERE org_id = v_org.id
        AND (is_special = false OR is_special IS NULL)
        AND config_group_id IS NULL
    ) THEN
      -- ── Scenario A/B: migrate existing general configs ──────────────────────
      -- Assign version numbers ordered by start_date ascending.
      v_idx := 1;
      FOR v_cfg IN
        SELECT * FROM public.allocation_configs
        WHERE org_id = v_org.id
          AND (is_special = false OR is_special IS NULL)
          AND config_group_id IS NULL
        ORDER BY start_date ASC, created_at ASC
      LOOP
        UPDATE public.allocation_configs
        SET
          config_group_id = v_group_id,
          -- effective_from may already be set for some rows; fall back to start_date
          effective_from  = COALESCE(effective_from, v_cfg.start_date),
          version_number  = v_idx
        WHERE id = v_cfg.id;

        v_idx := v_idx + 1;
      END LOOP;

      -- Set effective_to for each version = next version's effective_from - 1 day.
      -- The latest version keeps effective_to = NULL (open-ended).
      FOR v_cfg IN
        SELECT id, COALESCE(effective_from, start_date) AS eff_from
        FROM public.allocation_configs
        WHERE config_group_id = v_group_id
          AND org_id = v_org.id
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
        -- If v_next_effrom IS NULL → this is the latest version; leave effective_to = NULL
      END LOOP;

    ELSE
      -- ── Scenario C: no general configs — create draft placeholder ───────────
      -- The UI will surface a "Set up your General Distribution Rule" banner.
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

-- 4. Update complete_org_onboarding() to seed General category + rule for new orgs

-- Must drop first because we are adding parameters.
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
  v_user_id    uuid := auth.uid();
  v_group_id   uuid;
  v_org_date   date;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = v_user_id
      AND role    IN ('owner', 'admin')
      AND status  = 'active'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only org admins can complete onboarding';
  END IF;

  UPDATE public.organizations
  SET name                = trim(p_name),
      default_currency    = p_default_currency,
      fiscal_year_start   = p_fiscal_year_start,
      timezone            = p_timezone,
      onboarding_complete = true,
      updated_at          = now()
  WHERE id = p_org_id;

  SELECT created_at::date INTO v_org_date
  FROM public.organizations WHERE id = p_org_id;

  -- Seed default income types
  IF NOT EXISTS (SELECT 1 FROM public.income_types WHERE org_id = p_org_id LIMIT 1) THEN
    INSERT INTO public.income_types (org_id, name, color) VALUES
      (p_org_id, 'Tithe',          '#6366f1'),
      (p_org_id, 'Offering',       '#10b981'),
      (p_org_id, 'Donation',       '#f59e0b'),
      (p_org_id, 'Special Giving', '#ec4899'),
      (p_org_id, 'Thanksgiving',   '#3b82f6'),
      (p_org_id, 'Project',        '#8b5cf6');
  END IF;

  -- Seed system General outflow type
  INSERT INTO public.outflow_types (org_id, name, color, is_system, is_locked)
  VALUES (p_org_id, 'General', '#64748b', true, true)
  ON CONFLICT (org_id, name) DO NOTHING;

  -- Seed General category (is_default = true, fully visible to users)
  IF NOT EXISTS (
    SELECT 1 FROM public.categories WHERE org_id = p_org_id AND is_default = true
  ) THEN
    INSERT INTO public.categories (org_id, name, is_default)
    VALUES (p_org_id, 'General', true);
  END IF;

  -- Seed General rule group (is_default = true)
  IF NOT EXISTS (
    SELECT 1 FROM public.special_config_groups WHERE org_id = p_org_id AND is_default = true
  ) THEN
    INSERT INTO public.special_config_groups (org_id, name, is_default)
    VALUES (p_org_id, 'General', true)
    RETURNING id INTO v_group_id;

    -- Auto-lock a default version: 100% → General category.
    -- Onboarding Distribution Rules step will let the user replace this
    -- by creating a new version with their actual split.
    INSERT INTO public.allocation_configs (
      org_id, config_group_id, name,
      start_date, effective_from, effective_to,
      status, is_special, allocation_type, rows, version_number
    ) VALUES (
      p_org_id, v_group_id, 'General Distribution Rule',
      v_org_date, v_org_date, NULL,
      'locked', false, 'percentage',
      '[{"category_name":"General","budget_portion":"Percentage","percentage":100}]'::jsonb,
      1
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_org_onboarding(uuid, text, text, int, text)
  TO authenticated;

-- 5. Reload PostgREST schema cache ─────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
