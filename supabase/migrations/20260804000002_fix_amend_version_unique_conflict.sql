-- ── Fix amendVersion() "duplicate key" false failure ─────────────────────────
--
-- Amending a locked distribution-rule version always failed with
-- "A record with this name already exists" (friendlyError's generic
-- translation of a Postgres unique-violation) even though amending has no
-- name field at all.
--
-- Root cause: idx_alloc_configs_group_effrom_unique is a partial unique index
-- on (config_group_id, effective_from) WHERE status = 'locked'. The client's
-- amendVersion() (src/hooks/useSpecialConfigGroups.ts) inserted the amended
-- row as status='locked' with the SAME effective_from as the version being
-- amended (Effective From is read-only when amending), then only afterwards
-- set superseded_by_id on the original. But superseding never changes the
-- original's status away from 'locked' — every other query in this schema
-- already accounts for that by filtering `status = 'locked' AND
-- superseded_by_id IS NULL` when deciding what's actually live. The unique
-- index never did, so the original and its amendment permanently collided on
-- the index — not just during a race window, every single time.
--
-- Fix:
--  1. Narrow the unique index to superseded_by_id IS NULL, matching every
--     other "is this version live" check in the schema.
--  2. Move the amend operation into a single atomic RPC (mirroring
--     create_special_config_version / approve_config_version) so the client
--     never sequences two separate writes with a window in between. The new
--     row is inserted as a temporary draft, the original is then superseded
--     (removing it from the partial index), and only then is the new row
--     flipped to 'locked' — so it never collides with the row it replaces.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_alloc_configs_group_effrom_unique;

CREATE UNIQUE INDEX idx_alloc_configs_group_effrom_unique
  ON public.allocation_configs (config_group_id, effective_from)
  WHERE status = 'locked' AND superseded_by_id IS NULL;

CREATE OR REPLACE FUNCTION public.amend_config_version(
  p_original_id      uuid,
  p_allocation_type  text,
  p_total_amount     numeric(15,2),
  p_rows             jsonb,
  p_effective_from   date,
  p_effective_to     date,
  p_amendment_reason text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $$
DECLARE
  v_orig   record;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_orig FROM public.allocation_configs WHERE id = p_original_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'amend_config_version: version % not found', p_original_id;
  END IF;

  IF NOT public.is_org_admin(v_orig.org_id) THEN
    RAISE EXCEPTION 'amend_config_version: caller must be an org admin';
  END IF;

  IF v_orig.status <> 'locked' THEN
    RAISE EXCEPTION 'amend_config_version: only locked versions can be amended';
  END IF;

  IF v_orig.config_group_id IS NULL THEN
    RAISE EXCEPTION 'amend_config_version: version does not belong to a rule group';
  END IF;

  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'amend_config_version: at least one fund row is required';
  END IF;

  IF coalesce(trim(p_amendment_reason), '') = '' THEN
    RAISE EXCEPTION 'amend_config_version: amendment reason is required';
  END IF;

  -- Lock the group row so a concurrent amend/version-create can't interleave.
  BEGIN
    PERFORM id FROM public.special_config_groups
    WHERE id = v_orig.config_group_id
    FOR UPDATE;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION
      'Another change to this distribution rule is still in progress. Wait a moment and try again.';
  END;

  -- Insert the amendment as a draft first — the partial unique index only
  -- applies to status='locked', so this can never collide with the original
  -- it's about to replace.
  INSERT INTO public.allocation_configs (
    org_id, config_group_id, name, is_special, allocation_type, total_amount,
    rows, effective_from, effective_to, version_number, start_date, status,
    change_type, source_version_id, amendment_reason
  ) VALUES (
    v_orig.org_id, v_orig.config_group_id, v_orig.name, v_orig.is_special,
    p_allocation_type, p_total_amount, p_rows, p_effective_from, p_effective_to,
    v_orig.version_number + 1, p_effective_from, 'draft',
    'amendment', v_orig.id, trim(p_amendment_reason)
  )
  RETURNING id INTO v_new_id;

  -- Supersede the original, removing it from the partial unique index...
  UPDATE public.allocation_configs
  SET    superseded_by_id = v_new_id, superseded_at = now()
  WHERE  id = v_orig.id;

  -- ...then flip the amendment to locked now that the slot is free.
  UPDATE public.allocation_configs
  SET    status = 'locked'
  WHERE  id = v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL   ON FUNCTION public.amend_config_version(uuid,text,numeric,jsonb,date,date,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.amend_config_version(uuid,text,numeric,jsonb,date,date,text) TO authenticated;
