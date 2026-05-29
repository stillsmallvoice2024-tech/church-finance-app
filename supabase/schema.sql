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

-- Auto-create profile on signup and enroll in primary org as viewer.
-- Inner exception block prevents username UNIQUE conflicts from aborting
-- auth user creation ("Database error saving new user").
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_org_id uuid;
begin
  begin
    insert into public.profiles (id, email, full_name, username)
    values (
      new.id,
      new.email,
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'username'
    )
    on conflict (id) do nothing;
  exception when unique_violation then
    raise notice '[handle_new_user] username conflict for user %; inserting with NULL username', new.id;
    insert into public.profiles (id, email, full_name, username)
    values (new.id, new.email, new.raw_user_meta_data->>'full_name', null)
    on conflict (id) do nothing;
  end;

  select id into v_org_id from public.organizations where slug = 'primary' limit 1;
  if v_org_id is not null then
    insert into public.org_members (org_id, user_id, role, status)
    values (v_org_id, new.id, 'viewer', 'active')
    on conflict (org_id, user_id) do nothing;
  end if;

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
  id          uuid default gen_random_uuid() primary key,
  name        text not null unique,
  description text,
  group_id    uuid references public.category_groups(id) on delete set null,
  is_hidden   boolean not null default false,
  created_at  timestamptz default now()
);

-- ============================================================
-- BANKS
-- ============================================================
create table public.banks (
  id                               uuid default gen_random_uuid() primary key,
  name                             text not null,
  account_number                   text,
  account_type                     text,
  currency                         text not null default 'NGN',
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
  recorded_at              timestamptz,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now(),
  recorded_at              timestamptz default now()
);

-- ============================================================
-- OUTFLOW TYPES (reporting/classification layer)
-- ============================================================
create table public.outflow_types (
  id               uuid default gen_random_uuid() primary key,
  name             text not null unique,
  color            text not null default '#64748b',
  is_system        boolean not null default false,
  is_locked        boolean not null default false,
  auto_created     boolean not null default false,
  manually_renamed boolean not null default false,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- System fallback type
insert into public.outflow_types (name, color, is_system, is_locked)
values ('General', '#64748b', true, true)
on conflict (name) do update set is_system = true, is_locked = true;

-- ============================================================
-- CATEGORY-OUTFLOW TYPE MAPPING (many-to-many)
-- ============================================================
create table public.category_outflow_type_map (
  id              uuid default gen_random_uuid() primary key,
  category_id     uuid not null references public.categories(id) on delete cascade,
  outflow_type_id uuid not null references public.outflow_types(id) on delete cascade,
  created_at      timestamptz default now(),
  unique(category_id, outflow_type_id)
);
create index idx_cotm_category on public.category_outflow_type_map(category_id);
create index idx_cotm_type     on public.category_outflow_type_map(outflow_type_id);

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
  outflow_type_id          uuid references public.outflow_types(id) on delete set null,
  is_pending_deduction     boolean not null default false,
  created_by               uuid references public.profiles(id),
  recorded_at              timestamptz default now(),
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
  from_category_id    uuid references public.categories(id) on delete set null,
  to_category_id      uuid references public.categories(id) on delete set null,
  status              text not null default 'active' check (status in ('active', 'reversed', 'void')),
  reversal_of_id      uuid references public.intra_flows(id) on delete set null,
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
alter table public.receipts              enable row level security;
alter table public.invitations           enable row level security;
alter table public.audit_log             enable row level security;
alter table public.field_changes         enable row level security;
alter table public.outflow_types         enable row level security;
alter table public.category_outflow_type_map enable row level security;

-- ── Helper functions ───────────────────────────────────────────────────────────
-- is_admin / is_finance_user use org_members so suspended users lose access
-- immediately; used for tables without a direct org_id column.

create or replace function public.is_finance_user()
returns boolean as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid()
      and role    in ('admin', 'accountant')
      and status  = 'active'
  );
$$ language sql security definer stable;

create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid()
      and role    = 'admin'
      and status  = 'active'
  );
$$ language sql security definer stable;

-- is_org_member: any active role in p_org_id — used by SELECT policies.
create or replace function public.is_org_member(p_org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.org_members
    where org_id  = p_org_id
      and user_id = auth.uid()
      and status  = 'active'
  );
$$;

-- ── Profiles (no org_id — global user registry) ───────────────────────────────

create policy "profiles_select" on public.profiles
  for select using (auth.uid() is not null);

create policy "profiles_insert" on public.profiles
  for insert with check (auth.uid() is not null);

create policy "profiles_update_self" on public.profiles
  for update
  using  (id = auth.uid())
  with check (
    id   = auth.uid()
    and  role = (select p.role from public.profiles p where p.id = auth.uid())
  );

create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin());

create policy "profiles_delete" on public.profiles
  for delete using (public.is_admin());

-- ── Category Groups ────────────────────────────────────────────────────────────

create policy "category_groups_select" on public.category_groups
  for select using (public.is_org_member(org_id));
create policy "category_groups_insert" on public.category_groups
  for insert with check (public.is_org_admin(org_id));
create policy "category_groups_update" on public.category_groups
  for update using (public.is_org_admin(org_id));
create policy "category_groups_delete" on public.category_groups
  for delete using (public.is_org_admin(org_id));

-- ── Categories ─────────────────────────────────────────────────────────────────

create policy "categories_select" on public.categories
  for select using (public.is_org_member(org_id));
create policy "categories_insert" on public.categories
  for insert with check (public.is_org_finance_user(org_id));
create policy "categories_update" on public.categories
  for update using (public.is_org_finance_user(org_id));
create policy "categories_delete" on public.categories
  for delete using (public.is_org_admin(org_id));

-- ── Banks ──────────────────────────────────────────────────────────────────────

create policy "banks_select" on public.banks
  for select using (public.is_org_member(org_id));
create policy "banks_insert" on public.banks
  for insert with check (public.is_org_admin(org_id));
create policy "banks_update" on public.banks
  for update using (public.is_org_admin(org_id));
create policy "banks_delete" on public.banks
  for delete using (public.is_org_admin(org_id));

-- ── Allocation Configs ─────────────────────────────────────────────────────────

create policy "allocation_configs_select" on public.allocation_configs
  for select using (public.is_org_member(org_id));
create policy "allocation_configs_insert" on public.allocation_configs
  for insert with check (public.is_org_finance_user(org_id));
create policy "allocation_configs_update" on public.allocation_configs
  for update using (public.is_org_finance_user(org_id));
create policy "allocation_configs_delete" on public.allocation_configs
  for delete using (public.is_org_admin(org_id));

-- ── Income Types ───────────────────────────────────────────────────────────────

create policy "income_types_select" on public.income_types
  for select using (public.is_org_member(org_id));
create policy "income_types_insert" on public.income_types
  for insert with check (public.is_org_admin(org_id));
create policy "income_types_update" on public.income_types
  for update using (public.is_org_admin(org_id));
create policy "income_types_delete" on public.income_types
  for delete using (public.is_org_admin(org_id));

create policy "income_type_rules_select" on public.income_type_rules
  for select using (public.is_org_member(org_id));
create policy "income_type_rules_insert" on public.income_type_rules
  for insert with check (public.is_org_admin(org_id));
create policy "income_type_rules_update" on public.income_type_rules
  for update using (public.is_org_admin(org_id));
create policy "income_type_rules_delete" on public.income_type_rules
  for delete using (public.is_org_admin(org_id));

-- ── Outflow Types ──────────────────────────────────────────────────────────────

create policy "outflow_types_select" on public.outflow_types
  for select using (public.is_org_member(org_id));
create policy "outflow_types_insert" on public.outflow_types
  for insert with check (public.is_org_finance_user(org_id));
create policy "outflow_types_update" on public.outflow_types
  for update using (public.is_org_finance_user(org_id));
create policy "outflow_types_delete" on public.outflow_types
  for delete using (public.is_org_admin(org_id));

-- ── Category-Outflow Type Map ──────────────────────────────────────────────────

create policy "cotm_select" on public.category_outflow_type_map
  for select using (public.is_org_member(org_id));
create policy "cotm_insert" on public.category_outflow_type_map
  for insert with check (public.is_org_finance_user(org_id));
create policy "cotm_delete" on public.category_outflow_type_map
  for delete using (public.is_org_finance_user(org_id));

-- ── Inflow Transactions ────────────────────────────────────────────────────────

create policy "inflow_select" on public.inflow_transactions
  for select using (public.is_org_member(org_id));
create policy "inflow_insert" on public.inflow_transactions
  for insert with check (public.is_org_finance_user(org_id));
create policy "inflow_update" on public.inflow_transactions
  for update using (public.is_org_finance_user(org_id));
create policy "inflow_delete" on public.inflow_transactions
  for delete using (public.is_org_finance_user(org_id));

-- ── Outflow Transactions ───────────────────────────────────────────────────────

create policy "outflow_select" on public.outflow_transactions
  for select using (public.is_org_member(org_id));
create policy "outflow_insert" on public.outflow_transactions
  for insert with check (public.is_org_finance_user(org_id));
create policy "outflow_update" on public.outflow_transactions
  for update using (public.is_org_finance_user(org_id));
create policy "outflow_delete" on public.outflow_transactions
  for delete using (public.is_org_finance_user(org_id));

-- ── Intra Flows ────────────────────────────────────────────────────────────────

create policy "intraflow_select" on public.intra_flows
  for select using (public.is_org_member(org_id));
create policy "intraflow_insert" on public.intra_flows
  for insert with check (public.is_org_finance_user(org_id));
create policy "intraflow_update" on public.intra_flows
  for update using (public.is_org_finance_user(org_id));
create policy "intraflow_delete" on public.intra_flows
  for delete using (public.is_org_finance_user(org_id));

-- ── Bank Deposits ──────────────────────────────────────────────────────────────

create policy "bank_deposits_select" on public.bank_deposits
  for select using (public.is_org_member(org_id));
create policy "bank_deposits_insert" on public.bank_deposits
  for insert with check (public.is_org_finance_user(org_id));
create policy "bank_deposits_update" on public.bank_deposits
  for update using (public.is_org_finance_user(org_id));
create policy "bank_deposits_delete" on public.bank_deposits
  for delete using (public.is_org_admin(org_id));

-- ── Intrabank Transfers ────────────────────────────────────────────────────────

create policy "intrabank_select" on public.intrabank_transfers
  for select using (public.is_org_member(org_id));
create policy "intrabank_insert" on public.intrabank_transfers
  for insert with check (public.is_org_finance_user(org_id));
create policy "intrabank_update" on public.intrabank_transfers
  for update using (public.is_org_finance_user(org_id));
create policy "intrabank_delete" on public.intrabank_transfers
  for delete using (public.is_org_admin(org_id));

-- ── Accounts ───────────────────────────────────────────────────────────────────

create policy "accounts_select" on public.accounts
  for select using (public.is_org_member(org_id));
create policy "accounts_insert" on public.accounts
  for insert with check (public.is_org_admin(org_id));
create policy "accounts_update" on public.accounts
  for update using (public.is_org_admin(org_id));
create policy "accounts_delete" on public.accounts
  for delete using (public.is_org_admin(org_id));

-- ── Ledger Entries ─────────────────────────────────────────────────────────────

create policy "ledger_select" on public.ledger_entries
  for select using (public.is_org_member(org_id));
create policy "ledger_insert" on public.ledger_entries
  for insert with check (public.is_org_finance_user(org_id));
create policy "ledger_update" on public.ledger_entries
  for update using (public.is_org_finance_user(org_id));
create policy "ledger_delete" on public.ledger_entries
  for delete using (public.is_org_admin(org_id));

-- ── FX Transactions ────────────────────────────────────────────────────────────

create policy "fx_select" on public.fx_transactions
  for select using (public.is_org_member(org_id));
create policy "fx_insert" on public.fx_transactions
  for insert with check (public.is_org_finance_user(org_id));
create policy "fx_update" on public.fx_transactions
  for update using (public.is_org_finance_user(org_id));
create policy "fx_delete" on public.fx_transactions
  for delete using (public.is_org_admin(org_id));

-- ── Special Projects ───────────────────────────────────────────────────────────

create policy "projects_select" on public.special_projects
  for select using (public.is_org_member(org_id));
create policy "projects_insert" on public.special_projects
  for insert with check (public.is_org_admin(org_id));
create policy "projects_update" on public.special_projects
  for update using (public.is_org_admin(org_id));
create policy "projects_delete" on public.special_projects
  for delete using (public.is_org_admin(org_id));

-- ── Project Entries ────────────────────────────────────────────────────────────

create policy "project_entries_select" on public.project_entries
  for select using (public.is_org_member(org_id));
create policy "project_entries_insert" on public.project_entries
  for insert with check (public.is_org_finance_user(org_id));
create policy "project_entries_update" on public.project_entries
  for update using (public.is_org_finance_user(org_id));
create policy "project_entries_delete" on public.project_entries
  for delete using (public.is_org_admin(org_id));

-- ── Receipts ───────────────────────────────────────────────────────────────────

create policy "receipts_select" on public.receipts
  for select using (public.is_org_member(org_id));
create policy "receipts_insert" on public.receipts
  for insert with check (public.is_org_finance_user(org_id));
create policy "receipts_delete" on public.receipts
  for delete using (public.is_org_finance_user(org_id));

-- ── Invitations ────────────────────────────────────────────────────────────────
-- Token reads via get_invitation_by_token() SECURITY DEFINER RPC only.

create policy "invitations_select" on public.invitations
  for select using (public.is_org_admin(org_id));
create policy "invitations_insert" on public.invitations
  for insert with check (public.is_org_admin(org_id));
create policy "invitations_update" on public.invitations
  for update using (public.is_org_admin(org_id));
create policy "invitations_delete" on public.invitations
  for delete using (public.is_org_admin(org_id));

-- ── Invitation security-definer helpers ────────────────────────────────────────

-- Returns minimal invite data for a PENDING, non-expired token.
-- Safe for anonymous callers; never exposes accepted/expired rows or other invites.
create or replace function public.get_invitation_by_token(p_token uuid)
returns table(id uuid, email text, role text, status text, expires_at timestamptz)
language plpgsql security definer stable
as $$
begin
  return query
    select i.id, i.email, i.role, i.status, i.expires_at
    from   public.invitations i
    where  i.token      = p_token
      and  i.status     = 'pending'
      and  i.expires_at > now();
end;
$$;

-- Atomically sets the role from the invite, syncs org_members, marks consumed.
-- p_user_id must equal auth.uid() to block accepting on behalf of others.
create or replace function public.accept_invitation(p_token uuid, p_user_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_invite public.invitations;
begin
  if p_user_id != auth.uid() then
    raise exception 'Unauthorized';
  end if;

  select * into v_invite
  from   public.invitations
  where  token      = p_token
    and  status     = 'pending'
    and  expires_at > now()
  for update;

  if not found then
    raise exception 'Invalid or expired invitation';
  end if;

  -- Keep profiles.role in sync for frontend useRole() hook
  update public.profiles
    set role       = v_invite.role,
        updated_at = now()
  where id = p_user_id;

  -- Upsert org_members.role (authoritative for Phase 3 RLS helpers)
  insert into public.org_members (org_id, user_id, role, status)
  values (v_invite.org_id, p_user_id, v_invite.role, 'active')
  on conflict (org_id, user_id) do update
    set role   = excluded.role,
        status = 'active';

  update public.invitations
    set status      = 'accepted',
        accepted_at = now()
  where token = p_token;
end;
$$;

-- ── Audit Log (no org_id) ──────────────────────────────────────────────────────

create policy "audit_admin_read" on public.audit_log
  for select using (public.is_admin());
create policy "audit_insert" on public.audit_log
  for insert with check (
    exists (select 1 from public.org_members where user_id = auth.uid() and status = 'active')
  );

-- ── Field Changes (no org_id) ──────────────────────────────────────────────────

create policy "field_changes_admin_read" on public.field_changes
  for select using (public.is_admin());
create policy "field_changes_insert" on public.field_changes
  for insert with check (
    exists (select 1 from public.org_members where user_id = auth.uid() and status = 'active')
  );

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

create policy "cob_select" on public.category_opening_balances
  for select using (public.is_org_member(org_id));
create policy "cob_insert" on public.category_opening_balances
  for insert with check (public.is_org_finance_user(org_id));
create policy "cob_update" on public.category_opening_balances
  for update using (public.is_org_finance_user(org_id));
create policy "cob_delete" on public.category_opening_balances
  for delete using (public.is_org_admin(org_id));

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
  for select using (public.is_org_member(org_id));
create policy "report_templates_insert" on public.report_templates
  for insert with check (public.is_org_finance_user(org_id));
create policy "report_templates_update" on public.report_templates
  for update using (public.is_org_finance_user(org_id));
create policy "report_templates_delete" on public.report_templates
  for delete using (public.is_org_admin(org_id));

-- ============================================================
-- SPECIAL CONFIG GROUPS (versioned special allocation configs)
-- ============================================================
create table if not exists public.special_config_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

alter table public.special_config_groups enable row level security;

create policy "scg_select" on public.special_config_groups
  for select using (public.is_org_member(org_id));
create policy "scg_insert" on public.special_config_groups
  for insert with check (public.is_org_admin(org_id));
create policy "scg_update" on public.special_config_groups
  for update using (public.is_org_admin(org_id));
create policy "scg_delete" on public.special_config_groups
  for delete using (public.is_org_admin(org_id));

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

create policy "tas_select" on public.transaction_allocation_snapshots
  for select using (public.is_org_member(org_id));
create policy "tas_insert" on public.transaction_allocation_snapshots
  for insert with check (public.is_org_finance_user(org_id));
create policy "tas_update" on public.transaction_allocation_snapshots
  for update using (public.is_org_finance_user(org_id));
create policy "tas_delete" on public.transaction_allocation_snapshots
  for delete using (public.is_org_admin(org_id));

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

create policy "rl_select" on public.recalculation_logs
  for select using (public.is_org_member(org_id));
-- Append-only: no update/delete policy intentionally (immutable audit trail).
create policy "rl_insert" on public.recalculation_logs
  for insert with check (public.is_org_finance_user(org_id));

create index if not exists idx_report_templates_user on public.report_templates(created_by);


-- Balance Brought Forward deduplication + uniqueness constraint
create unique index if not exists idx_inflow_bf_unique_bank
  on inflow_transactions (bank_name)
  where transaction_type = 'balance_brought_forward';

create index if not exists idx_inflow_bank_name  on inflow_transactions(bank_name);
create index if not exists idx_outflow_bank_name on outflow_transactions(bank_name);

-- Dynamic Reports
create table if not exists public.dynamic_reports (
  id         uuid primary key default gen_random_uuid(),
  title      text not null default 'Untitled Report',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.dynamic_reports enable row level security;
create policy "dr_select" on public.dynamic_reports for select using (public.is_org_member(org_id));
create policy "dr_insert" on public.dynamic_reports for insert with check (public.is_org_finance_user(org_id));
create policy "dr_update" on public.dynamic_reports for update using (public.is_org_finance_user(org_id));
create policy "dr_delete" on public.dynamic_reports for delete using (public.is_org_admin(org_id));

-- Dynamic Report Blocks
create table if not exists public.dynamic_report_blocks (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references dynamic_reports(id) on delete cascade,
  block_type  text not null check (block_type in ('text', 'metric', 'table', 'formula')),
  position    integer not null default 0,
  config_json jsonb not null default '{}',
  created_at  timestamptz default now()
);
alter table public.dynamic_report_blocks enable row level security;
-- dynamic_report_blocks has no org_id — isolate via parent dynamic_reports
create policy "drb_select" on public.dynamic_report_blocks for select using (
  exists (
    select 1 from public.dynamic_reports dr
    join public.org_members m on m.org_id = dr.org_id and m.user_id = auth.uid() and m.status = 'active'
    where dr.id = report_id
  )
);
create policy "drb_insert" on public.dynamic_report_blocks for insert with check (
  exists (
    select 1 from public.dynamic_reports dr
    join public.org_members m on m.org_id = dr.org_id and m.user_id = auth.uid()
      and m.role in ('admin', 'accountant') and m.status = 'active'
    where dr.id = report_id
  )
);
create policy "drb_update" on public.dynamic_report_blocks for update using (
  exists (
    select 1 from public.dynamic_reports dr
    join public.org_members m on m.org_id = dr.org_id and m.user_id = auth.uid()
      and m.role in ('admin', 'accountant') and m.status = 'active'
    where dr.id = report_id
  )
);
create policy "drb_delete" on public.dynamic_report_blocks for delete using (
  exists (
    select 1 from public.dynamic_reports dr
    join public.org_members m on m.org_id = dr.org_id and m.user_id = auth.uid()
      and m.role = 'admin' and m.status = 'active'
    where dr.id = report_id
  )
);
create index if not exists idx_drb_report_position on public.dynamic_report_blocks(report_id, position);

-- ── Dynamic Report Snapshots ──────────────────────────────────────────────────
create table if not exists public.dynamic_report_snapshots (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references dynamic_reports(id) on delete cascade,
  label       text not null,
  snapshot_at timestamptz not null default now(),
  data        jsonb not null default '{}',
  created_at  timestamptz default now()
);
alter table public.dynamic_report_snapshots enable row level security;
-- dynamic_report_snapshots has no org_id — isolate via parent dynamic_reports
create policy "drs_select" on public.dynamic_report_snapshots for select using (
  exists (
    select 1 from public.dynamic_reports dr
    join public.org_members m on m.org_id = dr.org_id and m.user_id = auth.uid() and m.status = 'active'
    where dr.id = report_id
  )
);
create policy "drs_insert" on public.dynamic_report_snapshots for insert with check (
  exists (
    select 1 from public.dynamic_reports dr
    join public.org_members m on m.org_id = dr.org_id and m.user_id = auth.uid()
      and m.role in ('admin', 'accountant') and m.status = 'active'
    where dr.id = report_id
  )
);
create policy "drs_delete" on public.dynamic_report_snapshots for delete using (
  exists (
    select 1 from public.dynamic_reports dr
    join public.org_members m on m.org_id = dr.org_id and m.user_id = auth.uid()
      and m.role = 'admin' and m.status = 'active'
    where dr.id = report_id
  )
);
create index if not exists idx_drs_report_at on public.dynamic_report_snapshots(report_id, snapshot_at desc);

-- ============================================================
-- ORGANIZATIONS & MULTI-TENANT FOUNDATION (Phase 1)
-- ============================================================
create table if not exists public.organizations (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  slug       text        not null unique,
  created_by uuid        references public.profiles(id) on delete set null,
  metadata   jsonb       not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

create index if not exists idx_organizations_slug       on public.organizations(slug);
create index if not exists idx_organizations_created_by on public.organizations(created_by);

create policy "orgs_select" on public.organizations for select using (public.is_org_member(id));
create policy "orgs_insert" on public.organizations for insert with check (public.is_admin());
create policy "orgs_update" on public.organizations for update using (public.is_org_admin(id));
create policy "orgs_delete" on public.organizations for delete using (public.is_org_admin(id));

-- Seed the primary (bootstrap) organization.
-- On a fresh install all business tables are empty, so the NOT NULL defaults below
-- are satisfied by this row existing before any data is inserted.
insert into public.organizations (name, slug, metadata)
values ('My Church', 'primary', '{"bootstrap": true}'::jsonb)
on conflict (slug) do nothing;

-- ── Org Members ───────────────────────────────────────────────
create table if not exists public.org_members (
  id         uuid        primary key default gen_random_uuid(),
  org_id     uuid        not null references public.organizations(id) on delete cascade,
  user_id    uuid        not null references public.profiles(id)      on delete cascade,
  role       text        not null default 'viewer'
                         check (role in ('admin', 'accountant', 'viewer')),
  joined_at  timestamptz not null default now(),
  invited_by uuid        references public.profiles(id) on delete set null,
  status     text        not null default 'active'
                         check (status in ('active', 'invited', 'suspended')),
  unique (org_id, user_id)
);

alter table public.org_members enable row level security;

create index if not exists idx_org_members_org_id  on public.org_members(org_id);
create index if not exists idx_org_members_user_id on public.org_members(user_id);

create policy "org_members_select" on public.org_members for select using (public.is_org_member(org_id));
create policy "org_members_insert" on public.org_members for insert with check (public.is_org_admin(org_id));
create policy "org_members_update" on public.org_members for update using (public.is_org_admin(org_id));
create policy "org_members_delete" on public.org_members for delete using (public.is_org_admin(org_id));

-- ── org_id on all business tables (NOT NULL + DEFAULT after Phase 2 backfill) ─
-- Fresh installs: tables are empty when these run, so NOT NULL + DEFAULT is safe.
-- Existing installs: run 20260528000001_org_backfill.sql instead of re-applying this.

alter table public.category_groups           add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.categories                add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.banks                     add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.allocation_configs        add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.income_types              add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.income_type_rules         add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.inflow_transactions       add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.outflow_transactions      add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.intra_flows               add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.bank_deposits             add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.intrabank_transfers       add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.accounts                  add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.ledger_entries            add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.fx_transactions           add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.special_projects          add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.project_entries           add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.receipts                  add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.invitations               add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.report_templates          add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.special_config_groups     add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.transaction_allocation_snapshots add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.recalculation_logs        add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.dynamic_reports           add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.outflow_types             add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.category_outflow_type_map add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;
alter table public.category_opening_balances add column if not exists org_id uuid not null default public.get_current_org_id() references public.organizations(id) on delete set null;

-- Standalone org_id indexes (high-volume tables — Phase 1)
create index if not exists idx_inflow_org        on public.inflow_transactions(org_id);
create index if not exists idx_outflow_org       on public.outflow_transactions(org_id);
create index if not exists idx_intra_flows_org   on public.intra_flows(org_id);
create index if not exists idx_banks_org         on public.banks(org_id);
create index if not exists idx_categories_org    on public.categories(org_id);
create index if not exists idx_alloc_configs_org on public.allocation_configs(org_id);
create index if not exists idx_fx_org            on public.fx_transactions(org_id);
create index if not exists idx_bank_deposits_org on public.bank_deposits(org_id);

-- Composite (org_id, date) indexes for org-scoped date-range queries (Phase 2)
create index if not exists idx_inflow_org_date       on public.inflow_transactions(org_id, date);
create index if not exists idx_outflow_org_date      on public.outflow_transactions(org_id, date);
create index if not exists idx_intra_org_date        on public.intra_flows(org_id, date);
create index if not exists idx_bank_dep_org_date     on public.bank_deposits(org_id, date);
create index if not exists idx_intrabank_org_date    on public.intrabank_transfers(org_id, date);
create index if not exists idx_fx_org_date           on public.fx_transactions(org_id, date);
create index if not exists idx_proj_entries_org_date on public.project_entries(org_id, date);
create index if not exists idx_ledger_org_date       on public.ledger_entries(org_id, date);

-- Standalone org_id indexes (remaining tables — Phase 2)
create index if not exists idx_category_groups_org    on public.category_groups(org_id);
create index if not exists idx_income_types_org       on public.income_types(org_id);
create index if not exists idx_income_type_rules_org  on public.income_type_rules(org_id);
create index if not exists idx_intrabank_org          on public.intrabank_transfers(org_id);
create index if not exists idx_accounts_org           on public.accounts(org_id);
create index if not exists idx_ledger_entries_org     on public.ledger_entries(org_id);
create index if not exists idx_special_projects_org   on public.special_projects(org_id);
create index if not exists idx_project_entries_org    on public.project_entries(org_id);
create index if not exists idx_receipts_org           on public.receipts(org_id);
create index if not exists idx_invitations_org        on public.invitations(org_id);
create index if not exists idx_report_templates_org   on public.report_templates(org_id);
create index if not exists idx_special_config_groups_org on public.special_config_groups(org_id);
create index if not exists idx_tas_org                on public.transaction_allocation_snapshots(org_id);
create index if not exists idx_recalc_logs_org        on public.recalculation_logs(org_id);
create index if not exists idx_dynamic_reports_org    on public.dynamic_reports(org_id);
create index if not exists idx_outflow_types_org      on public.outflow_types(org_id);
create index if not exists idx_cotm_org               on public.category_outflow_type_map(org_id);
create index if not exists idx_cob_org                on public.category_opening_balances(org_id);

-- ── Org-aware helper functions ────────────────────────────────

create or replace function public.get_current_org_id()
returns uuid language sql security definer stable as $$
  select id from public.organizations where slug = 'primary' limit 1;
$$;

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.org_members
    where org_id  = p_org_id
      and user_id = auth.uid()
      and role    = 'admin'
      and status  = 'active'
  );
$$;

create or replace function public.is_org_finance_user(p_org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.org_members
    where org_id  = p_org_id
      and user_id = auth.uid()
      and role    in ('admin', 'accountant')
      and status  = 'active'
  );
$$;

create or replace function public.is_org_member(p_org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.org_members
    where org_id  = p_org_id
      and user_id = auth.uid()
      and status  = 'active'
  );
$$;
