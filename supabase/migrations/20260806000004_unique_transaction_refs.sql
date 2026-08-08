-- ============================================================================
-- Unique transactions per bank account
-- ============================================================================
-- Import deduplication was a client-side read-then-write: fetch which refs
-- already exist (src/utils/dedupQuery.ts), filter, then INSERT.  Nothing
-- enforced the result.  Two treasurers importing the same statement, or one
-- retrying after a write timeout (see the note in src/lib/supabase.ts — an
-- aborted request is not rolled back server-side), both land a duplicated set
-- of transactions with nothing to flag it.
--
-- Identity is (org, bank, reference, date, amount, description, ref_occurrence).
-- Keying on the reference alone would be wrong — banks reuse one reference
-- across a transfer, its fee and the VAT on that fee, and every one of those is
-- a real transaction.  Including date, amount and description keeps them apart
-- while still blocking a re-imported statement, which reproduces all six columns
-- exactly.  The bank's reference is never rewritten, so it stays usable for
-- reconciliation.
--
-- Rows with no reference are exempt.  intra_flows is not covered: no bank
-- column, manual entry only (no race), and reversal rows may reuse a reference.
-- ============================================================================

-- ── 1. Pre-flight: refuse to run on data that already has duplicates ─────────
-- Creating the index would otherwise fail with an opaque "could not create
-- unique index" and no indication of which rows are at fault.  Every group the
-- view returns is the same transaction recorded more than once; the surplus
-- rows are not real transactions.  They are still never deleted automatically —
-- a human reviews and decides.

DO $$
DECLARE
  v_groups  bigint;
  v_surplus bigint;
BEGIN
  SELECT count(*), coalesce(sum(surplus_rows), 0)
  INTO   v_groups, v_surplus
  FROM   public.duplicate_transactions;

  IF v_groups > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce transaction uniqueness: % duplicated transaction(s) covering % surplus row(s) already exist.',
      v_groups, v_surplus
      USING HINT =
        'Review them with: SELECT * FROM public.duplicate_transactions ORDER BY overstated_amount DESC; '
        'Each group is one transaction recorded more than once — row_ids is oldest-first, so keep row_ids[1] '
        'and delete the rest. Postings that merely share a reference (a transfer and its fee) are NOT listed '
        'here and need no action. Then re-run this migration.';
  END IF;
END $$;

-- ── 2. Unique indexes ────────────────────────────────────────────────────────
-- Partial on the normalised reference so rows without one are unconstrained.
-- Not CONCURRENTLY: migrations run inside a transaction, which forbids it.

CREATE UNIQUE INDEX IF NOT EXISTS inflow_transactions_org_bank_txn_unique
  ON public.inflow_transactions (
    org_id,
    public.txn_bank_key(bank_id, bank_name),
    public.normalize_txn_ref(transaction_ref),
    date,
    amount,
    coalesce(public.normalize_txn_ref(description), ''),
    ref_occurrence
  )
  WHERE public.normalize_txn_ref(transaction_ref) IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS outflow_transactions_org_bank_txn_unique
  ON public.outflow_transactions (
    org_id,
    public.txn_bank_key(bank_id, bank_name),
    public.normalize_txn_ref(transaction_id),
    date,
    amount_disbursed,
    coalesce(public.normalize_txn_ref(description), ''),
    ref_occurrence
  )
  WHERE public.normalize_txn_ref(transaction_id) IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS fx_transactions_org_bank_txn_unique
  ON public.fx_transactions (
    org_id,
    public.txn_bank_key(bank_id, bank_name),
    public.normalize_txn_ref(transaction_ref),
    date,
    deposit,
    withdrawal,
    coalesce(public.normalize_txn_ref(narration), ''),
    ref_occurrence
  )
  WHERE public.normalize_txn_ref(transaction_ref) IS NOT NULL;
