-- ============================================================================
-- Neutralise duplicated transactions — WITHOUT DELETING ANY ROW
-- ============================================================================
-- public.duplicate_transactions (added in 20260806000003) groups rows that are
-- byte-identical across reference, date, amount and description — every group
-- it returns is the same transaction recorded more than once, never a shared
-- reference (a transfer and its fee differ in amount, so they never appear
-- here). This migration corrects the double-counted money WITHOUT removing any
-- row: the surplus copies stay in the table, visible in every listing, but are
-- zeroed and labelled so they no longer inflate a balance or report.
--
-- Every UPDATE below is captured by the existing audit_trigger_fn and
-- field_changes_trigger_fn (see schema.sql ~line 1978), which snapshot the full
-- before/after row into audit_log and the per-field diff into field_changes.
-- The original amount is therefore preserved twice over: once in the row's own
-- description, once in the audit trail — nothing is lost, nothing is deleted.
--
-- For each group: the OLDEST row (row_ids[1] — the first one written) is left
-- completely untouched, exactly as recorded. Every other row in the group has
-- its amount set to 0 and its description tagged
-- "[DUPLICATE IMPORT — was <original amount>, see row <id>]", and is given an
-- increasing ref_occurrence so multiple surplus copies of the same group stay
-- distinguishable from each other and from the kept row.
--
-- fx_transactions carries a STORED running balance, chained row-to-row at
-- insert time (create_fx_transaction). A duplicate fx row poisons the running
-- balance of every later row in the same (org, currency) — not just its own.
-- Zeroing the duplicate's deposit/withdrawal is therefore not enough on its
-- own; step 3 below recomputes running_balance for every affected (org,
-- currency) pair, over ALL its rows, in chronological order.
-- ============================================================================

BEGIN;

-- ── 1. Neutralise inflow_transactions ────────────────────────────────────────
WITH surplus AS (
  SELECT unnest(row_ids[2:]) AS id,
         generate_series(1, array_length(row_ids, 1) - 1) AS occ,
         amount AS original_amount
  FROM   public.duplicate_transactions
  WHERE  source_table = 'inflow_transactions'
)
UPDATE public.inflow_transactions tgt
SET    amount         = 0,
       description    = '[DUPLICATE IMPORT — was ' || trim(to_char(surplus.original_amount, 'FM999,999,999,990.00'))
                         || ', see row ' || (SELECT (row_ids[1])::text FROM public.duplicate_transactions dt
                                              WHERE dt.source_table = 'inflow_transactions'
                                                AND surplus.id = ANY(dt.row_ids)) || '] '
                         || coalesce(tgt.description, ''),
       ref_occurrence = surplus.occ
FROM   surplus
WHERE  tgt.id = surplus.id;

-- ── 2. Neutralise outflow_transactions ───────────────────────────────────────
WITH surplus AS (
  SELECT unnest(row_ids[2:]) AS id,
         generate_series(1, array_length(row_ids, 1) - 1) AS occ,
         amount AS original_amount
  FROM   public.duplicate_transactions
  WHERE  source_table = 'outflow_transactions'
)
UPDATE public.outflow_transactions tgt
SET    amount_disbursed = 0,
       description       = '[DUPLICATE IMPORT — was ' || trim(to_char(surplus.original_amount, 'FM999,999,999,990.00'))
                            || ', see row ' || (SELECT (row_ids[1])::text FROM public.duplicate_transactions dt
                                                 WHERE dt.source_table = 'outflow_transactions'
                                                   AND surplus.id = ANY(dt.row_ids)) || '] '
                            || coalesce(tgt.description, ''),
       ref_occurrence    = surplus.occ
FROM   surplus
WHERE  tgt.id = surplus.id;

-- ── 3. Neutralise fx_transactions, then recompute running_balance ───────────
WITH surplus AS (
  SELECT unnest(row_ids[2:]) AS id,
         generate_series(1, array_length(row_ids, 1) - 1) AS occ,
         amount AS original_amount
  FROM   public.duplicate_transactions
  WHERE  source_table = 'fx_transactions'
)
UPDATE public.fx_transactions tgt
SET    deposit        = 0,
       withdrawal     = 0,
       narration      = '[DUPLICATE IMPORT — was ' || trim(to_char(surplus.original_amount, 'FM999,999,999,990.00000'))
                         || ', see row ' || (SELECT (row_ids[1])::text FROM public.duplicate_transactions dt
                                              WHERE dt.source_table = 'fx_transactions'
                                                AND surplus.id = ANY(dt.row_ids)) || '] '
                         || coalesce(tgt.narration, ''),
       ref_occurrence = surplus.occ
FROM   surplus
WHERE  tgt.id = surplus.id;

-- Recompute running_balance for every (org, currency) pair touched above, over
-- ALL its rows in chronological order — a duplicate's effect propagated
-- forward through every later row's stored balance, so a partial recompute
-- starting only from the duplicate would miss rows written before it that a
-- LATER duplicate in the same currency had already poisoned.
--
-- Identified from the rows the UPDATE above just marked (narration now starts
-- with the tag), NOT from duplicate_transactions again — that view is live, and
-- by this point the neutralise step has already zeroed the duplicate's
-- deposit/withdrawal, so it no longer reports as a duplicate and the view would
-- come back empty here.
WITH affected AS (
  SELECT DISTINCT org_id, currency
  FROM   public.fx_transactions
  WHERE  narration LIKE '[DUPLICATE IMPORT —%'
),
recomputed AS (
  SELECT f.id,
         sum(f.deposit - f.withdrawal) OVER (
           PARTITION BY f.org_id, f.currency
           ORDER BY f.date, f.created_at, f.id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS new_balance
  FROM   public.fx_transactions f
  JOIN   affected a ON a.org_id = f.org_id AND a.currency = f.currency
)
UPDATE public.fx_transactions tgt
SET    running_balance = recomputed.new_balance
FROM   recomputed
WHERE  tgt.id = recomputed.id;

-- ── 4. Confirm nothing is left for the uniqueness migration to reject ────────
DO $$
DECLARE v_remaining bigint;
BEGIN
  SELECT count(*) INTO v_remaining FROM public.duplicate_transactions;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Still % duplicate group(s) after neutralisation — nothing was committed.', v_remaining;
  END IF;
END $$;

COMMIT;
