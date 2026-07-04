-- ================================================================
-- CHURCH FINANCE APP — CANONICAL SCHEMA  (fresh-install only)
-- Generated: 2026-06-05
--
-- DO NOT apply to an existing database.
-- For existing databases apply migrations in supabase/migrations/ .
--
-- Safe deployment order
-- ---------------------------------------------------------------
--  1. Extension
--  2. Auth bridge         (profiles)
--  3. Multi-tenant core   (organizations, org_members)
--  4. Helper functions    (require org_members to exist)
--  5. handle_new_user trigger
--  6. Business tables     (org_id inline — get_current_org_id() already defined)
--  7. Seed data           (primary org first, then default records)
--  8. Enable RLS
--  9. RLS policies        (all helpers + columns exist)
-- 10. Indexes
-- 11. RPCs and grants
-- 12. Schema-change notification
-- ================================================================

-- ── 1. Extension ─────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ================================================================
-- 2. AUTH BRIDGE
-- ================================================================

create table public.profiles (
  id         uuid references auth.users on delete cascade primary key,
  email      text not null,
  full_name  text,
  username   text unique,
  role       text not null default 'viewer'
             check (role in ('owner', 'admin', 'accountant', 'viewer')),
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ================================================================
-- 3. MULTI-TENANT CORE
-- organizations must exist before org_members and before departments.
-- ================================================================

create table public.organizations (
  id                    uuid        primary key default gen_random_uuid(),
  name                  text        not null,
  slug                  text        not null unique,
  created_by            uuid        references public.profiles(id) on delete set null,
  metadata              jsonb       not null default '{}',
  default_currency      text,
  fiscal_year_start     int         not null default 1 check (fiscal_year_start between 1 and 12),
  timezone              text        not null default 'Africa/Lagos',
  onboarding_complete   boolean     not null default true,
  status                text        not null default 'active'
                        check (status in ('active', 'pending_deletion')),
  deleted_at            timestamptz,
  purge_at              timestamptz,
  deletion_requested_by uuid        references public.profiles(id) on delete set null,
  deletion_backup_path  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_organizations_slug       on public.organizations(slug);
create index if not exists idx_organizations_created_by on public.organizations(created_by);
create index if not exists idx_organizations_status     on public.organizations(status);
create index if not exists idx_organizations_purge_at   on public.organizations(purge_at);

create table public.org_members (
  id         uuid        primary key default gen_random_uuid(),
  org_id     uuid        not null references public.organizations(id) on delete cascade,
  user_id    uuid        not null references public.profiles(id)      on delete cascade,
  role       text        not null default 'viewer'
             check (role in ('owner', 'admin', 'accountant', 'viewer')),
  joined_at  timestamptz not null default now(),
  invited_by uuid        references public.profiles(id) on delete set null,
  status     text        not null default 'active'
             check (status in ('active', 'invited', 'suspended')),
  unique (org_id, user_id)
);

create index if not exists idx_org_members_org_id      on public.org_members(org_id);
create index if not exists idx_org_members_user_id     on public.org_members(user_id);
create index if not exists idx_org_members_uid_status  on public.org_members(user_id, status)
  where status = 'active';
create index if not exists idx_org_members_org_uid_status on public.org_members(org_id, user_id, status)
  where status = 'active';

-- ================================================================
-- 4. ORG-AWARE HELPER FUNCTIONS
-- Must be defined BEFORE any table with DEFAULT get_current_org_id()
-- and BEFORE any RLS policy that calls them.
-- ================================================================


-- ── Helper functions ───────────────────────────────────────────────────────────
-- is_admin / is_finance_user use org_members so suspended users lose access
-- immediately; used for tables without a direct org_id column.

create or replace function public.is_finance_user()
returns boolean as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid()
      and role    in ('owner', 'admin', 'accountant')
      and status  = 'active'
  );
$$ language sql security definer stable;

create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid()
      and role    in ('owner', 'admin')
      and status  = 'active'
  );
$$ language sql security definer stable;

-- Returns the id of the bootstrap 'primary' org.
-- Used as the DEFAULT for org_id on all business tables (fresh install only).
create or replace function public.get_current_org_id()
returns uuid language sql security definer stable as $$
  select id from public.organizations where slug = 'primary' limit 1;
$$;

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

-- is_org_admin: owner or admin in p_org_id.
create or replace function public.is_org_admin(p_org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.org_members
    where org_id  = p_org_id
      and user_id = auth.uid()
      and role    in ('owner', 'admin')
      and status  = 'active'
  );
$$;

-- is_org_finance_user: owner, admin, or accountant in p_org_id.
create or replace function public.is_org_finance_user(p_org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.org_members
    where org_id  = p_org_id
      and user_id = auth.uid()
      and role    in ('owner', 'admin', 'accountant')
      and status  = 'active'
  );
$$;

-- is_org_owner: owner role only (used for deletion/transfer RPCs).
create or replace function public.is_org_owner(p_org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.org_members
    where org_id  = p_org_id
      and user_id = auth.uid()
      and role    = 'owner'
      and status  = 'active'
  );
$$;

-- is_admin: owner or admin in ANY active org — used by tables without org_id.
create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid()
      and role    in ('owner', 'admin')
      and status  = 'active'
  );
$$;

-- is_finance_user: owner, admin, or accountant in ANY active org.
create or replace function public.is_finance_user()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid()
      and role    in ('owner', 'admin', 'accountant')
      and status  = 'active'
  );
$$;

-- ================================================================
-- 5. HANDLE_NEW_USER TRIGGER
-- Creates only the profile row on sign-up.
-- Org membership is always set explicitly by create_organization()
-- (self-signup) or accept_invitation() (invite flow).
-- ================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
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
  exception
    when unique_violation then
      raise warning '[handle_new_user] username conflict user=% — retrying without username', new.id;
      begin
        insert into public.profiles (id, email, full_name, username)
        values (new.id, new.email, new.raw_user_meta_data->>'full_name', null)
        on conflict (id) do nothing;
      exception when others then
        raise warning '[handle_new_user] profile fallback failed user=% err=%', new.id, sqlerrm;
      end;
    when others then
      raise warning '[handle_new_user] profile insert failed user=% err=%', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ================================================================
-- 6. BUSINESS TABLES
-- All tables include org_id NOT NULL DEFAULT get_current_org_id().
-- Table order respects all FK dependencies.
-- ================================================================

-- ── Special Config Groups (referenced by allocation_configs) ──────────────────
create table public.special_config_groups (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  is_default boolean     not null default false,
  org_id     uuid        not null default public.get_current_org_id()
             references public.organizations(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ── Category Groups ───────────────────────────────────────────────────────────
create table public.category_groups (
  id         uuid        default gen_random_uuid() primary key,
  name       text        not null,
  sort_order integer     default 0,
  org_id     uuid        not null default public.get_current_org_id()
             references public.organizations(id) on delete set null,
  created_at timestamptz default now()
);

-- ── Categories ────────────────────────────────────────────────────────────────
create table public.categories (
  id          uuid        default gen_random_uuid() primary key,
  name        text        not null unique,
  description text,
  group_id    uuid        references public.category_groups(id) on delete set null,
  is_hidden   boolean     not null default false,
  is_default  boolean     not null default false,
  currency    text,
  org_id      uuid        not null default public.get_current_org_id()
              references public.organizations(id) on delete set null,
  created_at  timestamptz default now()
);

-- ── Banks ─────────────────────────────────────────────────────────────────────
create table public.banks (
  id                               uuid        default gen_random_uuid() primary key,
  name                             text        not null,
  account_number                   text,
  account_type                     text,
  currency                         text        not null default 'NGN',
  starting_balance                 numeric(15,2),
  starting_balance_category        text,
  starting_balance_budget_portion  text,
  starting_balance_alloc_type      text        check (starting_balance_alloc_type in ('percentage', 'amount')),
  starting_balance_allocations     jsonb       not null default '[]',
  is_foreign_currency              bool        not null default false,
  org_id                           uuid        not null default public.get_current_org_id()
                                   references public.organizations(id) on delete set null,
  created_at                       timestamptz default now()
);

-- ── Allocation Configs ────────────────────────────────────────────────────────
create table public.allocation_configs (
  id               uuid        default gen_random_uuid() primary key,
  name             text        not null,
  start_date       date        not null,
  status           text        not null default 'draft' check (status in ('draft', 'locked')),
  rows             jsonb       not null default '[]',
  is_special       boolean     not null default false,
  allocation_type  text,
  total_amount     numeric(15,2),
  config_group_id   uuid        references public.special_config_groups(id) on delete cascade,
  effective_from    date,
  effective_to      date,
  version_number    integer     not null default 1,
  superseded_by_id  uuid        references public.allocation_configs(id) on delete set null,
  superseded_at     timestamptz,
  change_type       text        check (change_type in ('initial','new_version','date_split','amendment')) default 'initial',
  source_version_id uuid        references public.allocation_configs(id) on delete set null,
  amendment_reason  text,
  org_id            uuid        not null default public.get_current_org_id()
                    references public.organizations(id) on delete set null,
  created_at        timestamptz default now()
);

-- ── Income Types ──────────────────────────────────────────────────────────────
create table public.income_types (
  id                      uuid        default gen_random_uuid() primary key,
  name                    text        not null,
  description             text,
  color                   text        not null default '#6366f1',
  special_config_id       uuid        references public.allocation_configs(id) on delete set null,
  special_config_group_id uuid        references public.special_config_groups(id) on delete set null,
  org_id                  uuid        not null default public.get_current_org_id()
                          references public.organizations(id) on delete set null,
  created_at              timestamptz default now()
);

create table public.income_type_rules (
  id             uuid        default gen_random_uuid() primary key,
  income_type_id uuid        not null references public.income_types(id) on delete cascade,
  rule_type      text        not null check (rule_type in ('keyword', 'stage_code')),
  rule_value     text        not null,
  org_id         uuid        not null default public.get_current_org_id()
                 references public.organizations(id) on delete set null,
  created_at     timestamptz default now()
);

-- ── Outflow Types ─────────────────────────────────────────────────────────────
create table public.outflow_types (
  id               uuid        default gen_random_uuid() primary key,
  name             text        not null,
  color            text        not null default '#64748b',
  is_system        boolean     not null default false,
  is_locked        boolean     not null default false,
  auto_created     boolean     not null default false,
  manually_renamed boolean     not null default false,
  created_by       uuid        references public.profiles(id),
  org_id           uuid        not null default public.get_current_org_id()
                   references public.organizations(id) on delete set null,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  unique (org_id, name)
);

-- ── Category-Outflow Type Mapping ─────────────────────────────────────────────
create table public.category_outflow_type_map (
  id              uuid        default gen_random_uuid() primary key,
  category_id     uuid        not null references public.categories(id) on delete cascade,
  outflow_type_id uuid        not null references public.outflow_types(id) on delete cascade,
  org_id          uuid        not null default public.get_current_org_id()
                  references public.organizations(id) on delete set null,
  created_at      timestamptz default now(),
  unique (category_id, outflow_type_id)
);

-- ── Accounts (chart of accounts) ─────────────────────────────────────────────
create table public.accounts (
  id              uuid        default gen_random_uuid() primary key,
  code            text        unique not null,
  name            text        not null,
  category        text        check (category in ('income','expense','savings','ministry','special','foreign')),
  opening_balance numeric(15,2) default 0,
  is_active       boolean     default true,
  org_id          uuid        not null default public.get_current_org_id()
                  references public.organizations(id) on delete set null,
  created_at      timestamptz default now()
);

-- ── Ledger Entries ────────────────────────────────────────────────────────────
create table public.ledger_entries (
  id                       uuid        default gen_random_uuid() primary key,
  account_id               uuid        references public.accounts(id) on delete cascade,
  date                     date        not null,
  description              text,
  inflow                   numeric(15,2) default 0,
  refund_intraflow         numeric(15,2) default 0,
  outflow                  numeric(15,2) default 0,
  balance                  numeric(15,2) default 0,
  percentage_part          numeric(15,2),
  savings_part             numeric(15,2),
  special_seed_description text,
  created_by               uuid        references public.profiles(id),
  org_id                   uuid        not null default public.get_current_org_id()
                           references public.organizations(id) on delete set null,
  created_at               timestamptz default now()
);

-- ── Special Projects ──────────────────────────────────────────────────────────
create table public.special_projects (
  id              uuid        default gen_random_uuid() primary key,
  name            text        not null,
  code            text,
  opening_balance numeric(15,2) default 0,
  is_active       boolean     default true,
  org_id          uuid        not null default public.get_current_org_id()
                  references public.organizations(id) on delete set null,
  created_at      timestamptz default now()
);

create table public.project_entries (
  id                uuid        default gen_random_uuid() primary key,
  project_id        uuid        references public.special_projects(id) on delete cascade,
  date              date        not null,
  description       text,
  inflow            numeric(15,2) default 0,
  percentage_inflow numeric(15,2) default 0,
  refund_intraflow  numeric(15,2) default 0,
  outflow           numeric(15,2) default 0,
  balance           numeric(15,2) default 0,
  created_by        uuid        references public.profiles(id),
  org_id            uuid        not null default public.get_current_org_id()
                    references public.organizations(id) on delete set null,
  created_at        timestamptz default now(),
  import_seq        bigint      generated always as identity
);

-- ── Departments / Units ───────────────────────────────────────────────────────
create table public.departments (
  id          uuid        default gen_random_uuid() primary key,
  name        text        not null,
  code        text,
  description text,
  active      boolean     not null default true,
  org_id      uuid        not null default public.get_current_org_id()
              references public.organizations(id) on delete set null,
  created_by  uuid        references public.profiles(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create unique index departments_org_name_unique on public.departments(org_id, name);

-- ── Inflow Transactions ───────────────────────────────────────────────────────
create table public.inflow_transactions (
  id                        uuid        default gen_random_uuid() primary key,
  date                      date        not null,
  description               text,
  amount                    numeric(15,2) not null default 0,
  stage_code_1              text,
  stage_code_2              text,
  stage_code_3              text,
  transaction_ref           text,
  specific_seed_description text,
  remark                    text,
  bank_name                 text,
  fx_currency               text,
  fx_amount                 numeric(15,4),
  fx_rate                   numeric(15,6),
  transaction_type          text,
  original_transaction_id   text,
  root_transaction_id       text,
  root_transaction_table    text,
  offset_link_type          text,
  offset_role               text        check (offset_role in ('root', 'offset')),
  deposit_group_id          uuid,
  allocation_config_id      uuid        references public.allocation_configs(id) on delete set null,
  income_type_id            uuid        references public.income_types(id) on delete set null,
  is_pending_deduction      boolean     not null default false,
  created_by                uuid        references public.profiles(id),
  recorded_at               timestamptz default now(),
  created_at                timestamptz default now(),
  updated_at                timestamptz default now(),
  import_seq                bigint      generated always as identity,
  org_id                    uuid        not null default public.get_current_org_id()
                            references public.organizations(id) on delete set null
);

-- ── Outflow Transactions ──────────────────────────────────────────────────────
create table public.outflow_transactions (
  id                      uuid        default gen_random_uuid() primary key,
  date                    date        not null,
  transaction_id          text,
  bank_description        text,
  description             text,
  amount_disbursed        numeric(15,2) default 0,
  amount_refunded         numeric(15,2) default 0,
  transfer_charge         numeric(15,2) default 0,
  bank_total              numeric(15,2) default 0,
  stage_code_1            text,
  stage_code_2            text,
  remarks                 text,
  bank_name               text,
  fx_currency             text,
  fx_amount               numeric(15,4),
  fx_rate                 numeric(15,6),
  transaction_type        text,
  original_transaction_id text,
  root_transaction_id     text,
  root_transaction_table  text,
  offset_link_type        text,
  offset_role             text        check (offset_role in ('root', 'offset')),
  deposit_group_id        uuid,
  allocation_config_id    uuid        references public.allocation_configs(id) on delete set null,
  outflow_type_id         uuid        references public.outflow_types(id) on delete set null,
  department_id           uuid        references public.departments(id) on delete set null,
  is_pending_deduction    boolean     not null default false,
  created_by              uuid        references public.profiles(id),
  recorded_at             timestamptz default now(),
  created_at              timestamptz default now(),
  updated_at              timestamptz default now(),
  import_seq              bigint      generated always as identity,
  org_id                  uuid        not null default public.get_current_org_id()
                          references public.organizations(id) on delete set null
);

-- ── Intra-Account Flows ───────────────────────────────────────────────────────
create table public.intra_flows (
  id                  uuid        default gen_random_uuid() primary key,
  date                date        not null,
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
  from_category_id    uuid        references public.categories(id) on delete set null,
  to_category_id      uuid        references public.categories(id) on delete set null,
  status              text        not null default 'active' check (status in ('active', 'reversed', 'void')),
  reversal_of_id      uuid        references public.intra_flows(id) on delete set null,
  transfer_type       text,
  batch_id            uuid,
  created_by          uuid        references public.profiles(id),
  org_id              uuid        not null default public.get_current_org_id()
                      references public.organizations(id) on delete set null,
  created_at          timestamptz default now(),
  import_seq          bigint      generated always as identity
);

-- ── FX Transactions ───────────────────────────────────────────────────────────
create table public.fx_transactions (
  id              uuid        default gen_random_uuid() primary key,
  date            date        not null,
  currency        text        not null,
  transaction_ref text,
  narration       text,
  deposit         numeric(15,4) default 0,
  withdrawal      numeric(15,4) default 0,
  running_balance numeric(15,4) default 0,
  bank_name       text,
  created_by      uuid        references public.profiles(id),
  org_id          uuid        not null default public.get_current_org_id()
                  references public.organizations(id) on delete set null,
  created_at      timestamptz default now(),
  import_seq      bigint      generated always as identity
);

-- ── FX Conversions (atomic link: fx withdrawal ↔ naira inflow) ────────────────
create table public.fx_conversions (
  id                   uuid        primary key default gen_random_uuid(),
  date                 date        not null,
  fx_currency          text        not null,
  fx_amount            numeric(15,4) not null,
  exchange_rate        numeric(15,6) not null,
  naira_amount         numeric(15,2) not null,
  fx_withdrawal_id     uuid        references public.fx_transactions(id) on delete set null,
  naira_inflow_id      uuid        references public.inflow_transactions(id) on delete set null,
  notes                text,
  allocation_config_id uuid        references public.allocation_configs(id) on delete set null,
  is_partial           boolean     not null default false,
  created_by           uuid        references public.profiles(id) on delete set null,
  org_id               uuid        not null default public.get_current_org_id()
                       references public.organizations(id) on delete set null,
  created_at           timestamptz not null default now()
);

-- ── Bank Deposits ─────────────────────────────────────────────────────────────
create table public.bank_deposits (
  id              uuid        default gen_random_uuid() primary key,
  date            date        not null,
  bank_id         uuid        references public.banks(id),
  bank_name       text,
  amount          numeric(15,2) not null,
  description     text,
  transaction_ref text,
  remarks         text,
  org_id          uuid        not null default public.get_current_org_id()
                  references public.organizations(id) on delete set null,
  created_at      timestamptz default now(),
  import_seq      bigint      generated always as identity
);

-- ── Intrabank Transfers ───────────────────────────────────────────────────────
create table public.intrabank_transfers (
  id              uuid        default gen_random_uuid() primary key,
  date            date        not null,
  from_bank_id    uuid        references public.banks(id),
  from_bank_name  text,
  to_bank_id      uuid        references public.banks(id),
  to_bank_name    text,
  amount          numeric(15,2) not null,
  description     text,
  transaction_ref text,
  remarks         text,
  org_id          uuid        not null default public.get_current_org_id()
                  references public.organizations(id) on delete set null,
  created_at      timestamptz default now(),
  import_seq      bigint      generated always as identity
);

-- ── Receipts ──────────────────────────────────────────────────────────────────
create table public.receipts (
  id          uuid        default gen_random_uuid() primary key,
  entity_type text        not null check (entity_type in ('inflow','outflow','bank_deposit')),
  entity_id   uuid        not null,
  file_name   text        not null,
  file_path   text        not null,
  file_size   integer,
  mime_type   text,
  uploaded_by uuid        references public.profiles(id),
  org_id      uuid        not null default public.get_current_org_id()
              references public.organizations(id) on delete set null,
  created_at  timestamptz default now()
);

-- ── Invitations ───────────────────────────────────────────────────────────────
create table public.invitations (
  id          uuid        default gen_random_uuid() primary key,
  email       text        not null,
  role        text        not null default 'viewer'
              check (role in ('owner', 'admin', 'accountant', 'viewer')),
  invited_by  uuid        references public.profiles(id),
  status      text        not null default 'pending'
              check (status in ('pending', 'accepted', 'expired')),
  token       uuid        default gen_random_uuid() unique,
  expires_at  timestamptz default now() + interval '7 days',
  accepted_at timestamptz,
  org_id      uuid        not null default public.get_current_org_id()
              references public.organizations(id) on delete set null,
  created_at  timestamptz default now()
);

create table public.invitation_emails (
  id            uuid        primary key default gen_random_uuid(),
  invitation_id uuid        not null references public.invitations(id) on delete cascade,
  email         text        not null,
  status        text        not null check (status in ('sent', 'failed')),
  error_msg     text,
  resend_id     text,
  sent_at       timestamptz not null default now()
);

-- ── Audit Log ─────────────────────────────────────────────────────────────────
create table public.audit_log (
  id         uuid        default gen_random_uuid() primary key,
  user_id    uuid        references public.profiles(id) on delete set null,
  action     text        not null,
  table_name text,
  record_id  uuid,
  old_data   jsonb,
  new_data   jsonb,
  org_id     uuid        references public.organizations(id) on delete set null,
  created_at timestamptz default now()
);

-- ── Field-Level Change Log ────────────────────────────────────────────────────
create table public.field_changes (
  id         uuid        default gen_random_uuid() primary key,
  user_id    uuid        references public.profiles(id) on delete set null,
  table_name text        not null,
  record_id  text        not null,
  field_name text        not null,
  old_value  text,
  new_value  text,
  org_id     uuid        references public.organizations(id) on delete set null,
  changed_at timestamptz default now()
);

-- ── Audit Maintenance Log (N-3) ───────────────────────────────────────────────
create table public.audit_maintenance_log (
  id                        uuid        default gen_random_uuid() primary key,
  run_at                    timestamptz default now() not null,
  retention_interval        interval    not null,
  audit_rows_deleted        bigint      not null default 0,
  field_change_rows_deleted bigint      not null default 0,
  performed_by              uuid        references public.profiles(id) on delete set null
);

-- ── GDPR Erasure Requests (N-4) ───────────────────────────────────────────────
create table public.gdpr_erasure_requests (
  id                            uuid        default gen_random_uuid() primary key,
  org_id                        uuid        not null default public.get_current_org_id()
                                references public.organizations(id) on delete cascade,
  requested_by                  uuid        references public.profiles(id) on delete set null,
  -- plain uuid, not FK: the profile may be deleted as part of erasure
  target_user_id                uuid        not null,
  requested_at                  timestamptz default now() not null,
  completed_at                  timestamptz,
  notes                         text,
  anonymized_audit_count        bigint      default 0 not null,
  anonymized_field_change_count bigint      default 0 not null
);

-- ── Category Opening Balances ─────────────────────────────────────────────────
create table public.category_opening_balances (
  id             uuid        default gen_random_uuid() primary key,
  category_id    uuid        not null references public.categories(id) on delete cascade,
  budget_portion text        not null
                 check (budget_portion in ('Percentage Allocation','Specific Seed','Savings')),
  amount         numeric(15,2) not null default 0
                 check (amount >= 0 and amount != 'NaN'::numeric),
  org_id         uuid        not null default public.get_current_org_id()
                 references public.organizations(id) on delete set null,
  created_at     timestamptz default now(),
  unique (category_id, budget_portion)
);

-- ── Report Templates ──────────────────────────────────────────────────────────
create table public.report_templates (
  id          uuid        default gen_random_uuid() primary key,
  name        text        not null,
  description text,
  layout      jsonb       not null default '{}',
  created_by  uuid        references public.profiles(id) on delete set null,
  org_id      uuid        not null default public.get_current_org_id()
              references public.organizations(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── Transaction Allocation Snapshots ─────────────────────────────────────────
create table public.transaction_allocation_snapshots (
  id                uuid        primary key default gen_random_uuid(),
  transaction_id    uuid        not null references public.inflow_transactions(id) on delete cascade,
  config_version_id uuid        references public.allocation_configs(id) on delete restrict,
  config_group_id   uuid        references public.special_config_groups(id) on delete set null,
  resolved_rows     jsonb       not null default '[]',
  allocation_type   text,
  org_id            uuid        not null default public.get_current_org_id()
                    references public.organizations(id) on delete set null,
  is_recalculated   boolean     not null default false,
  recalculated_at   timestamptz,
  created_at        timestamptz not null default now(),
  unique (transaction_id)
);

-- ── Recalculation Logs (append-only) ─────────────────────────────────────────
create table public.recalculation_logs (
  id                uuid        primary key default gen_random_uuid(),
  config_group_id   uuid        references public.special_config_groups(id) on delete set null,
  config_version_id uuid        references public.allocation_configs(id) on delete set null,
  performed_by      uuid        references public.profiles(id) on delete set null,
  performed_at      timestamptz not null default now(),
  affected_count    integer     not null default 0,
  reason            text,
  action_summary    text        not null,
  org_id            uuid        not null default public.get_current_org_id()
                    references public.organizations(id) on delete set null
);

-- ── Dynamic Reports ───────────────────────────────────────────────────────────
create table public.dynamic_reports (
  id         uuid        primary key default gen_random_uuid(),
  title      text        not null default 'Untitled Report',
  created_by uuid        references public.profiles(id) on delete set null,
  org_id     uuid        not null default public.get_current_org_id()
             references public.organizations(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.dynamic_report_blocks (
  id          uuid    primary key default gen_random_uuid(),
  report_id   uuid    not null references public.dynamic_reports(id) on delete cascade,
  block_type  text    not null check (block_type in ('text', 'metric', 'table', 'formula')),
  position    integer not null default 0,
  config_json jsonb   not null default '{}',
  created_at  timestamptz default now()
);

create table public.dynamic_report_snapshots (
  id          uuid        primary key default gen_random_uuid(),
  report_id   uuid        not null references public.dynamic_reports(id) on delete cascade,
  label       text        not null,
  snapshot_at timestamptz not null default now(),
  data        jsonb       not null default '{}',
  created_at  timestamptz default now()
);

-- ── Currencies ───────────────────────────────────────────────────────────────
create table public.currencies (
  code       text    primary key,
  name       text    not null,
  symbol     text    not null default '',
  flag       text,
  is_active  boolean not null default true,
  sort_order integer not null default 99
);

-- ── User Preferences ──────────────────────────────────────────────────────────
create table public.user_preferences (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  org_id      uuid        not null references public.organizations(id) on delete cascade,
  preferences jsonb       not null default '{}',
  updated_at  timestamptz not null default now(),
  unique (user_id, org_id)
);

-- ── Org Deletion Backups ──────────────────────────────────────────────────────
create table public.org_deletion_backups (
  id              uuid        primary key default gen_random_uuid(),
  org_id          uuid        not null references public.organizations(id) on delete cascade,
  created_by      uuid        references public.profiles(id) on delete set null,
  backup_path     text        not null,
  file_size_bytes bigint,
  status          text        not null default 'available'
                  check (status in ('generating', 'available', 'expired', 'failed')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);

-- ================================================================
-- 7. SEED DATA
-- Bootstrap org must exist BEFORE any INSERT that relies on
-- get_current_org_id() returning a non-null value.
-- ================================================================

insert into public.organizations (name, slug, metadata, onboarding_complete)
values ('My Church', 'primary', '{"bootstrap": true}'::jsonb, true)
on conflict (slug) do nothing;

-- Default outflow type per org (keyed on org_id + name).
insert into public.outflow_types (org_id, name, color, is_system, is_locked)
select id, 'General', '#64748b', true, true
from   public.organizations
where  slug = 'primary'
on conflict (org_id, name) do update set is_system = true, is_locked = true;

-- ================================================================
-- 8. ENABLE ROW LEVEL SECURITY
-- All tables must have RLS enabled before policies are attached.
-- ================================================================

alter table public.profiles                       enable row level security;
alter table public.organizations                  enable row level security;
alter table public.org_members                    enable row level security;
alter table public.special_config_groups          enable row level security;
alter table public.category_groups                enable row level security;
alter table public.categories                     enable row level security;
alter table public.banks                          enable row level security;
alter table public.allocation_configs             enable row level security;
alter table public.income_types                   enable row level security;
alter table public.income_type_rules              enable row level security;
alter table public.outflow_types                  enable row level security;
alter table public.category_outflow_type_map      enable row level security;
alter table public.accounts                       enable row level security;
alter table public.ledger_entries                 enable row level security;
alter table public.special_projects               enable row level security;
alter table public.project_entries                enable row level security;
alter table public.departments                    enable row level security;
alter table public.inflow_transactions            enable row level security;
alter table public.outflow_transactions           enable row level security;
alter table public.intra_flows                    enable row level security;
alter table public.fx_transactions                enable row level security;
alter table public.fx_conversions                 enable row level security;
alter table public.bank_deposits                  enable row level security;
alter table public.intrabank_transfers            enable row level security;
alter table public.receipts                       enable row level security;
alter table public.invitations                    enable row level security;
alter table public.invitation_emails              enable row level security;
alter table public.audit_log                      enable row level security;
alter table public.field_changes                  enable row level security;
alter table public.audit_maintenance_log          enable row level security;
alter table public.gdpr_erasure_requests          enable row level security;
alter table public.category_opening_balances      enable row level security;
alter table public.report_templates               enable row level security;
alter table public.transaction_allocation_snapshots enable row level security;
alter table public.recalculation_logs             enable row level security;
alter table public.dynamic_reports                enable row level security;
alter table public.dynamic_report_blocks          enable row level security;
alter table public.dynamic_report_snapshots       enable row level security;
alter table public.currencies                     enable row level security;
alter table public.user_preferences               enable row level security;
alter table public.org_deletion_backups           enable row level security;

-- ================================================================
-- 9. RLS POLICIES
-- All helper functions exist (Section 4).
-- All org_id columns exist (Section 6).
-- ================================================================

-- ── profiles (no org_id — global user registry) ───────────────────────────────

-- Restricted to own row or a user who shares an active org (no cross-org PII).
-- Username login resolves via resolve_username() SECURITY DEFINER RPC, not this.
create policy "profiles_select" on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from   public.org_members caller
      join   public.org_members target
        on   target.org_id = caller.org_id
      where  caller.user_id = auth.uid()
        and  caller.status  = 'active'
        and  target.user_id = profiles.id
        and  target.status  = 'active'
    )
  );

create policy "profiles_insert" on public.profiles
  for insert with check (auth.uid() is not null);

create policy "profiles_update_self" on public.profiles
  for update
  using  (id = auth.uid())
  with check (
    id   = auth.uid()
    and  role = (select p.role from public.profiles p where p.id = auth.uid())
  );

-- Admin can update a profile only if they share an active org with the target.
-- WITH CHECK prevents role escalation: admin cannot change another user's role column.
create policy "profiles_update_admin" on public.profiles
  for update using (
    exists (
      select 1 from public.org_members caller
      join   public.org_members target
        on   target.org_id  = caller.org_id
        and  target.user_id = profiles.id
        and  target.status  = 'active'
      where  caller.user_id = auth.uid()
        and  caller.role    in ('owner', 'admin')
        and  caller.status  = 'active'
    )
  )
  with check (
    role = (select p2.role from public.profiles p2 where p2.id = profiles.id)
    and exists (
      select 1 from public.org_members caller
      join   public.org_members target
        on   target.org_id  = caller.org_id
        and  target.user_id = profiles.id
        and  target.status  = 'active'
      where  caller.user_id = auth.uid()
        and  caller.role    in ('owner', 'admin')
        and  caller.status  = 'active'
    )
  );

create policy "profiles_delete" on public.profiles
  for delete using (
    exists (
      select 1 from public.org_members caller
      join   public.org_members target
        on   target.org_id  = caller.org_id
        and  target.user_id = profiles.id
        and  target.status  = 'active'
      where  caller.user_id = auth.uid()
        and  caller.role    in ('owner', 'admin')
        and  caller.status  = 'active'
    )
  );

-- ── organizations ──────────────────────────────────────────────────────────────

create policy "orgs_select" on public.organizations
  for select using (public.is_org_member(id));

create policy "orgs_insert" on public.organizations
  for insert with check (false);

create policy "orgs_update" on public.organizations
  for update using (public.is_org_admin(id));

create policy "orgs_delete" on public.organizations
  for delete using (public.is_org_admin(id));

-- ── org_members ────────────────────────────────────────────────────────────────

create policy "org_members_select" on public.org_members
  for select using (public.is_org_member(org_id));

create policy "org_members_insert" on public.org_members
  for insert with check (public.is_org_admin(org_id));

create policy "org_members_update" on public.org_members
  for update using (public.is_org_admin(org_id));

create policy "org_members_delete" on public.org_members
  for delete using (public.is_org_admin(org_id));

-- ── special_config_groups ──────────────────────────────────────────────────────

create policy "scg_select" on public.special_config_groups
  for select using (public.is_org_member(org_id));
create policy "scg_insert" on public.special_config_groups
  for insert with check (public.is_org_admin(org_id));
create policy "scg_update" on public.special_config_groups
  for update using (public.is_org_admin(org_id));
create policy "scg_delete" on public.special_config_groups
  for delete using (public.is_org_admin(org_id));

-- ── category_groups ────────────────────────────────────────────────────────────

create policy "category_groups_select" on public.category_groups
  for select using (public.is_org_member(org_id));
create policy "category_groups_insert" on public.category_groups
  for insert with check (public.is_org_admin(org_id));
create policy "category_groups_update" on public.category_groups
  for update using (public.is_org_admin(org_id));
create policy "category_groups_delete" on public.category_groups
  for delete using (public.is_org_admin(org_id));

-- ── categories ─────────────────────────────────────────────────────────────────

create policy "categories_select" on public.categories
  for select using (public.is_org_member(org_id));
create policy "categories_insert" on public.categories
  for insert with check (public.is_org_finance_user(org_id));
create policy "categories_update" on public.categories
  for update using (public.is_org_finance_user(org_id));
create policy "categories_delete" on public.categories
  for delete using (public.is_org_admin(org_id));

-- ── banks ──────────────────────────────────────────────────────────────────────

create policy "banks_select" on public.banks
  for select using (public.is_org_member(org_id));
create policy "banks_insert" on public.banks
  for insert with check (public.is_org_admin(org_id));
create policy "banks_update" on public.banks
  for update using (public.is_org_admin(org_id));
create policy "banks_delete" on public.banks
  for delete using (public.is_org_admin(org_id));

-- ── allocation_configs ─────────────────────────────────────────────────────────

create policy "allocation_configs_select" on public.allocation_configs
  for select using (public.is_org_member(org_id));
create policy "allocation_configs_insert" on public.allocation_configs
  for insert with check (public.is_org_finance_user(org_id));
create policy "allocation_configs_update" on public.allocation_configs
  for update using (public.is_org_finance_user(org_id));
create policy "allocation_configs_delete" on public.allocation_configs
  for delete using (public.is_org_admin(org_id));

-- ── income_types ───────────────────────────────────────────────────────────────

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

-- ── outflow_types ──────────────────────────────────────────────────────────────

create policy "outflow_types_select" on public.outflow_types
  for select using (public.is_org_member(org_id));
create policy "outflow_types_insert" on public.outflow_types
  for insert with check (public.is_org_finance_user(org_id));
create policy "outflow_types_update" on public.outflow_types
  for update using (public.is_org_finance_user(org_id));
create policy "outflow_types_delete" on public.outflow_types
  for delete using (public.is_org_admin(org_id));

-- ── category_outflow_type_map ──────────────────────────────────────────────────

create policy "cotm_select" on public.category_outflow_type_map
  for select using (public.is_org_member(org_id));
create policy "cotm_insert" on public.category_outflow_type_map
  for insert with check (public.is_org_finance_user(org_id));
create policy "cotm_delete" on public.category_outflow_type_map
  for delete using (public.is_org_finance_user(org_id));

-- ── accounts ───────────────────────────────────────────────────────────────────

create policy "accounts_select" on public.accounts
  for select using (public.is_org_member(org_id));
create policy "accounts_insert" on public.accounts
  for insert with check (public.is_org_admin(org_id));
create policy "accounts_update" on public.accounts
  for update using (public.is_org_admin(org_id));
create policy "accounts_delete" on public.accounts
  for delete using (public.is_org_admin(org_id));

-- ── ledger_entries ─────────────────────────────────────────────────────────────

create policy "ledger_select" on public.ledger_entries
  for select using (public.is_org_member(org_id));
create policy "ledger_insert" on public.ledger_entries
  for insert with check (public.is_org_finance_user(org_id));
create policy "ledger_update" on public.ledger_entries
  for update using (public.is_org_finance_user(org_id));
create policy "ledger_delete" on public.ledger_entries
  for delete using (public.is_org_admin(org_id));

-- ── special_projects ───────────────────────────────────────────────────────────

create policy "projects_select" on public.special_projects
  for select using (public.is_org_member(org_id));
create policy "projects_insert" on public.special_projects
  for insert with check (public.is_org_admin(org_id));
create policy "projects_update" on public.special_projects
  for update using (public.is_org_admin(org_id));
create policy "projects_delete" on public.special_projects
  for delete using (public.is_org_admin(org_id));

-- ── project_entries ────────────────────────────────────────────────────────────

create policy "project_entries_select" on public.project_entries
  for select using (public.is_org_member(org_id));
create policy "project_entries_insert" on public.project_entries
  for insert with check (public.is_org_finance_user(org_id));
create policy "project_entries_update" on public.project_entries
  for update using (public.is_org_finance_user(org_id));
create policy "project_entries_delete" on public.project_entries
  for delete using (public.is_org_admin(org_id));

-- ── departments ────────────────────────────────────────────────────────────────

create policy "departments_select" on public.departments
  for select using (public.is_org_member(org_id));
create policy "departments_insert" on public.departments
  for insert with check (public.is_org_finance_user(org_id));
create policy "departments_update" on public.departments
  for update using (public.is_org_finance_user(org_id));
create policy "departments_delete" on public.departments
  for delete using (public.is_org_admin(org_id));

-- ── inflow_transactions ────────────────────────────────────────────────────────

create policy "inflow_select" on public.inflow_transactions
  for select using (public.is_org_member(org_id));
create policy "inflow_insert" on public.inflow_transactions
  for insert with check (public.is_org_finance_user(org_id));
create policy "inflow_update" on public.inflow_transactions
  for update using (public.is_org_finance_user(org_id));
create policy "inflow_delete" on public.inflow_transactions
  for delete using (public.is_org_finance_user(org_id));

-- ── outflow_transactions ───────────────────────────────────────────────────────

create policy "outflow_select" on public.outflow_transactions
  for select using (public.is_org_member(org_id));
create policy "outflow_insert" on public.outflow_transactions
  for insert with check (public.is_org_finance_user(org_id));
create policy "outflow_update" on public.outflow_transactions
  for update using (public.is_org_finance_user(org_id));
create policy "outflow_delete" on public.outflow_transactions
  for delete using (public.is_org_finance_user(org_id));

-- ── intra_flows ────────────────────────────────────────────────────────────────

create policy "intraflow_select" on public.intra_flows
  for select using (public.is_org_member(org_id));
create policy "intraflow_insert" on public.intra_flows
  for insert with check (public.is_org_finance_user(org_id));
create policy "intraflow_update" on public.intra_flows
  for update using (public.is_org_finance_user(org_id));
create policy "intraflow_delete" on public.intra_flows
  for delete using (public.is_org_finance_user(org_id));

-- ── fx_transactions ────────────────────────────────────────────────────────────

create policy "fx_select" on public.fx_transactions
  for select using (public.is_org_member(org_id));
create policy "fx_insert" on public.fx_transactions
  for insert with check (public.is_org_finance_user(org_id));
create policy "fx_update" on public.fx_transactions
  for update using (public.is_org_finance_user(org_id));
create policy "fx_delete" on public.fx_transactions
  for delete using (public.is_org_admin(org_id));

-- ── fx_conversions ─────────────────────────────────────────────────────────────

create policy "fxc_select" on public.fx_conversions
  for select using (public.is_org_member(org_id));
create policy "fxc_insert" on public.fx_conversions
  for insert with check (public.is_org_finance_user(org_id));
create policy "fxc_update" on public.fx_conversions
  for update using (public.is_org_finance_user(org_id));
create policy "fxc_delete" on public.fx_conversions
  for delete using (public.is_org_admin(org_id));

-- ── bank_deposits ──────────────────────────────────────────────────────────────

create policy "bank_deposits_select" on public.bank_deposits
  for select using (public.is_org_member(org_id));
create policy "bank_deposits_insert" on public.bank_deposits
  for insert with check (public.is_org_finance_user(org_id));
create policy "bank_deposits_update" on public.bank_deposits
  for update using (public.is_org_finance_user(org_id));
create policy "bank_deposits_delete" on public.bank_deposits
  for delete using (public.is_org_admin(org_id));

-- ── intrabank_transfers ────────────────────────────────────────────────────────

create policy "intrabank_select" on public.intrabank_transfers
  for select using (public.is_org_member(org_id));
create policy "intrabank_insert" on public.intrabank_transfers
  for insert with check (public.is_org_finance_user(org_id));
create policy "intrabank_update" on public.intrabank_transfers
  for update using (public.is_org_finance_user(org_id));
create policy "intrabank_delete" on public.intrabank_transfers
  for delete using (public.is_org_admin(org_id));

-- ── receipts ───────────────────────────────────────────────────────────────────

create policy "receipts_select" on public.receipts
  for select using (public.is_org_member(org_id));
create policy "receipts_insert" on public.receipts
  for insert with check (public.is_org_finance_user(org_id));
create policy "receipts_delete" on public.receipts
  for delete using (public.is_org_finance_user(org_id));

-- ── invitations ────────────────────────────────────────────────────────────────
-- Token reads go exclusively through get_invitation_by_token() SECURITY DEFINER.

create policy "invitations_select" on public.invitations
  for select using (public.is_org_admin(org_id));
create policy "invitations_insert" on public.invitations
  for insert with check (public.is_org_admin(org_id));
create policy "invitations_update" on public.invitations
  for update using (public.is_org_admin(org_id));
create policy "invitations_delete" on public.invitations
  for delete using (public.is_org_admin(org_id));

-- ── invitation_emails ──────────────────────────────────────────────────────────
-- Service role (edge function) bypasses RLS for INSERT.

-- Scoped to admins of the invitation's own org (no cross-org read).
create policy "invitation_emails_admin_read" on public.invitation_emails
  for select using (
    exists (
      select 1 from public.invitations i
      where  i.id = invitation_emails.invitation_id
        and  public.is_org_admin(i.org_id)
    )
  );

-- ── audit_log (org-scoped since migration 20260602000002) ─────────────────────

create policy "audit_select" on public.audit_log
  for select using (
    org_id is not null
    and public.is_org_member(org_id)
    and public.is_org_admin(org_id)
  );

create policy "audit_insert" on public.audit_log
  for insert with check (
    org_id is not null and public.is_org_member(org_id)
  );

-- No client DELETE policy: audit_log is append-only from the client.
-- Retention cleanup runs via purge_old_audit_logs() (SECURITY DEFINER).

-- ── field_changes (org-scoped since migration 20260602000002) ─────────────────

create policy "field_changes_select" on public.field_changes
  for select using (
    org_id is not null
    and public.is_org_member(org_id)
    and public.is_org_admin(org_id)
  );

create policy "field_changes_insert" on public.field_changes
  for insert with check (
    org_id is not null and public.is_org_member(org_id)
  );

-- No client DELETE policy: field_changes is append-only from the client.
-- Retention cleanup runs via SECURITY DEFINER maintenance only.

-- ── audit_maintenance_log (N-3) ───────────────────────────────────────────────

create policy "aml_admin_read" on public.audit_maintenance_log
  for select using (public.is_admin());

-- ── gdpr_erasure_requests (N-4) ──────────────────────────────────────────────

create policy "gdpr_req_select" on public.gdpr_erasure_requests
  for select using (public.is_org_admin(org_id));

create policy "gdpr_req_insert" on public.gdpr_erasure_requests
  for insert with check (public.is_org_admin(org_id));

-- ── category_opening_balances ──────────────────────────────────────────────────

create policy "cob_select" on public.category_opening_balances
  for select using (public.is_org_member(org_id));
create policy "cob_insert" on public.category_opening_balances
  for insert with check (public.is_org_finance_user(org_id));
create policy "cob_update" on public.category_opening_balances
  for update using (public.is_org_finance_user(org_id));
create policy "cob_delete" on public.category_opening_balances
  for delete using (public.is_org_admin(org_id));

-- ── report_templates ───────────────────────────────────────────────────────────

create policy "report_templates_select" on public.report_templates
  for select using (public.is_org_member(org_id));
create policy "report_templates_insert" on public.report_templates
  for insert with check (public.is_org_finance_user(org_id));
create policy "report_templates_update" on public.report_templates
  for update using (public.is_org_finance_user(org_id));
create policy "report_templates_delete" on public.report_templates
  for delete using (public.is_org_admin(org_id));

-- ── transaction_allocation_snapshots ──────────────────────────────────────────

create policy "tas_select" on public.transaction_allocation_snapshots
  for select using (public.is_org_member(org_id));
create policy "tas_insert" on public.transaction_allocation_snapshots
  for insert with check (public.is_org_finance_user(org_id));
create policy "tas_update" on public.transaction_allocation_snapshots
  for update using (public.is_org_finance_user(org_id));
create policy "tas_delete" on public.transaction_allocation_snapshots
  for delete using (public.is_org_admin(org_id));

-- ── recalculation_logs (append-only) ──────────────────────────────────────────

create policy "rl_select" on public.recalculation_logs
  for select using (public.is_org_member(org_id));
create policy "rl_insert" on public.recalculation_logs
  for insert with check (public.is_org_finance_user(org_id));

-- ── dynamic_reports ────────────────────────────────────────────────────────────

create policy "dr_select" on public.dynamic_reports
  for select using (public.is_org_member(org_id));
create policy "dr_insert" on public.dynamic_reports
  for insert with check (public.is_org_finance_user(org_id));
create policy "dr_update" on public.dynamic_reports
  for update using (public.is_org_finance_user(org_id));
create policy "dr_delete" on public.dynamic_reports
  for delete using (public.is_org_admin(org_id));

-- ── dynamic_report_blocks (isolate via parent dynamic_reports) ─────────────────

create policy "drb_select" on public.dynamic_report_blocks
  for select using (
    exists (
      select 1 from public.dynamic_reports dr
      join   public.org_members m
        on   m.org_id = dr.org_id and m.user_id = auth.uid() and m.status = 'active'
      where  dr.id = report_id
    )
  );
create policy "drb_insert" on public.dynamic_report_blocks
  for insert with check (
    exists (
      select 1 from public.dynamic_reports dr
      join   public.org_members m
        on   m.org_id = dr.org_id and m.user_id = auth.uid()
        and  m.role   in ('owner', 'admin', 'accountant') and m.status = 'active'
      where  dr.id = report_id
    )
  );
create policy "drb_update" on public.dynamic_report_blocks
  for update using (
    exists (
      select 1 from public.dynamic_reports dr
      join   public.org_members m
        on   m.org_id = dr.org_id and m.user_id = auth.uid()
        and  m.role   in ('owner', 'admin', 'accountant') and m.status = 'active'
      where  dr.id = report_id
    )
  );
create policy "drb_delete" on public.dynamic_report_blocks
  for delete using (
    exists (
      select 1 from public.dynamic_reports dr
      join   public.org_members m
        on   m.org_id = dr.org_id and m.user_id = auth.uid()
        and  m.role   in ('owner', 'admin', 'accountant') and m.status = 'active'
      where  dr.id = report_id
    )
  );

-- ── dynamic_report_snapshots (isolate via parent dynamic_reports) ──────────────

create policy "drs_select" on public.dynamic_report_snapshots
  for select using (
    exists (
      select 1 from public.dynamic_reports dr
      join   public.org_members m
        on   m.org_id = dr.org_id and m.user_id = auth.uid() and m.status = 'active'
      where  dr.id = report_id
    )
  );
create policy "drs_insert" on public.dynamic_report_snapshots
  for insert with check (
    exists (
      select 1 from public.dynamic_reports dr
      join   public.org_members m
        on   m.org_id = dr.org_id and m.user_id = auth.uid()
        and  m.role   in ('owner', 'admin', 'accountant') and m.status = 'active'
      where  dr.id = report_id
    )
  );
create policy "drs_delete" on public.dynamic_report_snapshots
  for delete using (
    exists (
      select 1 from public.dynamic_reports dr
      join   public.org_members m
        on   m.org_id = dr.org_id and m.user_id = auth.uid()
        and  m.role   in ('owner', 'admin') and m.status = 'active'
      where  dr.id = report_id
    )
  );

-- Atomic replacement of a report's blocks (delete + insert in one transaction).
-- SECURITY INVOKER: runs under the caller's RLS, preserving tenant isolation.
create or replace function public.save_dynamic_report_blocks(
  p_report_id uuid,
  p_blocks    jsonb
)
returns void
language plpgsql
as $$
declare
  v_block jsonb;
  v_pos   int := 0;
begin
  delete from public.dynamic_report_blocks where report_id = p_report_id;

  for v_block in select * from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb))
  loop
    insert into public.dynamic_report_blocks (report_id, block_type, position, config_json)
    values (
      p_report_id,
      v_block->>'block_type',
      v_pos,
      coalesce(v_block->'config_json', '{}'::jsonb)
    );
    v_pos := v_pos + 1;
  end loop;
end;
$$;

grant execute on function public.save_dynamic_report_blocks(uuid, jsonb) to authenticated;

-- ── currencies ─────────────────────────────────────────────────────────────────

create policy "currencies_select" on public.currencies
  for select using (auth.role() = 'authenticated');
create policy "currencies_insert" on public.currencies
  for insert with check (public.is_admin());
create policy "currencies_update" on public.currencies
  for update using (public.is_admin());
create policy "currencies_delete" on public.currencies
  for delete using (public.is_admin());

-- ── user_preferences ───────────────────────────────────────────────────────────

create policy "user_preferences_select_own" on public.user_preferences
  for select using (user_id = auth.uid());
create policy "user_preferences_insert_own" on public.user_preferences
  for insert with check (user_id = auth.uid());
create policy "user_preferences_update_own" on public.user_preferences
  for update using (user_id = auth.uid());
create policy "user_preferences_delete_own" on public.user_preferences
  for delete using (user_id = auth.uid());

-- ── org_deletion_backups ───────────────────────────────────────────────────────

create policy "del_backup_owner_select" on public.org_deletion_backups
  for select using (
    exists (
      select 1 from public.org_members
      where org_id  = org_deletion_backups.org_id
        and user_id = auth.uid()
        and role    = 'owner'
        and status  = 'active'
    )
  );

-- SECURITY DEFINER RPCs perform inserts; direct client inserts blocked.
create policy "del_backup_rpc_insert" on public.org_deletion_backups
  for insert with check (false);

create policy "del_backup_owner_delete" on public.org_deletion_backups
  for delete using (
    exists (
      select 1 from public.org_members
      where org_id  = org_deletion_backups.org_id
        and user_id = auth.uid()
        and role    = 'owner'
        and status  = 'active'
    )
  );

-- ================================================================
-- 10. INDEXES
-- ================================================================

create index if not exists idx_inflow_date            on public.inflow_transactions(date);
create index if not exists idx_outflow_date           on public.outflow_transactions(date);
create index if not exists idx_intra_date             on public.intra_flows(date);
create index if not exists idx_bank_dep_date          on public.bank_deposits(date);
create index if not exists idx_intrabank_date         on public.intrabank_transfers(date);
create index if not exists idx_inflow_import_seq        on public.inflow_transactions(import_seq);
create index if not exists idx_outflow_import_seq       on public.outflow_transactions(import_seq);
create index if not exists idx_fx_import_seq            on public.fx_transactions(import_seq);
create index if not exists idx_intraflow_import_seq     on public.intra_flows(import_seq);
create index if not exists idx_bank_deposits_import_seq on public.bank_deposits(import_seq);
create index if not exists idx_intrabank_import_seq     on public.intrabank_transfers(import_seq);
create index if not exists idx_project_entries_import_seq on public.project_entries(import_seq);
create index if not exists idx_fx_date                on public.fx_transactions(date);
create index if not exists idx_project_entries        on public.project_entries(project_id);
create index if not exists idx_receipts_entity        on public.receipts(entity_type, entity_id);
create index if not exists idx_field_changes          on public.field_changes(table_name, record_id);
create index if not exists idx_income_type_rules      on public.income_type_rules(income_type_id);
create index if not exists idx_inflow_income_type     on public.inflow_transactions(income_type_id);
create index if not exists idx_inflow_txn_type        on public.inflow_transactions(transaction_type);
create index if not exists idx_outflow_txn_type       on public.outflow_transactions(transaction_type);
create index if not exists idx_inflow_root_txn_id     on public.inflow_transactions(root_transaction_id) where root_transaction_id is not null;
create index if not exists idx_outflow_root_txn_id    on public.outflow_transactions(root_transaction_id) where root_transaction_id is not null;
create index if not exists idx_inflow_offset_role     on public.inflow_transactions(offset_role) where offset_role is not null;
create index if not exists idx_outflow_offset_role    on public.outflow_transactions(offset_role) where offset_role is not null;
create index if not exists idx_inflow_deposit_group   on public.inflow_transactions(deposit_group_id) where deposit_group_id is not null;
create index if not exists idx_outflow_deposit_group  on public.outflow_transactions(deposit_group_id) where deposit_group_id is not null;
create index if not exists idx_categories_group       on public.categories(group_id);
create index if not exists idx_invitations_token      on public.invitations(token);
create index if not exists idx_outflow_department_id  on public.outflow_transactions(department_id);
create index if not exists idx_invitation_emails_invitation on public.invitation_emails(invitation_id);
create index if not exists idx_invitation_emails_sent_at    on public.invitation_emails(sent_at desc);
create index if not exists idx_cob_category           on public.category_opening_balances(category_id);
create index if not exists idx_report_templates_user  on public.report_templates(created_by);
create index if not exists idx_alloc_config_group     on public.allocation_configs(config_group_id);
create index if not exists idx_drb_report_position    on public.dynamic_report_blocks(report_id, position);
create index if not exists idx_drs_report_at          on public.dynamic_report_snapshots(report_id, snapshot_at desc);
create index if not exists idx_intra_batch            on public.intra_flows(batch_id);
create index if not exists idx_org_del_backups_org    on public.org_deletion_backups(org_id);
create index if not exists idx_org_del_backups_exp    on public.org_deletion_backups(expires_at);
create index if not exists idx_audit_log_org_id       on public.audit_log(org_id);
create index if not exists idx_audit_log_org_date     on public.audit_log(org_id, created_at desc);
create index if not exists idx_field_changes_org_id   on public.field_changes(org_id);
create index if not exists idx_field_changes_org_date on public.field_changes(org_id, changed_at desc);
create index if not exists idx_gdpr_erasure_org        on public.gdpr_erasure_requests(org_id);
create index if not exists idx_gdpr_erasure_user       on public.gdpr_erasure_requests(target_user_id);
create index if not exists idx_cotm_category          on public.category_outflow_type_map(category_id);
create index if not exists idx_cotm_type              on public.category_outflow_type_map(outflow_type_id);

-- Standalone org_id indexes
create index if not exists idx_inflow_org              on public.inflow_transactions(org_id);
create index if not exists idx_outflow_org             on public.outflow_transactions(org_id);
create index if not exists idx_intra_flows_org         on public.intra_flows(org_id);
create index if not exists idx_banks_org               on public.banks(org_id);
create index if not exists idx_categories_org          on public.categories(org_id);
create index if not exists idx_alloc_configs_org       on public.allocation_configs(org_id);
create index if not exists idx_fx_org                  on public.fx_transactions(org_id);
create index if not exists idx_bank_deposits_org       on public.bank_deposits(org_id);
create index if not exists idx_category_groups_org     on public.category_groups(org_id);
create index if not exists idx_income_types_org        on public.income_types(org_id);
create index if not exists idx_income_type_rules_org   on public.income_type_rules(org_id);
create index if not exists idx_intrabank_org           on public.intrabank_transfers(org_id);
create index if not exists idx_accounts_org            on public.accounts(org_id);
create index if not exists idx_ledger_entries_org      on public.ledger_entries(org_id);
create index if not exists idx_special_projects_org    on public.special_projects(org_id);
create index if not exists idx_project_entries_org     on public.project_entries(org_id);
create index if not exists idx_receipts_org            on public.receipts(org_id);
create index if not exists idx_invitations_org         on public.invitations(org_id);
create index if not exists idx_report_templates_org    on public.report_templates(org_id);
create index if not exists idx_special_config_groups_org on public.special_config_groups(org_id);
create index if not exists idx_tas_org                 on public.transaction_allocation_snapshots(org_id);
create index if not exists idx_recalc_logs_org         on public.recalculation_logs(org_id);
create index if not exists idx_dynamic_reports_org     on public.dynamic_reports(org_id);
create index if not exists idx_outflow_types_org       on public.outflow_types(org_id);
create index if not exists idx_cotm_org                on public.category_outflow_type_map(org_id);
create index if not exists idx_departments_org         on public.departments(org_id);
create index if not exists idx_cob_org                 on public.category_opening_balances(org_id);
create index if not exists idx_fx_conversions_org      on public.fx_conversions(org_id);
create index if not exists idx_departments_org_active  on public.departments(org_id, active);
create index if not exists user_preferences_user_id_idx on public.user_preferences (user_id);
create index if not exists user_preferences_org_id_idx  on public.user_preferences (org_id);

-- Composite (org_id, date) indexes for org-scoped date-range queries
create index if not exists idx_inflow_org_date       on public.inflow_transactions(org_id, date);
create index if not exists idx_outflow_org_date      on public.outflow_transactions(org_id, date);
create index if not exists idx_intra_org_date        on public.intra_flows(org_id, date);
create index if not exists idx_bank_dep_org_date     on public.bank_deposits(org_id, date);
create index if not exists idx_intrabank_org_date    on public.intrabank_transfers(org_id, date);
create index if not exists idx_fx_org_date           on public.fx_transactions(org_id, date);
create index if not exists idx_proj_entries_org_date on public.project_entries(org_id, date);
create index if not exists idx_ledger_org_date       on public.ledger_entries(org_id, date);
create index if not exists idx_fx_conversions_org_date on public.fx_conversions(org_id, date);

-- Additional composite indexes for common filter patterns
create index if not exists idx_outflow_types_org_name      on public.outflow_types(org_id, name);
create index if not exists idx_cotm_org_category           on public.category_outflow_type_map(org_id, category_id);
create index if not exists idx_dynamic_reports_org_updated on public.dynamic_reports(org_id, updated_at desc);
create index if not exists idx_report_templates_org_name   on public.report_templates(org_id, name);
create index if not exists idx_inflow_org_txn_type         on public.inflow_transactions(org_id, transaction_type);
create index if not exists idx_outflow_org_pending         on public.outflow_transactions(org_id, is_pending_deduction)
  where is_pending_deduction = true;
create index if not exists idx_alloc_configs_org_effective on public.allocation_configs(org_id, effective_from, effective_to);
create index if not exists idx_alloc_configs_group_date   on public.allocation_configs(config_group_id, status, effective_from, effective_to) where config_group_id is not null;
create unique index if not exists idx_alloc_configs_group_effrom_unique on public.allocation_configs(config_group_id, effective_from) where status = 'locked';
create index if not exists idx_receipts_org_entity         on public.receipts(org_id, entity_type, entity_id);
create index if not exists idx_intra_flows_org_batch       on public.intra_flows(org_id, batch_id)
  where batch_id is not null;
create index if not exists idx_tas_org_txn                 on public.transaction_allocation_snapshots(org_id, transaction_id);

-- Balance Brought Forward deduplication index
create unique index if not exists idx_inflow_bf_unique_bank
  on public.inflow_transactions (bank_name)
  where transaction_type = 'balance_brought_forward';

create index if not exists idx_inflow_bank_name   on public.inflow_transactions(bank_name);
create index if not exists idx_outflow_bank_name  on public.outflow_transactions(bank_name);

-- ================================================================
-- 11. RPCS, SECURITY FUNCTIONS AND GRANTS
-- ================================================================

-- ── Invitation helpers ────────────────────────────────────────────────────────

create or replace function public.get_invitation_by_token(p_token uuid)
returns table(
  id         uuid,
  email      text,
  role       text,
  org_id     uuid,
  org_name   text,
  status     text,
  expires_at timestamptz
)
language plpgsql security definer stable
as $$
begin
  return query
    select
      i.id,
      i.email,
      i.role,
      i.org_id,
      o.name as org_name,
      i.status,
      i.expires_at
    from   public.invitations i
    left join public.organizations o on o.id = i.org_id
    where  i.token      = p_token
      and  i.status     = 'pending'
      and  i.expires_at > now();
end;
$$;

-- Atomically accepts an invite: upserts org_members, syncs profiles.role, marks consumed.
create or replace function public.accept_invitation(p_token uuid, p_user_id uuid)
returns void language plpgsql security definer
as $$
declare
  v_invite public.invitations;
  v_org_id uuid;
begin
  if p_user_id != auth.uid() then
    raise exception 'Unauthorized';
  end if;

  select * into v_invite
  from   public.invitations
  where  token = p_token
  for update;

  if not found then
    raise exception 'Invalid or expired invitation';
  end if;

  v_org_id := v_invite.org_id;
  if v_org_id is null then
    select id into v_org_id from public.organizations where slug = 'primary' and status = 'active' limit 1;
  end if;
  if v_org_id is null then
    raise exception 'No active organisation found for invitation';
  end if;

  -- Verify the target org is still active before adding the member
  if not exists (select 1 from public.organizations where id = v_org_id and status = 'active') then
    raise exception 'The organisation for this invitation is no longer active';
  end if;

  if v_invite.status = 'accepted' then
    if v_org_id is not null and exists (
      select 1 from public.org_members
      where org_id = v_org_id and user_id = p_user_id and status = 'active'
    ) then
      return;
    end if;
    raise exception 'This invitation has already been used';
  end if;

  if v_invite.status = 'expired' or (v_invite.expires_at is not null and v_invite.expires_at <= now()) then
    raise exception 'This invitation has expired';
  end if;

  if v_invite.status != 'pending' then
    raise exception 'Invalid invitation';
  end if;

  if lower(v_invite.email) != lower((select email from auth.users where id = p_user_id)) then
    raise exception 'This invitation is for a different email address';
  end if;

  begin
    insert into public.profiles (id, email, full_name, username)
    select p_user_id,
           u.email,
           u.raw_user_meta_data->>'full_name',
           u.raw_user_meta_data->>'username'
    from   auth.users u
    where  u.id = p_user_id
    on conflict (id) do update
      set full_name = coalesce(excluded.full_name, profiles.full_name),
          username  = coalesce(excluded.username,  profiles.username);
  exception
    when unique_violation then
      raise warning '[accept_invitation] username conflict user=% — upserting without username', p_user_id;
      insert into public.profiles (id, email, full_name)
      select p_user_id, u.email, u.raw_user_meta_data->>'full_name'
      from   auth.users u
      where  u.id = p_user_id
      on conflict (id) do update
        set full_name = coalesce(excluded.full_name, profiles.full_name);
  end;

  begin
    update public.profiles
      set role       = v_invite.role,
          updated_at = now()
    where id = p_user_id;
  exception when others then
    raise warning '[accept_invitation] profiles.role update failed (non-fatal) user=% err=%', p_user_id, sqlerrm;
  end;

  if v_org_id is not null then
    insert into public.org_members (org_id, user_id, role, status)
    values (v_org_id, p_user_id, v_invite.role, 'active')
    on conflict (org_id, user_id) do update
      set role   = excluded.role,
          status = 'active';
  else
    raise warning '[accept_invitation] no org found — org_members skipped user=% token=%', p_user_id, p_token;
  end if;

  update public.invitations
    set status      = 'accepted',
        accepted_at = now()
  where token = p_token;
end;
$$;

-- ── Server-side audit trigger functions (LB-9) ───────────────────────────────
-- SECURITY DEFINER: runs as postgres, bypasses RLS.
-- Captures auth.uid() + now() server-side; client cannot forge these.

create or replace function public.audit_trigger_fn()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user_id   uuid;
  v_org_id    uuid;
  v_record_id uuid;
  v_old_data  jsonb;
  v_new_data  jsonb;
  v_row_json  jsonb;
begin
  v_user_id := auth.uid();
  if TG_OP = 'DELETE' then
    v_row_json := row_to_json(OLD)::jsonb; v_old_data := v_row_json; v_new_data := null;
  elsif TG_OP = 'INSERT' then
    v_row_json := row_to_json(NEW)::jsonb; v_old_data := null; v_new_data := v_row_json;
  else
    v_row_json := row_to_json(NEW)::jsonb; v_old_data := row_to_json(OLD)::jsonb; v_new_data := v_row_json;
  end if;
  begin v_record_id := (v_row_json->>'id')::uuid; exception when others then v_record_id := null; end;
  begin v_org_id    := (v_row_json->>'org_id')::uuid; exception when others then v_org_id := null; end;
  insert into public.audit_log(user_id, action, table_name, record_id, old_data, new_data, org_id)
  values (v_user_id, TG_OP, TG_TABLE_NAME, v_record_id, v_old_data, v_new_data, v_org_id);
  return coalesce(NEW, OLD);
end;
$$;

create or replace function public.field_changes_trigger_fn()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user_id   uuid;
  v_org_id    uuid;
  v_record_id text;
  v_old_json  jsonb;
  v_new_json  jsonb;
  v_key       text;
  -- Metadata-only fields skipped to avoid noise rows on every touch-update
  v_skip      constant text[] := array[
    'updated_at', 'created_at', 'recorded_at',
    'recalculated_at', 'sent_at', 'snapshot_at', 'changed_at'
  ];
begin
  if TG_OP <> 'UPDATE' then return NEW; end if;
  v_user_id   := auth.uid();
  v_old_json  := row_to_json(OLD)::jsonb;
  v_new_json  := row_to_json(NEW)::jsonb;
  v_record_id := v_new_json->>'id';
  begin v_org_id := (v_new_json->>'org_id')::uuid; exception when others then v_org_id := null; end;
  for v_key in select key from jsonb_object_keys(v_new_json) as key loop
    continue when v_key = any(v_skip);
    if (v_old_json->>v_key) is distinct from (v_new_json->>v_key) then
      insert into public.field_changes(user_id, table_name, record_id, field_name, old_value, new_value, org_id)
      values (v_user_id, TG_TABLE_NAME, v_record_id, v_key, v_old_json->>v_key, v_new_json->>v_key, v_org_id);
    end if;
  end loop;
  return NEW;
end;
$$;

-- Audit triggers on all financial tables
create trigger trg_audit_inflow_transactions
  after insert or update or delete on public.inflow_transactions for each row execute function public.audit_trigger_fn();
create trigger trg_field_changes_inflow_transactions
  after update on public.inflow_transactions for each row execute function public.field_changes_trigger_fn();

create trigger trg_audit_outflow_transactions
  after insert or update or delete on public.outflow_transactions for each row execute function public.audit_trigger_fn();
create trigger trg_field_changes_outflow_transactions
  after update on public.outflow_transactions for each row execute function public.field_changes_trigger_fn();

create trigger trg_audit_intra_flows
  after insert or update or delete on public.intra_flows for each row execute function public.audit_trigger_fn();
create trigger trg_field_changes_intra_flows
  after update on public.intra_flows for each row execute function public.field_changes_trigger_fn();

create trigger trg_audit_banks
  after insert or update or delete on public.banks for each row execute function public.audit_trigger_fn();
create trigger trg_field_changes_banks
  after update on public.banks for each row execute function public.field_changes_trigger_fn();

create trigger trg_audit_categories
  after insert or update or delete on public.categories for each row execute function public.audit_trigger_fn();
create trigger trg_field_changes_categories
  after update on public.categories for each row execute function public.field_changes_trigger_fn();

create trigger trg_audit_allocation_configs
  after insert or update or delete on public.allocation_configs for each row execute function public.audit_trigger_fn();
create trigger trg_field_changes_allocation_configs
  after update on public.allocation_configs for each row execute function public.field_changes_trigger_fn();

create trigger trg_audit_fx_transactions
  after insert or update or delete on public.fx_transactions for each row execute function public.audit_trigger_fn();
create trigger trg_field_changes_fx_transactions
  after update on public.fx_transactions for each row execute function public.field_changes_trigger_fn();

create trigger trg_audit_bank_deposits
  after insert or update or delete on public.bank_deposits for each row execute function public.audit_trigger_fn();
create trigger trg_audit_intrabank_transfers
  after insert or update or delete on public.intrabank_transfers for each row execute function public.audit_trigger_fn();
create trigger trg_audit_accounts
  after insert or update or delete on public.accounts for each row execute function public.audit_trigger_fn();
create trigger trg_audit_ledger_entries
  after insert or update or delete on public.ledger_entries for each row execute function public.audit_trigger_fn();

-- Ledger balance auto-recompute: fires after any INSERT/UPDATE/DELETE on
-- ledger_entries, and when accounts.opening_balance changes.
create or replace function public.recalculate_ledger_balances(
  p_account_id uuid,
  p_org_id     uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_opening numeric(15,2) := 0;
begin
  select coalesce(opening_balance, 0) into v_opening
  from   public.accounts where id = p_account_id;
  v_opening := coalesce(v_opening, 0);
  with computed as (
    select id,
           v_opening + sum(
             coalesce(inflow, 0) + coalesce(refund_intraflow, 0) - coalesce(outflow, 0)
           ) over (
             order by date asc, created_at asc
             rows between unbounded preceding and current row
           ) as new_balance
    from   public.ledger_entries
    where  account_id = p_account_id and org_id = p_org_id
  )
  update public.ledger_entries e
  set    balance = c.new_balance
  from   computed c where e.id = c.id;
end;
$$;

create or replace function public.trg_ledger_balance_fn()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalculate_ledger_balances(old.account_id, old.org_id);
  elsif tg_op = 'UPDATE' and old.account_id is distinct from new.account_id then
    perform public.recalculate_ledger_balances(old.account_id, old.org_id);
    perform public.recalculate_ledger_balances(new.account_id, new.org_id);
  else
    perform public.recalculate_ledger_balances(new.account_id, new.org_id);
  end if;
  return null;
end;
$$;

create trigger trg_ledger_balance
  after insert or update or delete on public.ledger_entries
  for each row execute function public.trg_ledger_balance_fn();

create or replace function public.trg_account_opening_balance_fn()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.opening_balance is distinct from new.opening_balance then
    perform public.recalculate_ledger_balances(new.id, new.org_id);
  end if;
  return null;
end;
$$;

create trigger trg_account_opening_balance
  after update on public.accounts
  for each row execute function public.trg_account_opening_balance_fn();

-- Audit log delete immutability: rows can never be destroyed.
-- UPDATE is allowed so GDPR erasure can SET user_id = NULL.
-- purge_old_audit_logs() bypasses this guard via transaction-local session variable.
create or replace function public.audit_log_no_delete_fn()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.audit_maintenance', true) = 'true' then
    return OLD;
  end if;
  raise exception 'audit_log rows cannot be deleted';
end;
$$;

create trigger trg_audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.audit_log_no_delete_fn();

-- ── Org management RPCs ───────────────────────────────────────────────────────

create or replace function public.create_organization(p_name text)
returns uuid language plpgsql security definer as $$
declare
  v_user_id  uuid := auth.uid();
  v_org_id   uuid;
  v_slug     text;
  v_attempt  int  := 0;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if length(trim(p_name)) = 0 then raise exception 'Organisation name cannot be empty'; end if;

  v_slug := lower(regexp_replace(trim(p_name), '[^a-z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' or v_slug = 'primary' then v_slug := 'org'; end if;

  loop
    begin
      insert into public.organizations (name, slug, created_by, onboarding_complete)
      values (
        trim(p_name),
        case when v_attempt = 0 then v_slug else v_slug || '-' || v_attempt end,
        v_user_id,
        false
      )
      returning id into v_org_id;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 9 then raise exception 'Could not generate a unique slug for: %', p_name; end if;
    end;
  end loop;

  insert into public.org_members (org_id, user_id, role, status)
  values (v_org_id, v_user_id, 'owner', 'active')
  on conflict (org_id, user_id) do update set role = 'owner', status = 'active';

  -- Remove any viewer-role placeholder from the primary bootstrap org.
  delete from public.org_members
  where  org_id  = (select id from public.organizations where slug = 'primary' limit 1)
    and  user_id = v_user_id
    and  role    = 'viewer';

  return v_org_id;
end;
$$;

grant execute on function public.create_organization(text) to authenticated;

create or replace function public.complete_org_onboarding(
  p_org_id            uuid,
  p_name              text,
  p_default_currency  text,
  p_fiscal_year_start int  default 1,
  p_timezone          text default 'Africa/Lagos'
)
returns void language plpgsql security definer as $$
declare
  v_user_id  uuid := auth.uid();
  v_group_id uuid;
  v_org_date date;
begin
  if not exists (
    select 1 from public.org_members
    where org_id  = p_org_id
      and user_id = v_user_id
      and role    in ('owner', 'admin')
      and status  = 'active'
  ) then
    raise exception 'Unauthorized: only org admins can complete onboarding';
  end if;

  update public.organizations
  set name = trim(p_name), default_currency = p_default_currency,
      fiscal_year_start = p_fiscal_year_start, timezone = p_timezone,
      onboarding_complete = true, updated_at = now()
  where id = p_org_id;

  select created_at::date into v_org_date
  from public.organizations where id = p_org_id;

  -- Seed default income types
  if not exists (select 1 from public.income_types where org_id = p_org_id limit 1) then
    insert into public.income_types (org_id, name, color) values
      (p_org_id, 'Tithe',          '#6366f1'),
      (p_org_id, 'Offering',       '#10b981'),
      (p_org_id, 'Donation',       '#f59e0b'),
      (p_org_id, 'Special Giving', '#ec4899'),
      (p_org_id, 'Thanksgiving',   '#3b82f6'),
      (p_org_id, 'Project',        '#8b5cf6');
  end if;

  -- Seed system General outflow type
  insert into public.outflow_types (org_id, name, color, is_system, is_locked)
  values (p_org_id, 'General', '#64748b', true, true)
  on conflict (org_id, name) do nothing;

  -- Seed General category (is_default = true, fully visible to users)
  if not exists (
    select 1 from public.categories where org_id = p_org_id and is_default = true
  ) then
    insert into public.categories (org_id, name, is_default)
    values (p_org_id, 'General', true);
  end if;

  -- Get or create the General rule group (decoupled from draft-config creation)
  select id into v_group_id
  from public.special_config_groups
  where org_id = p_org_id and is_default = true
  limit 1;

  if v_group_id is null then
    insert into public.special_config_groups (org_id, name, is_default)
    values (p_org_id, 'General', true)
    returning id into v_group_id;
  end if;

  -- Ensure a draft config exists in the group, independently of whether the group
  -- was just created or already existed.
  if not exists (
    select 1 from public.allocation_configs
    where config_group_id = v_group_id and status = 'draft'
  ) then
    insert into public.allocation_configs (
      org_id, config_group_id, name,
      start_date, effective_from, effective_to,
      status, is_special, allocation_type, rows, version_number
    ) values (
      p_org_id, v_group_id, 'General Distribution Rule',
      v_org_date, v_org_date, null,
      'draft', false, 'percentage',
      '[]'::jsonb,
      1
    );
  end if;
end;
$$;

grant execute on function public.complete_org_onboarding(uuid, text, text, int, text) to authenticated;

create or replace function public.update_org_member_role(
  p_member_id uuid,
  p_new_role  text
)
returns void language plpgsql security definer as $$
declare
  v_member      public.org_members;
  v_caller_role text;
  v_owner_count int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_new_role not in ('owner', 'admin', 'accountant', 'viewer') then
    raise exception 'Invalid role: %', p_new_role;
  end if;

  select * into v_member from public.org_members where id = p_member_id;
  if not found then raise exception 'Member not found'; end if;

  select role into v_caller_role
  from   public.org_members
  where  org_id = v_member.org_id and user_id = auth.uid() and status = 'active';

  if v_caller_role is null or v_caller_role not in ('owner', 'admin') then
    raise exception 'Unauthorized: only org owners and admins can change roles';
  end if;

  if v_caller_role = 'admin' and p_new_role = 'owner' then
    raise exception 'Only an org owner can promote members to owner';
  end if;

  if v_member.role = 'owner' and p_new_role != 'owner' then
    select count(*) into v_owner_count
    from   public.org_members
    where  org_id = v_member.org_id and role = 'owner' and status = 'active';
    if v_owner_count <= 1 then
      raise exception 'Cannot demote the last owner of an organisation';
    end if;
  end if;

  update public.org_members set role = p_new_role where id = p_member_id;
end;
$$;

grant execute on function public.update_org_member_role(uuid, text) to authenticated;

create or replace function public.remove_org_member(p_member_id uuid)
returns void language plpgsql security definer as $$
declare
  v_member      public.org_members;
  v_caller_role text;
  v_owner_count int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into v_member from public.org_members where id = p_member_id;
  if not found then raise exception 'Member not found'; end if;

  select role into v_caller_role
  from   public.org_members
  where  org_id = v_member.org_id and user_id = auth.uid() and status = 'active';

  if v_caller_role is null or v_caller_role not in ('owner', 'admin') then
    raise exception 'Unauthorized: only org owners and admins can remove members';
  end if;

  if v_member.role = 'owner' then
    select count(*) into v_owner_count
    from   public.org_members
    where  org_id = v_member.org_id and role = 'owner' and status = 'active';
    if v_owner_count <= 1 then
      raise exception 'Cannot remove the last owner of an organisation';
    end if;
  end if;

  delete from public.org_members where id = p_member_id;
end;
$$;

grant execute on function public.remove_org_member(uuid) to authenticated;

create or replace function public.transfer_org_ownership(
  p_org_id         uuid,
  p_target_user_id uuid
)
returns void language plpgsql security definer as $$
declare
  v_caller_role text;
  v_target      public.org_members;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select role into v_caller_role
  from   public.org_members
  where  org_id = p_org_id and user_id = auth.uid() and status = 'active';

  if v_caller_role != 'owner' then
    raise exception 'Unauthorized: only an org owner can transfer ownership';
  end if;

  select * into v_target
  from   public.org_members
  where  org_id = p_org_id and user_id = p_target_user_id and status = 'active';

  if not found then
    raise exception 'Target user is not an active member of this organisation';
  end if;

  update public.org_members set role = 'owner'
  where  org_id = p_org_id and user_id = p_target_user_id;
end;
$$;

grant execute on function public.transfer_org_ownership(uuid, uuid) to authenticated;

-- ── Org deletion flow ─────────────────────────────────────────────────────────

create or replace function public.check_org_not_locked()
returns trigger language plpgsql security definer as $$
begin
  if new.org_id is null then return new; end if;
  if exists (
    select 1 from public.organizations
    where id = new.org_id and status != 'active'
  ) then
    raise exception 'Organisation is locked pending deletion — no edits are permitted.';
  end if;
  return new;
end;
$$;

-- Apply lock trigger to all org-scoped business tables.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'inflow_transactions','outflow_transactions','intra_flows','bank_deposits',
    'intrabank_transfers','fx_transactions','fx_conversions','banks','categories',
    'category_groups','category_opening_balances','category_outflow_type_map',
    'allocation_configs','income_types','income_type_rules','outflow_types',
    'special_config_groups','transaction_allocation_snapshots','recalculation_logs',
    'special_projects','project_entries','report_templates','dynamic_reports',
    'departments','receipts'
  ]
  loop
    execute format(
      'drop trigger if exists trg_check_org_locked on public.%I;
       create trigger trg_check_org_locked
         before insert or update on public.%I
         for each row execute function public.check_org_not_locked();',
      tbl, tbl
    );
  end loop;
end $$;

create or replace function public.request_org_deletion(
  p_org_id           uuid,
  p_org_name_confirm text
)
returns jsonb language plpgsql security definer as $$
declare
  v_user_id  uuid := auth.uid();
  v_org      record;
  v_purge_at timestamptz;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  select * into v_org from public.organizations where id = p_org_id;
  if not found then raise exception 'Organisation not found'; end if;

  if not exists (
    select 1 from public.org_members
    where org_id  = p_org_id and user_id = v_user_id and role = 'owner' and status = 'active'
  ) then
    raise exception 'Only the organisation owner can request deletion';
  end if;

  if v_org.name is distinct from p_org_name_confirm then
    raise exception 'Organisation name confirmation does not match';
  end if;

  if v_org.status = 'pending_deletion' then
    raise exception 'Organisation is already pending deletion';
  end if;

  v_purge_at := now() + interval '30 days';

  update public.organizations
  set status                = 'pending_deletion',
      deleted_at            = now(),
      purge_at              = v_purge_at,
      deletion_requested_by = v_user_id
  where id = p_org_id;

  insert into public.audit_log (
    org_id, table_name, record_id, action, old_data, new_data, user_id, created_at
  ) values (
    p_org_id, 'organizations', p_org_id, 'DELETION_REQUESTED',
    jsonb_build_object('status', 'active'),
    jsonb_build_object('status', 'pending_deletion', 'deleted_at', now(), 'purge_at', v_purge_at),
    v_user_id, now()
  );

  return jsonb_build_object(
    'ok', true, 'org_id', p_org_id, 'org_name', v_org.name,
    'deleted_at', now(), 'purge_at', v_purge_at
  );
end;
$$;

grant execute on function public.request_org_deletion(uuid, text) to authenticated;

create or replace function public.record_deletion_backup(
  p_org_id    uuid,
  p_path      text,
  p_file_size bigint default null
)
returns jsonb language plpgsql security definer as $$
declare
  v_user_id uuid := auth.uid();
  v_org     record;
  v_id      uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  select * into v_org from public.organizations where id = p_org_id;
  if not found then raise exception 'Organisation not found'; end if;

  if not exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = v_user_id and role = 'owner' and status = 'active'
  ) then
    raise exception 'Only the organisation owner can record a deletion backup';
  end if;

  insert into public.org_deletion_backups (
    org_id, created_by, backup_path, file_size_bytes, status, expires_at
  ) values (
    p_org_id, v_user_id, p_path, p_file_size, 'available',
    coalesce(v_org.purge_at, now() + interval '30 days')
  )
  returning id into v_id;

  update public.organizations set deletion_backup_path = p_path where id = p_org_id;

  return jsonb_build_object('ok', true, 'backup_id', v_id);
end;
$$;

grant execute on function public.record_deletion_backup(uuid, text, bigint) to authenticated;

create or replace function public.restore_org(p_org_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_user_id uuid := auth.uid();
  v_org     record;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  select * into v_org from public.organizations where id = p_org_id;
  if not found then raise exception 'Organisation not found'; end if;

  if not exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = v_user_id and role = 'owner' and status = 'active'
  ) then
    raise exception 'Only the organisation owner can restore a pending deletion';
  end if;

  if v_org.status != 'pending_deletion' then
    raise exception 'Organisation is not in pending_deletion status';
  end if;

  if v_org.purge_at is not null and v_org.purge_at < now() then
    raise exception 'Purge window has passed — this organisation can no longer be restored';
  end if;

  update public.organizations
  set status                = 'active',
      deleted_at            = null,
      purge_at              = null,
      deletion_requested_by = null,
      deletion_backup_path  = null
  where id = p_org_id;

  insert into public.audit_log (
    org_id, table_name, record_id, action, old_data, new_data, user_id, created_at
  ) values (
    p_org_id, 'organizations', p_org_id, 'DELETION_RESTORED',
    jsonb_build_object('status', 'pending_deletion', 'deleted_at', v_org.deleted_at),
    jsonb_build_object('status', 'active'),
    v_user_id, now()
  );

  return jsonb_build_object('ok', true, 'org_id', p_org_id);
end;
$$;

grant execute on function public.restore_org(uuid) to authenticated;

-- purge_org: permanently deletes all org data.
-- Called by service-role Edge Function after purge_at.
-- Audit entry written BEFORE deletions so it survives even after org rows are gone.
-- No EXCEPTION WHEN OTHERS: errors propagate and roll back the transaction.
create or replace function public.purge_org(p_org_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_org  record;
  v_snap jsonb;
begin
  if auth.uid() is not null then
    raise exception 'purge_org may only be called by the service role';
  end if;

  select * into v_org from public.organizations where id = p_org_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Organisation not found');
  end if;

  if v_org.status != 'pending_deletion' then
    return jsonb_build_object('ok', false, 'error', 'Organisation is not pending deletion');
  end if;

  if v_org.purge_at is null or v_org.purge_at > now() then
    return jsonb_build_object(
      'ok', false,
      'error', format('Purge window has not passed yet (purge_at = %s)', v_org.purge_at)
    );
  end if;

  v_snap := row_to_json(v_org)::jsonb;

  -- Audit written first so it is preserved regardless of FK cascades below
  insert into public.audit_log (
    table_name, record_id, action, old_data, new_data, user_id, created_at
  ) values (
    'organizations', p_org_id, 'PURGE_INITIATED', v_snap, null, null, now()
  );

  delete from public.receipts                          where org_id = p_org_id;
  delete from public.transaction_allocation_snapshots  where org_id = p_org_id;
  delete from public.recalculation_logs                where org_id = p_org_id;

  -- dynamic_report_blocks/snapshots have no org_id; delete via parent report_id
  delete from public.dynamic_report_snapshots
    where report_id in (select id from public.dynamic_reports where org_id = p_org_id);
  delete from public.dynamic_report_blocks
    where report_id in (select id from public.dynamic_reports where org_id = p_org_id);
  delete from public.dynamic_reports                   where org_id = p_org_id;

  delete from public.report_templates                  where org_id = p_org_id;
  delete from public.project_entries                   where org_id = p_org_id;
  delete from public.special_projects                  where org_id = p_org_id;
  delete from public.fx_conversions                    where org_id = p_org_id;
  delete from public.fx_transactions                   where org_id = p_org_id;
  delete from public.intrabank_transfers               where org_id = p_org_id;
  delete from public.bank_deposits                     where org_id = p_org_id;
  delete from public.intra_flows                       where org_id = p_org_id;
  delete from public.outflow_transactions              where org_id = p_org_id;
  delete from public.inflow_transactions               where org_id = p_org_id;
  delete from public.income_type_rules                 where org_id = p_org_id;
  delete from public.income_types                      where org_id = p_org_id;
  delete from public.category_outflow_type_map         where org_id = p_org_id;
  delete from public.outflow_types                     where org_id = p_org_id;
  delete from public.allocation_configs                where org_id = p_org_id;
  delete from public.special_config_groups             where org_id = p_org_id;
  delete from public.category_opening_balances         where org_id = p_org_id;
  delete from public.categories                        where org_id = p_org_id;
  delete from public.category_groups                   where org_id = p_org_id;
  delete from public.banks                             where org_id = p_org_id;
  delete from public.departments                       where org_id = p_org_id;
  delete from public.ledger_entries                    where org_id = p_org_id;
  delete from public.accounts                          where org_id = p_org_id;
  delete from public.invitations                       where org_id = p_org_id;
  delete from public.org_deletion_backups              where org_id = p_org_id;

  -- audit_log.org_id has ON DELETE SET NULL — FK cascade nullifies org_id
  -- when the organizations row is deleted below. Explicit DELETE is blocked by
  -- trg_audit_log_no_delete and is not needed.

  delete from public.org_members                       where org_id = p_org_id;
  delete from public.organizations                     where id     = p_org_id;

  return jsonb_build_object('ok', true, 'org_id', p_org_id, 'purged_at', now());
end;
$$;

-- purge_org is NOT granted to authenticated — service-role only.

-- ── Atomic FX Conversion (LB-2/E-C2) ─────────────────────────────────────────
-- SECURITY INVOKER: RLS on all three tables enforced with the caller's identity.
-- Postgres auto-rolls back all three inserts on any exception.
create or replace function public.perform_fx_conversion(
  p_org_id               uuid,
  p_user_id              uuid,
  p_date                 date,
  p_fx_currency          text,
  p_fx_amount            numeric,
  p_exchange_rate        numeric,
  p_naira_amount         numeric,
  p_bank_name            text,
  p_base_currency        text default 'NGN',
  p_notes                text default null,
  p_allocation_config_id uuid default null,
  p_stage_code_1         text default null,
  p_stage_code_2         text default 'Percentage Allocation'
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_prev_balance  numeric(15,4);
  v_new_balance   numeric(15,4);
  v_fx_tx_id      uuid;
  v_inflow_id     uuid;
  v_conversion_id uuid;
begin
  if p_org_id is null then raise exception 'org_id is required'; end if;
  if p_bank_name is null or trim(p_bank_name) = '' then
    raise exception 'bank_name is required for FX conversion inflows';
  end if;
  if p_fx_amount <= 0 then raise exception 'fx_amount must be positive'; end if;
  if p_exchange_rate <= 0 then raise exception 'exchange_rate must be positive'; end if;

  select coalesce(running_balance, 0)
  into   v_prev_balance
  from   public.fx_transactions
  where  org_id   = p_org_id
    and  currency = p_fx_currency
  order  by date desc, created_at desc
  limit  1;

  v_prev_balance := coalesce(v_prev_balance, 0);
  v_new_balance  := v_prev_balance - p_fx_amount;

  insert into public.fx_transactions (
    date, currency, withdrawal, deposit, running_balance,
    narration, created_by, org_id
  ) values (
    p_date, p_fx_currency, p_fx_amount, 0, v_new_balance,
    coalesce(p_notes, 'Converted to ' || p_base_currency || ' @ ' || p_exchange_rate::text),
    p_user_id, p_org_id
  )
  returning id into v_fx_tx_id;

  insert into public.inflow_transactions (
    date, amount, description, bank_name,
    stage_code_1, stage_code_2, allocation_config_id,
    fx_currency, fx_amount, fx_rate,
    transaction_type, created_by, org_id
  ) values (
    p_date, p_naira_amount,
    coalesce(p_notes, 'FX Conversion: ' || p_fx_currency || ' → ' || p_base_currency),
    p_bank_name, p_stage_code_1,
    coalesce(p_stage_code_2, 'Percentage Allocation'),
    p_allocation_config_id, p_fx_currency, p_fx_amount, p_exchange_rate,
    'fx_conversion', p_user_id, p_org_id
  )
  returning id into v_inflow_id;

  insert into public.fx_conversions (
    date, fx_currency, fx_amount, exchange_rate, naira_amount,
    fx_withdrawal_id, naira_inflow_id, notes,
    allocation_config_id, is_partial, created_by, org_id
  ) values (
    p_date, p_fx_currency, p_fx_amount, p_exchange_rate, p_naira_amount,
    v_fx_tx_id, v_inflow_id, p_notes,
    p_allocation_config_id, (p_fx_amount < v_prev_balance),
    p_user_id, p_org_id
  )
  returning id into v_conversion_id;

  return jsonb_build_object(
    'fx_transaction_id', v_fx_tx_id,
    'inflow_id',         v_inflow_id,
    'conversion_id',     v_conversion_id
  );

exception when others then raise;
end;
$$;

grant execute on function public.perform_fx_conversion(
  uuid, uuid, date, text, numeric, numeric, numeric, text, text, text, uuid, text, text
) to authenticated;

-- ── user_preferences updated_at trigger ──────────────────────────────────────

create or replace function public.set_user_preferences_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_preferences_updated_at on public.user_preferences;
create trigger user_preferences_updated_at
  before update on public.user_preferences
  for each row execute function public.set_user_preferences_updated_at();

-- ── purge_old_audit_logs() (N-3) ─────────────────────────────────────────────

create or replace function public.purge_old_audit_logs(
  p_retention_interval interval default '7 years'
)
returns table(audit_rows_deleted bigint, field_change_rows_deleted bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_audit_deleted bigint := 0;
  v_fc_deleted    bigint := 0;
  v_cutoff        timestamptz;
  v_caller_org    uuid;
begin
  if auth.uid() is not null then
    -- Authenticated caller must be an org admin; scope deletion to their org only
    if not public.is_admin() then
      raise exception 'purge_old_audit_logs: caller must be an org admin';
    end if;
    select org_id into v_caller_org
    from public.org_members
    where user_id = auth.uid() and role in ('owner', 'admin') and status = 'active'
    order by joined_at
    limit 1;
    if v_caller_org is null then
      raise exception 'purge_old_audit_logs: no active admin membership found for caller';
    end if;
  end if;
  -- v_caller_org = NULL means pg_cron service role: delete across all orgs

  v_cutoff := now() - p_retention_interval;
  set local app.audit_maintenance = 'true';

  if v_caller_org is not null then
    delete from public.audit_log where created_at < v_cutoff and org_id = v_caller_org;
  else
    delete from public.audit_log where created_at < v_cutoff;
  end if;
  get diagnostics v_audit_deleted = row_count;

  if v_caller_org is not null then
    delete from public.field_changes where changed_at < v_cutoff and org_id = v_caller_org;
  else
    delete from public.field_changes where changed_at < v_cutoff;
  end if;
  get diagnostics v_fc_deleted = row_count;

  insert into public.audit_maintenance_log
    (retention_interval, audit_rows_deleted, field_change_rows_deleted, performed_by)
  values
    (p_retention_interval, v_audit_deleted, v_fc_deleted, auth.uid());
  return query select v_audit_deleted, v_fc_deleted;
end;
$$;

revoke all   on function public.purge_old_audit_logs(interval) from public;
grant execute on function public.purge_old_audit_logs(interval) to authenticated;

-- ── request_gdpr_erasure() (N-4) ─────────────────────────────────────────────

create or replace function public.request_gdpr_erasure(
  p_org_id         uuid,
  p_target_user_id uuid,
  p_notes          text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_audit_count bigint := 0;
  v_fc_count    bigint := 0;
  v_request_id  uuid;
  v_pii_keys    constant text[] := array[
    'email', 'full_name', 'username', 'phone', 'avatar_url'
  ];
begin
  -- Caller must be an admin of the specified org (not just any org)
  if not public.is_org_admin(p_org_id) then
    raise exception 'request_gdpr_erasure: caller must be an admin of the specified org';
  end if;
  with updated as (
    update public.audit_log
    set
      user_id  = null,
      old_data = case when old_data is not null then old_data - v_pii_keys else null end,
      new_data = case when new_data is not null then new_data - v_pii_keys else null end
    where user_id = p_target_user_id and org_id = p_org_id
    returning 1
  )
  select count(*) into v_audit_count from updated;
  with updated as (
    update public.field_changes
    set
      user_id   = null,
      old_value = case when field_name = any(v_pii_keys) then null else old_value end,
      new_value = case when field_name = any(v_pii_keys) then null else new_value end
    where user_id = p_target_user_id and org_id = p_org_id
    returning 1
  )
  select count(*) into v_fc_count from updated;
  insert into public.gdpr_erasure_requests
    (org_id, requested_by, target_user_id, completed_at, notes,
     anonymized_audit_count, anonymized_field_change_count)
  values
    (p_org_id, auth.uid(), p_target_user_id, now(), p_notes,
     v_audit_count, v_fc_count)
  returning id into v_request_id;
  return v_request_id;
end;
$$;

-- Drop old 2-arg signature so callers must supply p_org_id explicitly
drop function if exists public.request_gdpr_erasure(uuid, text);
revoke all   on function public.request_gdpr_erasure(uuid, uuid, text) from public;
grant execute on function public.request_gdpr_erasure(uuid, uuid, text) to authenticated;

-- ── bank_statement_balances ────────────────────────────────────────────────────
create table if not exists public.bank_statement_balances (
  id                uuid          default gen_random_uuid() primary key,
  bank_name         text          not null,
  bank_id           uuid          references public.banks(id) on delete set null,
  reference_balance numeric(15,2) not null,
  statement_date    date          not null,
  notes             text,
  entered_by        uuid          references public.profiles(id),
  org_id            uuid          not null default public.get_current_org_id()
                    references public.organizations(id) on delete set null,
  created_at        timestamptz   default now(),
  unique (org_id, bank_name)
);
alter table public.bank_statement_balances enable row level security;
create policy "bsb_select" on public.bank_statement_balances
  for select using (public.is_org_member(org_id));
create policy "bsb_insert" on public.bank_statement_balances
  for insert with check (public.is_org_finance_user(org_id));
create policy "bsb_update" on public.bank_statement_balances
  for update using (public.is_org_finance_user(org_id));
create policy "bsb_delete" on public.bank_statement_balances
  for delete using (public.is_org_admin(org_id));
create index if not exists idx_bsb_org_bank on public.bank_statement_balances(org_id, bank_name);

-- ================================================================
-- 12. SCHEMA RELOAD
-- ================================================================

notify pgrst, 'reload schema';
