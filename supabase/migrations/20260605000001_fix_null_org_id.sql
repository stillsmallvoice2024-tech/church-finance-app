-- ============================================================
-- LB-5 / S-C2: Prevent NULL org_id on all inserts
--
-- Root cause: get_current_org_id() returns NULL when no org
-- with slug='primary' exists (pure multi-tenant installs).
-- All 26 business-table columns have DEFAULT get_current_org_id(),
-- so any INSERT that omits org_id silently produces org_id = NULL
-- (or, after the backfill migration added NOT NULL, a hard error).
-- audit_log and field_changes got org_id as NULLABLE in
-- 20260602000002 but never gained a NOT NULL constraint, letting
-- orphaned rows accumulate when the app omitted org_id.
--
-- Changes:
--   1. Re-run backfill for audit_log/field_changes NULL org_id rows
--   2. Add NOT NULL to audit_log.org_id and field_changes.org_id
--   3. Replace get_current_org_id() with an exception-raising stub
--      so any future INSERT that accidentally omits org_id fails
--      loudly at the DB layer instead of silently producing bad data
--
-- Idempotent: safe to re-run.
-- Prerequisites: 20260602000002_audit_log_org_isolation.sql applied.
-- ============================================================

-- ── 1. Backfill any remaining NULL org_id rows in audit_log ──────────────────
-- Mirror of backfill in 20260602000002 — catches rows written after that
-- migration ran but before the app-layer fix was deployed.

UPDATE public.audit_log al
SET    org_id = COALESCE(
  (SELECT it.org_id  FROM public.inflow_transactions   it  WHERE it.id  = al.record_id LIMIT 1),
  (SELECT ot.org_id  FROM public.outflow_transactions  ot  WHERE ot.id  = al.record_id LIMIT 1),
  (SELECT bd.org_id  FROM public.bank_deposits         bd  WHERE bd.id  = al.record_id LIMIT 1),
  (SELECT inf.org_id FROM public.intra_flows           inf WHERE inf.id = al.record_id LIMIT 1),
  (SELECT ibt.org_id FROM public.intrabank_transfers   ibt WHERE ibt.id = al.record_id LIMIT 1),
  (SELECT fx.org_id  FROM public.fx_transactions       fx  WHERE fx.id  = al.record_id LIMIT 1),
  (SELECT b.org_id   FROM public.banks                 b   WHERE b.id   = al.record_id LIMIT 1),
  (SELECT c.org_id   FROM public.categories            c   WHERE c.id   = al.record_id LIMIT 1),
  (SELECT ac.org_id  FROM public.allocation_configs    ac  WHERE ac.id  = al.record_id LIMIT 1)
)
WHERE al.org_id IS NULL;

-- Remaining NULL rows have no matching business record; assign to first org.
UPDATE public.audit_log
SET    org_id = (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1)
WHERE  org_id IS NULL;

-- ── 2. Backfill any remaining NULL org_id rows in field_changes ───────────────

UPDATE public.field_changes fc
SET    org_id = COALESCE(
  (SELECT it.org_id  FROM public.inflow_transactions   it  WHERE it.id::text  = fc.record_id LIMIT 1),
  (SELECT ot.org_id  FROM public.outflow_transactions  ot  WHERE ot.id::text  = fc.record_id LIMIT 1),
  (SELECT bd.org_id  FROM public.bank_deposits         bd  WHERE bd.id::text  = fc.record_id LIMIT 1),
  (SELECT inf.org_id FROM public.intra_flows           inf WHERE inf.id::text = fc.record_id LIMIT 1),
  (SELECT ibt.org_id FROM public.intrabank_transfers   ibt WHERE ibt.id::text = fc.record_id LIMIT 1),
  (SELECT fx.org_id  FROM public.fx_transactions       fx  WHERE fx.id::text  = fc.record_id LIMIT 1),
  (SELECT b.org_id   FROM public.banks                 b   WHERE b.id::text   = fc.record_id LIMIT 1),
  (SELECT c.org_id   FROM public.categories            c   WHERE c.id::text   = fc.record_id LIMIT 1),
  (SELECT ac.org_id  FROM public.allocation_configs    ac  WHERE ac.id::text  = fc.record_id LIMIT 1)
)
WHERE fc.org_id IS NULL;

UPDATE public.field_changes
SET    org_id = (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1)
WHERE  org_id IS NULL;

-- ── 3. Add NOT NULL to audit_log.org_id ──────────────────────────────────────
-- Pre-check: abort if any row still has NULL (backfill above should have fixed all).
DO $$
DECLARE v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.audit_log WHERE org_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot add NOT NULL to audit_log.org_id: % row(s) still have NULL org_id after backfill. '
      'No org exists to assign them to — delete or manually assign before re-running.', v_count;
  END IF;
END $$;

ALTER TABLE public.audit_log
  ALTER COLUMN org_id SET NOT NULL;

-- ── 4. Add NOT NULL to field_changes.org_id ──────────────────────────────────
DO $$
DECLARE v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.field_changes WHERE org_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot add NOT NULL to field_changes.org_id: % row(s) still have NULL org_id after backfill. '
      'No org exists to assign them to — delete or manually assign before re-running.', v_count;
  END IF;
END $$;

ALTER TABLE public.field_changes
  ALTER COLUMN org_id SET NOT NULL;

-- ── 5. Replace get_current_org_id() with an exception-raising stub ────────────
-- The application layer (orgPayload() in useMutations.ts, explicit org_id in all
-- other hooks) now ALWAYS supplies org_id on every INSERT. The DEFAULT must never
-- fire in normal operation. Replacing the function body with an exception ensures
-- any future regression that omits org_id produces an immediate, loud DB error
-- instead of silently inserting the wrong org_id or NULL.
--
-- NOTE: the DEFAULT expression `DEFAULT public.get_current_org_id()` on all 26
-- business-table columns is NOT removed here — changing a column DEFAULT requires
-- `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT ...` and that DDL is not needed
-- because the app always provides the value. The function body change alone is
-- sufficient to make any accidental reliance on the DEFAULT fail loudly.

CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE EXCEPTION
    'get_current_org_id() invoked — all INSERT statements must supply org_id explicitly. '
    'This function exists only as a DEFAULT stub; it must never be called at runtime. '
    'Ensure the calling code reads org_id from useOrgStore and passes it in the INSERT payload.';
END;
$$;

NOTIFY pgrst, 'reload schema';
