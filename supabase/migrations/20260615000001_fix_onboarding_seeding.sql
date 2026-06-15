-- Fix 1: categories.name had a global UNIQUE, blocking multiple orgs from
--         sharing common names like "General Fund". Changed to per-org uniqueness.
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_name_key;
ALTER TABLE public.categories ADD CONSTRAINT categories_org_name_key UNIQUE (org_id, name);

-- Fix 2: complete_org_onboarding() hardcoded 6 church-specific income types for
--         all org types. Income types are now seeded by the setup wizard instead.
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

  -- System outflow type only (locked, used internally for untagged outflows)
  INSERT INTO public.outflow_types (org_id, name, color, is_system, is_locked)
  VALUES (p_org_id, 'General', '#64748b', true, true)
  ON CONFLICT (org_id, name) DO NOTHING;

END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_org_onboarding(uuid, text, text, int, text) TO authenticated;
