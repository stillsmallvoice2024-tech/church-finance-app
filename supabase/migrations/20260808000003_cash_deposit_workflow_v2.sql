-- Cash deposit workflow follow-ups:
-- 1. When the auto-created bank_deposit outflow is deleted (from any page —
--    Outflows, Bank Ledger, Bank Deposits tracking), clear the link on its
--    source cash inflow so "Mark Deposited" reappears for it.
-- Uses root_transaction_id/root_transaction_table (already present on both
-- tables) rather than deposit_group_id, since deposit_group_id is also used
-- by the generic manual LinkDepositGroupModal pairing and must not be
-- touched for those groups.

create or replace function public.restore_cash_deposit_on_outflow_delete_fn()
returns trigger language plpgsql as $$
begin
  if old.transaction_type = 'bank_deposit' and old.offset_role = 'root' then
    update public.inflow_transactions
    set deposit_group_id = null, offset_role = null, root_transaction_id = null, root_transaction_table = null
    where root_transaction_id = old.id::text and root_transaction_table = 'outflow_transactions';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_restore_cash_deposit on public.outflow_transactions;
create trigger trg_restore_cash_deposit
  after delete on public.outflow_transactions
  for each row execute function public.restore_cash_deposit_on_outflow_delete_fn();
