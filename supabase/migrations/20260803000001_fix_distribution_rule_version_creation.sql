-- ── Distribution rule version creation — correctness + lock hardening ────────
--
-- Three defects in create_special_config_version (20260606000003):
--
--  1. A DRAFT insert closed the covering version (effective_to = from - 1),
--     ending the org's live rule even though the draft applies to nothing.
--     Saving "New Version → Save as Draft", or creating rules in the
--     onboarding wizard, silently left the group with no active version —
--     so no rule resolved for new transactions.
--
--  2. `PERFORM ... FOR UPDATE` waited indefinitely for the group row lock.
--     A previous request the browser had already abandoned still held its
--     transaction, so every retry blocked until the client's own fetch
--     timeout fired, surfacing as an opaque "AbortError: signal is aborted
--     without reason". lock_timeout turns that into a fast, readable error.
--
--  3. The covering-version lookup had no ORDER BY, so with more than one
--     candidate row `LIMIT 1` closed an arbitrary version.
--
-- Also grants a statement_timeout below the client's write timeout so the
-- server gives up first and reports why, instead of the browser cancelling a
-- write that then commits anyway.
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- (set above) turns contention into a clear error rather than a hang.
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

  -- Compute next version number server-side (no client-supplied race window)
  SELECT COALESCE(MAX(version_number), 0) INTO v_max_ver
  FROM   public.allocation_configs
  WHERE  config_group_id = p_group_id AND org_id = p_org_id;

  IF p_status = 'locked' THEN
    -- Find the locked version whose range contains p_effective_from. Only
    -- locked versions define the live timeline, and the latest-starting match
    -- is the one actually in force.
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

    -- Find the immediately following locked version to bound the new range
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

    -- Close the covering version. Skipped entirely for drafts: a draft must
    -- never shorten the rule that is currently live.
    IF v_covering_id IS NOT NULL THEN
      UPDATE public.allocation_configs
      SET    effective_to = p_effective_from - 1
      WHERE  id = v_covering_id
        AND  effective_from < p_effective_from;
    END IF;
  ELSE
    v_new_to := NULL;
  END IF;

  INSERT INTO public.allocation_configs (
    name, is_special, allocation_type, total_amount, rows,
    effective_from, effective_to, version_number,
    config_group_id, start_date, status, org_id
  ) VALUES (
    p_name,
    -- The General (default) group is the org-wide fallback, not a special rule
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

-- ── approve_config_version — promote a draft to live ─────────────────────────
-- Drafts (including every rule the onboarding wizard creates) resolve to
-- nothing until locked. Flipping status with a bare UPDATE would leave two
-- locked versions covering the same day, so approving has to close the version
-- it supersedes and bound its own range — the same timeline arithmetic
-- create_special_config_version does, in one transaction.

CREATE OR REPLACE FUNCTION public.approve_config_version(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $$
DECLARE
  v_cfg         record;
  v_covering_id uuid;
  v_next_from   date;
BEGIN
  SELECT * INTO v_cfg FROM public.allocation_configs WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_config_version: version % not found', p_version_id;
  END IF;

  IF NOT public.is_org_admin(v_cfg.org_id) THEN
    RAISE EXCEPTION 'approve_config_version: caller must be an org admin';
  END IF;

  IF v_cfg.status <> 'draft' THEN
    RAISE EXCEPTION 'approve_config_version: version is already %', v_cfg.status;
  END IF;

  IF v_cfg.config_group_id IS NULL THEN
    RAISE EXCEPTION 'approve_config_version: version does not belong to a rule group';
  END IF;

  IF v_cfg.rows IS NULL OR jsonb_array_length(v_cfg.rows) = 0 THEN
    RAISE EXCEPTION 'approve_config_version: version has no category rows';
  END IF;

  BEGIN
    PERFORM id FROM public.special_config_groups
    WHERE id = v_cfg.config_group_id
    FOR UPDATE;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION
      'Another change to this distribution rule is still in progress. Wait a moment and try again.';
  END;

  IF EXISTS (
    SELECT 1 FROM public.allocation_configs
    WHERE config_group_id = v_cfg.config_group_id
      AND status          = 'locked'
      AND effective_from  = v_cfg.effective_from
      AND id             <> p_version_id
  ) THEN
    RAISE EXCEPTION
      'A live version of this rule already starts on %. Change this draft''s start date first.',
      v_cfg.effective_from;
  END IF;

  SELECT id INTO v_covering_id
  FROM   public.allocation_configs
  WHERE  config_group_id = v_cfg.config_group_id
    AND  status          = 'locked'
    AND  superseded_by_id IS NULL
    AND  effective_from < v_cfg.effective_from
    AND  (effective_to IS NULL OR effective_to >= v_cfg.effective_from)
  ORDER BY effective_from DESC
  LIMIT  1;

  IF v_covering_id IS NOT NULL THEN
    UPDATE public.allocation_configs
    SET    effective_to = v_cfg.effective_from - 1
    WHERE  id = v_covering_id;
  END IF;

  SELECT effective_from INTO v_next_from
  FROM   public.allocation_configs
  WHERE  config_group_id = v_cfg.config_group_id
    AND  status          = 'locked'
    AND  superseded_by_id IS NULL
    AND  effective_from  > v_cfg.effective_from
  ORDER BY effective_from
  LIMIT  1;

  UPDATE public.allocation_configs
  SET    status       = 'locked',
         effective_to = CASE
                          WHEN v_next_from IS NOT NULL
                            AND (effective_to IS NULL OR effective_to > v_next_from - 1)
                          THEN v_next_from - 1
                          ELSE effective_to
                        END
  WHERE  id = p_version_id;
END;
$$;

REVOKE ALL   ON FUNCTION public.approve_config_version(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.approve_config_version(uuid) TO authenticated;

-- ── Seed a General rule that actually resolves ───────────────────────────────
-- complete_org_onboarding() seeded the General group with a DRAFT holding an
-- empty rows array, despite its own comment saying "Auto-lock a default
-- version: 100% → General category". A draft with no rows resolves to nothing,
-- so a brand-new org had no fallback rule at all. Seed it locked and populated;
-- the wizard replaces it as soon as the user picks a split.

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

  IF NOT EXISTS (
    SELECT 1 FROM public.categories WHERE org_id = p_org_id AND is_default = true
  ) THEN
    INSERT INTO public.categories (org_id, name, is_default)
    VALUES (p_org_id, 'General', true);
  END IF;

  -- Get or create the General rule group (decoupled from version creation,
  -- per 20260625000001)
  SELECT id INTO v_group_id
  FROM public.special_config_groups
  WHERE org_id = p_org_id AND is_default = true
  LIMIT 1;

  IF v_group_id IS NULL THEN
    INSERT INTO public.special_config_groups (org_id, name, is_default)
    VALUES (p_org_id, 'General', true)
    RETURNING id INTO v_group_id;
  END IF;

  -- Seed a live fallback only when the group has no versions at all, so an org
  -- that already configured its General rule is never touched.
  IF NOT EXISTS (
    SELECT 1 FROM public.allocation_configs WHERE config_group_id = v_group_id
  ) THEN
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

-- ── Repair: General groups left with no active version ───────────────────────
-- Re-open the most recent locked version of any group whose entire timeline was
-- closed by a draft insert under the old function.

UPDATE public.allocation_configs ac
SET    effective_to = NULL
WHERE  ac.status = 'locked'
  AND  ac.superseded_by_id IS NULL
  AND  ac.config_group_id IS NOT NULL
  AND  ac.effective_to IS NOT NULL
  AND  ac.effective_to < CURRENT_DATE
  AND  ac.id = (
         SELECT id FROM public.allocation_configs x
         WHERE  x.config_group_id = ac.config_group_id
           AND  x.status = 'locked'
           AND  x.superseded_by_id IS NULL
         ORDER BY x.effective_from DESC
         LIMIT 1
       )
  -- only where nothing else covers today, i.e. the group is genuinely dark
  AND  NOT EXISTS (
         SELECT 1 FROM public.allocation_configs y
         WHERE  y.config_group_id = ac.config_group_id
           AND  y.status = 'locked'
           AND  y.superseded_by_id IS NULL
           AND  y.effective_from <= CURRENT_DATE
           AND  (y.effective_to IS NULL OR y.effective_to >= CURRENT_DATE)
       );

NOTIFY pgrst, 'reload schema';
