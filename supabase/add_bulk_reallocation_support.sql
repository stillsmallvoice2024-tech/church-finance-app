-- Add transfer_type and batch_id to intra_flows for bulk reallocation tracking
alter table public.intra_flows
  add column if not exists transfer_type text,
  add column if not exists batch_id      uuid;

create index if not exists idx_intra_batch on public.intra_flows(batch_id);
