-- Fund/category linkage fix (hybrid, mirroring 20260804000002_bank_id_fk_and_repair.sql).
--
-- Problem: every fund balance is grouped by stage_code_1, a plain text column
-- with no FK to categories. The same name-as-key pattern extends to
-- intra_flows.account_from/account_to and allocation_configs.rows[].category_name.
-- Renaming a fund detached every historical transaction from it (new fund reads
-- 0, old balance became an invisible orphan group); deleting one left its money
-- summed under a name absent from every dropdown.
--
-- Fix, in three parts:
--   1. One-time repair: replay every recorded categories.name rename (from
--      field_changes history) onto the text columns, so already-orphaned rows
--      reconcile with the fund's current name.
--   2. Structural fix: add category_id uuid FK to inflow/outflow transactions,
--      backfill from the now-repaired stage_code_1, and backfill the intra_flows
--      from_category_id/to_category_id columns that already exist but were never
--      populated for historical rows.
--   3. Going forward the app writes category_id at insert time and treats
--      stage_code_1 as a display snapshot, so future renames are cosmetic.
--
-- ON DELETE SET NULL (not CASCADE): losing the link must never delete money.
-- The app blocks deleting a referenced category anyway (useDeleteCategory).

-- ── 1. One-time repair: replay recorded categories.name renames ───────────────
-- field_changes captures every categories.name UPDATE (table_name='categories',
-- field_name='name', old_value/new_value). For each, move any row still holding
-- the old name onto the category's current name, scoped by org so two orgs'
-- identically-named funds never merge.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (fc.record_id, fc.old_value)
      fc.record_id::uuid AS category_id, fc.old_value AS old_name,
      c.name AS current_name, c.org_id AS org_id
    FROM public.field_changes fc
    JOIN public.categories c ON c.id = fc.record_id::uuid
    WHERE fc.table_name = 'categories'
      AND fc.field_name = 'name'
      AND fc.old_value IS NOT NULL
      AND fc.old_value <> c.name
    ORDER BY fc.record_id, fc.old_value, fc.changed_at DESC
  LOOP
    UPDATE public.inflow_transactions
      SET stage_code_1 = r.current_name
      WHERE org_id = r.org_id AND stage_code_1 = r.old_name;

    UPDATE public.outflow_transactions
      SET stage_code_1 = r.current_name
      WHERE org_id = r.org_id AND stage_code_1 = r.old_name;

    UPDATE public.intra_flows
      SET account_from = r.current_name
      WHERE org_id = r.org_id AND account_from = r.old_name;

    UPDATE public.intra_flows
      SET account_to = r.current_name
      WHERE org_id = r.org_id AND account_to = r.old_name;

    -- allocation_configs.rows is a jsonb array of objects carrying
    -- category_name. Rewrite only the elements that hold the old name.
    UPDATE public.allocation_configs ac
      SET rows = (
        SELECT jsonb_agg(
          CASE WHEN elem->>'category_name' = r.old_name
               THEN jsonb_set(elem, '{category_name}', to_jsonb(r.current_name))
               ELSE elem END
          ORDER BY ord
        )
        FROM jsonb_array_elements(ac.rows) WITH ORDINALITY AS t(elem, ord)
      )
      WHERE ac.org_id = r.org_id
        AND jsonb_typeof(ac.rows) = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(ac.rows) AS e
          WHERE e->>'category_name' = r.old_name
        );
  END LOOP;
END $$;

-- ── 2. Structural fix: category_id FK on the two text-only transaction tables ──
ALTER TABLE public.inflow_transactions
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;
ALTER TABLE public.outflow_transactions
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inflow_category_id  ON public.inflow_transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_outflow_category_id ON public.outflow_transactions(category_id);

-- Backfill from the (now-repaired) stage_code_1, matching within the same org.
UPDATE public.inflow_transactions t
  SET category_id = c.id
  FROM public.categories c
  WHERE t.category_id IS NULL AND t.stage_code_1 = c.name AND t.org_id = c.org_id;

UPDATE public.outflow_transactions t
  SET category_id = c.id
  FROM public.categories c
  WHERE t.category_id IS NULL AND t.stage_code_1 = c.name AND t.org_id = c.org_id;

-- intra_flows already has from_category_id/to_category_id, but rows imported
-- before those columns were wired up still carry only the text names.
UPDATE public.intra_flows f
  SET from_category_id = c.id
  FROM public.categories c
  WHERE f.from_category_id IS NULL AND f.account_from = c.name AND f.org_id = c.org_id;

UPDATE public.intra_flows f
  SET to_category_id = c.id
  FROM public.categories c
  WHERE f.to_category_id IS NULL AND f.account_to = c.name AND f.org_id = c.org_id;

NOTIFY pgrst, 'reload schema';
