-- ── Add deposit_group_id — declared in schema.sql, never migrated ────────────
--
-- schema.sql has declared inflow_transactions.deposit_group_id and
-- outflow_transactions.deposit_group_id since before the migrations directory
-- existed, but no migration ever created them. LinkDepositGroupModal writes
-- this column directly on both tables, so linking a transaction to a deposit
-- group fails with "column does not exist" until this runs.
--
-- Confirmed via a live schema-drift check against schema.sql; other declared-
-- but-unused columns found in the same check (inflow_transactions
-- .is_pending_deduction, outflow_types.created_by/updated_at) are intentionally
-- left out — nothing in the app reads or writes them.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.inflow_transactions
  ADD COLUMN IF NOT EXISTS deposit_group_id uuid;

ALTER TABLE public.outflow_transactions
  ADD COLUMN IF NOT EXISTS deposit_group_id uuid;

CREATE INDEX IF NOT EXISTS idx_inflow_deposit_group
  ON public.inflow_transactions(deposit_group_id)
  WHERE deposit_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outflow_deposit_group
  ON public.outflow_transactions(deposit_group_id)
  WHERE deposit_group_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
