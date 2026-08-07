-- ============================================================================
-- create_fx_transaction: carry ref_occurrence
-- ============================================================================
-- Manual FX entry goes through this function rather than a direct insert, so it
-- needs the occurrence value the modal computed. Without it every manual FX row
-- lands at 0 and a legitimate second identical entry collides with the first.
--
-- Adding a trailing parameter changes the function's identity (Postgres keys
-- overloads by parameter type list), so the 10-arg version is dropped first —
-- CREATE OR REPLACE would otherwise leave it behind as a live overload and
-- PostgREST would have two candidates to choose between.
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_fx_transaction(
  uuid, uuid, date, text, numeric, numeric, text, text, text, uuid
);

CREATE OR REPLACE FUNCTION public.create_fx_transaction(
  p_org_id          uuid,
  p_user_id         uuid,
  p_date            date,
  p_currency        text,
  p_deposit         numeric,
  p_withdrawal      numeric,
  p_narration       text     DEFAULT NULL,
  p_transaction_ref text     DEFAULT NULL,
  p_bank_name       text     DEFAULT NULL,
  p_bank_id         uuid     DEFAULT NULL,
  p_ref_occurrence  smallint DEFAULT 0
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
    narration, transaction_ref, bank_name, bank_id, ref_occurrence,
    created_by, org_id
  ) VALUES (
    p_date, p_currency,
    COALESCE(p_deposit, 0), COALESCE(p_withdrawal, 0),
    v_new_balance,
    p_narration, p_transaction_ref, p_bank_name, p_bank_id,
    COALESCE(p_ref_occurrence, 0),
    p_user_id, p_org_id
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.create_fx_transaction(
  uuid, uuid, date, text, numeric, numeric, text, text, text, uuid, smallint
) TO authenticated;

NOTIFY pgrst, 'reload schema';
