-- ============================================================
-- ORG ONBOARDING MIGRATION (20260530000000)
-- ============================================================
-- Adds self-signup organisation creation capability.
-- All statements are idempotent (ADD COLUMN IF NOT EXISTS, DROP IF EXISTS, etc.).
-- Safe to run on existing DBs without data loss.

-- ── 1. Add onboarding & settings columns to organizations ──────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_currency    text,
  ADD COLUMN IF NOT EXISTS fiscal_year_start   int     NOT NULL DEFAULT 1
    CHECK (fiscal_year_start BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS timezone            text    NOT NULL DEFAULT 'Africa/Lagos',
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT true;
-- DEFAULT true: existing orgs skip the onboarding wizard.
-- create_organization() explicitly sets onboarding_complete = false for new orgs.

NOTIFY pgrst, 'reload schema';

-- ── 2. Fix outflow_types name uniqueness for multi-tenancy ─────────────────────
-- The global UNIQUE(name) constraint prevents multiple orgs from having their own
-- 'General' type. Replace it with UNIQUE(org_id, name) so each org can seed
-- its own default types independently.

ALTER TABLE public.outflow_types DROP CONSTRAINT IF EXISTS outflow_types_name_key;

DO $$ BEGIN
  ALTER TABLE public.outflow_types
    ADD CONSTRAINT outflow_types_org_name_unique UNIQUE (org_id, name);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── 3. create_organization() ───────────────────────────────────────────────────
-- Atomically creates a new organisation + admin membership for the caller.
-- Uses SECURITY DEFINER to bypass the is_admin() RLS INSERT policy on organizations
-- (necessary because the caller isn't an admin of any org yet).
-- Removes the caller from the 'primary' bootstrap org if auto-enrolled as viewer.

CREATE OR REPLACE FUNCTION public.create_organization(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_org_id   uuid;
  v_slug     text;
  v_attempt  int  := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Organisation name cannot be empty';
  END IF;

  -- Derive a URL-safe slug from the org name
  v_slug := lower(regexp_replace(trim(p_name), '[^a-z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' OR v_slug = 'primary' THEN v_slug := 'org'; END IF;

  -- Insert with unique-slug retry (up to 9 suffix attempts)
  LOOP
    BEGIN
      INSERT INTO public.organizations (
        name, slug, created_by, onboarding_complete
      ) VALUES (
        trim(p_name),
        CASE WHEN v_attempt = 0 THEN v_slug ELSE v_slug || '-' || v_attempt END,
        v_user_id,
        false
      )
      RETURNING id INTO v_org_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_attempt := v_attempt + 1;
      IF v_attempt > 9 THEN
        RAISE EXCEPTION 'Could not generate a unique slug for: %', p_name;
      END IF;
    END;
  END LOOP;

  -- Make the caller an admin of the new org
  INSERT INTO public.org_members (org_id, user_id, role, status)
  VALUES (v_org_id, v_user_id, 'admin', 'active')
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET role = 'admin', status = 'active';

  -- Remove from the bootstrap 'primary' org if enrolled as a viewer by the
  -- handle_new_user trigger — the caller now has their own org.
  DELETE FROM public.org_members
  WHERE  org_id  = (SELECT id FROM public.organizations WHERE slug = 'primary' LIMIT 1)
    AND  user_id = v_user_id
    AND  role    = 'viewer';

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(text) TO authenticated;

-- ── 4. complete_org_onboarding() ───────────────────────────────────────────────
-- Saves org settings collected in the wizard, seeds default data, marks
-- onboarding as complete. SECURITY DEFINER so it can write to tables that have
-- org-scoped RLS without going through multiple client-side inserts.
-- Idempotent: safe to call multiple times (seeds only if the org has none yet).

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
  -- Caller must be an admin of this org
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE  org_id  = p_org_id
      AND  user_id = v_user_id
      AND  role    = 'admin'
      AND  status  = 'active'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only org admins can complete onboarding';
  END IF;

  -- Persist org settings and mark onboarding done
  UPDATE public.organizations
  SET
    name                 = trim(p_name),
    default_currency     = p_default_currency,
    fiscal_year_start    = p_fiscal_year_start,
    timezone             = p_timezone,
    onboarding_complete  = true,
    updated_at           = now()
  WHERE id = p_org_id;

  -- Seed default income types (only if the org has none — idempotent guard)
  IF NOT EXISTS (SELECT 1 FROM public.income_types WHERE org_id = p_org_id LIMIT 1) THEN
    INSERT INTO public.income_types (org_id, name, color) VALUES
      (p_org_id, 'Tithe',          '#6366f1'),
      (p_org_id, 'Offering',       '#10b981'),
      (p_org_id, 'Donation',       '#f59e0b'),
      (p_org_id, 'Special Giving', '#ec4899'),
      (p_org_id, 'Thanksgiving',   '#3b82f6'),
      (p_org_id, 'Project',        '#8b5cf6');
  END IF;

  -- Seed the fallback 'General' outflow type for this org (idempotent)
  INSERT INTO public.outflow_types (org_id, name, color, is_system, is_locked)
  VALUES (p_org_id, 'General', '#64748b', true, true)
  ON CONFLICT (org_id, name) DO NOTHING;

END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_org_onboarding(uuid, text, text, int, text) TO authenticated;
