-- Fix: ledger balance recalculation was O(N^2) on bulk writes.
-- The old FOR EACH ROW trigger ran a full-account recompute after every
-- single row change, so an N-row import triggered N full recomputes.
-- This converts it to a FOR EACH STATEMENT trigger that recomputes each
-- affected account once per statement, using transition tables to collect
-- the set of accounts touched by the whole batch.

DROP TRIGGER IF EXISTS trg_ledger_balance ON public.ledger_entries;
DROP FUNCTION IF EXISTS public.trg_ledger_balance_fn();

CREATE OR REPLACE FUNCTION public.trg_ledger_balance_stmt_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT account_id, org_id FROM new_rows WHERE account_id IS NOT NULL
    UNION
    SELECT DISTINCT account_id, org_id FROM old_rows WHERE account_id IS NOT NULL
  LOOP
    PERFORM public.recalculate_ledger_balances(r.account_id, r.org_id);
  END LOOP;
  RETURN NULL;
END;
$func$;

CREATE TRIGGER trg_ledger_balance_stmt
  AFTER INSERT OR UPDATE OR DELETE ON public.ledger_entries
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_ledger_balance_stmt_fn();

NOTIFY pgrst, 'reload schema';
