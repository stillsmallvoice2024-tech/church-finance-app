-- ============================================================================
-- Duplicate transaction reporting
-- ============================================================================
-- Applied ahead of the uniqueness indexes so that if an org already holds
-- duplicates the failing migration has something to point at.  This migration
-- is non-destructive and always succeeds.
--
-- A repeated reference does NOT mean a duplicated transaction.  Banks reuse one
-- reference across several genuine postings: a transfer, the fee on it and the
-- VAT on that fee all carry the same Session ID, and ImportModal maps
-- `sessionid` into this column.  ImportModal:1454 already works around a
-- fraction of this by tagging '-comm'/'-vat' onto debits whose description
-- starts with COMMISSION or VAT — evidence the pattern was known, and that the
-- workaround misses everything worded differently.
--
-- So identity is the whole row, not the reference: (org, bank, reference, date,
-- amount, description).  Re-importing a statement reproduces every one of those
-- columns, so duplicates are still caught; a fee and its VAT differ in amount,
-- so they coexist and the bank's reference is preserved intact.
-- ============================================================================

-- ── 1. Normalisation helper ──────────────────────────────────────────────────
-- IMMUTABLE so it can be used in an index expression.  Mirrors
-- src/utils/normalizeId.ts (NFC, strip invisible characters, collapse
-- whitespace, trim, case preserved — bank references are case-sensitive).
-- Returns NULL for a blank input, which is how the indexes exempt rows that
-- carry no reference at all.

CREATE OR REPLACE FUNCTION public.normalize_txn_ref(p_ref text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(
    btrim(regexp_replace(
      translate(
        normalize(coalesce(p_ref, ''), NFC),
        -- soft hyphen, NBSP, ZWSP/ZWNJ/ZWJ, LS/PS, BOM
        chr(173) || chr(160) || chr(8203) || chr(8204) || chr(8205)
                 || chr(8232) || chr(8233) || chr(65279),
        ''
      ),
      '\s+', ' ', 'g'
    )),
    ''
  );
$$;

-- ── 2. Bank-identity helper ──────────────────────────────────────────────────
-- Keys on bank_name, not bank_id, because:
--   * bank_id is NULL whenever an imported statement was not matched to an
--     internal bank (ImportModal sets it only when `internalBank` resolves), and
--     a plain NULL column in a unique index exempts exactly those rows;
--   * bank_name is set on every row that carries a bank_id (the import writes
--     both together) and on legacy rows written before bank_id existed, so old
--     and new rows for one bank land in the same key space;
--   * the companion migration makes bank names unique per org, so name and
--     account are 1:1, and it matches what the import's dedup pre-check filters
--     on (dedupQuery.ts scopes by bank_name).
-- bank_id is the fallback for the inverse case; rows with neither share the ''
-- key, which keeps them constrained rather than exempt.

CREATE OR REPLACE FUNCTION public.txn_bank_key(p_bank_id uuid, p_bank_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(nullif(public.normalize_bank_name(p_bank_name), ''), p_bank_id::text, '');
$$;

-- ── 3. Occurrence index ──────────────────────────────────────────────────────
-- A bank statement can legitimately contain two byte-identical lines: a
-- transfer that fails is reversed and retried, and both attempts post under one
-- Session ID with the same date, amount and narration.  No column tells them
-- apart — not even the running balance, which lands on the same figure when
-- nothing falls between the two attempts.  What separates them is their
-- position in the statement.
--
-- `ref_occurrence` records that position among otherwise-identical rows: the
-- first is 0, the second 1, and so on, in statement order.  The bank's
-- reference is stored verbatim and never rewritten, so it stays usable for
-- reconciliation.  Re-importing the same file reproduces the same numbering, so
-- the duplicate still collides and is still blocked.

ALTER TABLE public.inflow_transactions  ADD COLUMN IF NOT EXISTS ref_occurrence smallint NOT NULL DEFAULT 0;
ALTER TABLE public.outflow_transactions ADD COLUMN IF NOT EXISTS ref_occurrence smallint NOT NULL DEFAULT 0;
ALTER TABLE public.fx_transactions      ADD COLUMN IF NOT EXISTS ref_occurrence smallint NOT NULL DEFAULT 0;

-- ── 4. Backfill ──────────────────────────────────────────────────────────────
-- Existing identical rows are numbered ONLY where they arrived in the same
-- import run — a reversal and its retry are written seconds apart by one run.
-- Rows written by DIFFERENT runs are a statement imported twice; numbering
-- those would bless a duplicate and bake the double-counted money in
-- permanently.  They keep occurrence 0, stay colliding, and the index migration
-- refuses to run until a human resolves them.
--
-- Five minutes is the cutoff: a single import writes its rows within seconds,
-- and the smallest re-import gap worth worrying about is far larger.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('inflow_transactions',  'transaction_ref', 'amount',                                 'description'),
      ('outflow_transactions', 'transaction_id',  'amount_disbursed',                       'description'),
      -- fx splits its amount across two columns; both must partition, so this
      -- is interpolated as an expression (%2$s) rather than an identifier.
      ('fx_transactions',      'transaction_ref', 'coalesce(deposit,0), coalesce(withdrawal,0)', 'narration')
    ) AS v(tbl, refcol, amtexpr, desccol)
  LOOP
    EXECUTE format($sql$
      WITH grouped AS (
        SELECT id,
               row_number() OVER (
                 PARTITION BY org_id,
                              public.txn_bank_key(bank_id, bank_name),
                              public.normalize_txn_ref(%1$I),
                              date, %2$s,
                              coalesce(public.normalize_txn_ref(%3$I), '')
                 ORDER BY created_at, id
               ) - 1 AS occ,
               max(created_at) OVER (
                 PARTITION BY org_id,
                              public.txn_bank_key(bank_id, bank_name),
                              public.normalize_txn_ref(%1$I),
                              date, %2$s,
                              coalesce(public.normalize_txn_ref(%3$I), '')
               ) - min(created_at) OVER (
                 PARTITION BY org_id,
                              public.txn_bank_key(bank_id, bank_name),
                              public.normalize_txn_ref(%1$I),
                              date, %2$s,
                              coalesce(public.normalize_txn_ref(%3$I), '')
               ) AS spread
        FROM   public.%4$I
        WHERE  public.normalize_txn_ref(%1$I) IS NOT NULL
      )
      UPDATE public.%4$I tgt
      SET    ref_occurrence = grouped.occ
      FROM   grouped
      WHERE  tgt.id = grouped.id
        AND  grouped.occ > 0
        AND  grouped.spread < interval '5 minutes'
    $sql$, t.refcol, t.amtexpr, t.desccol, t.tbl);
  END LOOP;
END $$;

-- ── 5. Reporting view ────────────────────────────────────────────────────────
-- Groups on the full identity key, so every row it returns is a genuine
-- duplicate — the same transaction recorded more than once. Postings that merely
-- share a reference do not appear.
--
-- `surplus_rows` and `overstated_amount` are what the duplicates are costing:
-- keeping the oldest row of each group, that is how many rows and how much money
-- are counted twice today.
--
-- security_invoker so RLS applies and each org sees only its own data.

CREATE OR REPLACE VIEW public.duplicate_transactions
WITH (security_invoker = true) AS
  SELECT 'inflow_transactions'::text AS source_table,
         org_id,
         public.txn_bank_key(bank_id, bank_name)   AS bank_key,
         max(bank_name)                            AS bank_name,
         public.normalize_txn_ref(transaction_ref) AS normalized_ref,
         date,
         amount,
         max(description)                          AS description,
         count(*)                                  AS row_count,
         count(*) - 1                              AS surplus_rows,
         amount * (count(*) - 1)                   AS overstated_amount,
         array_agg(id ORDER BY created_at, id)     AS row_ids
  FROM   public.inflow_transactions
  WHERE  public.normalize_txn_ref(transaction_ref) IS NOT NULL
  GROUP  BY org_id, 3, 5, date, amount,
            coalesce(public.normalize_txn_ref(description), ''), ref_occurrence
  HAVING count(*) > 1

  UNION ALL

  SELECT 'outflow_transactions'::text,
         org_id,
         public.txn_bank_key(bank_id, bank_name),
         max(bank_name),
         public.normalize_txn_ref(transaction_id),
         date,
         amount_disbursed,
         max(description),
         count(*),
         count(*) - 1,
         coalesce(amount_disbursed, 0) * (count(*) - 1),
         array_agg(id ORDER BY created_at, id)
  FROM   public.outflow_transactions
  WHERE  public.normalize_txn_ref(transaction_id) IS NOT NULL
  GROUP  BY org_id, 3, 5, date, amount_disbursed,
            coalesce(public.normalize_txn_ref(description), ''), ref_occurrence
  HAVING count(*) > 1

  UNION ALL

  SELECT 'fx_transactions'::text,
         org_id,
         public.txn_bank_key(bank_id, bank_name),
         max(bank_name),
         public.normalize_txn_ref(transaction_ref),
         date,
         coalesce(deposit, 0) + coalesce(withdrawal, 0),
         max(narration),
         count(*),
         count(*) - 1,
         (coalesce(deposit, 0) + coalesce(withdrawal, 0)) * (count(*) - 1),
         array_agg(id ORDER BY created_at, id)
  FROM   public.fx_transactions
  WHERE  public.normalize_txn_ref(transaction_ref) IS NOT NULL
  GROUP  BY org_id, 3, 5, date, deposit, withdrawal,
            coalesce(public.normalize_txn_ref(narration), ''), ref_occurrence
  HAVING count(*) > 1;

GRANT SELECT   ON public.duplicate_transactions            TO authenticated;
GRANT EXECUTE  ON FUNCTION public.normalize_txn_ref(text)  TO authenticated;
GRANT EXECUTE  ON FUNCTION public.txn_bank_key(uuid, text) TO authenticated;
