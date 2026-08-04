-- Bank name persistence fix (Option C — hybrid).
--
-- Problem: inflow_transactions, outflow_transactions, and fx_transactions store
-- bank_name as a plain text snapshot taken at insert time, with no bank_id FK.
-- Renaming a bank in Settings only updates banks.name, so every historical row
-- keeps the old name and silently drops out of every name-keyed lookup
-- (BankLedger, useBankBalances, useReconciliation, reconciliationRules, Import
-- dedupe) — see CLAUDE.md audit for details.
--
-- Fix, in two parts:
--   1. One-time repair: cascade every recorded bank rename (from field_changes
--      history) onto bank_name text columns so already-orphaned historical rows
--      reconcile with the bank's current name.
--   2. Structural fix: add bank_id uuid FK to inflow/outflow/fx transactions
--      (mirroring bank_deposits/intrabank_transfers/bank_statement_balances,
--      which already have it), backfill it from the now-repaired bank_name, and
--      go forward writing bank_id at insert time so future renames are cosmetic.

-- ── 1. One-time repair: replay recorded banks.name renames onto dependent tables ──
-- field_changes captures every banks.name UPDATE (table_name='banks',
-- field_name='name', old_value/new_value). For each such change, move any row
-- still holding the old name onto the bank's current name, scoped by org so
-- two orgs' identically-named banks never merge.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (fc.record_id, fc.old_value)
      fc.record_id::uuid AS bank_id, fc.old_value AS old_name, b.name AS current_name, b.org_id AS org_id
    FROM public.field_changes fc
    JOIN public.banks b ON b.id = fc.record_id::uuid
    WHERE fc.table_name = 'banks'
      AND fc.field_name = 'name'
      AND fc.old_value IS NOT NULL
      AND fc.old_value <> b.name
    ORDER BY fc.record_id, fc.old_value, fc.changed_at DESC
  LOOP
    UPDATE public.inflow_transactions
      SET bank_name = r.current_name
      WHERE org_id = r.org_id AND bank_name = r.old_name;

    UPDATE public.outflow_transactions
      SET bank_name = r.current_name
      WHERE org_id = r.org_id AND bank_name = r.old_name;

    UPDATE public.fx_transactions
      SET bank_name = r.current_name
      WHERE org_id = r.org_id AND bank_name = r.old_name;

    UPDATE public.bank_deposits
      SET bank_name = r.current_name
      WHERE org_id = r.org_id AND bank_name = r.old_name;

    UPDATE public.intrabank_transfers
      SET from_bank_name = r.current_name
      WHERE org_id = r.org_id AND from_bank_name = r.old_name;

    UPDATE public.intrabank_transfers
      SET to_bank_name = r.current_name
      WHERE org_id = r.org_id AND to_bank_name = r.old_name;

    -- bank_statement_balances has a UNIQUE (org_id, bank_name) constraint —
    -- skip rows that would collide with a reference balance already saved
    -- under the current name rather than aborting the whole repair.
    UPDATE public.bank_statement_balances bsb
      SET bank_name = r.current_name
      WHERE bsb.org_id = r.org_id AND bsb.bank_name = r.old_name
        AND NOT EXISTS (
          SELECT 1 FROM public.bank_statement_balances x
          WHERE x.org_id = r.org_id AND x.bank_name = r.current_name
        );
  END LOOP;
END $$;

-- ── 2. Structural fix: bank_id FK on the three text-only tables ───────────────
ALTER TABLE public.inflow_transactions
  ADD COLUMN IF NOT EXISTS bank_id uuid REFERENCES public.banks(id) ON DELETE SET NULL;
ALTER TABLE public.outflow_transactions
  ADD COLUMN IF NOT EXISTS bank_id uuid REFERENCES public.banks(id) ON DELETE SET NULL;
ALTER TABLE public.fx_transactions
  ADD COLUMN IF NOT EXISTS bank_id uuid REFERENCES public.banks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inflow_bank_id  ON public.inflow_transactions(bank_id);
CREATE INDEX IF NOT EXISTS idx_outflow_bank_id ON public.outflow_transactions(bank_id);
CREATE INDEX IF NOT EXISTS idx_fx_bank_id      ON public.fx_transactions(bank_id);

-- Backfill bank_id for existing rows by matching the (now-repaired) bank_name
-- to the current bank name within the same org.
UPDATE public.inflow_transactions t
  SET bank_id = b.id
  FROM public.banks b
  WHERE t.bank_id IS NULL AND t.bank_name = b.name AND t.org_id = b.org_id;

UPDATE public.outflow_transactions t
  SET bank_id = b.id
  FROM public.banks b
  WHERE t.bank_id IS NULL AND t.bank_name = b.name AND t.org_id = b.org_id;

UPDATE public.fx_transactions t
  SET bank_id = b.id
  FROM public.banks b
  WHERE t.bank_id IS NULL AND t.bank_name = b.name AND t.org_id = b.org_id;

-- ── 3. create_fx_transaction / update_fx_transaction: accept bank_id ──────────
-- Adding a new trailing parameter changes the function's identity (Postgres
-- keys overloads by parameter type list), so CREATE OR REPLACE would leave
-- the old 9/10-arg versions behind as separate overloads. Drop them first.
DROP FUNCTION IF EXISTS public.create_fx_transaction(uuid, uuid, date, text, numeric, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.update_fx_transaction(uuid, uuid, uuid, date, text, numeric, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.create_fx_transaction(
  p_org_id          uuid,
  p_user_id         uuid,
  p_date            date,
  p_currency        text,
  p_deposit         numeric,
  p_withdrawal      numeric,
  p_narration       text    DEFAULT NULL,
  p_transaction_ref text    DEFAULT NULL,
  p_bank_name       text    DEFAULT NULL,
  p_bank_id         uuid    DEFAULT NULL
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
    narration, transaction_ref, bank_name, bank_id, created_by, org_id
  ) VALUES (
    p_date, p_currency,
    COALESCE(p_deposit, 0), COALESCE(p_withdrawal, 0),
    v_new_balance,
    p_narration, p_transaction_ref, p_bank_name, p_bank_id,
    p_user_id, p_org_id
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.create_fx_transaction(
  uuid, uuid, date, text, numeric, numeric, text, text, text, uuid
) TO authenticated;

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
  p_bank_name       text    DEFAULT NULL,
  p_bank_id         uuid    DEFAULT NULL
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
    bank_name       = p_bank_name,
    bank_id         = p_bank_id
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
  uuid, uuid, uuid, date, text, numeric, numeric, text, text, text, uuid
) TO authenticated;

NOTIFY pgrst, 'reload schema';
