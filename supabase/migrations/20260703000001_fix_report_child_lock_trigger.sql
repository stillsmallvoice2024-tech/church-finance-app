-- ============================================================
-- Fix: "record \"new\" has no field \"org_id\"" when saving Custom Reports
--
-- check_org_not_locked() (added in 20260602000002_org_deletion_flow.sql)
-- begins with `IF NEW.org_id IS NULL`. Its attachment loop in that migration
-- erroneously included dynamic_report_blocks and dynamic_report_snapshots,
-- which have NO org_id column — they isolate via their parent dynamic_reports.
-- As a result every INSERT/UPDATE on those two tables raised:
--   record "new" has no field "org_id"
-- which made saving report blocks (and snapshots) fail.
--
-- schema.sql already excludes these two tables from the lock loop, so fresh
-- installs are unaffected. This migration brings existing databases in line
-- by removing the mis-attached trigger. Lock enforcement for these child
-- tables is provided transitively through their parent dynamic_reports row
-- (which IS org-scoped and IS lock-protected) and the app's OrgLockedScreen.
--
-- Idempotent: DROP TRIGGER IF EXISTS is a no-op if already removed.
-- ============================================================

DROP TRIGGER IF EXISTS trg_check_org_locked ON public.dynamic_report_blocks;
DROP TRIGGER IF EXISTS trg_check_org_locked ON public.dynamic_report_snapshots;

NOTIFY pgrst, 'reload schema';
