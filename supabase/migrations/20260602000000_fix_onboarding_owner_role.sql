-- ============================================================
-- Fix: complete_org_onboarding() must accept 'owner' role
-- The create_organization() RPC (20260601000001) grants 'owner',
-- but complete_org_onboarding() still checked role = 'admin' only,
-- causing Step 3 to fail with "Unauthorized" for all new org creators.
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_org_onboarding(
  p_org_id            uuid,
  p_name              text,
  p_default_currency  text,
  p_fiscal_year_start int  DEFAULT 1,
  p_timezone          text DEFAULT 'Africa/Lagos'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE  org_id  = p_org_id
      AND  user_id = v_user_id
      AND  role    IN ('owner', 'admin')
      AND  status  = 'active'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only org admins can complete onboarding';
  END IF;

  UPDATE public.organizations
  SET
    name                 = trim(p_name),
    default_currency     = p_default_currency,
    fiscal_year_start    = p_fiscal_year_start,
    timezone             = p_timezone,
    onboarding_complete  = true,
    updated_at           = now()
  WHERE id = p_org_id;

  IF NOT EXISTS (SELECT 1 FROM public.income_types WHERE org_id = p_org_id LIMIT 1) THEN
    INSERT INTO public.income_types (org_id, name, color) VALUES
      (p_org_id, 'Tithe',          '#6366f1'),
      (p_org_id, 'Offering',       '#10b981'),
      (p_org_id, 'Donation',       '#f59e0b'),
      (p_org_id, 'Special Giving', '#ec4899'),
      (p_org_id, 'Thanksgiving',   '#3b82f6'),
      (p_org_id, 'Project',        '#8b5cf6');
  END IF;

  INSERT INTO public.outflow_types (org_id, name, color, is_system, is_locked)
  VALUES (p_org_id, 'General', '#64748b', true, true)
  ON CONFLICT (org_id, name) DO NOTHING;

END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_org_onboarding(uuid, text, text, int, text) TO authenticated;
