-- ============================================================================
-- Unique organisation names
-- ============================================================================
-- Two organisations sharing the exact same name make cross-org leakage
-- invisible to the user: an unscoped query returning another org's rows looks
-- like correct data because the org label matches.  Enforcing globally unique
-- names removes that camouflage so any residual leak is immediately obvious.
--
-- Uniqueness is case-insensitive and whitespace-insensitive ("Grace Chapel",
-- "grace chapel" and " Grace  Chapel " all collide).  Organisations queued for
-- deletion are excluded so their names become reusable straight away.
-- ============================================================================

-- ── 1. Normalisation helper ──────────────────────────────────────────────────
-- IMMUTABLE so it can be used in an index expression.

CREATE OR REPLACE FUNCTION public.normalize_org_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
$$;

-- ── 2. De-duplicate existing rows ────────────────────────────────────────────
-- Oldest organisation keeps the name; later ones get " (2)", " (3)", … so the
-- unique index can be created without failing on legacy data.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id,
           name,
           row_number() OVER (
             PARTITION BY public.normalize_org_name(name)
             ORDER BY created_at, id
           ) AS rn
    FROM   public.organizations
    WHERE  status <> 'pending_deletion'
  LOOP
    IF r.rn > 1 THEN
      UPDATE public.organizations
      SET    name       = btrim(r.name) || ' (' || r.rn || ')',
             updated_at = now()
      WHERE  id = r.id;
    END IF;
  END LOOP;
END $$;

-- Trim stored names so the constraint and the displayed value agree.
UPDATE public.organizations
SET    name = btrim(regexp_replace(name, '\s+', ' ', 'g'))
WHERE  name <> btrim(regexp_replace(name, '\s+', ' ', 'g'));

-- ── 3. Unique index ──────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS organizations_name_unique
  ON public.organizations (public.normalize_org_name(name))
  WHERE status <> 'pending_deletion';

-- ── 4. create_organization(): reject duplicates with a readable error ────────
-- The existing slug-collision retry loop swallowed *any* unique_violation.  A
-- duplicate name would have burned all 10 attempts and surfaced as a confusing
-- "could not generate a unique slug".  The name is now checked up front, and
-- the loop only retries when the failing constraint is the slug index.

CREATE OR REPLACE FUNCTION public.create_organization(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_org_id     uuid;
  v_name       text;
  v_slug       text;
  v_attempt    int  := 0;
  v_constraint text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  v_name := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  IF length(v_name) = 0 THEN RAISE EXCEPTION 'Organisation name cannot be empty'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.organizations
    WHERE  public.normalize_org_name(name) = public.normalize_org_name(v_name)
      AND  status <> 'pending_deletion'
  ) THEN
    RAISE EXCEPTION 'An organisation named "%" already exists. Please choose a different name.', v_name
      USING ERRCODE = 'unique_violation';
  END IF;

  -- lower() must run BEFORE the character class, otherwise every capital
  -- matches [^a-z0-9] and is eaten ("Living Word" -> "iving-ord").
  v_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  IF v_slug = '' OR v_slug = 'primary' THEN v_slug := 'org'; END IF;

  LOOP
    BEGIN
      INSERT INTO public.organizations (name, slug, created_by, onboarding_complete)
      VALUES (
        v_name,
        CASE WHEN v_attempt = 0 THEN v_slug ELSE v_slug || '-' || v_attempt END,
        v_user_id,
        false
      )
      RETURNING id INTO v_org_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      -- Lost a race on the name (another session inserted it between the
      -- pre-check and this insert) — surface it rather than retrying.
      IF v_constraint = 'organizations_name_unique' THEN
        RAISE EXCEPTION 'An organisation named "%" already exists. Please choose a different name.', v_name
          USING ERRCODE = 'unique_violation';
      END IF;
      v_attempt := v_attempt + 1;
      IF v_attempt > 9 THEN RAISE EXCEPTION 'Could not generate a unique slug for: %', v_name; END IF;
    END;
  END LOOP;

  INSERT INTO public.org_members (org_id, user_id, role, status)
  VALUES (v_org_id, v_user_id, 'owner', 'active')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner', status = 'active';

  -- Remove any auto-created viewer membership on the bootstrap org
  DELETE FROM public.org_members
  WHERE  org_id  = (SELECT id FROM public.organizations WHERE slug = 'primary' LIMIT 1)
    AND  user_id = v_user_id
    AND  role    = 'viewer';

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_org_name(text) TO authenticated;
