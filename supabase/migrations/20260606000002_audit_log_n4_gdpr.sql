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

-- Drop old 2-arg signature; new 3-arg version with explicit p_org_id is in
-- 20260606000003_security_fixes.sql which runs after this migration.
DROP FUNCTION IF EXISTS public.request_gdpr_erasure(uuid, text);

NOTIFY pgrst, 'reload schema';
