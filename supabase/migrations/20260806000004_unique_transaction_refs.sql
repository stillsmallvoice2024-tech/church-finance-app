-- ============================================================================
-- Unique transaction references per bank account
-- ============================================================================
-- Import deduplication was a client-side read-then-write: fetch which refs
-- already exist (src/utils/dedupQuery.ts), filter, then INSERT.  Nothing
-- enforced the result.  Two treasurers importing the same statement, or one
-- treasurer retrying after a write timeout (see the note in src/lib/supabase.ts
-- — an aborted request is not rolled back server-side), both land a fully
-- duplicated set of transactions with nothing to flag it.
--
-- These indexes make the database the authority.  The pre-check stays as a
-- fast path that lets the user see duplicates before importing; the index is
-- what actually prevents them, and a 23505 on insert is now reported as a
-- skipped duplicate rather than a failed row.
--
-- Scope is (org, bank account, normalised ref).  The same ref in a different
-- bank is a different transaction.  Rows with no reference are exempt.
--
-- intra_flows is deliberately not covered: it has no bank column, is
-- manual-entry only (no import path, so no race), and its reversal rows may
-- legitimately reuse a reference.
-- ============================================================================

-- ── 1. Pre-flight: refuse to run on data that already has duplicates ─────────
-- Creating the index would fail with an opaque "could not create unique index"
-- and no indication of which rows are at fault.  Fail early instead, and point
-- at the report view added in the previous migration.  Duplicates are financial
-- records — they are never deleted automatically; a human decides.

DO $$
DECLARE
  v_groups bigint;
  v_rows   bigint;
BEGIN
  SELECT count(*), coalesce(sum(row_count), 0)
  INTO   v_groups, v_rows
  FROM   public.duplicate_transaction_refs;

  IF v_groups > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce transaction-reference uniqueness: % duplicate reference group(s) covering % row(s) already exist.',
      v_groups, v_rows
      USING HINT =
        'Inspect them with: SELECT * FROM public.duplicate_transaction_refs ORDER BY row_count DESC; '
        'Delete the surplus rows (row_ids lists each group oldest-first), then re-run this migration.';
  END IF;
END $$;

-- ── 2. Unique indexes ────────────────────────────────────────────────────────
-- Partial on the normalised ref so rows without a reference are unconstrained.
-- Not CONCURRENTLY: migrations run inside a transaction, which CONCURRENTLY
-- forbids.  These tables are small enough that the brief lock is a non-issue.

CREATE UNIQUE INDEX IF NOT EXISTS inflow_transactions_org_bank_ref_unique
  ON public.inflow_transactions (
    org_id,
    public.txn_bank_key(bank_id, bank_name),
    public.normalize_txn_ref(transaction_ref)
  )
  WHERE public.normalize_txn_ref(transaction_ref) IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS outflow_transactions_org_bank_ref_unique
  ON public.outflow_transactions (
    org_id,
    public.txn_bank_key(bank_id, bank_name),
    public.normalize_txn_ref(transaction_id)
  )
  WHERE public.normalize_txn_ref(transaction_id) IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS fx_transactions_org_bank_ref_unique
  ON public.fx_transactions (
    org_id,
    public.txn_bank_key(bank_id, bank_name),
    public.normalize_txn_ref(transaction_ref)
  )
  WHERE public.normalize_txn_ref(transaction_ref) IS NOT NULL;
