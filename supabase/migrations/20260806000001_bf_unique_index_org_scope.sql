-- ================================================================
-- Balance Brought Forward — scope the uniqueness rule to the org
--
-- schema.sql defined idx_inflow_bf_unique_bank as a unique index on
-- (bank_name) alone, with no org_id. That is cross-tenant: the first
-- org to record an opening balance for "GTBank" would permanently
-- block every other org on the platform from doing the same, and the
-- resulting unique violation from propagateBankOpeningBalance
-- (src/utils/bankOpeningBalance.ts) doubles as an existence oracle
-- leaking that some other tenant banks there.
--
-- The index was never applied to production — it lives only in
-- schema.sql, so it would land on a fresh install (new environment,
-- DR restore, staging clone) and break the second tenant onward.
-- Production meanwhile has had no uniqueness protection at all; the
-- intended one-BF-row-per-bank guarantee has been enforced only by
-- application code, leaving a race between concurrent writers.
--
-- This migration installs the correct org-scoped rule and removes the
-- unscoped one. It handles both states: environments that received
-- the bad index, and environments (like production) that never did.
--
-- Non-destructive: no rows are inserted, updated, or deleted. If an
-- environment holds duplicate BF rows for the same (org_id,
-- bank_name), the index build fails and the whole migration rolls
-- back with a clear message rather than discarding anyone's data.
--
-- Idempotent: safe to re-run.
-- ================================================================

do $$
begin
  -- Create the org-scoped rule first so there is never a window in
  -- which neither rule is enforcing uniqueness.
  begin
    create unique index if not exists idx_inflow_bf_unique_org_bank
      on public.inflow_transactions (org_id, bank_name)
      where transaction_type = 'balance_brought_forward';
  exception when unique_violation then
    raise exception
      'Cannot enforce one balance_brought_forward row per (org_id, bank_name): duplicates exist. No data was changed. Run the audit query in this migration''s header comment to list them, resolve them deliberately, then re-run.'
      using hint = 'select org_id, bank_name, count(*) from public.inflow_transactions where transaction_type = ''balance_brought_forward'' group by org_id, bank_name having count(*) > 1;';
  end;

  -- Only now retire the unscoped rule, on environments that have it.
  drop index if exists public.idx_inflow_bf_unique_bank;
end $$;
