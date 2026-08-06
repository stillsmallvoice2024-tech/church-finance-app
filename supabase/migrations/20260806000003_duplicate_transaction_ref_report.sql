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

CREATE OR REPLACE VIEW public.duplicate_transaction_refs
WITH (security_invoker = true) AS
  SELECT 'inflow_transactions'::text AS source_table,
         org_id,
         public.txn_bank_key(bank_id, bank_name) AS bank_key,
         max(bank_name)                          AS bank_name,
         public.normalize_txn_ref(transaction_ref) AS normalized_ref,
         count(*)                                AS row_count,
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
         sum(coalesce(deposit, 0) + coalesce(withdrawal, 0)),
         min(date),
         max(date),
         array_agg(id ORDER BY created_at, id)
  FROM   public.fx_transactions
  WHERE  public.normalize_txn_ref(transaction_ref) IS NOT NULL
  GROUP  BY org_id, 3, 5
  HAVING count(*) > 1;

GRANT SELECT   ON public.duplicate_transaction_refs           TO authenticated;
GRANT EXECUTE  ON FUNCTION public.normalize_txn_ref(text)     TO authenticated;
GRANT EXECUTE  ON FUNCTION public.txn_bank_key(uuid, text)    TO authenticated;
