-- ============================================================
-- SECURITY FIX: Org isolation for audit_log and field_changes
-- Fixes confirmed cross-tenant data leak where admins of any
-- org could read audit/field-change records from all orgs.
--
-- Changes:
--   1. Add org_id to audit_log and field_changes
--   2. Backfill org_id for existing rows via joined business tables
--   3. Replace is_admin() SELECT policies with org-scoped ones
--   4. Add DELETE policy so org admins can clear their own logs
--   5. Fix profiles_update_admin / profiles_delete cross-org leak
-- ============================================================

-- ── 1. Add org_id columns ─────────────────────────────────────────────────────

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.field_changes
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- ── 2. Backfill audit_log.org_id via joined business tables ──────────────────
-- Try each transaction table in turn. First match wins.

UPDATE public.audit_log al
SET    org_id = COALESCE(
  (SELECT it.org_id FROM public.inflow_transactions   it WHERE it.id = al.record_id LIMIT 1),
  (SELECT ot.org_id FROM public.outflow_transactions  ot WHERE ot.id = al.record_id LIMIT 1),
  (SELECT bd.org_id FROM public.bank_deposits         bd WHERE bd.id = al.record_id LIMIT 1),
  (SELECT inf.org_id FROM public.intra_flows          inf WHERE inf.id = al.record_id LIMIT 1),
  (SELECT ibt.org_id FROM public.intrabank_transfers  ibt WHERE ibt.id = al.record_id LIMIT 1),
  (SELECT fx.org_id  FROM public.fx_transactions      fx  WHERE fx.id  = al.record_id LIMIT 1),
  (SELECT b.org_id   FROM public.banks                b   WHERE b.id   = al.record_id LIMIT 1),
  (SELECT c.org_id   FROM public.categories           c   WHERE c.id   = al.record_id LIMIT 1),
  (SELECT ac.org_id  FROM public.allocation_configs   ac  WHERE ac.id  = al.record_id LIMIT 1)
)
WHERE  al.org_id IS NULL;

-- Rows still NULL: assign to the single/first org as a safe fallback.
UPDATE public.audit_log
SET    org_id = (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1)
WHERE  org_id IS NULL;

-- ── 3. Backfill field_changes.org_id via joined business tables ───────────────
-- field_changes.record_id is TEXT (not UUID) so cast carefully.

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
WHERE  fc.org_id IS NULL;

UPDATE public.field_changes
SET    org_id = (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1)
WHERE  org_id IS NULL;

-- ── 4. Add indexes ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_audit_log_org_id     ON public.audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_date   ON public.audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_changes_org_id ON public.field_changes(org_id);
CREATE INDEX IF NOT EXISTS idx_field_changes_org_date ON public.field_changes(org_id, changed_at DESC);

-- ── 5. Replace audit_log RLS policies ────────────────────────────────────────

DROP POLICY IF EXISTS "audit_admin_read"   ON public.audit_log;
DROP POLICY IF EXISTS "audit_insert"       ON public.audit_log;
DROP POLICY IF EXISTS "audit_write"        ON public.audit_log;
DROP POLICY IF EXISTS "audit_delete"       ON public.audit_log;

-- SELECT: only members of the row's org (org-scoped admins see only their own logs)
CREATE POLICY "audit_select" ON public.audit_log
  FOR SELECT USING (
    org_id IS NOT NULL AND public.is_org_member(org_id)
    AND public.is_org_admin(org_id)
  );

-- INSERT: any active org member can write (org_id must match their membership)
CREATE POLICY "audit_insert" ON public.audit_log
  FOR INSERT WITH CHECK (
    org_id IS NOT NULL AND public.is_org_member(org_id)
  );

-- DELETE: org admins can purge their own org's audit entries
CREATE POLICY "audit_delete" ON public.audit_log
  FOR DELETE USING (
    org_id IS NOT NULL AND public.is_org_admin(org_id)
  );

-- ── 6. Replace field_changes RLS policies ────────────────────────────────────

DROP POLICY IF EXISTS "field_changes_admin_read" ON public.field_changes;
DROP POLICY IF EXISTS "field_changes_insert"     ON public.field_changes;
DROP POLICY IF EXISTS "field_changes_write"      ON public.field_changes;
DROP POLICY IF EXISTS "field_changes_delete"     ON public.field_changes;

CREATE POLICY "field_changes_select" ON public.field_changes
  FOR SELECT USING (
    org_id IS NOT NULL AND public.is_org_member(org_id)
    AND public.is_org_admin(org_id)
  );

CREATE POLICY "field_changes_insert" ON public.field_changes
  FOR INSERT WITH CHECK (
    org_id IS NOT NULL AND public.is_org_member(org_id)
  );

CREATE POLICY "field_changes_delete" ON public.field_changes
  FOR DELETE USING (
    org_id IS NOT NULL AND public.is_org_admin(org_id)
  );

-- ── 7. Fix cross-org profile admin policies ───────────────────────────────────
-- The old policies used is_admin() which grants access if the caller is admin
-- in ANY org. Replace with a check that the target profile belongs to a shared org.

DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete"       ON public.profiles;

-- An admin can update a profile only if that user is a member of at least one
-- org where the calling user is also an admin.
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.org_members caller
      JOIN   public.org_members target
        ON   target.org_id   = caller.org_id
        AND  target.user_id  = profiles.id
        AND  target.status   = 'active'
      WHERE  caller.user_id = auth.uid()
        AND  caller.role    IN ('owner', 'admin')
        AND  caller.status  = 'active'
    )
  );

-- An admin can delete a profile only if that user shares at least one org with them.
CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.org_members caller
      JOIN   public.org_members target
        ON   target.org_id   = caller.org_id
        AND  target.user_id  = profiles.id
        AND  target.status   = 'active'
      WHERE  caller.user_id = auth.uid()
        AND  caller.role    IN ('owner', 'admin')
        AND  caller.status  = 'active'
    )
  );
