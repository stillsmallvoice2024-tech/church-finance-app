-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- USER PROFILES & ROLES
-- ============================================================
create table public.profiles (
  id         uuid references auth.users on delete cascade primary key,
  email      text not null,
  full_name  text,
  username   text unique,
  role       text not null default 'viewer' check (role in ('admin', 'accountant', 'viewer')),
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auto-create profile on signup (also used by AcceptInvite flow)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, username)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'username'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- CATEGORY GROUPS
-- ============================================================
create table public.category_groups (
  id         uuid default gen_random_uuid() primary key,
  name       text not null,
  sort_order integer default 0,
  created_at timestamptz default now()
);

-- ============================================================
-- CATEGORIES
-- ============================================================
create table public.categories (
  id                               uuid default gen_random_uuid() primary key,
  name                             text not null unique,
  description                      text,
  starting_balance                 numeric(15,2) default 0,
  starting_balance_budget_portion  text,
  group_id                         uuid references public.category_groups(id) on delete set null,
  is_hidden                        boolean not null default false,
  created_at                       timestamptz default now()
);

-- ============================================================
-- BANKS
-- ============================================================
create table public.banks (
  id                               uuid default gen_random_uuid() primary key,
  name                             text not null,
  account_number                   text,
  account_type                     text,
  starting_balance                 numeric(15,2),
  starting_balance_category        text,
  starting_balance_budget_portion  text,
  starting_balance_alloc_type      text check (starting_balance_alloc_type in ('percentage', 'amount')),
  starting_balance_allocations     jsonb not null default '[]',
  created_at                       timestamptz default now()
);

-- ============================================================
-- ALLOCATION CONFIGS
-- ============================================================
create table public.allocation_configs (
  id         uuid default gen_random_uuid() primary key,
  name       text not null,
  start_date date not null,
  status     text not null default 'draft' check (status in ('draft', 'locked')),
  rows       jsonb not null default '[]',
  created_at timestamptz default now()
);

-- ============================================================
-- INCOME TYPES
-- ============================================================
create table public.income_types (
  id                uuid default gen_random_uuid() primary key,
  name              text not null,
  description       text,
  color             text not null default '#6366f1',
  special_config_id uuid references public.allocation_configs(id) on delete set null,
  created_at        timestamptz default now()
);

create table public.income_type_rules (
  id             uuid default gen_random_uuid() primary key,
  income_type_id uuid not null references public.income_types(id) on delete cascade,
  rule_type      text not null check (rule_type in ('keyword', 'stage_code')),
  rule_value     text not null,
  created_at     timestamptz default now()
);

-- ============================================================
-- TRANSACTIONS — INFLOWS
-- ============================================================
create table public.inflow_transactions (
  id                       uuid default gen_random_uuid() primary key,
  date                     date not null,
  description              text,
  amount                   numeric(15,2) not null default 0,
  stage_code_1             text,
  stage_code_2             text,
  stage_code_3             text,
  transaction_ref          text,
  specific_seed_description text,
  remark                   text,
  bank_name                text,
  fx_currency              text,
  fx_amount                numeric(15,4),
  fx_rate                  numeric(15,6),
  transaction_type         text,
  original_transaction_id  text,
  allocation_config_id     uuid references public.allocation_configs(id) on delete set null,
  income_type_id           uuid references public.income_types(id) on delete set null,
  is_pending_deduction     boolean not null default false,
  created_by               uuid references public.profiles(id),
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

-- ============================================================
-- TRANSACTIONS — OUTFLOWS
-- ============================================================
create table public.outflow_transactions (
  id                       uuid default gen_random_uuid() primary key,
  date                     date not null,
  transaction_id           text,
  bank_description         text,
  description              text,
  amount_disbursed         numeric(15,2) default 0,
  amount_refunded          numeric(15,2) default 0,
  transfer_charge          numeric(15,2) default 0,
  actual_amount            numeric(15,2) default 0,
  bank_total               numeric(15,2) default 0,
  stage_code_1             text,
  stage_code_2             text,
  remarks                  text,
  bank_name                text,
  fx_currency              text,
  fx_amount                numeric(15,4),
  fx_rate                  numeric(15,6),
  transaction_type         text,
  original_transaction_id  text,
  allocation_config_id     uuid references public.allocation_configs(id) on delete set null,
  is_pending_deduction     boolean not null default false,
  created_by               uuid references public.profiles(id),
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

-- ============================================================
-- INTRA-ACCOUNT FLOWS
-- ============================================================
create table public.intra_flows (
  id                  uuid default gen_random_uuid() primary key,
  date                date not null,
  transaction_ref     text,
  account_from        text,
  account_to          text,
  description         text,
  total_amount        numeric(15,2) default 0,
  account_from_stage1 text,
  account_from_stage2 text,
  account_to_stage1   text,
  account_to_stage2   text,
  remark              text,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz default now()
);

-- ============================================================
-- BANK DEPOSITS
-- ============================================================
create table public.bank_deposits (
  id              uuid default gen_random_uuid() primary key,
  date            date not null,
  bank_id         uuid references public.banks(id),
  bank_name       text,
  amount          numeric(15,2) not null,
  description     text,
  transaction_ref text,
  remarks         text,
  created_at      timestamptz default now()
);

-- ============================================================
-- INTRABANK TRANSFERS
-- ============================================================
create table public.intrabank_transfers (
  id              uuid default gen_random_uuid() primary key,
  date            date not null,
  from_bank_id    uuid references public.banks(id),
  from_bank_name  text,
  to_bank_id      uuid references public.banks(id),
  to_bank_name    text,
  amount          numeric(15,2) not null,
  description     text,
  transaction_ref text,
  remarks         text,
  created_at      timestamptz default now()
);

-- ============================================================
-- ACCOUNT LEDGERS (chart of accounts)
-- ============================================================
create table public.accounts (
  id              uuid default gen_random_uuid() primary key,
  code            text unique not null,
  name            text not null,
  category        text check (category in ('income','expense','savings','ministry','special','foreign')),
  opening_balance numeric(15,2) default 0,
  is_active       boolean default true,
  created_at      timestamptz default now()
);

create table public.ledger_entries (
  id                       uuid default gen_random_uuid() primary key,
  account_id               uuid references public.accounts(id) on delete cascade,
  date                     date not null,
  description              text,
  inflow                   numeric(15,2) default 0,
  refund_intraflow         numeric(15,2) default 0,
  outflow                  numeric(15,2) default 0,
  balance                  numeric(15,2) default 0,
  percentage_part          numeric(15,2),
  savings_part             numeric(15,2),
  special_seed_description text,
  created_by               uuid references public.profiles(id),
  created_at               timestamptz default now()
);

-- ============================================================
-- FOREIGN CURRENCY
-- ============================================================
create table public.fx_transactions (
  id              uuid default gen_random_uuid() primary key,
  date            date not null,
  currency        text not null check (currency in ('USD','GBP','EUR','CNY')),
  transaction_ref text,
  narration       text,
  deposit         numeric(15,4) default 0,
  withdrawal      numeric(15,4) default 0,
  running_balance numeric(15,4) default 0,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz default now()
);

-- ============================================================
-- SPECIAL PROJECTS
-- ============================================================
create table public.special_projects (
  id              uuid default gen_random_uuid() primary key,
  name            text not null,
  code            text,
  opening_balance numeric(15,2) default 0,
  is_active       boolean default true,
  created_at      timestamptz default now()
);

create table public.project_entries (
  id                uuid default gen_random_uuid() primary key,
  project_id        uuid references public.special_projects(id) on delete cascade,
  date              date not null,
  description       text,
  inflow            numeric(15,2) default 0,
  percentage_inflow numeric(15,2) default 0,
  refund_intraflow  numeric(15,2) default 0,
  outflow           numeric(15,2) default 0,
  balance           numeric(15,2) default 0,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz default now()
);

-- ============================================================
-- RECEIPTS (file attachments on transactions)
-- ============================================================
create table public.receipts (
  id          uuid default gen_random_uuid() primary key,
  entity_type text not null check (entity_type in ('inflow','outflow','bank_deposit')),
  entity_id   uuid not null,
  file_name   text not null,
  file_path   text not null,
  file_size   integer,
  mime_type   text,
  uploaded_by uuid references public.profiles(id),
  created_at  timestamptz default now()
);

-- ============================================================
-- INVITATIONS
-- ============================================================
create table public.invitations (
  id          uuid default gen_random_uuid() primary key,
  email       text not null,
  role        text not null default 'viewer' check (role in ('accountant', 'viewer')),
  invited_by  uuid references public.profiles(id),
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'expired')),
  token       uuid default gen_random_uuid() unique,
  expires_at  timestamptz default now() + interval '7 days',
  accepted_at timestamptz,
  created_at  timestamptz default now()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================
create table public.audit_log (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references public.profiles(id),
  action     text not null,
  table_name text,
  record_id  uuid,
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz default now()
);

-- ============================================================
-- FIELD-LEVEL CHANGE LOG
-- ============================================================
create table public.field_changes (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references public.profiles(id) on delete set null,
  table_name text not null,
  record_id  text not null,
  field_name text not null,
  old_value  text,
  new_value  text,
  changed_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
alter table public.profiles           enable row level security;
alter table public.category_groups    enable row level security;
alter table public.categories         enable row level security;
alter table public.banks              enable row level security;
alter table public.allocation_configs enable row level security;
alter table public.income_types       enable row level security;
alter table public.income_type_rules  enable row level security;
alter table public.inflow_transactions  enable row level security;
alter table public.outflow_transactions enable row level security;
alter table public.intra_flows        enable row level security;
alter table public.bank_deposits      enable row level security;
alter table public.intrabank_transfers enable row level security;
alter table public.accounts           enable row level security;
alter table public.ledger_entries     enable row level security;
alter table public.fx_transactions    enable row level security;
alter table public.special_projects   enable row level security;
alter table public.project_entries    enable row level security;
alter table public.receipts           enable row level security;
alter table public.invitations        enable row level security;
alter table public.audit_log          enable row level security;
alter table public.field_changes      enable row level security;

-- ── Helper functions ───────────────────────────────────────────────────────────

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

-- ── Profiles ───────────────────────────────────────────────────────────────────

create policy "profiles_select" on public.profiles
  for select using (auth.uid() is not null);

create policy "profiles_insert" on public.profiles
  for insert with check (auth.uid() is not null);

create policy "profiles_update" on public.profiles
  for update using (auth.uid() is not null);

create policy "profiles_delete" on public.profiles
  for delete using (auth.uid() is not null);

-- ── Category Groups ────────────────────────────────────────────────────────────

create policy "category_groups_read" on public.category_groups
  for select using (auth.uid() is not null);
create policy "category_groups_write" on public.category_groups
  for all using (public.is_admin());

-- ── Categories ─────────────────────────────────────────────────────────────────

create policy "categories_read" on public.categories
  for select using (auth.uid() is not null);
create policy "categories_write" on public.categories
  for all using (public.is_finance_user());
create policy "categories_delete" on public.categories
  for delete using (public.is_admin());

-- ── Banks ──────────────────────────────────────────────────────────────────────

create policy "banks_read" on public.banks
  for select using (auth.uid() is not null);
create policy "banks_write" on public.banks
  for all using (public.is_admin());

-- ── Allocation Configs ─────────────────────────────────────────────────────────

create policy "allocation_configs_read" on public.allocation_configs
  for select using (auth.uid() is not null);
create policy "allocation_configs_write" on public.allocation_configs
  for all using (public.is_finance_user());
create policy "allocation_configs_delete" on public.allocation_configs
  for delete using (public.is_admin());

-- ── Income Types ───────────────────────────────────────────────────────────────

create policy "income_types_read" on public.income_types
  for select using (auth.uid() is not null);
create policy "income_types_write" on public.income_types
  for all using (public.is_admin());

create policy "income_type_rules_read" on public.income_type_rules
  for select using (auth.uid() is not null);
create policy "income_type_rules_write" on public.income_type_rules
  for all using (public.is_admin());

-- ── Inflow Transactions ────────────────────────────────────────────────────────

create policy "inflow_read" on public.inflow_transactions
  for select using (auth.uid() is not null);
create policy "inflow_write" on public.inflow_transactions
  for insert with check (public.is_finance_user());
create policy "inflow_update" on public.inflow_transactions
  for update using (public.is_finance_user());
create policy "inflow_delete" on public.inflow_transactions
  for delete using (auth.uid() is not null);

-- ── Outflow Transactions ───────────────────────────────────────────────────────

create policy "outflow_read" on public.outflow_transactions
  for select using (auth.uid() is not null);
create policy "outflow_write" on public.outflow_transactions
  for insert with check (public.is_finance_user());
create policy "outflow_update" on public.outflow_transactions
  for update using (public.is_finance_user());
create policy "outflow_delete" on public.outflow_transactions
  for delete using (auth.uid() is not null);

-- ── Intra Flows ────────────────────────────────────────────────────────────────

create policy "intraflow_read" on public.intra_flows
  for select using (auth.uid() is not null);
create policy "intraflow_write" on public.intra_flows
  for insert with check (public.is_finance_user());
create policy "intraflow_update" on public.intra_flows
  for update using (public.is_finance_user());
create policy "intraflow_delete" on public.intra_flows
  for delete using (auth.uid() is not null);

-- ── Bank Deposits ──────────────────────────────────────────────────────────────

create policy "bank_deposits_read" on public.bank_deposits
  for select using (auth.uid() is not null);
create policy "bank_deposits_write" on public.bank_deposits
  for insert with check (public.is_finance_user());
create policy "bank_deposits_update" on public.bank_deposits
  for update using (public.is_finance_user());
create policy "bank_deposits_delete" on public.bank_deposits
  for delete using (public.is_admin());

-- ── Intrabank Transfers ────────────────────────────────────────────────────────

create policy "intrabank_read" on public.intrabank_transfers
  for select using (auth.uid() is not null);
create policy "intrabank_write" on public.intrabank_transfers
  for insert with check (public.is_finance_user());
create policy "intrabank_update" on public.intrabank_transfers
  for update using (public.is_finance_user());
create policy "intrabank_delete" on public.intrabank_transfers
  for delete using (public.is_admin());

-- ── Accounts ───────────────────────────────────────────────────────────────────

create policy "accounts_read" on public.accounts
  for select using (auth.uid() is not null);
create policy "accounts_write" on public.accounts
  for all using (public.is_admin());

-- ── Ledger Entries ─────────────────────────────────────────────────────────────

create policy "ledger_read" on public.ledger_entries
  for select using (auth.uid() is not null);
create policy "ledger_write" on public.ledger_entries
  for insert with check (public.is_finance_user());
create policy "ledger_update" on public.ledger_entries
  for update using (public.is_finance_user());
create policy "ledger_delete" on public.ledger_entries
  for delete using (public.is_admin());

-- ── FX Transactions ────────────────────────────────────────────────────────────

create policy "fx_read" on public.fx_transactions
  for select using (auth.uid() is not null);
create policy "fx_write" on public.fx_transactions
  for insert with check (public.is_finance_user());
create policy "fx_update" on public.fx_transactions
  for update using (public.is_finance_user());
create policy "fx_delete" on public.fx_transactions
  for delete using (public.is_admin());

-- ── Special Projects ───────────────────────────────────────────────────────────

create policy "projects_read" on public.special_projects
  for select using (auth.uid() is not null);
create policy "projects_write" on public.special_projects
  for all using (public.is_admin());

-- ── Project Entries ────────────────────────────────────────────────────────────

create policy "project_entries_read" on public.project_entries
  for select using (auth.uid() is not null);
create policy "project_entries_write" on public.project_entries
  for insert with check (public.is_finance_user());
create policy "project_entries_update" on public.project_entries
  for update using (public.is_finance_user());
create policy "project_entries_delete" on public.project_entries
  for delete using (public.is_admin());

-- ── Receipts ───────────────────────────────────────────────────────────────────

create policy "receipts_read" on public.receipts
  for select using (auth.uid() is not null);
create policy "receipts_write" on public.receipts
  for insert with check (auth.uid() is not null);
create policy "receipts_delete" on public.receipts
  for delete using (auth.uid() is not null);

-- ── Invitations ────────────────────────────────────────────────────────────────

-- Admins manage invitations; anyone with a valid token can read their own invite
create policy "invitations_admin_all" on public.invitations
  using  (public.is_admin())
  with check (public.is_admin());

create policy "invitations_read_by_token" on public.invitations
  for select using (true);

-- ── Audit Log ──────────────────────────────────────────────────────────────────

create policy "audit_admin_read" on public.audit_log
  for select using (public.is_admin());
create policy "audit_write" on public.audit_log
  for insert with check (auth.uid() is not null);

-- ── Field Changes ──────────────────────────────────────────────────────────────

create policy "field_changes_admin_read" on public.field_changes
  for select using (public.is_admin());
create policy "field_changes_write" on public.field_changes
  for insert with check (auth.uid() is not null);

-- ============================================================
-- USEFUL INDEXES
-- ============================================================
create index if not exists idx_inflow_date      on public.inflow_transactions(date);
create index if not exists idx_outflow_date     on public.outflow_transactions(date);
create index if not exists idx_intra_date       on public.intra_flows(date);
create index if not exists idx_bank_dep_date    on public.bank_deposits(date);
create index if not exists idx_intrabank_date   on public.intrabank_transfers(date);
create index if not exists idx_fx_date          on public.fx_transactions(date);
create index if not exists idx_project_entries  on public.project_entries(project_id);
create index if not exists idx_receipts_entity  on public.receipts(entity_type, entity_id);
create index if not exists idx_field_changes    on public.field_changes(table_name, record_id);
create index if not exists idx_income_type_rules on public.income_type_rules(income_type_id);
create index if not exists idx_inflow_income_type   on public.inflow_transactions(income_type_id);
create index if not exists idx_inflow_txn_type     on public.inflow_transactions(transaction_type);
create index if not exists idx_outflow_txn_type    on public.outflow_transactions(transaction_type);
create index if not exists idx_categories_group    on public.categories(group_id);
create index if not exists idx_invitations_token on public.invitations(token);

-- ============================================================
-- CATEGORY OPENING BALANCES
-- ============================================================
create table if not exists public.category_opening_balances (
  id             uuid default gen_random_uuid() primary key,
  category_id    uuid not null references categories(id) on delete cascade,
  budget_portion text not null check (budget_portion in ('Percentage Allocation','Specific Seed','Savings')),
  amount         numeric(15,2) not null default 0,
  created_at     timestamptz default now(),
  unique (category_id, budget_portion)
);

alter table public.category_opening_balances enable row level security;

create policy "cob_read" on public.category_opening_balances
  for select using (auth.uid() is not null);
create policy "cob_write" on public.category_opening_balances
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create index if not exists idx_cob_category on public.category_opening_balances(category_id);

-- ============================================================
-- REPORT TEMPLATES
-- ============================================================
create table if not exists public.report_templates (
  id          uuid default gen_random_uuid() primary key,
  name        text not null,
  description text,
  layout      jsonb not null default '{}',
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.report_templates enable row level security;

create policy "report_templates_select" on public.report_templates
  for select using (auth.uid() is not null);
create policy "report_templates_all" on public.report_templates
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ============================================================
-- SPECIAL CONFIG GROUPS (versioned special allocation configs)
-- ============================================================
create table if not exists public.special_config_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

alter table public.special_config_groups enable row level security;

create policy "scg_read" on public.special_config_groups
  for select using (auth.uid() is not null);
create policy "scg_write" on public.special_config_groups
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

alter table public.allocation_configs
  add column if not exists config_group_id uuid references public.special_config_groups(id) on delete cascade,
  add column if not exists effective_from  date,
  add column if not exists effective_to    date,
  add column if not exists version_number  integer not null default 1;

alter table public.income_types
  add column if not exists special_config_group_id uuid references public.special_config_groups(id) on delete set null;

create index if not exists idx_alloc_config_group on public.allocation_configs(config_group_id);

-- ============================================================
-- TRANSACTION ALLOCATION SNAPSHOTS
-- ============================================================
create table if not exists public.transaction_allocation_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  transaction_id     uuid not null references public.inflow_transactions(id) on delete cascade,
  config_version_id  uuid references public.allocation_configs(id) on delete restrict,
  config_group_id    uuid references public.special_config_groups(id) on delete set null,
  resolved_rows      jsonb not null default '[]',
  allocation_type    text,
  created_at         timestamptz not null default now(),
  is_recalculated    boolean not null default false,
  recalculated_at    timestamptz,
  unique(transaction_id)
);

alter table public.transaction_allocation_snapshots enable row level security;

create policy "tas_read" on public.transaction_allocation_snapshots
  for select using (auth.uid() is not null);
create policy "tas_write" on public.transaction_allocation_snapshots
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ============================================================
-- RECALCULATION LOGS
-- ============================================================
create table if not exists public.recalculation_logs (
  id                 uuid primary key default gen_random_uuid(),
  config_group_id    uuid references public.special_config_groups(id) on delete set null,
  config_version_id  uuid references public.allocation_configs(id) on delete set null,
  performed_by       uuid references public.profiles(id) on delete set null,
  performed_at       timestamptz not null default now(),
  affected_count     integer not null default 0,
  reason             text,
  action_summary     text not null
);

alter table public.recalculation_logs enable row level security;

create policy "rl_read" on public.recalculation_logs
  for select using (auth.uid() is not null);
create policy "rl_write" on public.recalculation_logs
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create index if not exists idx_report_templates_user on public.report_templates(created_by);
