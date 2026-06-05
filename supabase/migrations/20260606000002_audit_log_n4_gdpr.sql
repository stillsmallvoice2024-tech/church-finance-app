-- ============================================================
-- N-4: GDPR erasure — compliant anonymisation workflow
--
-- Changes:
--   1. Fix audit_log.user_id FK → ON DELETE SET NULL
--      (was missing — deleting a profile raised a FK violation)
--   2. gdpr_erasure_requests table: records every erasure action
--      to satisfy GDPR Art. 17 documentation requirements.
--   3. request_gdpr_erasure(p_target_user_id, p_notes): SECURITY DEFINER
--      RPC callable by org admins.
--      — NULLs user_id in audit_log and field_changes for the target user
--      — Scrubs top-level PII keys (email, full_name, username, phone,
--        avatar_url) from audit_log.old_data / new_data JSONB
--      — NULLs old_value / new_value in field_changes where field_name
--        is a PII key (email, full_name, username, phone, avatar_url)
--      — Inserts a gdpr_erasure_requests row with counts for the record
--
-- Scope: anonymises only the calling admin's own org's audit data.
-- The profile row and auth.users record are NOT deleted by this function —
-- full account deletion should follow through a separate flow.
--
-- Irreversible: anonymised data cannot be restored.
-- Idempotent: safe to re-run (re-anonymisation of already-NULL rows is a no-op).
-- ============================================================

-- ── 1. Fix audit_log.user_id FK ──────────────────────────────────────────────
-- Add ON DELETE SET NULL so that deleting a profiles row does not raise
-- a FK violation on audit_log. The audit record is preserved; only the
-- user linkage is severed.

ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── 2. gdpr_erasure_requests ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gdpr_erasure_requests (
  id                            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id                        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by                  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- target_user_id is NOT a FK because the profile may be deleted as part of
  -- the erasure. Store as plain uuid for the audit record.
  target_user_id                uuid        NOT NULL,
  requested_at                  timestamptz DEFAULT now() NOT NULL,
  completed_at                  timestamptz,
  notes                         text,
  anonymized_audit_count        bigint      DEFAULT 0 NOT NULL,
  anonymized_field_change_count bigint      DEFAULT 0 NOT NULL
);

ALTER TABLE public.gdpr_erasure_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gdpr_req_select" ON public.gdpr_erasure_requests;
CREATE POLICY "gdpr_req_select" ON public.gdpr_erasure_requests
  FOR SELECT USING (public.is_org_admin(org_id));

DROP POLICY IF EXISTS "gdpr_req_insert" ON public.gdpr_erasure_requests;
CREATE POLICY "gdpr_req_insert" ON public.gdpr_erasure_requests
  FOR INSERT WITH CHECK (public.is_org_admin(org_id));

CREATE INDEX IF NOT EXISTS idx_gdpr_erasure_org  ON public.gdpr_erasure_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_gdpr_erasure_user ON public.gdpr_erasure_requests(target_user_id);

-- ── 3. request_gdpr_erasure RPC ──────────────────────────────────────────────
-- Anonymises audit records for a given user within the calling admin's org.
-- Returns the gdpr_erasure_requests.id so the caller can reference the record.
--
-- Usage (from Supabase JS client as an org admin):
--   const { data } = await supabase.rpc('request_gdpr_erasure', {
--     p_target_user_id: '<uuid>',
--     p_notes: 'User submitted erasure request on 2026-06-06'
--   })

CREATE OR REPLACE FUNCTION public.request_gdpr_erasure(
  p_target_user_id uuid,
  p_notes          text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id      uuid;
  v_audit_count bigint := 0;
  v_fc_count    bigint := 0;
  v_request_id  uuid;
  -- Top-level JSONB keys and field names that may carry personal data
  v_pii_keys    CONSTANT text[] := ARRAY[
    'email', 'full_name', 'username', 'phone', 'avatar_url'
  ];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'request_gdpr_erasure: caller must be an org admin';
  END IF;

  -- Resolve org from the caller's active admin membership
  SELECT om.org_id INTO v_org_id
  FROM   public.org_members om
  WHERE  om.user_id = auth.uid()
    AND  om.role    IN ('owner', 'admin')
    AND  om.status  = 'active'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'request_gdpr_erasure: no active admin membership found for caller';
  END IF;

  -- ── Anonymise audit_log ───────────────────────────────────────────────────
  -- NULLs user_id (link to the erased person).
  -- Removes PII keys from old_data and new_data at the top level using the
  -- jsonb minus-array operator (jsonb - text[]).

  WITH updated AS (
    UPDATE public.audit_log
    SET
      user_id  = NULL,
      old_data = CASE WHEN old_data IS NOT NULL THEN old_data - v_pii_keys ELSE NULL END,
      new_data = CASE WHEN new_data IS NOT NULL THEN new_data - v_pii_keys ELSE NULL END
    WHERE user_id = p_target_user_id
      AND org_id  = v_org_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_audit_count FROM updated;

  -- ── Anonymise field_changes ───────────────────────────────────────────────
  -- NULLs user_id.
  -- Scrubs old_value/new_value only where field_name is a PII field, so that
  -- non-PII field changes (e.g. amounts, dates) remain intact for the audit trail.

  WITH updated AS (
    UPDATE public.field_changes
    SET
      user_id   = NULL,
      old_value = CASE WHEN field_name = ANY(v_pii_keys) THEN NULL ELSE old_value END,
      new_value = CASE WHEN field_name = ANY(v_pii_keys) THEN NULL ELSE new_value END
    WHERE user_id = p_target_user_id
      AND org_id  = v_org_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_fc_count FROM updated;

  -- ── Record the erasure ────────────────────────────────────────────────────

  INSERT INTO public.gdpr_erasure_requests
    (org_id, requested_by, target_user_id, completed_at, notes,
     anonymized_audit_count, anonymized_field_change_count)
  VALUES
    (v_org_id, auth.uid(), p_target_user_id, now(), p_notes,
     v_audit_count, v_fc_count)
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_gdpr_erasure(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.request_gdpr_erasure(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
