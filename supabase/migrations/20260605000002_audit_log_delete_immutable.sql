-- ============================================================
-- Audit log delete immutability (LB-9 follow-up)
--
-- Blocks all DELETE on audit_log — no one can destroy evidence,
-- including org admins, service-role, and postgres superuser.
--
-- UPDATE is intentionally allowed so GDPR erasure requests can
-- SET user_id = NULL without destroying the financial record.
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_log_no_delete_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log rows cannot be deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_no_delete ON public.audit_log;
CREATE TRIGGER trg_audit_log_no_delete
  BEFORE DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_no_delete_fn();

-- The existing audit_delete RLS policy is now unreachable but harmless.
-- Drop it to avoid misleading readers.
DROP POLICY IF EXISTS "audit_delete" ON public.audit_log;

NOTIFY pgrst, 'reload schema';
