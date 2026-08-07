-- ============================================================================
-- Duplicate transaction-reference reporting
-- ============================================================================
-- Applied ahead of the uniqueness indexes so that if an org already holds
-- duplicate references the failing migration has something to point at.  This
-- migration is non-destructive and always succeeds.
--
-- `normalize_txn_ref` mirrors src/utils/normalizeId.ts exactly (NFC, strip
-- invisible characters, collapse whitespace, trim, case preserved — bank refs
-- are case-sensitive) so the database and the import dedup pre-check agree on
-- what counts as "the same reference".
-- ============================================================================

-- ── 1. Normalisation helper ──────────────────────────────────────────────────
-- IMMUTABLE so it can be used in an index expression.  Returns NULL for a
-- blank/absent reference, which is how the uniqueness indexes exempt rows that
-- have no reference at all.

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
-- The uniqueness scope is the bank account.  It keys on bank_name, not bank_id,
-- for three reasons:
--   * bank_id is NULL whenever an imported statement was not matched to an
--     internal bank (ImportModal sets it only when `internalBank` resolves), and
--     a plain NULL column in a unique index exempts exactly those rows;
--   * bank_name is set on every row that carries a bank_id (the import writes
--     both together) and on legacy rows written before bank_id existed, so old
--     and new rows for one bank land in the same key space — keying on bank_id
--     would let a legacy row and a new row hold the same reference;
--   * the companion migration makes bank names unique per org, so name and
--     account are 1:1, and it matches what the import's dedup pre-check filters
--     on (dedupQuery.ts scopes by bank_name) — index and pre-check agree.
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

-- ── 3. Reporting view ────────────────────────────────────────────────────────
-- security_invoker so RLS on the underlying tables applies — each org sees only
-- its own duplicates.

-- `distinct_rows` counts how many genuinely different transactions share the
-- reference (same date + amount + description = the same transaction recorded
-- twice).  It is the difference between the two reasons a reference repeats,
-- and it decides the remedy:
--
--   likely_cause = 'repeated import'  — every row identical. The statement was
--       imported twice. The surplus rows are not real transactions.
--   likely_cause = 'shared reference' — every row different. The bank reuses
--       one reference across several postings (a Session ID spanning the legs
--       of a settlement; ImportModal maps `sessionid` into this column). These
--       are all real transactions and NONE of them may be deleted.
--   likely_cause = 'mixed'            — both at once. Needs a human.
--
-- Only 'repeated import' is ever a deletion candidate, and even then it is the
-- user's call. 'shared reference' is resolved by suffixing, never by deleting —
-- see suffix_duplicate_transaction_refs() below.

CREATE OR REPLACE VIEW public.duplicate_transaction_refs
WITH (security_invoker = true) AS
  SELECT 'inflow_transactions'::text AS source_table,
         org_id,
         public.txn_bank_key(bank_id, bank_name) AS bank_key,
         max(bank_name)                          AS bank_name,
         public.normalize_txn_ref(transaction_ref) AS normalized_ref,
         count(*)                                AS row_count,
         count(DISTINCT (date, amount, coalesce(description, ''))) AS distinct_rows,
         CASE
           WHEN count(DISTINCT (date, amount, coalesce(description, ''))) = 1 THEN 'repeated import'
           WHEN count(DISTINCT (date, amount, coalesce(description, ''))) = count(*) THEN 'shared reference'
           ELSE 'mixed'
         END                                     AS likely_cause,
         sum(amount)                             AS total_amount,
         min(date)                               AS first_date,
         max(date)                               AS last_date,
         array_agg(id ORDER BY created_at, id)   AS row_ids
  FROM   public.inflow_transactions
  WHERE  public.normalize_txn_ref(transaction_ref) IS NOT NULL
  GROUP  BY org_id, 3, 5
  HAVING count(*) > 1

  UNION ALL

  SELECT 'outflow_transactions'::text,
         org_id,
         public.txn_bank_key(bank_id, bank_name),
         max(bank_name),
         public.normalize_txn_ref(transaction_id),
         count(*),
         count(DISTINCT (date, amount_disbursed, coalesce(description, ''))),
         CASE
           WHEN count(DISTINCT (date, amount_disbursed, coalesce(description, ''))) = 1 THEN 'repeated import'
           WHEN count(DISTINCT (date, amount_disbursed, coalesce(description, ''))) = count(*) THEN 'shared reference'
           ELSE 'mixed'
         END,
         sum(coalesce(amount_disbursed, 0)),
         min(date),
         max(date),
         array_agg(id ORDER BY created_at, id)
  FROM   public.outflow_transactions
  WHERE  public.normalize_txn_ref(transaction_id) IS NOT NULL
  GROUP  BY org_id, 3, 5
  HAVING count(*) > 1

  UNION ALL

  SELECT 'fx_transactions'::text,
         org_id,
         public.txn_bank_key(bank_id, bank_name),
         max(bank_name),
         public.normalize_txn_ref(transaction_ref),
         count(*),
         count(DISTINCT (date, deposit, withdrawal, coalesce(narration, ''))),
         CASE
           WHEN count(DISTINCT (date, deposit, withdrawal, coalesce(narration, ''))) = 1 THEN 'repeated import'
           WHEN count(DISTINCT (date, deposit, withdrawal, coalesce(narration, ''))) = count(*) THEN 'shared reference'
           ELSE 'mixed'
         END,
         sum(coalesce(deposit, 0) + coalesce(withdrawal, 0)),
         min(date),
         max(date),
         array_agg(id ORDER BY created_at, id)
  FROM   public.fx_transactions
  WHERE  public.normalize_txn_ref(transaction_ref) IS NOT NULL
  GROUP  BY org_id, 3, 5
  HAVING count(*) > 1;

-- ── 4. Non-destructive resolver ──────────────────────────────────────────────
-- Makes existing references unique by SUFFIXING them "-1", "-2", … exactly as
-- src/utils/claimRef.ts does for new imports. Nothing is deleted and no amount,
-- date or description is touched, so it is safe to run against a group of
-- genuinely distinct transactions that share a bank Session ID.
--
-- The oldest row in each group keeps the bare reference. Suffixes already in
-- use within the same (org, bank) are skipped, so a reference the statement
-- itself contains is never handed out twice.
--
-- This does NOT resolve a repeated import — suffixing those would turn one
-- duplicated month of income into two months of distinct-looking income, which
-- is worse than leaving it. Check `likely_cause` in duplicate_transaction_refs
-- first and delete repeated-import rows by hand; run this for the rest.

-- Helper for the suffix loop below: does any row in this (org, bank) already
-- hold this reference? Split out so the loop stays readable and so the lookup
-- is one dynamic statement rather than string-built predicates.
CREATE OR REPLACE FUNCTION public.duplicate_ref_holder(
  p_table text, p_col text, p_org_id uuid, p_bank_key text, p_ref text
)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY EXECUTE format($sql$
    SELECT x.id FROM public.%1$I x
    WHERE  x.org_id = $1
      AND  public.txn_bank_key(x.bank_id, x.bank_name) = $2
      AND  public.normalize_txn_ref(x.%2$I) = $3
    LIMIT 1
  $sql$, p_table, p_col)
  USING p_org_id, p_bank_key, p_ref;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.suffix_duplicate_transaction_refs()
RETURNS TABLE (source_table text, rows_renamed bigint)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  t         record;
  r         record;
  v_renamed bigint;
  v_new     text;
  v_n       int;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('inflow_transactions',  'transaction_ref'),
      ('outflow_transactions', 'transaction_id'),
      ('fx_transactions',      'transaction_ref')
    ) AS v(tbl, col)
  LOOP
    v_renamed := 0;

    -- Row by row, not one set-based UPDATE. A single statement evaluates every
    -- row's target against the PRE-update table, so two siblings can pick the
    -- same free suffix and collide. Assigning one at a time makes each rename
    -- visible to the next.
    --
    -- Only 'shared reference' groups are touched. A repeated import is left
    -- exactly as found: numbering those apart would launder one duplicated
    -- month of income into two months of distinct-looking income. 'mixed'
    -- groups are left too — they need a human to say which rows are real.
    FOR r IN EXECUTE format($sql$
      SELECT id, org_id,
             public.txn_bank_key(bank_id, bank_name) AS bank_key,
             public.normalize_txn_ref(%1$I)          AS nref,
             row_number() OVER (
               PARTITION BY org_id,
                            public.txn_bank_key(bank_id, bank_name),
                            public.normalize_txn_ref(%1$I)
               ORDER BY created_at, id
             ) AS rn
      FROM   public.%2$I
      WHERE  public.normalize_txn_ref(%1$I) IS NOT NULL
        AND  (org_id, public.txn_bank_key(bank_id, bank_name), public.normalize_txn_ref(%1$I)) IN (
               SELECT org_id, bank_key, normalized_ref
               FROM   public.duplicate_transaction_refs
               WHERE  source_table = %2$L AND likely_cause = 'shared reference'
             )
      ORDER  BY org_id, 3, 4, created_at, id
    $sql$, t.col, t.tbl)
    LOOP
      CONTINUE WHEN r.rn = 1;   -- oldest row keeps the bare reference

      v_n := r.rn - 1;
      LOOP
        v_new := r.nref || '-' || v_n;
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.duplicate_ref_holder(t.tbl, t.col, r.org_id, r.bank_key, v_new)
        );
        v_n := v_n + 1;
      END LOOP;

      EXECUTE format('UPDATE public.%1$I SET %2$I = $1 WHERE id = $2', t.tbl, t.col)
        USING v_new, r.id;
      v_renamed := v_renamed + 1;
    END LOOP;

    source_table := t.tbl;
    rows_renamed := v_renamed;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

GRANT SELECT   ON public.duplicate_transaction_refs                    TO authenticated;
GRANT EXECUTE  ON FUNCTION public.normalize_txn_ref(text)              TO authenticated;
GRANT EXECUTE  ON FUNCTION public.txn_bank_key(uuid, text)             TO authenticated;
-- Deliberately NOT granted to `authenticated`: this rewrites stored references
-- across an entire table and is a one-off admin operation, not something the
-- app should ever be able to trigger.
REVOKE ALL ON FUNCTION public.suffix_duplicate_transaction_refs() FROM public;
REVOKE ALL ON FUNCTION public.duplicate_ref_holder(text, text, uuid, text, text) FROM public;
