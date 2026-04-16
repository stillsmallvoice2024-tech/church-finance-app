-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- USER PROFILES & ROLES
-- ============================================================
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  role text not null default 'viewer' check (role in ('admin', 'accountant', 'viewer')),
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- TRANSACTIONS — INFLOWS
-- ============================================================
create table public.inflow_transactions (
  id uuid default uuid_generate_v4() primary key,
  date date not null,
  description text,
  amount numeric(15,2) not null default 0,
  stage_code_1 text,
  stage_code_2 text,
  stage_code_3 text,
  transaction_ref text,
  specific_seed_description text,
  remark text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- TRANSACTIONS — OUTFLOWS
-- ============================================================
create table public.outflow_transactions (
  id uuid default uuid_generate_v4() primary key,
  date date not null,
  transaction_id text,
  bank_description text,
  description text,
  amount_disbursed numeric(15,2) default 0,
  amount_refunded numeric(15,2) default 0,
  transfer_charge numeric(15,2) default 0,
  actual_amount numeric(15,2) default 0,
  bank_total numeric(15,2) default 0,
  stage_code_1 text,
  stage_code_2 text,
  remarks text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- INTRA-ACCOUNT FLOWS
-- ============================================================
create table public.intra_flows (
  id uuid default uuid_generate_v4() primary key,
  date date not null,
  transaction_ref text,
  account_from text,
  account_to text,
  description text,
  total_amount numeric(15,2) default 0,
  account_from_stage1 text,
  account_from_stage2 text,
  account_to_stage1 text,
  account_to_stage2 text,
  remark text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

-- ============================================================
-- ACCOUNT LEDGERS
-- ============================================================
create table public.accounts (
  id uuid default uuid_generate_v4() primary key,
  code text unique not null,
  name text not null,
  category text check (category in ('income','expense','savings','ministry','special','foreign')),
  opening_balance numeric(15,2) default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table public.ledger_entries (
  id uuid default uuid_generate_v4() primary key,
  account_id uuid references public.accounts(id) on delete cascade,
  date date not null,
  description text,
  inflow numeric(15,2) default 0,
  refund_intraflow numeric(15,2) default 0,
  outflow numeric(15,2) default 0,
  balance numeric(15,2) default 0,
  percentage_part numeric(15,2),
  savings_part numeric(15,2),
  special_seed_description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

-- ============================================================
-- FOREIGN CURRENCY
-- ============================================================
create table public.fx_transactions (
  id uuid default uuid_generate_v4() primary key,
  date date not null,
  currency text not null check (currency in ('USD','GBP','EUR','CNY')),
  transaction_ref text,
  narration text,
  deposit numeric(15,4) default 0,
  withdrawal numeric(15,4) default 0,
  running_balance numeric(15,4) default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

-- ============================================================
-- SPECIAL PROJECTS
-- ============================================================
create table public.special_projects (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  code text,
  opening_balance numeric(15,2) default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table public.project_entries (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.special_projects(id) on delete cascade,
  date date not null,
  description text,
  inflow numeric(15,2) default 0,
  percentage_inflow numeric(15,2) default 0,
  refund_intraflow numeric(15,2) default 0,
  outflow numeric(15,2) default 0,
  balance numeric(15,2) default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================
create table public.audit_log (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id),
  action text not null,
  table_name text,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
alter table public.profiles enable row level security;
alter table public.inflow_transactions enable row level security;
alter table public.outflow_transactions enable row level security;
alter table public.intra_flows enable row level security;
alter table public.accounts enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.fx_transactions enable row level security;
alter table public.special_projects enable row level security;
alter table public.project_entries enable row level security;
alter table public.audit_log enable row level security;

-- Profiles: authenticated users can read all; users update only their own; admins have full access
create policy "profiles_select" on public.profiles
  for select using (auth.uid() is not null);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "profiles_admin_all" on public.profiles
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Helper: check if current user is admin or accountant
create or replace function public.is_finance_user()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'accountant')
  );
$$ language sql security definer stable;

create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- Inflow transactions
create policy "inflow_read" on public.inflow_transactions
  for select using (auth.uid() is not null);
create policy "inflow_write" on public.inflow_transactions
  for insert with check (public.is_finance_user());
create policy "inflow_update" on public.inflow_transactions
  for update using (public.is_finance_user());
create policy "inflow_delete" on public.inflow_transactions
  for delete using (public.is_admin());

-- Outflow transactions
create policy "outflow_read" on public.outflow_transactions
  for select using (auth.uid() is not null);
create policy "outflow_write" on public.outflow_transactions
  for insert with check (public.is_finance_user());
create policy "outflow_update" on public.outflow_transactions
  for update using (public.is_finance_user());
create policy "outflow_delete" on public.outflow_transactions
  for delete using (public.is_admin());

-- Intra flows
create policy "intraflow_read" on public.intra_flows
  for select using (auth.uid() is not null);
create policy "intraflow_write" on public.intra_flows
  for insert with check (public.is_finance_user());
create policy "intraflow_delete" on public.intra_flows
  for delete using (public.is_admin());

-- Accounts
create policy "accounts_read" on public.accounts
  for select using (auth.uid() is not null);
create policy "accounts_write" on public.accounts
  for all using (public.is_admin());

-- Ledger entries
create policy "ledger_read" on public.ledger_entries
  for select using (auth.uid() is not null);
create policy "ledger_write" on public.ledger_entries
  for insert with check (public.is_finance_user());
create policy "ledger_update" on public.ledger_entries
  for update using (public.is_finance_user());
create policy "ledger_delete" on public.ledger_entries
  for delete using (public.is_admin());

-- FX transactions
create policy "fx_read" on public.fx_transactions
  for select using (auth.uid() is not null);
create policy "fx_write" on public.fx_transactions
  for insert with check (public.is_finance_user());
create policy "fx_update" on public.fx_transactions
  for update using (public.is_finance_user());
create policy "fx_delete" on public.fx_transactions
  for delete using (public.is_admin());

-- Special projects
create policy "projects_read" on public.special_projects
  for select using (auth.uid() is not null);
create policy "projects_write" on public.special_projects
  for all using (public.is_admin());

-- Project entries
create policy "project_entries_read" on public.project_entries
  for select using (auth.uid() is not null);
create policy "project_entries_write" on public.project_entries
  for insert with check (public.is_finance_user());
create policy "project_entries_update" on public.project_entries
  for update using (public.is_finance_user());
create policy "project_entries_delete" on public.project_entries
  for delete using (public.is_admin());

-- Audit log
create policy "audit_read_own" on public.audit_log
  for select using (user_id = auth.uid());
create policy "audit_admin_read" on public.audit_log
  for select using (public.is_admin());

-- ============================================================
-- INVITATIONS
-- ============================================================
create table if not exists public.invitations (
  id          uuid default gen_random_uuid() primary key,
  email       text not null,
  role        text not null default 'viewer'
                check (role in ('accountant', 'viewer')),
  invited_by  uuid references public.profiles(id),
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'expired')),
  token       uuid default gen_random_uuid() unique,
  created_at  timestamptz default now(),
  expires_at  timestamptz default now() + interval '7 days'
);
alter table public.invitations enable row level security;
-- Only admins can manage invitations
create policy "invitations_admin_all" on public.invitations
  using (exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  ))
  with check (exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  ));

-- ============================================================
-- INFLOW TYPE + PENDING DEDUCTION (added post-launch)
-- ============================================================

-- Add inflow_type to categorise each inflow transaction
alter table public.inflow_transactions
  add column if not exists inflow_type text
    check (inflow_type in ('general_giving','specific_seed','tithe','offering','direct_seed','refund'))
    not null default 'general_giving';

-- Mark outflow transactions that are pending deduction (not yet cleared)
alter table public.outflow_transactions
  add column if not exists is_pending_deduction boolean not null default false;
