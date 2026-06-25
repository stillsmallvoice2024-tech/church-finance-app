-- Fix A: Make complete_org_onboarding() idempotent for both group and draft config.
-- Previously, the draft config was only created inside the group-creation block,
-- so any org whose group already existed (from the unification migration or a prior
-- onboarding run) never got a draft and hit "Could not find draft distribution rule."
--
-- Fix B: Backfill — insert a draft placeholder for every org that already has a
-- General rule group but no draft config (orgs migrated by 20260621000000 that had
-- pre-existing locked general configs fall into this bucket).
-- ─────────────────────────────────────────────────────────────────────────────────

-- Fix A ──────────────────────────────────────────────────────────────────────────

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

  -- Seed General category
  IF NOT EXISTS (
    SELECT 1 FROM public.categories WHERE org_id = p_org_id AND is_default = true
  ) THEN
    INSERT INTO public.categories (org_id, name, is_default)
    VALUES (p_org_id, 'General', true);
  END IF;

  -- Get or create the General rule group (decoupled from draft-config creation)
  SELECT id INTO v_group_id
  FROM public.special_config_groups
  WHERE org_id = p_org_id AND is_default = true
  LIMIT 1;

  IF v_group_id IS NULL THEN
    INSERT INTO public.special_config_groups (org_id, name, is_default)
    VALUES (p_org_id, 'General', true)
    RETURNING id INTO v_group_id;
  END IF;

  -- Ensure a draft config exists in the group, independently of whether the group
  -- was just created or already existed.
  IF NOT EXISTS (
    SELECT 1 FROM public.allocation_configs
    WHERE config_group_id = v_group_id AND status = 'draft'
  ) THEN
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

GRANT EXECUTE ON FUNCTION public.complete_org_onboarding(uuid, text, text, int, text)
  TO authenticated;

-- Fix B ──────────────────────────────────────────────────────────────────────────
-- Backfill: for orgs that already have a General group (created by the unification
-- migration) but no draft config, insert a blank draft placeholder now.

INSERT INTO public.allocation_configs (
  org_id, config_group_id, name,
  start_date, effective_from, effective_to,
  status, is_special, allocation_type, rows, version_number
)
SELECT
  scg.org_id,
  scg.id,
  'General Distribution Rule',
  o.created_at::date,
  o.created_at::date,
  NULL,
  'draft',
  false,
  'percentage',
  '[]'::jsonb,
  1
FROM public.special_config_groups scg
JOIN public.organizations o ON o.id = scg.org_id
WHERE scg.is_default = true
  AND NOT EXISTS (
    SELECT 1 FROM public.allocation_configs ac
    WHERE ac.config_group_id = scg.id AND ac.status = 'draft'
  );

NOTIFY pgrst, 'reload schema';
