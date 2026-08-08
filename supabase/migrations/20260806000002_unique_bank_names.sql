-- ============================================================================
-- Unique bank names per organisation
-- ============================================================================
-- `bank_name` is denormalised plain text on inflow_transactions,
-- outflow_transactions, fx_transactions, bank_deposits, intrabank_transfers
-- and bank_statement_balances, and BankLedger reads rows back by that text
-- (src/pages/BankLedger.tsx).  Two banks sharing a name in one org therefore
-- blend into a single ledger, and the transaction-ref uniqueness index added
-- in the companion migration keys on the bank identity — so a shared name
-- would let one account's refs suppress the other's.
--
-- Uniqueness is case- and whitespace-insensitive ("GTBank", "gtbank" and
-- " GT  Bank " collide on the first two).  Existing collisions are resolved
-- automatically: the oldest bank keeps the plain name, later ones get
-- " - 1", " - 2", … in creation order.  The UI asks the user for their own
-- differentiator first and only falls back to this scheme when they decline.
-- ============================================================================

-- ── 1. Normalisation helper ──────────────────────────────────────────────────
-- IMMUTABLE so it can be used in an index expression.

CREATE OR REPLACE FUNCTION public.normalize_bank_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
$$;

-- ── 2. Trim stored names so the constraint and the displayed value agree ─────

UPDATE public.banks
SET    name = btrim(regexp_replace(name, '\s+', ' ', 'g'))
WHERE  name <> btrim(regexp_replace(name, '\s+', ' ', 'g'));

-- ── 3. De-duplicate existing bank names ──────────────────────────────────────
-- Oldest bank in each (org, normalised name) group keeps the name.  Later ones
-- are renamed to "<name> - N", skipping any suffix already taken by another
-- bank in the same org.
--
-- The rename is cascaded onto the denormalised bank_name columns, but ONLY for
-- rows that carry this bank's bank_id.  Rows with a NULL bank_id cannot be
-- attributed to one of the same-named banks, so they stay on the original name
-- and remain visible under the bank that kept it — no history is orphaned.

DO $$
DECLARE
  r          RECORD;
  v_new_name text;
  v_suffix   int;
BEGIN
  FOR r IN
    SELECT id, org_id, name,
           row_number() OVER (
             PARTITION BY org_id, public.normalize_bank_name(name)
             ORDER BY created_at, id
           ) AS rn
    FROM   public.banks
  LOOP
    CONTINUE WHEN r.rn = 1;

    v_suffix := r.rn - 1;
    LOOP
      v_new_name := r.name || ' - ' || v_suffix;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.banks
        WHERE  org_id = r.org_id
          AND  public.normalize_bank_name(name) = public.normalize_bank_name(v_new_name)
      );
      v_suffix := v_suffix + 1;
    END LOOP;

    UPDATE public.banks SET name = v_new_name WHERE id = r.id;

    UPDATE public.inflow_transactions
      SET bank_name = v_new_name
      WHERE org_id = r.org_id AND bank_id = r.id AND bank_name = r.name;
    UPDATE public.outflow_transactions
      SET bank_name = v_new_name
      WHERE org_id = r.org_id AND bank_id = r.id AND bank_name = r.name;
    UPDATE public.fx_transactions
      SET bank_name = v_new_name
      WHERE org_id = r.org_id AND bank_id = r.id AND bank_name = r.name;
    UPDATE public.bank_deposits
      SET bank_name = v_new_name
      WHERE org_id = r.org_id AND bank_id = r.id AND bank_name = r.name;
    UPDATE public.intrabank_transfers
      SET from_bank_name = v_new_name
      WHERE org_id = r.org_id AND from_bank_id = r.id AND from_bank_name = r.name;
    UPDATE public.intrabank_transfers
      SET to_bank_name = v_new_name
      WHERE org_id = r.org_id AND to_bank_id = r.id AND to_bank_name = r.name;

    -- bank_statement_balances has UNIQUE (org_id, bank_name) — skip if a row
    -- already sits under the new name (mirrors useUpdateBank's rename guard).
    UPDATE public.bank_statement_balances
      SET bank_name = v_new_name
      WHERE org_id = r.org_id AND bank_id = r.id AND bank_name = r.name
        AND NOT EXISTS (
          SELECT 1 FROM public.bank_statement_balances b2
          WHERE b2.org_id = r.org_id AND b2.bank_name = v_new_name
        );
  END LOOP;
END $$;

-- ── 4. Unique index ──────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS banks_org_name_unique
  ON public.banks (org_id, public.normalize_bank_name(name));

GRANT EXECUTE ON FUNCTION public.normalize_bank_name(text) TO authenticated;
