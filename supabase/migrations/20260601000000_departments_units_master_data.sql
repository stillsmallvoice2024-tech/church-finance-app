-- ============================================================
-- DEPARTMENTS / UNITS MASTER DATA  (20260601000000)
-- Idempotent — safe to re-run on any DB state.
--
-- Creates the departments table if it does not exist, enables RLS,
-- and (re)creates the four tenant-scoped policies.
-- Drops old policies first so the file is safe to re-apply.
-- ============================================================

-- ── 1. Ensure is_org_finance_user and is_org_admin helpers exist ──────────────
-- These were introduced in the multi_tenant_foundation migration.
-- Re-declaring here with CREATE OR REPLACE guarantees they exist even on
-- databases that were set up from schema.sql without running all migrations.

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

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = auth.uid()
      AND status  = 'active'
  );
$$;

-- ── 2. Create departments table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.departments (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text        NOT NULL,
  code        text,
  description text,
  active      boolean     NOT NULL DEFAULT true,
  org_id      uuid        REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_by  uuid        REFERENCES public.profiles(id),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ── 3. Set DEFAULT org_id so inserts without explicit org_id use primary org ──

ALTER TABLE public.departments
  ALTER COLUMN org_id SET DEFAULT public.get_current_org_id();

-- ── 4. Indexes ────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS departments_org_name_unique
  ON public.departments(org_id, name);

CREATE INDEX IF NOT EXISTS idx_departments_org_active
  ON public.departments(org_id, active);

CREATE INDEX IF NOT EXISTS idx_departments_org
  ON public.departments(org_id);

-- ── 5. Enable RLS ─────────────────────────────────────────────────────────────

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

-- ── 6. (Re)create RLS policies ────────────────────────────────────────────────

DROP POLICY IF EXISTS "departments_select" ON public.departments;
DROP POLICY IF EXISTS "departments_insert" ON public.departments;
DROP POLICY IF EXISTS "departments_update" ON public.departments;
DROP POLICY IF EXISTS "departments_delete" ON public.departments;

CREATE POLICY "departments_select" ON public.departments
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "departments_insert" ON public.departments
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));

CREATE POLICY "departments_update" ON public.departments
  FOR UPDATE USING (public.is_org_finance_user(org_id));

CREATE POLICY "departments_delete" ON public.departments
  FOR DELETE USING (public.is_org_admin(org_id));

-- ── 7. Backfill org_id for any rows that were inserted without one ────────────

DO $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'primary' LIMIT 1;
  IF v_org_id IS NOT NULL THEN
    UPDATE public.departments SET org_id = v_org_id WHERE org_id IS NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
