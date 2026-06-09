-- create_fx_transaction: server-side add for manual FX entries.
-- Uses advisory lock + latest-balance fetch, matching perform_fx_conversion behaviour.
CREATE OR REPLACE FUNCTION public.create_fx_transaction(
  p_org_id          uuid,
  p_user_id         uuid,
  p_date            date,
  p_currency        text,
  p_deposit         numeric,
  p_withdrawal      numeric,
  p_narration       text    DEFAULT NULL,
  p_transaction_ref text    DEFAULT NULL,
  p_bank_name       text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_prev_balance  numeric := 0;
  v_new_balance   numeric;
  v_new_id        uuid;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id is required';
  END IF;
  IF COALESCE(p_deposit, 0) < 0 OR COALESCE(p_withdrawal, 0) < 0 THEN
    RAISE EXCEPTION 'deposit and withdrawal must be non-negative';
  END IF;
  IF COALESCE(p_deposit, 0) = 0 AND COALESCE(p_withdrawal, 0) = 0 THEN
    RAISE EXCEPTION 'Either deposit or withdrawal must be non-zero';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_currency));

  SELECT COALESCE(running_balance, 0)
  INTO   v_prev_balance
  FROM   public.fx_transactions
  WHERE  org_id   = p_org_id
    AND  currency = p_currency
  ORDER  BY date DESC, created_at DESC
  LIMIT  1;

  v_prev_balance := COALESCE(v_prev_balance, 0);
  v_new_balance  := v_prev_balance + COALESCE(p_deposit, 0) - COALESCE(p_withdrawal, 0);

  INSERT INTO public.fx_transactions (
    date, currency, deposit, withdrawal, running_balance,
    narration, transaction_ref, bank_name, created_by, org_id
  ) VALUES (
    p_date, p_currency,
    COALESCE(p_deposit, 0), COALESCE(p_withdrawal, 0),
    v_new_balance,
    p_narration, p_transaction_ref, p_bank_name,
    p_user_id, p_org_id
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.create_fx_transaction(
  uuid, uuid, date, text, numeric, numeric, text, text, text
) TO authenticated;

-- update_fx_transaction: server-side edit for manual FX entries.
-- Updates the target row then does a full running_balance recompute for the whole
-- currency chain so date changes and amount changes both cascade correctly.
CREATE OR REPLACE FUNCTION public.update_fx_transaction(
  p_org_id          uuid,
  p_user_id         uuid,
  p_transaction_id  uuid,
  p_date            date,
  p_currency        text,
  p_deposit         numeric,
  p_withdrawal      numeric,
  p_narration       text    DEFAULT NULL,
  p_transaction_ref text    DEFAULT NULL,
  p_bank_name       text    DEFAULT NULL
) RETURNS numeric  -- new running_balance of the updated row
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_new_balance  numeric;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id is required';
  END IF;
  IF COALESCE(p_deposit, 0) < 0 OR COALESCE(p_withdrawal, 0) < 0 THEN
    RAISE EXCEPTION 'deposit and withdrawal must be non-negative';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_currency));

  UPDATE public.fx_transactions
  SET
    date            = p_date,
    deposit         = COALESCE(p_deposit, 0),
    withdrawal      = COALESCE(p_withdrawal, 0),
    narration       = p_narration,
    transaction_ref = p_transaction_ref,
    bank_name       = p_bank_name
  WHERE id       = p_transaction_id
    AND org_id   = p_org_id
    AND currency = p_currency;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FX transaction % not found or does not belong to this org', p_transaction_id;
  END IF;

  -- Full recompute: recalculate running_balance for every row of this currency
  -- in ascending date/created_at order so date changes cascade correctly.
  WITH computed AS (
    SELECT id,
           SUM(deposit - withdrawal) OVER (
             PARTITION BY org_id, currency
             ORDER BY date ASC, created_at ASC
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS new_balance
    FROM   public.fx_transactions
    WHERE  org_id   = p_org_id
      AND  currency = p_currency
  )
  UPDATE public.fx_transactions t
  SET    running_balance = c.new_balance
  FROM   computed c
  WHERE  t.id = c.id;

  SELECT running_balance INTO v_new_balance
  FROM   public.fx_transactions
  WHERE  id = p_transaction_id;

  RETURN v_new_balance;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.update_fx_transaction(
  uuid, uuid, uuid, date, text, numeric, numeric, text, text, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';
