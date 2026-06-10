-- ── Transaction Offset Linking ────────────────────────────────────────────────
-- Generic offset-linking architecture for inflow_transactions and
-- outflow_transactions.
--
-- Relationship types supported:
--   reversal          — full cancellation of original transaction
--   refund            — partial or full return against original
--   bank_deposit      — prevents double-counting internal movements
--   intra_bank_transfer — debit+credit pair that nets to 0 globally
--
-- Rules:
--   • Raw transaction amounts remain immutable
--   • offset_role='offset' rows contribute 0 to balances/reports/allocation
--   • ALL offsets point directly to ONE root (root_transaction_id)
--   • No chaining: root must not itself be an offset (enforced by trigger)
--   • NULL offset_role is treated as 'root' — existing data unaffected
--
-- Safe on existing data: all columns are nullable; no backfill needed.

ALTER TABLE public.inflow_transactions
  ADD COLUMN IF NOT EXISTS root_transaction_id    text,
  ADD COLUMN IF NOT EXISTS root_transaction_table text,
  ADD COLUMN IF NOT EXISTS offset_link_type       text,
  ADD COLUMN IF NOT EXISTS offset_role            text;

DO $$ BEGIN
  ALTER TABLE public.inflow_transactions
    ADD CONSTRAINT inflow_offset_role_check
    CHECK (offset_role IN ('root', 'offset'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.outflow_transactions
  ADD COLUMN IF NOT EXISTS root_transaction_id    text,
  ADD COLUMN IF NOT EXISTS root_transaction_table text,
  ADD COLUMN IF NOT EXISTS offset_link_type       text,
  ADD COLUMN IF NOT EXISTS offset_role            text;

DO $$ BEGIN
  ALTER TABLE public.outflow_transactions
    ADD CONSTRAINT outflow_offset_role_check
    CHECK (offset_role IN ('root', 'offset'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes for efficient offset lookups
CREATE INDEX IF NOT EXISTS idx_inflow_root_txn_id
  ON public.inflow_transactions(root_transaction_id)
  WHERE root_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outflow_root_txn_id
  ON public.outflow_transactions(root_transaction_id)
  WHERE root_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inflow_offset_role
  ON public.inflow_transactions(offset_role)
  WHERE offset_role IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outflow_offset_role
  ON public.outflow_transactions(offset_role)
  WHERE offset_role IS NOT NULL;

-- Anti-chaining trigger: prevents offset -> offset links.
-- All offsets must point directly to a root (non-offset) transaction.
CREATE OR REPLACE FUNCTION public.prevent_offset_chaining()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.offset_role = 'offset' AND NEW.root_transaction_id IS NOT NULL THEN
    IF NEW.root_transaction_table = 'inflow_transactions' THEN
      IF EXISTS (
        SELECT 1 FROM public.inflow_transactions
        WHERE id::text = NEW.root_transaction_id AND offset_role = 'offset'
      ) THEN
        RAISE EXCEPTION 'offset_chaining_not_allowed: root transaction is itself an offset';
      END IF;
    ELSIF NEW.root_transaction_table = 'outflow_transactions' THEN
      IF EXISTS (
        SELECT 1 FROM public.outflow_transactions
        WHERE id::text = NEW.root_transaction_id AND offset_role = 'offset'
      ) THEN
        RAISE EXCEPTION 'offset_chaining_not_allowed: root transaction is itself an offset';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_inflow_offset_chaining  ON public.inflow_transactions;
CREATE TRIGGER trg_prevent_inflow_offset_chaining
  BEFORE INSERT OR UPDATE ON public.inflow_transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_offset_chaining();

DROP TRIGGER IF EXISTS trg_prevent_outflow_offset_chaining ON public.outflow_transactions;
CREATE TRIGGER trg_prevent_outflow_offset_chaining
  BEFORE INSERT OR UPDATE ON public.outflow_transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_offset_chaining();

NOTIFY pgrst, 'reload schema';
