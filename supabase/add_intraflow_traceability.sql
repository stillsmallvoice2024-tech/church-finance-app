-- Part 2: Add traceability columns to intra_flows
-- Run this migration BEFORE deploying the matching code change.

alter table public.intra_flows
  add column if not exists from_category_id  uuid references public.categories(id) on delete set null,
  add column if not exists to_category_id    uuid references public.categories(id) on delete set null,
  add column if not exists status            text not null default 'active'
                                             check (status in ('active', 'reversed', 'void')),
  add column if not exists reversal_of_id    uuid references public.intra_flows(id) on delete set null;

-- Backfill existing rows: resolve stored name text → category ID
update public.intra_flows f
set from_category_id = c.id
from public.categories c
where f.account_from = c.name
  and f.from_category_id is null;

update public.intra_flows f
set to_category_id = c.id
from public.categories c
where f.account_to = c.name
  and f.to_category_id is null;
