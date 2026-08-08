-- ============================================================================
-- Backfill: FX-reversal pairs recorded as one inflow + one outflow row
-- ============================================================================
-- Some of duplicate_transactions' "repeated import" groups are not double
-- imports at all: an FX conversion posted the proceeds as an inflow, then the
-- bank reversed it, and the reversal landed as an outflow of the same
-- reference and amount instead of a signed entry in the same column.
-- duplicate_transactions cannot see this — it groups within one table — so
-- these look like an ordinary same-table duplicate until inspected. Run this
-- BEFORE 20260806000006 (which nulls surplus rows): once an amount is
-- zeroed it no longer matches its partner and this backfill can no longer
-- find the pair.
--
-- Non-destructive: no row is deleted or zeroed. The older row (the proceeds)
-- becomes offset_role='root'; the newer row (the reversal) is tagged
-- transaction_type='reversal', offset_role='offset', linked back via
-- root_transaction_id/root_transaction_table. isNonContributing() (see
-- transactionTypes.ts) then nets the offset row out of every balance and
-- report automatically — no other code path changes.
--
-- The pair set is computed ONCE into a temp table before either UPDATE runs,
-- so the second UPDATE isn't looking at a join condition the first UPDATE
-- already changed (offset_role IS NULL would otherwise exclude every row the
-- first UPDATE had just tagged, and find nothing).
--
-- Scope: only pairs where NEITHER row is already tagged reversal/offset, so
-- re-running is a no-op and a pair someone already resolved by hand is left
-- alone.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE fx_reversal_pairs ON COMMIT DROP AS
WITH candidate_pairs AS (
  SELECT i.id AS inflow_id, i.created_at AS inflow_created_at,
         o.id AS outflow_id, o.created_at AS outflow_created_at
  FROM   public.inflow_transactions i
  JOIN   public.outflow_transactions o
         ON  o.org_id = i.org_id
         AND public.txn_bank_key(o.bank_id, o.bank_name) = public.txn_bank_key(i.bank_id, i.bank_name)
         AND public.normalize_txn_ref(o.transaction_id) = public.normalize_txn_ref(i.transaction_ref)
         AND o.amount_disbursed = i.amount
  WHERE  public.normalize_txn_ref(i.transaction_ref) IS NOT NULL
    AND  coalesce(i.transaction_type, '') NOT IN ('reversal', 'refund', 'bank_deposit', 'intrabank_transfer')
    AND  coalesce(o.transaction_type, '') NOT IN ('reversal', 'refund', 'bank_deposit', 'intrabank_transfer')
    AND  i.offset_role IS NULL AND o.offset_role IS NULL
),
-- One pairing per inflow (its earliest-matching outflow) ...
by_inflow AS (
  SELECT DISTINCT ON (inflow_id) inflow_id, outflow_id, inflow_created_at, outflow_created_at
  FROM   candidate_pairs
  ORDER  BY inflow_id, outflow_created_at
)
-- ... then one per outflow too, so a reference reused a third time on either
-- side is left for manual review rather than paired twice.
SELECT DISTINCT ON (outflow_id) inflow_id, outflow_id,
       (inflow_created_at <= outflow_created_at) AS inflow_is_root
FROM   by_inflow
ORDER  BY outflow_id, inflow_created_at;

UPDATE public.inflow_transactions tgt
SET    offset_role            = CASE WHEN p.inflow_is_root THEN 'root' ELSE 'offset' END,
       transaction_type       = CASE WHEN p.inflow_is_root THEN tgt.transaction_type ELSE 'reversal' END,
       offset_link_type       = CASE WHEN p.inflow_is_root THEN tgt.offset_link_type ELSE 'reversal' END,
       root_transaction_id    = CASE WHEN p.inflow_is_root THEN tgt.root_transaction_id ELSE p.outflow_id::text END,
       root_transaction_table = CASE WHEN p.inflow_is_root THEN tgt.root_transaction_table ELSE 'outflow_transactions' END
FROM   fx_reversal_pairs p
WHERE  tgt.id = p.inflow_id;

UPDATE public.outflow_transactions tgt
SET    offset_role            = CASE WHEN p.inflow_is_root THEN 'offset' ELSE 'root' END,
       transaction_type       = CASE WHEN p.inflow_is_root THEN 'reversal' ELSE tgt.transaction_type END,
       offset_link_type       = CASE WHEN p.inflow_is_root THEN 'reversal' ELSE tgt.offset_link_type END,
       root_transaction_id    = CASE WHEN p.inflow_is_root THEN p.inflow_id::text ELSE tgt.root_transaction_id END,
       root_transaction_table = CASE WHEN p.inflow_is_root THEN 'inflow_transactions' ELSE tgt.root_transaction_table END
FROM   fx_reversal_pairs p
WHERE  tgt.id = p.outflow_id;

COMMIT;
