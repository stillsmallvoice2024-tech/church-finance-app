-- intra_flows had no updated_at column, so concurrent-edit detection
-- (optimistic locking) couldn't be applied to it the way it is for
-- inflow_transactions / outflow_transactions. useUpdateTransaction
-- (src/hooks/useMutations.ts) reads this column to guard against
-- overwriting a change made by someone else.
alter table public.intra_flows
  add column if not exists updated_at timestamptz default now();

update public.intra_flows set updated_at = created_at where updated_at is null;

notify pgrst, 'reload schema';
