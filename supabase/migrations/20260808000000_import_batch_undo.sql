-- Gives every import run a stable id so a run can be identified and undone,
-- and so a missing-column failure can be reported without silently dropping
-- the affected field from every row.

alter table public.inflow_transactions
  add column if not exists import_batch_id uuid;
alter table public.outflow_transactions
  add column if not exists import_batch_id uuid;

create index if not exists inflow_transactions_import_batch_id_idx
  on public.inflow_transactions (import_batch_id) where import_batch_id is not null;
create index if not exists outflow_transactions_import_batch_id_idx
  on public.outflow_transactions (import_batch_id) where import_batch_id is not null;

-- One row per import run — lets the UI show/undo a specific run without
-- scanning the transaction tables for stale ids.
create table if not exists public.import_batches (
  id           uuid        primary key default gen_random_uuid(),
  org_id       uuid        not null references public.organizations(id) on delete cascade,
  target_table text        not null,
  file_name    text,
  row_count    int         not null default 0,
  status       text        not null default 'completed' check (status in ('completed', 'partial', 'undone')),
  created_by   uuid        references public.profiles(id),
  created_at   timestamptz not null default now(),
  undone_at    timestamptz
);

create index if not exists idx_import_batches_org on public.import_batches(org_id);

alter table public.import_batches enable row level security;

create policy if not exists "import_batches_select" on public.import_batches
  for select using (public.is_org_member(org_id));
create policy if not exists "import_batches_insert" on public.import_batches
  for insert with check (public.is_org_finance_user(org_id));
create policy if not exists "import_batches_update" on public.import_batches
  for update using (public.is_org_finance_user(org_id));

NOTIFY pgrst, 'reload schema';
