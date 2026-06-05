-- ── FX Conversion Management ──────────────────────────────────────────────────
-- A. Updated perform_fx_conversion: add advisory lock before running balance SELECT
-- B. update_fx_conversion RPC: admin/owner only, updates rate + cascades
-- C. revert_fx_conversion RPC: admin/owner only, deletes all 3 rows + restores balances

-- A. perform_fx_conversion with advisory lock
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

  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_fx_currency));

  SELECT COALESCE(running_balance, 0)
  INTO   v_prev_balance
  FROM   public.fx_transactions
  WHERE  org_id   = p_org_id
    AND  currency = p_fx_currency
  ORDER  BY date DESC, created_at DESC
  LIMIT  1;

  v_prev_balance := COALESCE(v_prev_balance, 0);
  v_new_balance  := v_prev_balance - p_fx_amount;

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
    p_date, p_naira_amount,
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
    p_date, p_fx_currency, p_fx_amount, p_exchange_rate, p_naira_amount,
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

-- B. update_fx_conversion RPC
CREATE OR REPLACE FUNCTION public.update_fx_conversion(
  p_conversion_id        uuid,
  p_org_id               uuid,
  p_user_id              uuid,
  p_exchange_rate        numeric,
  p_naira_amount         numeric,
  p_notes                text,
  p_allocation_config_id uuid,
  p_stage_code_1         text,
  p_stage_code_2         text,
  p_bank_name            text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_conv RECORD; BEGIN
  -- admin/owner gate
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = p_org_id AND user_id = auth.uid() AND role IN ('owner','admin') AND status = 'active') THEN
    RAISE EXCEPTION 'Only admins and owners can edit FX conversions';
  END IF;
  SELECT * INTO v_conv FROM public.fx_conversions WHERE id = p_conversion_id AND org_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FX conversion not found'; END IF;
  -- Update conversion record
  UPDATE public.fx_conversions SET
    exchange_rate = p_exchange_rate, naira_amount = p_naira_amount,
    notes = p_notes, allocation_config_id = p_allocation_config_id
  WHERE id = p_conversion_id;
  -- Cascade to inflow: amount, rate, description, allocation, stage codes, bank
  IF v_conv.naira_inflow_id IS NOT NULL THEN
    UPDATE public.inflow_transactions SET
      amount = p_naira_amount, fx_rate = p_exchange_rate,
      description = COALESCE(p_notes, description),
      allocation_config_id = p_allocation_config_id,
      stage_code_1 = p_stage_code_1, stage_code_2 = p_stage_code_2,
      bank_name = p_bank_name
    WHERE id = v_conv.naira_inflow_id;
  END IF;
  -- Update FX transaction narration
  IF v_conv.fx_withdrawal_id IS NOT NULL AND p_notes IS NOT NULL THEN
    UPDATE public.fx_transactions SET narration = p_notes WHERE id = v_conv.fx_withdrawal_id;
  END IF;
  RETURN jsonb_build_object('conversion_id', p_conversion_id, 'inflow_id', v_conv.naira_inflow_id, 'fx_tx_id', v_conv.fx_withdrawal_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_fx_conversion(uuid,uuid,uuid,numeric,numeric,text,uuid,text,text,text) TO authenticated;

-- C. revert_fx_conversion RPC
CREATE OR REPLACE FUNCTION public.revert_fx_conversion(
  p_conversion_id uuid,
  p_org_id        uuid,
  p_user_id       uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_conv    RECORD;
  v_fx_date date;
  v_fx_ts   timestamptz;
  v_fx_amt  numeric;
  v_ccy     text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = p_org_id AND user_id = auth.uid() AND role IN ('owner','admin') AND status = 'active') THEN
    RAISE EXCEPTION 'Only admins and owners can revert FX conversions';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(
    (SELECT fx_currency FROM public.fx_conversions WHERE id = p_conversion_id AND org_id = p_org_id)
  ));
  SELECT * INTO v_conv FROM public.fx_conversions WHERE id = p_conversion_id AND org_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FX conversion not found'; END IF;
  v_ccy    := v_conv.fx_currency;
  v_fx_amt := v_conv.fx_amount;
  -- Capture position of FX withdrawal row before deleting it
  IF v_conv.fx_withdrawal_id IS NOT NULL THEN
    SELECT date, created_at INTO v_fx_date, v_fx_ts
    FROM public.fx_transactions WHERE id = v_conv.fx_withdrawal_id;
    DELETE FROM public.fx_transactions WHERE id = v_conv.fx_withdrawal_id;
    -- Restore running balances on all subsequent rows for same org+currency
    UPDATE public.fx_transactions
    SET running_balance = running_balance + v_fx_amt
    WHERE org_id = p_org_id AND currency = v_ccy
      AND (date > v_fx_date OR (date = v_fx_date AND created_at > v_fx_ts));
  END IF;
  -- Delete NGN inflow
  IF v_conv.naira_inflow_id IS NOT NULL THEN
    DELETE FROM public.inflow_transactions WHERE id = v_conv.naira_inflow_id;
  END IF;
  -- Delete conversion link
  DELETE FROM public.fx_conversions WHERE id = p_conversion_id;
  RETURN jsonb_build_object(
    'reverted_conversion_id', p_conversion_id,
    'fx_tx_deleted', v_conv.fx_withdrawal_id,
    'inflow_deleted', v_conv.naira_inflow_id
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.revert_fx_conversion(uuid,uuid,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
