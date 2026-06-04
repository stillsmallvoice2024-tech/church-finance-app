-- ── LB-2/E-C2: Atomic FX Conversion ──────────────────────────────────────────
-- Wraps fx_transactions + inflow_transactions + fx_conversions inserts in one
-- PL/pgSQL function. Postgres auto-rolls back all three on any exception —
-- no orphaned withdrawals, no orphaned inflows, no partial commits.
--
-- SECURITY INVOKER: RLS on all three tables enforced with the caller's identity.
-- Multi-tenant: p_org_id validated; every insert scoped to p_org_id.

CREATE OR REPLACE FUNCTION public.perform_fx_conversion(
  p_org_id               uuid,
  p_user_id              uuid,
  p_date                 date,
  p_fx_currency          text,
  p_fx_amount            numeric,
  p_exchange_rate        numeric,
  p_naira_amount         numeric,
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

  -- Running balance from last committed row for this org + currency
  SELECT COALESCE(running_balance, 0)
  INTO   v_prev_balance
  FROM   public.fx_transactions
  WHERE  org_id   = p_org_id
    AND  currency = p_fx_currency
  ORDER  BY date DESC, created_at DESC
  LIMIT  1;

  v_prev_balance := COALESCE(v_prev_balance, 0);
  v_new_balance  := v_prev_balance - p_fx_amount;

  -- 1. FX withdrawal (reduces running balance)
  INSERT INTO public.fx_transactions (
    date, currency, withdrawal, deposit, running_balance,
    narration, created_by, org_id
  ) VALUES (
    p_date,
    p_fx_currency,
    p_fx_amount,
    0,
    v_new_balance,
    COALESCE(p_notes, 'Converted to ' || p_base_currency || ' @ ' || p_exchange_rate::text),
    p_user_id,
    p_org_id
  )
  RETURNING id INTO v_fx_tx_id;

  -- 2. NGN inflow (bank_name required — NULL → invisible to BankLedger)
  INSERT INTO public.inflow_transactions (
    date, amount, description, bank_name,
    stage_code_1, stage_code_2, allocation_config_id,
    fx_currency, fx_amount, fx_rate,
    transaction_type, created_by, org_id
  ) VALUES (
    p_date,
    p_naira_amount,
    COALESCE(p_notes, 'FX Conversion: ' || p_fx_currency || ' → ' || p_base_currency),
    p_bank_name,
    p_stage_code_1,
    COALESCE(p_stage_code_2, 'Percentage Allocation'),
    p_allocation_config_id,
    p_fx_currency,
    p_fx_amount,
    p_exchange_rate,
    'fx_conversion',
    p_user_id,
    p_org_id
  )
  RETURNING id INTO v_inflow_id;

  -- 3. Conversion link record
  INSERT INTO public.fx_conversions (
    date, fx_currency, fx_amount, exchange_rate, naira_amount,
    fx_withdrawal_id, naira_inflow_id, notes,
    allocation_config_id, is_partial, created_by, org_id
  ) VALUES (
    p_date,
    p_fx_currency,
    p_fx_amount,
    p_exchange_rate,
    p_naira_amount,
    v_fx_tx_id,
    v_inflow_id,
    p_notes,
    p_allocation_config_id,
    (p_fx_amount < v_prev_balance),
    p_user_id,
    p_org_id
  )
  RETURNING id INTO v_conversion_id;

  RETURN jsonb_build_object(
    'fx_transaction_id', v_fx_tx_id,
    'inflow_id',         v_inflow_id,
    'conversion_id',     v_conversion_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.perform_fx_conversion(
  uuid, uuid, date, text, numeric, numeric, numeric, text, text, text, uuid, text, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';
