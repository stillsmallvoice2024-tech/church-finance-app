-- ============================================================================
-- Atomic restore: delete + insert in ONE transaction
--
-- Finding addressed (app audit):
--   restoreFromBackup() issued ~26 DELETEs and N upserts as separate,
--   un-transacted PostgREST round-trips from a browser tab. A network drop, a
--   closed tab, or one FK violation between the delete loop and the insert loop
--   left the org permanently empty or half-populated, with no rollback path.
--   A half-restored ledger is worse than no ledger: it looks valid.
--
-- Design: rows are staged over many ordinary (RLS-protected) inserts, then a
-- single SECURITY DEFINER RPC replays them. Chunking the *upload* is safe;
-- chunking the *commit* is not, so commit_restore() does every delete and every
-- insert inside its own implicit transaction — any exception rolls back the lot.
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- ── 1. Allowlist ─────────────────────────────────────────────────────────────
-- commit_restore() builds dynamic SQL. Every identifier it interpolates comes
-- from this table and nowhere else — a caller cannot name an arbitrary relation.
-- Mirrors MANAGED_TABLES in src/utils/backupRestore.ts; insert_order matches the
-- registry's array order (parents before children), delete order is its reverse.

CREATE TABLE IF NOT EXISTS public.restore_allowed_tables (
  table_key         text    PRIMARY KEY,
  insert_order      integer NOT NULL,
  conflict_column   text    NOT NULL DEFAULT 'id',
  /* false = table has no org_id column (global or the org row itself) */
  org_scoped        boolean NOT NULL DEFAULT true,
  /* replace-mode wipes this table first. Never true for non-org-scoped tables:
     an unscoped DELETE would cross tenant boundaries. */
  delete_in_replace boolean NOT NULL DEFAULT false,
  /* 'update' = upsert; 'nothing' = insert-only (append-mode / audit tables) */
  conflict_action   text    NOT NULL DEFAULT 'update'
    CHECK (conflict_action IN ('update', 'nothing'))
);

ALTER TABLE public.restore_allowed_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "restore_allowed_tables_select" ON public.restore_allowed_tables;
CREATE POLICY "restore_allowed_tables_select" ON public.restore_allowed_tables
  FOR SELECT USING (auth.role() = 'authenticated');

-- Reconciled wholesale on every run so the allowlist can never drift from the
-- registry: a table dropped from MANAGED_TABLES disappears here too.
--
-- Upsert + prune rather than TRUNCATE: restore_staging carries an FK to this
-- table, and Postgres refuses to TRUNCATE a table referenced by a foreign key
-- even when the referencing table is empty — which would make every re-run
-- after the first one fail.
WITH seed (table_key, insert_order, conflict_column, org_scoped, delete_in_replace, conflict_action) AS (
  VALUES
    -- Configuration
    ('organizations'::text,               0::integer, 'id'::text,   false, false, 'update'::text),
    -- currencies is a GLOBAL table (PK code, no org_id). It is deliberately
    -- never deleted here: an unscoped wipe would clear the currency list for
    -- every tenant on the instance, not just the one being restored.
    ('currencies',                        1, 'code', false, false, 'update'),
    ('category_groups',                   2, 'id',   true,  true,  'update'),
    ('categories',                        3, 'id',   true,  true,  'update'),
    ('category_opening_balances',         4, 'id',   true,  true,  'update'),
    ('banks',                             5, 'id',   true,  true,  'update'),
    -- Allocation
    ('special_config_groups',             6, 'id',   true,  true,  'update'),
    ('allocation_configs',                7, 'id',   true,  true,  'update'),
    ('income_types',                      8, 'id',   true,  true,  'update'),
    ('outflow_types',                     9, 'id',   true,  true,  'update'),
    ('income_type_rules',                10, 'id',   true,  true,  'update'),
    -- Transactions
    ('inflow_transactions',              11, 'id',   true,  true,  'update'),
    ('outflow_transactions',             12, 'id',   true,  true,  'update'),
    ('intra_flows',                      13, 'id',   true,  true,  'update'),
    ('bank_deposits',                    14, 'id',   true,  true,  'update'),
    ('intrabank_transfers',              15, 'id',   true,  true,  'update'),
    ('fx_transactions',                  16, 'id',   true,  true,  'update'),
    ('fx_conversions',                   17, 'id',   true,  true,  'update'),
    ('transaction_allocation_snapshots', 18, 'id',   true,  false, 'nothing'),
    ('recalculation_logs',               19, 'id',   true,  false, 'nothing'),
    -- Projects
    ('special_projects',                 20, 'id',   true,  true,  'update'),
    ('project_entries',                  21, 'id',   true,  true,  'update'),
    -- Reports
    ('report_templates',                 22, 'id',   true,  true,  'update'),
    ('dynamic_reports',                  23, 'id',   true,  true,  'update'),
    ('dynamic_report_blocks',            24, 'id',   true,  true,  'update'),
    ('dynamic_report_snapshots',         25, 'id',   true,  true,  'update'),
    -- Membership
    ('org_members',                      26, 'id',   true,  false, 'update'),
    -- Reconciliation
    ('bank_statement_balances',          27, 'id',   true,  true,  'update'),
    ('reconciliation_runs',              28, 'id',   true,  false, 'nothing'),
    -- Audit trail: append-only, never deleted, never overwritten on conflict.
    ('receipts',                         29, 'id',   true,  false, 'nothing'),
    ('audit_log',                        30, 'id',   true,  false, 'nothing'),
    ('field_changes',                    31, 'id',   true,  false, 'nothing')
),
-- Data-modifying CTEs always execute, referenced or not.
upserted AS (
  INSERT INTO public.restore_allowed_tables
    (table_key, insert_order, conflict_column, org_scoped, delete_in_replace, conflict_action)
  SELECT * FROM seed
  ON CONFLICT (table_key) DO UPDATE SET
    insert_order      = EXCLUDED.insert_order,
    conflict_column   = EXCLUDED.conflict_column,
    org_scoped        = EXCLUDED.org_scoped,
    delete_in_replace = EXCLUDED.delete_in_replace,
    conflict_action   = EXCLUDED.conflict_action
  RETURNING table_key
)
-- Prune anything no longer in the registry. Fails loudly rather than silently
-- if an in-flight batch still references the removed key.
DELETE FROM public.restore_allowed_tables a
WHERE a.table_key NOT IN (SELECT s.table_key FROM seed s);

-- ── 2. Staging ───────────────────────────────────────────────────────────────
-- The client inserts here over as many round-trips as the payload needs. These
-- are ordinary RLS-protected writes; nothing destructive happens until commit.

CREATE TABLE IF NOT EXISTS public.restore_batches (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by   uuid        NOT NULL DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  status       text        NOT NULL DEFAULT 'staging'
    CHECK (status IN ('staging', 'committed', 'aborted'))
);

CREATE TABLE IF NOT EXISTS public.restore_staging (
  id        bigserial PRIMARY KEY,
  batch_id  uuid  NOT NULL REFERENCES public.restore_batches(id) ON DELETE CASCADE,
  -- FK to the allowlist: an unknown table name is rejected at staging time,
  -- long before anything is deleted.
  table_key text  NOT NULL REFERENCES public.restore_allowed_tables(table_key),
  rows      jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS restore_staging_batch_idx
  ON public.restore_staging (batch_id, table_key, id);

ALTER TABLE public.restore_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restore_staging ENABLE ROW LEVEL SECURITY;

-- Only an org OWNER may stage or commit a restore. Matches the destructiveness
-- of the operation: replace mode discards the org's entire ledger.
DROP POLICY IF EXISTS "restore_batches_all" ON public.restore_batches;
CREATE POLICY "restore_batches_all" ON public.restore_batches
  FOR ALL
  USING       (public.is_org_owner(org_id))
  WITH CHECK  (public.is_org_owner(org_id));

DROP POLICY IF EXISTS "restore_staging_all" ON public.restore_staging;
CREATE POLICY "restore_staging_all" ON public.restore_staging
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.restore_batches b
    WHERE b.id = restore_staging.batch_id AND public.is_org_owner(b.org_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.restore_batches b
    WHERE b.id = restore_staging.batch_id
      AND b.status = 'staging'
      AND public.is_org_owner(b.org_id)
  ));

-- ── 3. Commit ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.commit_restore(
  p_batch_id              uuid,
  p_mode                  text,
  p_acknowledge_data_loss boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id      uuid;
  v_status      text;
  v_tbl         record;
  v_rows        jsonb;
  v_cols        text[];
  v_collist     text;
  v_setlist     text;
  v_sql         text;
  v_live        bigint;
  v_staged      bigint;
  v_inserted    bigint;
  v_shortfall   text[]  := ARRAY[]::text[];
  v_total_short bigint  := 0;
  v_counts      jsonb   := '{}'::jsonb;
BEGIN
  IF p_mode NOT IN ('merge', 'replace') THEN
    RAISE EXCEPTION 'Unknown restore mode: %', p_mode USING ERRCODE = '22023';
  END IF;

  SELECT org_id, status INTO v_org_id, v_status
  FROM public.restore_batches WHERE id = p_batch_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Unknown restore batch %', p_batch_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'staging' THEN
    RAISE EXCEPTION 'Restore batch % is already %', p_batch_id, v_status USING ERRCODE = '55000';
  END IF;

  -- SECURITY DEFINER bypasses RLS, so authorisation is re-checked explicitly.
  IF NOT public.is_org_owner(v_org_id) THEN
    RAISE EXCEPTION 'Only an organisation owner may commit a restore'
      USING ERRCODE = '42501';
  END IF;

  -- A full-ledger replay can outrun the default statement timeout. Scoped to
  -- this transaction only.
  PERFORM set_config('statement_timeout', '600000', true);

  -- ── Replace-mode guard, server side ────────────────────────────────────────
  -- The client runs the same comparison before uploading, but the client is not
  -- a trust boundary: a truncated or wrong-org backup must not be able to empty
  -- the ledger just because the browser skipped the preflight.
  IF p_mode = 'replace' AND NOT p_acknowledge_data_loss THEN
    FOR v_tbl IN
      SELECT * FROM public.restore_allowed_tables
      WHERE delete_in_replace ORDER BY insert_order
    LOOP
      EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id = $1', v_tbl.table_key)
        INTO v_live USING v_org_id;

      SELECT coalesce(sum(jsonb_array_length(s.rows)), 0) INTO v_staged
      FROM public.restore_staging s
      WHERE s.batch_id = p_batch_id AND s.table_key = v_tbl.table_key;

      IF v_staged < v_live THEN
        v_shortfall   := v_shortfall || format('%s (%s live vs %s staged)',
                                               v_tbl.table_key, v_live, v_staged);
        v_total_short := v_total_short + (v_live - v_staged);
      END IF;
    END LOOP;

    IF array_length(v_shortfall, 1) > 0 THEN
      RAISE EXCEPTION
        'Replace refused: backup is short by % row(s) — %. Re-confirm explicitly to proceed.',
        v_total_short, array_to_string(v_shortfall, '; ')
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- ── Delete, children before parents ────────────────────────────────────────
  -- Always org-scoped: RLS is bypassed here, so the WHERE clause is the only
  -- thing standing between this and another tenant's data.
  IF p_mode = 'replace' THEN
    FOR v_tbl IN
      SELECT * FROM public.restore_allowed_tables
      WHERE delete_in_replace ORDER BY insert_order DESC
    LOOP
      EXECUTE format('DELETE FROM public.%I WHERE org_id = $1', v_tbl.table_key)
        USING v_org_id;
    END LOOP;
  END IF;

  -- ── Insert, parents before children ────────────────────────────────────────
  FOR v_tbl IN
    SELECT * FROM public.restore_allowed_tables ORDER BY insert_order
  LOOP
    SELECT coalesce(jsonb_agg(elem ORDER BY s.id, ord), '[]'::jsonb) INTO v_rows
    FROM public.restore_staging s,
         LATERAL jsonb_array_elements(s.rows) WITH ORDINALITY AS t(elem, ord)
    WHERE s.batch_id = p_batch_id AND s.table_key = v_tbl.table_key;

    IF jsonb_array_length(v_rows) = 0 THEN CONTINUE; END IF;

    IF v_tbl.org_scoped THEN
      -- Overwrite org_id on every row rather than trusting the file. A backup
      -- taken from another org cannot be used to write into this one.
      SELECT jsonb_agg(elem || jsonb_build_object('org_id', v_org_id))
        INTO v_rows FROM jsonb_array_elements(v_rows) elem;
    ELSIF v_tbl.table_key = 'organizations' THEN
      -- Only the org being restored; never a sibling tenant's row.
      SELECT coalesce(jsonb_agg(elem), '[]'::jsonb) INTO v_rows
      FROM jsonb_array_elements(v_rows) elem
      WHERE elem->>'id' = v_org_id::text;

      IF jsonb_array_length(v_rows) = 0 THEN CONTINUE; END IF;
    END IF;

    -- Restore only columns the payload actually carries and the table actually
    -- has: an older backup missing a newer column must not null it out, and a
    -- newer backup with a dropped column must not abort the restore.
    SELECT array_agg(DISTINCT k ORDER BY k) INTO v_cols
    FROM jsonb_array_elements(v_rows) e, jsonb_object_keys(e) k
    WHERE k IN (
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_tbl.table_key
        AND is_generated = 'NEVER' AND identity_generation IS DISTINCT FROM 'ALWAYS'
    );

    IF v_cols IS NULL OR array_length(v_cols, 1) = 0 THEN
      RAISE EXCEPTION 'Backup rows for % carry no column matching the live schema',
        v_tbl.table_key USING ERRCODE = '42703';
    END IF;
    IF NOT (v_tbl.conflict_column = ANY (v_cols)) THEN
      RAISE EXCEPTION 'Backup rows for % are missing the key column %',
        v_tbl.table_key, v_tbl.conflict_column USING ERRCODE = '42703';
    END IF;

    SELECT string_agg(quote_ident(c), ', ' ORDER BY c) INTO v_collist FROM unnest(v_cols) c;
    SELECT string_agg(format('%I = EXCLUDED.%I', c, c), ', ' ORDER BY c) INTO v_setlist
    FROM unnest(v_cols) c WHERE c <> v_tbl.conflict_column;

    v_sql := format(
      'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(null::public.%I, $1) ON CONFLICT (%I) DO %s',
      v_tbl.table_key,
      v_collist,
      v_collist,
      v_tbl.table_key,
      v_tbl.conflict_column,
      CASE
        WHEN v_tbl.conflict_action = 'nothing' OR v_setlist IS NULL THEN 'NOTHING'
        ELSE 'UPDATE SET ' || v_setlist
      END
    );

    EXECUTE v_sql USING v_rows;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(v_tbl.table_key, v_inserted);
  END LOOP;

  -- Staged payload is dead weight once replayed; the batch row is kept as a
  -- record that the restore happened.
  DELETE FROM public.restore_staging WHERE batch_id = p_batch_id;
  UPDATE public.restore_batches SET status = 'committed' WHERE id = p_batch_id;

  RETURN jsonb_build_object('org_id', v_org_id, 'mode', p_mode, 'counts', v_counts);
END;
$$;

REVOKE ALL ON FUNCTION public.commit_restore(uuid, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.commit_restore(uuid, text, boolean) TO authenticated;

-- ── 4. Housekeeping ──────────────────────────────────────────────────────────
-- Abandoned batches (tab closed mid-upload) hold no locks and touch no live
-- data, but should not accumulate.

CREATE OR REPLACE FUNCTION public.purge_stale_restore_batches(p_older_than interval DEFAULT '24 hours')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM public.restore_batches
  WHERE status = 'staging' AND created_at < now() - p_older_than;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_stale_restore_batches(interval) FROM public;

NOTIFY pgrst, 'reload schema';
