-- ============================================================
-- SECURITY: make audit_log + field_changes client-append-only
-- Idempotent — safe to re-run.
--
-- Finding addressed (release audit item 2):
--   audit_delete / field_changes_delete allowed org admins to DELETE
--   rows from the audit trail. An admin could erase evidence of their
--   own actions, defeating the purpose of the trail.
--
-- Fix: drop the client DELETE policies. With RLS enabled and no DELETE
-- policy, PostgREST/authenticated deletes are denied by default —
-- SELECT (admins) and INSERT (triggers) are unaffected, so the trail
-- can still be read and written, only never removed from the client.
--
-- Legitimate retention cleanup still works: purge_old_audit_logs() is
-- SECURITY DEFINER (migration 20260606000003) and bypasses RLS, as does
-- any service-role maintenance job.
-- ============================================================

DROP POLICY IF EXISTS "audit_delete"         ON public.audit_log;
DROP POLICY IF EXISTS "field_changes_delete" ON public.field_changes;

NOTIFY pgrst, 'reload schema';
