-- recalculate_ledger_balances: recomputes running balance for all entries of
-- one account, incorporating accounts.opening_balance as the starting point.
-- Called by trigger after any INSERT/UPDATE/DELETE on ledger_entries, and
-- after opening_balance changes on accounts.
CREATE OR REPLACE FUNCTION public.recalculate_ledger_balances(
  p_account_id uuid,
  p_org_id     uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_opening numeric(15,2) := 0;
BEGIN
  SELECT COALESCE(opening_balance, 0)
  INTO   v_opening
  FROM   public.accounts
  WHERE  id = p_account_id;

  v_opening := COALESCE(v_opening, 0);

  WITH computed AS (
    SELECT id,
           v_opening + SUM(
             COALESCE(inflow, 0) + COALESCE(refund_intraflow, 0) - COALESCE(outflow, 0)
           ) OVER (
             ORDER BY date ASC, created_at ASC
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS new_balance
    FROM   public.ledger_entries
    WHERE  account_id = p_account_id
      AND  org_id     = p_org_id
  )
  UPDATE public.ledger_entries e
  SET    balance = c.new_balance
  FROM   computed c
  WHERE  e.id = c.id;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.recalculate_ledger_balances(uuid, uuid) TO authenticated;

-- Trigger function for ledger_entries: fires after INSERT/UPDATE/DELETE
CREATE OR REPLACE FUNCTION public.trg_ledger_balance_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_ledger_balances(OLD.account_id, OLD.org_id);
  ELSIF TG_OP = 'UPDATE' AND OLD.account_id IS DISTINCT FROM NEW.account_id THEN
    -- Entry moved to a different account: recalculate both
    PERFORM public.recalculate_ledger_balances(OLD.account_id, OLD.org_id);
    PERFORM public.recalculate_ledger_balances(NEW.account_id, NEW.org_id);
  ELSE
    PERFORM public.recalculate_ledger_balances(NEW.account_id, NEW.org_id);
  END IF;
  RETURN NULL;
END;
$func$;

DROP TRIGGER IF EXISTS trg_ledger_balance ON public.ledger_entries;
CREATE TRIGGER trg_ledger_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_balance_fn();

-- Trigger on accounts: when opening_balance changes, cascade to ledger entries
CREATE OR REPLACE FUNCTION public.trg_account_opening_balance_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF OLD.opening_balance IS DISTINCT FROM NEW.opening_balance THEN
    PERFORM public.recalculate_ledger_balances(NEW.id, NEW.org_id);
  END IF;
  RETURN NULL;
END;
$func$;

DROP TRIGGER IF EXISTS trg_account_opening_balance ON public.accounts;
CREATE TRIGGER trg_account_opening_balance
  AFTER UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_account_opening_balance_fn();

NOTIFY pgrst, 'reload schema';
