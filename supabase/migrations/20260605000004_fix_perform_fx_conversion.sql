-- Fix perform_fx_conversion:
--   H-3: compute naira_amount server-side (p_naira_amount from client is ignored)
--   H-4: guard against negative FX balance before recording the withdrawal

CREATE OR REPLACE FUNCTION public.perform_fx_conversion(
  p_org_id               uuid,
  p_user_id              uuid,
  p_date                 date,
  p_fx_currency          text,
  p_fx_amount            numeric,
  p_exchange_rate        numeric,
  p_naira_amount         numeric,   -- kept in signature for caller compatibility; value is ignored
  p_bank_name            text,
  p_base_currency        text DEFAULT 'NGN',
  p_notes                text DEFAULT NULL,
  p_allocation_config_id uuid DEFAULT NULL,
  p_stage_code_1         text DEFAULT NULL,
  p_stage_code_2         text DEFAULT 'Percentage Allocation'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_prev_balance  numeric(15,4);
  v_new_balance   numeric(15,4);
  v_naira_amount  numeric(15,2);
  v_fx_tx_id      uuid;
  v_inflow_id     uuid;
  v_conversion_id uuid;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id is required';
  END IF;
  IF p_bank_name IS NULL OR trim(p_bank_name) = '' THEN
    RAISE EXCEPTION 'bank_name is required for FX conversion inflows';
  END IF;
  IF p_fx_amount <= 0 THEN
    RAISE EXCEPTION 'fx_amount must be positive';
  END IF;
  IF p_exchange_rate <= 0 THEN
    RAISE EXCEPTION 'exchange_rate must be positive';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_fx_currency));

  SELECT COALESCE(running_balance, 0)
  INTO   v_prev_balance
  FROM   public.fx_transactions
  WHERE  org_id   = p_org_id
    AND  currency = p_fx_currency
  ORDER  BY date DESC, created_at DESC
  LIMIT  1;

  v_prev_balance := COALESCE(v_prev_balance, 0);

  -- H-4: reject conversion if FX balance is insufficient
  IF v_prev_balance < p_fx_amount THEN
    RAISE EXCEPTION 'Insufficient FX balance: available % but requested %',
      v_prev_balance, p_fx_amount;
  END IF;

  v_new_balance := v_prev_balance - p_fx_amount;

  -- H-3: compute naira_amount server-side; ignore client-supplied value
  v_naira_amount := ROUND(p_fx_amount * p_exchange_rate, 2);

  INSERT INTO public.fx_transactions (
    date, currency, withdrawal, deposit, running_balance,
    narration, created_by, org_id
  ) VALUES (
    p_date, p_fx_currency, p_fx_amount, 0, v_new_balance,
    COALESCE(p_notes, 'Converted to ' || p_base_currency || ' @ ' || p_exchange_rate::text),
    p_user_id, p_org_id
  )
  RETURNING id INTO v_fx_tx_id;

  INSERT INTO public.inflow_transactions (
    date, amount, description, bank_name,
    stage_code_1, stage_code_2, allocation_config_id,
    fx_currency, fx_amount, fx_rate,
    transaction_type, created_by, org_id
  ) VALUES (
    p_date, v_naira_amount,
    COALESCE(p_notes, 'FX Conversion: ' || p_fx_currency || ' → ' || p_base_currency),
    p_bank_name, p_stage_code_1,
    COALESCE(p_stage_code_2, 'Percentage Allocation'),
    p_allocation_config_id, p_fx_currency, p_fx_amount, p_exchange_rate,
    'fx_conversion', p_user_id, p_org_id
  )
  RETURNING id INTO v_inflow_id;

  INSERT INTO public.fx_conversions (
    date, fx_currency, fx_amount, exchange_rate, naira_amount,
    fx_withdrawal_id, naira_inflow_id, notes,
    allocation_config_id, is_partial, created_by, org_id
  ) VALUES (
    p_date, p_fx_currency, p_fx_amount, p_exchange_rate, v_naira_amount,
    v_fx_tx_id, v_inflow_id, p_notes,
    p_allocation_config_id, (p_fx_amount < v_prev_balance),
    p_user_id, p_org_id
  )
  RETURNING id INTO v_conversion_id;

  RETURN jsonb_build_object(
    'fx_transaction_id', v_fx_tx_id,
    'inflow_id',         v_inflow_id,
    'conversion_id',     v_conversion_id
  );

EXCEPTION
  WHEN OTHERS THEN RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.perform_fx_conversion(
  uuid, uuid, date, text, numeric, numeric, numeric, text, text, text, uuid, text, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';
