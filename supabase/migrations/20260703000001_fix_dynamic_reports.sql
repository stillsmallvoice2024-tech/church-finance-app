-- ============================================================
-- Fix Custom (dynamic) Reports: save failure, missing snapshots
-- table, and non-atomic block saving.
--
-- Three problems on databases provisioned before the dynamic-report
-- feature stabilised:
--
--   1. The org-deletion lock trigger check_org_not_locked() begins with
--      `IF NEW.org_id IS NULL`, but 20260602000002_org_deletion_flow.sql
--      attached it to dynamic_report_blocks / dynamic_report_snapshots,
--      which have NO org_id column (they isolate via parent
--      dynamic_reports). Every INSERT raised:
--        record "new" has no field "org_id"
--
--   2. dynamic_report_snapshots was only ever added to schema.sql (fresh
--      installs), never in a migration — so existing databases lack it
--      entirely and the "Save snapshot" feature fails with 42P01.
--
--   3. The client saved blocks with delete-then-insert across two round
--      trips; a mid-save failure left the delete committed and the insert
--      lost. save_dynamic_report_blocks() replaces them in one
--      transaction instead.
--
-- Fully idempotent — safe to run more than once.
-- ============================================================

-- ── 1. Provision dynamic_report_snapshots if missing ─────────────────────────
CREATE TABLE IF NOT EXISTS public.dynamic_report_snapshots (
  id          uuid        primary key default gen_random_uuid(),
  report_id   uuid        not null references public.dynamic_reports(id) on delete cascade,
  label       text        not null,
  snapshot_at timestamptz not null default now(),
  data        jsonb       not null default '{}',
  created_at  timestamptz default now()
);

ALTER TABLE public.dynamic_report_snapshots ENABLE ROW LEVEL SECURITY;

-- Policies isolate via the parent dynamic_reports row's org membership.
DROP POLICY IF EXISTS "drs_select" ON public.dynamic_report_snapshots;
CREATE POLICY "drs_select" ON public.dynamic_report_snapshots
  FOR SELECT USING (
    exists (
      select 1 from public.dynamic_reports dr
      join   public.org_members m
        on   m.org_id = dr.org_id and m.user_id = auth.uid() and m.status = 'active'
      where  dr.id = report_id
    )
  );

DROP POLICY IF EXISTS "drs_insert" ON public.dynamic_report_snapshots;
CREATE POLICY "drs_insert" ON public.dynamic_report_snapshots
  FOR INSERT WITH CHECK (
    exists (
      select 1 from public.dynamic_reports dr
      join   public.org_members m
        on   m.org_id = dr.org_id and m.user_id = auth.uid()
        and  m.role   in ('owner', 'admin', 'accountant') and m.status = 'active'
      where  dr.id = report_id
    )
  );

DROP POLICY IF EXISTS "drs_delete" ON public.dynamic_report_snapshots;
CREATE POLICY "drs_delete" ON public.dynamic_report_snapshots
  FOR DELETE USING (
    exists (
      select 1 from public.dynamic_reports dr
      join   public.org_members m
        on   m.org_id = dr.org_id and m.user_id = auth.uid()
        and  m.role   in ('owner', 'admin') and m.status = 'active'
      where  dr.id = report_id
    )
  );

CREATE INDEX IF NOT EXISTS idx_drs_report_at
  ON public.dynamic_report_snapshots(report_id, snapshot_at desc);

-- ── 2. Remove the mis-attached org-lock trigger from child tables ────────────
-- Guarded per-table: DROP TRIGGER IF EXISTS still raises 42P01 if the *table*
-- is absent, so check existence first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'dynamic_report_blocks') THEN
    DROP TRIGGER IF EXISTS trg_check_org_locked ON public.dynamic_report_blocks;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'dynamic_report_snapshots') THEN
    DROP TRIGGER IF EXISTS trg_check_org_locked ON public.dynamic_report_snapshots;
  END IF;
END $$;

-- ── 3. Atomic block replacement RPC ──────────────────────────────────────────
-- SECURITY INVOKER (default): the DELETE and INSERTs run under the caller's
-- RLS, preserving tenant isolation. The whole function body is one
-- transaction, so a failure rolls back — blocks are never lost mid-save.
CREATE OR REPLACE FUNCTION public.save_dynamic_report_blocks(
  p_report_id uuid,
  p_blocks    jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_block jsonb;
  v_pos   int := 0;
BEGIN
  DELETE FROM public.dynamic_report_blocks WHERE report_id = p_report_id;

  FOR v_block IN SELECT * FROM jsonb_array_elements(COALESCE(p_blocks, '[]'::jsonb))
  LOOP
    INSERT INTO public.dynamic_report_blocks (report_id, block_type, position, config_json)
    VALUES (
      p_report_id,
      v_block->>'block_type',
      v_pos,
      COALESCE(v_block->'config_json', '{}'::jsonb)
    );
    v_pos := v_pos + 1;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_dynamic_report_blocks(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
