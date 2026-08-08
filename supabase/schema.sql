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
  plan_tier             text        not null default 'free'
                        check (plan_tier in ('free', 'level1', 'full')),
  plan_started_at       timestamptz not null default now(),
  plan_expires_at       timestamptz,
  imported_rows_count   int         not null default 0,
  imported_rows_period_start timestamptz not null default now(),
  -- Max OCR pages per UTC day (20260807000002_ocr_quota). Enforced by
  -- consume_ocr_page(); raise per-org via the service role if needed.
  ocr_daily_page_limit  int         not null default 300,
  -- Stripe linkage (20260806000000_stripe_billing). Written only by the
  -- billing edge functions under the service role — see Section 12.
  stripe_customer_id     text,
  stripe_subscription_id text,
  plan_status           text        not null default 'active'
                        check (plan_status in ('active', 'trialing', 'past_due', 'canceled')),
  trial_ends_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_organizations_slug       on public.organizations(slug);
create index if not exists idx_organizations_created_by on public.organizations(created_by);
create index if not exists idx_organizations_status     on public.organizations(status);
create index if not exists idx_organizations_purge_at   on public.organizations(purge_at);

create unique index if not exists organizations_stripe_customer_id_key
  on public.organizations (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists organizations_stripe_subscription_id_key
  on public.organizations (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- Organisation names are globally unique, case- and whitespace-insensitive.
-- Identically named orgs would disguise any cross-org leak as correct data.
-- Orgs queued for deletion are excluded so their names are reusable.
create or replace function public.normalize_org_name(p_name text)
returns text language sql immutable set search_path = public as $$
  select lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
$$;

create unique index if not exists organizations_name_unique
  on public.organizations (public.normalize_org_name(name))
  where status <> 'pending_deletion';

-- Bank names are unique per org, case- and whitespace-insensitive. bank_name is
-- denormalised text on every transaction table and BankLedger reads rows back by
-- it, so two same-named banks would blend into one ledger — and the transaction
-- ref indexes below key on bank identity, so one account's refs would suppress
-- the other's.
create or replace function public.normalize_bank_name(p_name text)
returns text language sql immutable set search_path = public as $$
  select lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
$$;

-- Mirrors src/utils/normalizeId.ts: NFC, strip invisible characters, collapse
-- whitespace, trim. Case is preserved — bank refs are case-sensitive. Returns
-- NULL for a blank ref, which is how the uniqueness indexes exempt rows that
-- carry no reference.
create or replace function public.normalize_txn_ref(p_ref text)
returns text language sql immutable set search_path = public as $$
  select nullif(
    btrim(regexp_replace(
      translate(
        normalize(coalesce(p_ref, ''), nfc),
        -- soft hyphen, NBSP, ZWSP/ZWNJ/ZWJ, LS/PS, BOM
        chr(173) || chr(160) || chr(8203) || chr(8204) || chr(8205)
                 || chr(8232) || chr(8233) || chr(65279),
        ''
      ),
      '\s+', ' ', 'g'
    )),
    ''
  );
$$;

-- Uniqueness scope for a transaction ref is the bank account, keyed on
-- bank_name rather than bank_id. bank_name is set on every row that has a
-- bank_id (the import writes both together) AND on legacy rows written before
-- bank_id existed, so keying on it puts old and new rows for the same bank in
-- the same key space — keying on bank_id would let a legacy row and a new row
-- for one bank hold the same ref. Names are unique per org (see
-- banks_org_name_unique), so name and account are 1:1. bank_id is the fallback
-- for the inverse case, and rows with neither share the '' key, which keeps
-- unmatched statement rows constrained instead of exempt.
create or replace function public.txn_bank_key(p_bank_id uuid, p_bank_name text)
returns text language sql immutable set search_path = public as $$
  select coalesce(nullif(public.normalize_bank_name(p_bank_name), ''), p_bank_id::text, '');
$$;

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

-- DEFAULT stub for org_id on all business-table columns. The application layer
-- (orgPayload() in useMutations.ts, explicit org_id in all other hooks) always
-- supplies org_id on every INSERT, so this DEFAULT must never actually fire.
-- Raising here turns any future regression that omits org_id into an immediate,
-- loud DB error instead of a silent cross-tenant leak.
create or replace function public.get_current_org_id()
returns uuid language plpgsql security definer as $$
begin
  raise exception
    'get_current_org_id() invoked — all INSERT statements must supply org_id explicitly. '
    'This function exists only as a DEFAULT stub; it must never be called at runtime. '
    'Ensure the calling code reads org_id from useOrgStore and passes it in the INSERT payload.';
end;
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

-- org_effective_plan_tier: a grandfathered/expired plan silently reverts to
-- 'free' once plan_expires_at is in the past — lazy check, no cron needed.
create or replace function public.org_effective_plan_tier(p_org_id uuid)
returns text language sql security definer stable as $$
  select case
    when o.plan_expires_at is not null and o.plan_expires_at < now() then 'free'
    else o.plan_tier
  end
  from public.organizations o
  where o.id = p_org_id;
$$;

-- org_plan_at_least: true if the org's effective tier meets p_min_tier.
create or replace function public.org_plan_at_least(p_org_id uuid, p_min_tier text)
returns boolean language sql security definer stable as $$
  select case public.org_effective_plan_tier(p_org_id)
    when 'full'   then true
    when 'level1' then p_min_tier in ('free', 'level1')
    else               p_min_tier = 'free'
  end;
$$;

-- increment_import_count: atomically bumps organizations.imported_rows_count
-- so the free-tier 100-row/month Import cap can't be raced by concurrent
-- imports. Rolls the counter over (reset, not add) when the calendar month
-- has changed since imported_rows_period_start — lazy, no cron needed.
create or replace function public.increment_import_count(p_org_id uuid, p_count int)
returns int language plpgsql security definer as $$
declare
  v_new_count    int;
  v_period_start timestamptz;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this organization';
  end if;

  -- SECURITY DEFINER doesn't change the JWT the request arrived with, so
  -- guard_org_plan_columns() would see 'authenticated' and block the write
  -- below. This is the one legitimate user-triggered change to a billing
  -- column; the flag is transaction-local.
  perform set_config('app.plan_guard_bypass', 'on', true);

  select imported_rows_period_start into v_period_start
  from public.organizations where id = p_org_id;

  if date_trunc('month', now()) <> date_trunc('month', v_period_start) then
    update public.organizations
    set imported_rows_count        = greatest(p_count, 0),
        imported_rows_period_start = now()
    where id = p_org_id
    returning imported_rows_count into v_new_count;
  else
    update public.organizations
    set imported_rows_count = imported_rows_count + greatest(p_count, 0)
    where id = p_org_id
    returning imported_rows_count into v_new_count;
  end if;

  return v_new_count;
end;
$$;

-- ── OCR spend control (20260807000002_ocr_quota) ─────────────────────────────
-- The pdf-ocr Edge Function turns one request into one billed model call, so
-- it must not be reachable on a valid JWT alone. consume_ocr_page() is the
-- single authorising gate it calls before spending anything: membership, role
-- and plan are checked server-side, then the org's daily page count is
-- incremented under the upserted row's lock so concurrent pages cannot race
-- past the cap. Service role only — granting it to authenticated would let any
-- user burn their own org's allowance directly.
create table if not exists public.ocr_usage (
  org_id     uuid        not null references public.organizations(id) on delete cascade,
  usage_date date        not null default (now() at time zone 'utc')::date,
  pages      int         not null default 0,
  updated_at timestamptz not null default now(),
  primary key (org_id, usage_date)
);

create index if not exists idx_ocr_usage_date on public.ocr_usage(usage_date);

-- RLS on with zero policies: denies anon and authenticated outright. The
-- service role bypasses RLS; orgs see their usage via the RPC's return value.
alter table public.ocr_usage enable row level security;
revoke all on public.ocr_usage from anon, authenticated;

create or replace function public.consume_ocr_page(
  p_org_id  uuid,
  p_user_id uuid,
  p_pages   int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  text;
  v_limit int;
  v_used  int;
  v_want  int := greatest(coalesce(p_pages, 1), 1);
begin
  -- p_user_id is passed explicitly: the caller holds the service role, so
  -- auth.uid() is null and the is_org_*() helpers cannot be reused here.
  select role into v_role
  from public.org_members
  where org_id = p_org_id
    and user_id = p_user_id
    and status  = 'active';

  if v_role is null then
    return jsonb_build_object('allowed', false, 'reason', 'not_a_member');
  end if;

  if v_role not in ('owner', 'admin', 'accountant') then
    return jsonb_build_object('allowed', false, 'reason', 'role_not_permitted');
  end if;

  if not public.org_plan_at_least(p_org_id, 'full') then
    return jsonb_build_object('allowed', false, 'reason', 'plan_too_low');
  end if;

  select ocr_daily_page_limit into v_limit
  from public.organizations
  where id = p_org_id;

  insert into public.ocr_usage (org_id, usage_date, pages)
  values (p_org_id, (now() at time zone 'utc')::date, 0)
  on conflict (org_id, usage_date)
    do update set pages = public.ocr_usage.pages
  returning pages into v_used;

  if v_used + v_want > v_limit then
    return jsonb_build_object(
      'allowed', false, 'reason', 'daily_quota_exceeded',
      'used', v_used, 'limit', v_limit
    );
  end if;

  -- Incremented only once all three gates pass, so a refusal costs the org
  -- nothing from its own allowance.
  update public.ocr_usage
  set pages = pages + v_want, updated_at = now()
  where org_id = p_org_id
    and usage_date = (now() at time zone 'utc')::date
  returning pages into v_used;

  return jsonb_build_object('allowed', true, 'used', v_used, 'limit', v_limit);
end;
$$;

revoke all on function public.consume_ocr_page(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.consume_ocr_page(uuid, uuid, int) to service_role;

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
  id          uuid       primary key default gen_random_uuid(),
  name        text       not null,
  is_default  boolean    not null default false,
  is_archived boolean    not null default false,
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
  -- Unique per ORG, not globally: two tenants must both be able to own a
  -- category called "Tithes". A bare `unique` here is a multi-tenancy break.
  name        text        not null,
  description text,
  group_id    uuid        references public.category_groups(id) on delete set null,
  is_hidden   boolean     not null default false,
  is_default  boolean     not null default false,
  currency    text,
  org_id      uuid        not null default public.get_current_org_id()
              references public.organizations(id) on delete set null,
  created_at  timestamptz default now(),
  constraint categories_org_name_key unique (org_id, name)
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
create unique index if not exists banks_org_name_unique
  on public.banks (org_id, public.normalize_bank_name(name));

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
  rule_type      text        not null check (rule_type in ('keyword', 'stage_code', 'bank')),
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

-- Outflow counterpart to income_type_rules: auto-classifies debit rows during
-- import. Matches against the RAW description, never a cleaned narration.
create table public.outflow_classification_rules (
  id              uuid        default gen_random_uuid() primary key,
  rule_type       text        not null check (rule_type in ('keyword', 'stage_code', 'bank')),
  rule_value      text        not null,
  stage_code_1    text,
  stage_code_2    text,
  outflow_type_id uuid        references public.outflow_types(id) on delete set null,
  priority        int         not null default 0,
  org_id          uuid        not null default public.get_current_org_id()
                  references public.organizations(id) on delete set null,
  created_at      timestamptz default now()
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
  category_id               uuid        references public.categories(id) on delete set null,
  stage_code_2              text,
  stage_code_3              text,
  transaction_ref           text,
  specific_seed_description text,
  remark                    text,
  bank_name                 text,
  bank_id                   uuid        references public.banks(id) on delete set null,
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
  -- Position among otherwise-identical rows in one statement (0 = first). A
  -- failed transfer that is reversed and retried posts twice under one Session
  -- ID with identical date, amount and narration; nothing else tells them
  -- apart. Part of the uniqueness key, so the reference itself is never
  -- rewritten and stays usable for reconciliation.
  ref_occurrence            smallint    not null default 0,
  created_by                uuid        references public.profiles(id),
  recorded_at               timestamptz default now(),
  created_at                timestamptz default now(),
  updated_at                timestamptz default now(),
  import_seq                bigint      generated always as identity,
  import_batch_id           uuid,
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
  category_id             uuid        references public.categories(id) on delete set null,
  stage_code_2            text,
  remarks                 text,
  bank_name               text,
  bank_id                 uuid        references public.banks(id) on delete set null,
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
  ref_occurrence          smallint    not null default 0,
  created_by              uuid        references public.profiles(id),
  recorded_at             timestamptz default now(),
  created_at              timestamptz default now(),
  updated_at              timestamptz default now(),
  import_seq              bigint      generated always as identity,
  import_batch_id         uuid,
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
  updated_at          timestamptz default now(),
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
  bank_id         uuid        references public.banks(id) on delete set null,
  ref_occurrence  smallint    not null default 0,
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

-- Caps invites per org per hour: org name and inviter name are both
-- user-controllable and get emailed out under our sending domain, so an
-- unbounded invite rate is an open phishing-blast vector.
create or replace function public.enforce_invite_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public as $$
declare
  v_recent_count int;
begin
  select count(*) into v_recent_count
  from public.invitations
  where org_id = new.org_id
    and created_at > now() - interval '1 hour';

  if v_recent_count >= 20 then
    raise exception 'Too many invitations sent recently. Please try again later.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists invitations_rate_limit on public.invitations;
create trigger invitations_rate_limit
  before insert on public.invitations
  for each row
  execute function public.enforce_invite_rate_limit();

-- ── Audit Log ─────────────────────────────────────────────────────────────────
create table public.audit_log (
  id         uuid        default gen_random_uuid() primary key,
  user_id    uuid        references public.profiles(id) on delete set null,
  action     text        not null,
  table_name text,
  record_id  uuid,
  old_data   jsonb,
  new_data   jsonb,
  org_id     uuid        not null references public.organizations(id) on delete set null,
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
  org_id     uuid        not null references public.organizations(id) on delete set null,
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

-- ── Import Batches ────────────────────────────────────────────────────────────
-- One row per import run — lets the UI show/undo a specific run without
-- scanning the transaction tables for stale ids.
create table public.import_batches (
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
-- Org-scoped: each organisation owns its own currency list. Surrogate id PK
-- (not code) so the table behaves like every other org-scoped table in the
-- backup/restore registry; uniqueness of the code is per organisation.
create table public.currencies (
  id         uuid    primary key default gen_random_uuid(),
  org_id     uuid    not null references public.organizations(id) on delete cascade,
  code       text    not null,
  name       text    not null,
  symbol     text    not null default '',
  flag       text,
  is_active  boolean not null default true,
  sort_order integer not null default 99,
  unique (org_id, code)
);
create index currencies_org_id_idx on public.currencies (org_id);

-- Default currency list handed to every new organisation.
-- Mirrors DEFAULT_CURRENCIES in src/hooks/useCurrencies.ts.
create or replace function public.seed_default_currencies(p_org_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.currencies (org_id, code, name, symbol, flag, is_active, sort_order)
  select p_org_id, d.code, d.name, d.symbol, d.flag, true, d.sort_order
  from (values
    ('NGN', 'Nigerian Naira', '₦', '🇳🇬', 0),
    ('USD', 'US Dollar',      '$', '🇺🇸', 1),
    ('GBP', 'British Pound',  '£', '🇬🇧', 2),
    ('EUR', 'Euro',           '€', '🇪🇺', 3),
    ('CNY', 'Chinese Yuan',   '¥', '🇨🇳', 4)
  ) as d(code, name, symbol, flag, sort_order)
  on conflict (org_id, code) do nothing;
$$;

create or replace function public.seed_currencies_on_org_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_default_currencies(new.id);
  return new;
end $$;

drop trigger if exists trg_seed_currencies_on_org_insert on public.organizations;
create trigger trg_seed_currencies_on_org_insert
  after insert on public.organizations
  for each row execute function public.seed_currencies_on_org_insert();

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
-- No bootstrap organisation is seeded here. Every org is created by a user
-- via the create_organization() RPC (Onboarding.tsx / LoginPage.tsx signup),
-- which seeds that org's own default outflow type, category, and rule group
-- through complete_org_onboarding(). A fresh install therefore starts with
-- zero organisations.
-- ================================================================

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
alter table public.outflow_classification_rules   enable row level security;
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
alter table public.import_batches                 enable row level security;
alter table public.transaction_allocation_snapshots enable row level security;
alter table public.recalculation_logs             enable row level security;
alter table public.dynamic_reports                enable row level security;
alter table public.dynamic_report_blocks          enable row level security;
alter table public.dynamic_report_snapshots       enable row level security;
alter table public.currencies                     enable row level security;
alter table public.user_preferences               enable row level security;
alter table public.org_deletion_backups           enable row level security;

-- ── Plan predicates used by the policies in Section 9 ─────────────────────────
-- Declared here rather than with the other helpers in Section 4 because they
-- count rows in business tables that don't exist until Section 6.
--
-- These mirror QUANTITY_LIMITS and TXN_TYPE_FEATURE in src/hooks/usePlan.ts.
-- The database is the enforcer; the TypeScript copies exist so a user sees an
-- upsell card instead of a raw error. Change one, change the other.

-- Mirrors QUANTITY_LIMITS.multiBank — Start caps at one bank.
create or replace function public.org_can_add_bank(p_org_id uuid)
returns boolean language sql stable security definer as $$
  select public.org_plan_at_least(p_org_id, 'level1')
      or (select count(*) from public.banks where org_id = p_org_id) < 1;
$$;

-- Mirrors QUANTITY_LIMITS.customDistributionRules — Start none, Growth two,
-- Impact unlimited. A custom distribution rule is one special_config_groups row.
create or replace function public.org_can_add_custom_rule(p_org_id uuid)
returns boolean language sql stable security definer as $$
  select case public.org_effective_plan_tier(p_org_id)
    when 'full'   then true
    when 'level1' then (select count(*) from public.special_config_groups where org_id = p_org_id) < 2
    else               false
  end;
$$;

-- Which tier a given inflow/outflow transaction_type requires — the four types
-- the Adjustments and Bank Movement pages exist to manage, both Impact-tier
-- features. Enforced by trg_inflow/outflow_txn_type_plan in Section 12.
create or replace function public.org_plan_allows_txn_type(p_org_id uuid, p_txn_type text)
returns boolean language sql stable as $$
  select case p_txn_type
    when 'refund'             then public.org_plan_at_least(p_org_id, 'full')
    when 'reversal'           then public.org_plan_at_least(p_org_id, 'full')
    when 'bank_deposit'       then public.org_plan_at_least(p_org_id, 'full')
    when 'intrabank_transfer' then public.org_plan_at_least(p_org_id, 'full')
    else true
  end;
$$;

-- ================================================================
-- 9. RLS POLICIES
-- All helper functions exist (Section 4).
-- All org_id columns exist (Section 6).
--
-- Subscription tiers are enforced HERE and in Section 12, not in the
-- browser. The React gates in src/components/auth/PlanGates.tsx are
-- presentation only — they exist so a user sees an upsell card instead
-- of a database error. Deleting one from the DOM gets you nothing.
--
-- DESIGN RULE — plan enforcement is on CREATE, never on READ/EDIT/DELETE.
-- A downgrade must never trap an org's data: they keep full read, edit
-- and delete access to everything created on a higher tier, and simply
-- cannot create more of it. Every plan check below is INSERT-only.
-- ================================================================

-- ── profiles (no org_id — global user registry) ───────────────────────────────

-- Restricted to own row or a user who shares an active org (no cross-org PII).
-- Username login resolves inside the `username-auth` Edge Function (service
-- role), not through this policy and not through any anon-callable RPC.
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

-- Billing/metering columns are row-writable by any org admin under orgs_update,
-- so they are locked at the column level and by a guard trigger. Only the
-- service role (Stripe webhook) and SECURITY DEFINER functions may change them.
revoke update on public.organizations from authenticated, anon;

do $$
declare
  v_col text;
  v_locked text[] := array[
    'plan_tier',
    'plan_status',
    'plan_started_at',
    'plan_expires_at',
    'trial_ends_at',
    'stripe_customer_id',
    'stripe_subscription_id',
    'imported_rows_count',
    'imported_rows_period_start',
    'ocr_daily_page_limit'
  ];
begin
  for v_col in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'organizations'
      and not (column_name = any (v_locked))
  loop
    execute format(
      'grant update (%I) on public.organizations to authenticated',
      v_col
    );
  end loop;
end $$;

create or replace function public.guard_organization_billing_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if new.plan_tier                  is distinct from old.plan_tier
  or new.plan_status                is distinct from old.plan_status
  or new.plan_started_at            is distinct from old.plan_started_at
  or new.plan_expires_at            is distinct from old.plan_expires_at
  or new.trial_ends_at              is distinct from old.trial_ends_at
  or new.stripe_customer_id         is distinct from old.stripe_customer_id
  or new.stripe_subscription_id     is distinct from old.stripe_subscription_id
  or new.imported_rows_count        is distinct from old.imported_rows_count
  or new.imported_rows_period_start is distinct from old.imported_rows_period_start
  or new.ocr_daily_page_limit       is distinct from old.ocr_daily_page_limit
  then
    raise exception
      'Billing and usage fields on organizations can only be changed by the billing system'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_organization_billing_columns() from public, anon, authenticated;

drop trigger if exists guard_organization_billing_columns on public.organizations;
create trigger guard_organization_billing_columns
  before update on public.organizations
  for each row execute function public.guard_organization_billing_columns();

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
  for insert with check (
    public.is_org_admin(org_id)
    and public.org_can_add_custom_rule(org_id)
  );
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

-- ── outflow_classification_rules ───────────────────────────────────────────────

create policy "outflow_classification_rules_select" on public.outflow_classification_rules
  for select using (public.is_org_member(org_id));
create policy "outflow_classification_rules_insert" on public.outflow_classification_rules
  for insert with check (public.is_org_admin(org_id));
create policy "outflow_classification_rules_update" on public.outflow_classification_rules
  for update using (public.is_org_admin(org_id));
create policy "outflow_classification_rules_delete" on public.outflow_classification_rules
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
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'level1')
  );
create policy "fx_update" on public.fx_transactions
  for update using (public.is_org_finance_user(org_id));
create policy "fx_delete" on public.fx_transactions
  for delete using (public.is_org_admin(org_id));

-- ── fx_conversions ─────────────────────────────────────────────────────────────

create policy "fxc_select" on public.fx_conversions
  for select using (public.is_org_member(org_id));
create policy "fxc_insert" on public.fx_conversions
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'level1')
  );
create policy "fxc_update" on public.fx_conversions
  for update using (public.is_org_finance_user(org_id));
create policy "fxc_delete" on public.fx_conversions
  for delete using (public.is_org_admin(org_id));

-- ── bank_deposits ──────────────────────────────────────────────────────────────

create policy "bank_deposits_select" on public.bank_deposits
  for select using (public.is_org_member(org_id));
create policy "bank_deposits_insert" on public.bank_deposits
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'full')
  );
create policy "bank_deposits_update" on public.bank_deposits
  for update using (public.is_org_finance_user(org_id));
create policy "bank_deposits_delete" on public.bank_deposits
  for delete using (public.is_org_admin(org_id));

-- ── intrabank_transfers ────────────────────────────────────────────────────────

create policy "intrabank_select" on public.intrabank_transfers
  for select using (public.is_org_member(org_id));
create policy "intrabank_insert" on public.intrabank_transfers
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'full')
  );
create policy "intrabank_update" on public.intrabank_transfers
  for update using (public.is_org_finance_user(org_id));
create policy "intrabank_delete" on public.intrabank_transfers
  for delete using (public.is_org_admin(org_id));

-- ── receipts ───────────────────────────────────────────────────────────────────

create policy "receipts_select" on public.receipts
  for select using (public.is_org_member(org_id));
create policy "receipts_insert" on public.receipts
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'level1')
  );
create policy "receipts_delete" on public.receipts
  for delete using (public.is_org_finance_user(org_id));

-- ── invitations ────────────────────────────────────────────────────────────────
-- Token reads go exclusively through get_invitation_by_token() SECURITY DEFINER.

create policy "invitations_select" on public.invitations
  for select using (public.is_org_admin(org_id));
create policy "invitations_insert" on public.invitations
  for insert with check (
    public.is_org_admin(org_id)
    and public.org_plan_at_least(org_id, 'level1')
  );
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

-- No client INSERT policy on audit_log by design. Audit rows are written by the
-- SECURITY DEFINER trigger audit_trigger_fn() running as postgres, so the app
-- role never needs — and must not have — direct INSERT. Granting it back would
-- let a client forge or suppress its own audit entries, defeating the
-- append-only trail. (Dropped live by 20260605000001_server_side_audit_triggers.)

-- No client DELETE policy: audit_log is append-only from the client.
-- Retention cleanup runs via purge_old_audit_logs() (SECURITY DEFINER).

-- ── field_changes (org-scoped since migration 20260602000002) ─────────────────

create policy "field_changes_select" on public.field_changes
  for select using (
    org_id is not null
    and public.is_org_member(org_id)
    and public.is_org_admin(org_id)
  );

-- No client INSERT policy on field_changes, for the same reason as audit_log:
-- the server-side audit trigger writes these rows.

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
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'level1')
  );
create policy "report_templates_update" on public.report_templates
  for update using (public.is_org_finance_user(org_id));
create policy "report_templates_delete" on public.report_templates
  for delete using (public.is_org_admin(org_id));

-- ── import_batches ─────────────────────────────────────────────────────────────

create policy "import_batches_select" on public.import_batches
  for select using (public.is_org_member(org_id));
create policy "import_batches_insert" on public.import_batches
  for insert with check (public.is_org_finance_user(org_id));
create policy "import_batches_update" on public.import_batches
  for update using (public.is_org_finance_user(org_id));

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
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'full')
  );
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
-- KNOWN LIVE DEFECT — reproduced here deliberately, do not "fix" in place.
-- drb_insert and drb_update omit 'owner', while drb_delete (repaired by
-- 20260616000001) includes it. The dynamic-report save flow is delete-then-
-- insert, so an organisation OWNER saving a report deletes the existing blocks
-- and is then denied the re-insert — the report is emptied. Correcting this
-- needs a forward migration so the live database changes too; editing only this
-- file would hide the defect behind a green drift check.
create policy "drb_insert" on public.dynamic_report_blocks
  for insert with check (
    exists (
      select 1 from public.dynamic_reports dr
      join   public.org_members m
        on   m.org_id = dr.org_id and m.user_id = auth.uid()
        and  m.role   in ('admin', 'accountant') and m.status = 'active'
      where  dr.id = report_id
    )
  );
create policy "drb_update" on public.dynamic_report_blocks
  for update using (
    exists (
      select 1 from public.dynamic_reports dr
      join   public.org_members m
        on   m.org_id = dr.org_id and m.user_id = auth.uid()
        and  m.role   in ('admin', 'accountant') and m.status = 'active'
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

-- Org-scoped throughout: is_admin() is "admin in ANY active org", so using it
-- here would let an admin of one organisation rewrite every other tenant's
-- currency list.
create policy "currencies_select" on public.currencies
  for select using (public.is_org_member(org_id));
create policy "currencies_insert" on public.currencies
  for insert with check (public.is_org_admin(org_id));
create policy "currencies_update" on public.currencies
  for update using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
create policy "currencies_delete" on public.currencies
  for delete using (public.is_org_admin(org_id));

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
-- Transactions are unique per (org, bank account, reference, date, amount,
-- description). Import dedup is a client-side pre-check (src/utils/dedupQuery.ts)
-- — without these indexes two concurrent imports, or one retry after a write
-- timeout, silently duplicate a whole statement. The pre-check stays as a fast
-- path; these are the enforcement.
--
-- The key is the whole row, not the reference alone: banks reuse one reference
-- across a transfer, its fee and the VAT on that fee (ImportModal:1454 already
-- half-handles this by tagging '-comm'/'-vat'), and all three are real. Date,
-- amount and description keep them apart while still blocking a re-imported
-- statement, which reproduces every column. The bank's reference is never
-- rewritten, so it stays usable for reconciliation.
--
-- Rows with no reference are exempt. intra_flows is not covered: no bank column,
-- manual entry only (no race), and reversal rows may reuse a reference.
create unique index if not exists inflow_transactions_org_bank_txn_unique
  on public.inflow_transactions (org_id, public.txn_bank_key(bank_id, bank_name),
    public.normalize_txn_ref(transaction_ref), date, amount,
    coalesce(public.normalize_txn_ref(description), ''), ref_occurrence)
  where public.normalize_txn_ref(transaction_ref) is not null;
create unique index if not exists outflow_transactions_org_bank_txn_unique
  on public.outflow_transactions (org_id, public.txn_bank_key(bank_id, bank_name),
    public.normalize_txn_ref(transaction_id), date, amount_disbursed,
    coalesce(public.normalize_txn_ref(description), ''), ref_occurrence)
  where public.normalize_txn_ref(transaction_id) is not null;
create unique index if not exists fx_transactions_org_bank_txn_unique
  on public.fx_transactions (org_id, public.txn_bank_key(bank_id, bank_name),
    public.normalize_txn_ref(transaction_ref), date, deposit, withdrawal,
    coalesce(public.normalize_txn_ref(narration), ''), ref_occurrence)
  where public.normalize_txn_ref(transaction_ref) is not null;
create index if not exists idx_inflow_deposit_group   on public.inflow_transactions(deposit_group_id) where deposit_group_id is not null;
create index if not exists idx_outflow_deposit_group  on public.outflow_transactions(deposit_group_id) where deposit_group_id is not null;
create index if not exists inflow_transactions_import_batch_id_idx  on public.inflow_transactions(import_batch_id) where import_batch_id is not null;
create index if not exists outflow_transactions_import_batch_id_idx on public.outflow_transactions(import_batch_id) where import_batch_id is not null;
create index if not exists idx_categories_group       on public.categories(group_id);
create index if not exists idx_invitations_token      on public.invitations(token);
create index if not exists idx_outflow_department_id  on public.outflow_transactions(department_id);
create index if not exists idx_invitation_emails_invitation on public.invitation_emails(invitation_id);
create index if not exists idx_invitation_emails_sent_at    on public.invitation_emails(sent_at desc);
create index if not exists idx_cob_category           on public.category_opening_balances(category_id);
create index if not exists idx_inflow_category_id      on public.inflow_transactions(category_id);
create index if not exists idx_outflow_category_id     on public.outflow_transactions(category_id);
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
create index if not exists idx_outflow_classification_rules_org    on public.outflow_classification_rules(org_id);
create index if not exists idx_outflow_classification_rules_lookup on public.outflow_classification_rules(org_id, priority, created_at);
create index if not exists idx_intrabank_org           on public.intrabank_transfers(org_id);
create index if not exists idx_accounts_org            on public.accounts(org_id);
create index if not exists idx_ledger_entries_org      on public.ledger_entries(org_id);
create index if not exists idx_special_projects_org    on public.special_projects(org_id);
create index if not exists idx_project_entries_org     on public.project_entries(org_id);
create index if not exists idx_receipts_org            on public.receipts(org_id);
create index if not exists idx_import_batches_org      on public.import_batches(org_id);
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
create unique index if not exists idx_alloc_configs_group_effrom_unique on public.allocation_configs(config_group_id, effective_from) where status = 'locked' and superseded_by_id is null;
create index if not exists idx_receipts_org_entity         on public.receipts(org_id, entity_type, entity_id);
create index if not exists idx_intra_flows_org_batch       on public.intra_flows(org_id, batch_id)
  where batch_id is not null;
create index if not exists idx_tas_org_txn                 on public.transaction_allocation_snapshots(org_id, transaction_id);

-- Balance Brought Forward deduplication index.
-- Must be org-scoped: banks are plain text and tenants share bank names
-- (Nigerian churches largely use the same handful), so an unscoped unique
-- index would let the first tenant to claim a name lock out all others.
create unique index if not exists idx_inflow_bf_unique_org_bank
  on public.inflow_transactions (org_id, bank_name)
  where transaction_type = 'balance_brought_forward';

create index if not exists idx_inflow_bank_name   on public.inflow_transactions(bank_name);
create index if not exists idx_outflow_bank_name  on public.outflow_transactions(bank_name);

create index if not exists idx_inflow_bank_id     on public.inflow_transactions(bank_id);
create index if not exists idx_outflow_bank_id    on public.outflow_transactions(bank_id);
create index if not exists idx_fx_bank_id         on public.fx_transactions(bank_id);

-- Balance-aggregate RPC support (20260807000003_balance_aggregate_rpcs).
create index if not exists idx_inflow_org_stage2   on public.inflow_transactions(org_id, stage_code_2);
create index if not exists idx_outflow_org_stage2  on public.outflow_transactions(org_id, stage_code_2);
create index if not exists idx_inflow_org_bank_id  on public.inflow_transactions(org_id, bank_id);
create index if not exists idx_outflow_org_bank_id on public.outflow_transactions(org_id, bank_id);

-- ================================================================
-- 11. RPCS, SECURITY FUNCTIONS AND GRANTS
-- ================================================================

-- ── Username login rate limiting ──────────────────────────────────────────────
-- Username → email resolution deliberately has NO database entry point. An
-- earlier resolve_username() RPC granted to `anon` let any unauthenticated
-- caller convert guessed usernames into real email addresses — a harvesting
-- oracle aimed straight at finance administrators. It was dropped in
-- 20260807000001_remove_resolve_username_rpc.sql.
--
-- Username login now runs inside the `username-auth` Edge Function, which
-- resolves the username with the service role and hands back a session,
-- never an email address. These two objects are its rate limiter.

create table if not exists public.auth_attempts (
  id            bigserial   primary key,
  ip_hash       text        not null,
  username_hash text        not null,
  attempted_at  timestamptz not null default now()
);

create index if not exists auth_attempts_ip_idx
  on public.auth_attempts (ip_hash, attempted_at desc);
create index if not exists auth_attempts_username_idx
  on public.auth_attempts (username_hash, attempted_at desc);
create index if not exists auth_attempts_attempted_at_idx
  on public.auth_attempts (attempted_at);

-- RLS on with no policies: only the service role (BYPASSRLS) can read or write.
alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from anon, authenticated;
revoke all on sequence public.auth_attempts_id_seq from anon, authenticated;

-- Records the attempt and reports whether the caller is still under the caps:
-- 10/minute and 60/hour per IP, 20/hour per username.
create or replace function public.check_auth_rate_limit(
  p_ip_hash       text,
  p_username_hash text
)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ip_minute int;
  v_ip_hour   int;
  v_user_hour int;
begin
  if random() < 0.01 then
    delete from public.auth_attempts
    where  attempted_at < now() - interval '24 hours';
  end if;

  select count(*) into v_ip_minute
  from   public.auth_attempts
  where  ip_hash = p_ip_hash and attempted_at > now() - interval '1 minute';

  select count(*) into v_ip_hour
  from   public.auth_attempts
  where  ip_hash = p_ip_hash and attempted_at > now() - interval '1 hour';

  select count(*) into v_user_hour
  from   public.auth_attempts
  where  username_hash = p_username_hash and attempted_at > now() - interval '1 hour';

  insert into public.auth_attempts (ip_hash, username_hash)
  values (p_ip_hash, p_username_hash);

  return v_ip_minute < 10 and v_ip_hour < 60 and v_user_hour < 20;
end;
$$;

revoke all on function public.check_auth_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.check_auth_rate_limit(text, text) to service_role;

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

-- FOR EACH STATEMENT (not ROW): a bulk import firing N row events would
-- otherwise trigger N full-account recomputes. These use transition tables
-- to recompute each affected account once per statement instead. Postgres
-- does not allow a single trigger to declare transition tables while firing
-- on more than one event, so insert/update/delete are separate triggers.
create or replace function public.trg_ledger_balance_ins_fn()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in select distinct account_id, org_id from new_rows where account_id is not null
  loop
    perform public.recalculate_ledger_balances(r.account_id, r.org_id);
  end loop;
  return null;
end;
$$;

create or replace function public.trg_ledger_balance_upd_fn()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select distinct account_id, org_id from new_rows where account_id is not null
    union
    select distinct account_id, org_id from old_rows where account_id is not null
  loop
    perform public.recalculate_ledger_balances(r.account_id, r.org_id);
  end loop;
  return null;
end;
$$;

create or replace function public.trg_ledger_balance_del_fn()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in select distinct account_id, org_id from old_rows where account_id is not null
  loop
    perform public.recalculate_ledger_balances(r.account_id, r.org_id);
  end loop;
  return null;
end;
$$;

create trigger trg_ledger_balance_ins
  after insert on public.ledger_entries
  referencing new table as new_rows
  for each statement execute function public.trg_ledger_balance_ins_fn();

create trigger trg_ledger_balance_upd
  after update on public.ledger_entries
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.trg_ledger_balance_upd_fn();

create trigger trg_ledger_balance_del
  after delete on public.ledger_entries
  referencing old table as old_rows
  for each statement execute function public.trg_ledger_balance_del_fn();

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
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  v_user_id    uuid := auth.uid();
  v_org_id     uuid;
  v_name       text;
  v_slug       text;
  v_attempt    int  := 0;
  v_constraint text;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  v_name := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if length(v_name) = 0 then raise exception 'Organisation name cannot be empty'; end if;

  if exists (
    select 1 from public.organizations
    where  public.normalize_org_name(name) = public.normalize_org_name(v_name)
      and  status <> 'pending_deletion'
  ) then
    raise exception 'An organisation named "%" already exists. Please choose a different name.', v_name
      using errcode = 'unique_violation';
  end if;

  -- lower() must run BEFORE the character class, otherwise every capital
  -- matches [^a-z0-9] and is eaten ("Living Word" -> "iving-ord").
  v_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  if v_slug = '' or v_slug = 'primary' then v_slug := 'org'; end if;

  loop
    begin
      insert into public.organizations (name, slug, created_by, onboarding_complete)
      values (
        v_name,
        case when v_attempt = 0 then v_slug else v_slug || '-' || v_attempt end,
        v_user_id,
        false
      )
      returning id into v_org_id;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- Lost a race on the name — surface it instead of retrying the slug.
      if v_constraint = 'organizations_name_unique' then
        raise exception 'An organisation named "%" already exists. Please choose a different name.', v_name
          using errcode = 'unique_violation';
      end if;
      v_attempt := v_attempt + 1;
      if v_attempt > 9 then raise exception 'Could not generate a unique slug for: %', v_name; end if;
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
grant execute on function public.normalize_org_name(text) to authenticated;

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

  -- Seed a live fallback only when the group has no versions at all, so an org
  -- that already configured its General rule is never touched.
  if not exists (
    select 1 from public.allocation_configs where config_group_id = v_group_id
  ) then
    insert into public.allocation_configs (
      org_id, config_group_id, name,
      start_date, effective_from, effective_to,
      status, is_special, allocation_type, rows, version_number
    ) values (
      p_org_id, v_group_id, 'General Distribution Rule',
      v_org_date, v_org_date, null,
      'locked', false, 'percentage',
      '[{"category_name":"General","budget_portion":"Percentage","percentage":100}]'::jsonb,
      1
    );
  end if;
end;
$$;

grant execute on function public.complete_org_onboarding(uuid, text, text, int, text) to authenticated;

-- ── Distribution rule versioning RPC ─────────────────────────────────────────
-- Atomic creation of a new version of a distribution rule group.
-- Drafts never close the covering (live) version.

CREATE OR REPLACE FUNCTION public.create_special_config_version(
  p_group_id       uuid,
  p_org_id         uuid,
  p_name           text,
  p_allocation_type text,
  p_total_amount   numeric(15,2),
  p_rows           jsonb,
  p_effective_from date,
  p_status         text DEFAULT 'draft'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $$
DECLARE
  v_covering_id   uuid;
  v_next_from     date;
  v_new_to        date;
  v_max_ver       integer;
  v_new_id        uuid;
BEGIN
  IF NOT public.is_org_admin(p_org_id) THEN
    RAISE EXCEPTION 'create_special_config_version: caller must be an org admin';
  END IF;

  IF p_status NOT IN ('draft', 'locked') THEN
    RAISE EXCEPTION 'create_special_config_version: invalid status %', p_status;
  END IF;

  -- Lock the group row to prevent concurrent version creation. lock_timeout
  -- (set above) turns contention into a clear error rather than a hang.
  BEGIN
    PERFORM id FROM public.special_config_groups
    WHERE id = p_group_id AND org_id = p_org_id
    FOR UPDATE;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION
      'Another change to this distribution rule is still in progress. Wait a moment and try again.';
  END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_special_config_version: group % not found in org %', p_group_id, p_org_id;
  END IF;

  -- Compute next version number server-side (no client-supplied race window)
  SELECT COALESCE(MAX(version_number), 0) INTO v_max_ver
  FROM   public.allocation_configs
  WHERE  config_group_id = p_group_id AND org_id = p_org_id;

  IF p_status = 'locked' THEN
    -- Find the locked version whose range contains p_effective_from. Only
    -- locked versions define the live timeline, and the latest-starting match
    -- is the one actually in force.
    SELECT id INTO v_covering_id
    FROM   public.allocation_configs
    WHERE  config_group_id = p_group_id
      AND  org_id          = p_org_id
      AND  status          = 'locked'
      AND  superseded_by_id IS NULL
      AND  effective_from <= p_effective_from
      AND  (effective_to IS NULL OR effective_to >= p_effective_from)
    ORDER BY effective_from DESC
    LIMIT  1;

    -- Find the immediately following locked version to bound the new range
    SELECT effective_from INTO v_next_from
    FROM   public.allocation_configs
    WHERE  config_group_id = p_group_id
      AND  org_id          = p_org_id
      AND  status          = 'locked'
      AND  superseded_by_id IS NULL
      AND  effective_from  > p_effective_from
    ORDER BY effective_from
    LIMIT  1;

    v_new_to := CASE WHEN v_next_from IS NOT NULL
                     THEN v_next_from - 1
                     ELSE NULL END;

    -- Close the covering version. Skipped entirely for drafts: a draft must
    -- never shorten the rule that is currently live.
    IF v_covering_id IS NOT NULL THEN
      UPDATE public.allocation_configs
      SET    effective_to = p_effective_from - 1
      WHERE  id = v_covering_id
        AND  effective_from < p_effective_from;
    END IF;
  ELSE
    v_new_to := NULL;
  END IF;

  INSERT INTO public.allocation_configs (
    name, is_special, allocation_type, total_amount, rows,
    effective_from, effective_to, version_number,
    config_group_id, start_date, status, org_id
  ) VALUES (
    p_name,
    -- The General (default) group is the org-wide fallback, not a special rule
    NOT COALESCE((SELECT is_default FROM public.special_config_groups WHERE id = p_group_id), false),
    p_allocation_type, p_total_amount, p_rows,
    p_effective_from, v_new_to, v_max_ver + 1,
    p_group_id, p_effective_from, p_status, p_org_id
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL   ON FUNCTION public.create_special_config_version(uuid,uuid,text,text,numeric,jsonb,date,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_special_config_version(uuid,uuid,text,text,numeric,jsonb,date,text) TO authenticated;

-- ── approve_config_version — promote a draft to live ─────────────────────────
-- Drafts (including every rule the onboarding wizard creates) resolve to
-- nothing until locked. Flipping status with a bare UPDATE would leave two
-- locked versions covering the same day, so approving has to close the version
-- it supersedes and bound its own range — the same timeline arithmetic
-- create_special_config_version does, in one transaction.

CREATE OR REPLACE FUNCTION public.approve_config_version(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $$
DECLARE
  v_cfg         record;
  v_covering_id uuid;
  v_next_from   date;
BEGIN
  SELECT * INTO v_cfg FROM public.allocation_configs WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_config_version: version % not found', p_version_id;
  END IF;

  IF NOT public.is_org_admin(v_cfg.org_id) THEN
    RAISE EXCEPTION 'approve_config_version: caller must be an org admin';
  END IF;

  IF v_cfg.status <> 'draft' THEN
    RAISE EXCEPTION 'approve_config_version: version is already %', v_cfg.status;
  END IF;

  IF v_cfg.config_group_id IS NULL THEN
    RAISE EXCEPTION 'approve_config_version: version does not belong to a rule group';
  END IF;

  IF v_cfg.rows IS NULL OR jsonb_array_length(v_cfg.rows) = 0 THEN
    RAISE EXCEPTION 'approve_config_version: version has no category rows';
  END IF;

  BEGIN
    PERFORM id FROM public.special_config_groups
    WHERE id = v_cfg.config_group_id
    FOR UPDATE;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION
      'Another change to this distribution rule is still in progress. Wait a moment and try again.';
  END;

  IF EXISTS (
    SELECT 1 FROM public.allocation_configs
    WHERE config_group_id = v_cfg.config_group_id
      AND status          = 'locked'
      AND effective_from  = v_cfg.effective_from
      AND id             <> p_version_id
  ) THEN
    RAISE EXCEPTION
      'A live version of this rule already starts on %. Change this draft''s start date first.',
      v_cfg.effective_from;
  END IF;

  SELECT id INTO v_covering_id
  FROM   public.allocation_configs
  WHERE  config_group_id = v_cfg.config_group_id
    AND  status          = 'locked'
    AND  superseded_by_id IS NULL
    AND  effective_from < v_cfg.effective_from
    AND  (effective_to IS NULL OR effective_to >= v_cfg.effective_from)
  ORDER BY effective_from DESC
  LIMIT  1;

  IF v_covering_id IS NOT NULL THEN
    UPDATE public.allocation_configs
    SET    effective_to = v_cfg.effective_from - 1
    WHERE  id = v_covering_id;
  END IF;

  SELECT effective_from INTO v_next_from
  FROM   public.allocation_configs
  WHERE  config_group_id = v_cfg.config_group_id
    AND  status          = 'locked'
    AND  superseded_by_id IS NULL
    AND  effective_from  > v_cfg.effective_from
  ORDER BY effective_from
  LIMIT  1;

  UPDATE public.allocation_configs
  SET    status       = 'locked',
         effective_to = CASE
                          WHEN v_next_from IS NOT NULL
                            AND (effective_to IS NULL OR effective_to > v_next_from - 1)
                          THEN v_next_from - 1
                          ELSE effective_to
                        END
  WHERE  id = p_version_id;
END;
$$;

REVOKE ALL   ON FUNCTION public.approve_config_version(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.approve_config_version(uuid) TO authenticated;

-- ── amend_config_version — amend a locked version in place ───────────────────
-- A bare insert-then-supersede from the client raced with
-- idx_alloc_configs_group_effrom_unique: the amendment shares the original's
-- effective_from, and superseding never changes the original's status away
-- from 'locked', so two "locked" rows briefly (in practice: always) matched
-- the same (config_group_id, effective_from) slot. Inserting the amendment as
-- a draft first, superseding the original, then flipping the amendment to
-- locked keeps the two rows from ever occupying that slot at the same time.

CREATE OR REPLACE FUNCTION public.amend_config_version(
  p_original_id      uuid,
  p_allocation_type  text,
  p_total_amount     numeric(15,2),
  p_rows             jsonb,
  p_effective_from   date,
  p_effective_to     date,
  p_amendment_reason text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $$
DECLARE
  v_orig   record;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_orig FROM public.allocation_configs WHERE id = p_original_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'amend_config_version: version % not found', p_original_id;
  END IF;

  IF NOT public.is_org_admin(v_orig.org_id) THEN
    RAISE EXCEPTION 'amend_config_version: caller must be an org admin';
  END IF;

  IF v_orig.status <> 'locked' THEN
    RAISE EXCEPTION 'amend_config_version: only locked versions can be amended';
  END IF;

  IF v_orig.config_group_id IS NULL THEN
    RAISE EXCEPTION 'amend_config_version: version does not belong to a rule group';
  END IF;

  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'amend_config_version: at least one fund row is required';
  END IF;

  IF coalesce(trim(p_amendment_reason), '') = '' THEN
    RAISE EXCEPTION 'amend_config_version: amendment reason is required';
  END IF;

  BEGIN
    PERFORM id FROM public.special_config_groups
    WHERE id = v_orig.config_group_id
    FOR UPDATE;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION
      'Another change to this distribution rule is still in progress. Wait a moment and try again.';
  END;

  INSERT INTO public.allocation_configs (
    org_id, config_group_id, name, is_special, allocation_type, total_amount,
    rows, effective_from, effective_to, version_number, start_date, status,
    change_type, source_version_id, amendment_reason
  ) VALUES (
    v_orig.org_id, v_orig.config_group_id, v_orig.name, v_orig.is_special,
    p_allocation_type, p_total_amount, p_rows, p_effective_from, p_effective_to,
    v_orig.version_number + 1, p_effective_from, 'draft',
    'amendment', v_orig.id, trim(p_amendment_reason)
  )
  RETURNING id INTO v_new_id;

  UPDATE public.allocation_configs
  SET    superseded_by_id = v_new_id, superseded_at = now()
  WHERE  id = v_orig.id;

  UPDATE public.allocation_configs
  SET    status = 'locked'
  WHERE  id = v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL   ON FUNCTION public.amend_config_version(uuid,text,numeric,jsonb,date,date,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.amend_config_version(uuid,text,numeric,jsonb,date,date,text) TO authenticated;


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
    'outflow_classification_rules',
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

-- ── Offset-chaining guard ─────────────────────────────────────────────────────
-- An offset entry (offset_role = 'offset') must point directly at the root
-- transaction it corrects, not at another offset — otherwise a chain of
-- corrections could obscure which entry is actually authoritative.
create or replace function public.prevent_offset_chaining()
returns trigger language plpgsql as $$
begin
  if new.offset_role = 'offset' and new.root_transaction_id is not null then
    if new.root_transaction_table = 'inflow_transactions' then
      if exists (
        select 1 from public.inflow_transactions
        where id::text = new.root_transaction_id and offset_role = 'offset'
      ) then
        raise exception 'offset_chaining_not_allowed: root transaction is itself an offset';
      end if;
    elsif new.root_transaction_table = 'outflow_transactions' then
      if exists (
        select 1 from public.outflow_transactions
        where id::text = new.root_transaction_id and offset_role = 'offset'
      ) then
        raise exception 'offset_chaining_not_allowed: root transaction is itself an offset';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_prevent_inflow_offset_chaining
  before insert or update on public.inflow_transactions
  for each row execute function public.prevent_offset_chaining();

create trigger trg_prevent_outflow_offset_chaining
  before insert or update on public.outflow_transactions
  for each row execute function public.prevent_offset_chaining();

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

grant execute on function public.org_effective_plan_tier(uuid) to authenticated;
grant execute on function public.org_plan_at_least(uuid, text) to authenticated;
grant execute on function public.increment_import_count(uuid, int) to authenticated;

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
  delete from public.outflow_classification_rules      where org_id = p_org_id;
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

-- ── Atomic FX Conversion (LB-2/E-C2, H-3, H-4) ───────────────────────────────
-- SECURITY INVOKER: RLS on all three tables enforced with the caller's identity.
-- Postgres auto-rolls back all three inserts on any exception.
-- H-3: naira_amount is computed server-side from fx_amount * exchange_rate;
--      p_naira_amount is kept in the signature for caller compatibility only.
-- H-4: rejects the conversion outright if the FX balance is insufficient.
-- The advisory lock serializes concurrent conversions on the same org+currency
-- so two simultaneous calls can't both read the same running_balance.
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
  v_naira_amount  numeric(15,2);
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

  perform pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_fx_currency));

  select coalesce(running_balance, 0)
  into   v_prev_balance
  from   public.fx_transactions
  where  org_id   = p_org_id
    and  currency = p_fx_currency
  order  by date desc, created_at desc
  limit  1;

  v_prev_balance := coalesce(v_prev_balance, 0);

  if v_prev_balance < p_fx_amount then
    raise exception 'Insufficient FX balance: available % but requested %',
      v_prev_balance, p_fx_amount;
  end if;

  v_new_balance  := v_prev_balance - p_fx_amount;
  v_naira_amount := round(p_fx_amount * p_exchange_rate, 2);

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
    p_date, v_naira_amount,
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
    p_date, p_fx_currency, p_fx_amount, p_exchange_rate, v_naira_amount,
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

-- ── create_fx_transaction — server-side manual FX ledger entry ──────────────
-- Computes running_balance server-side under an advisory lock so two manual
-- entries for the same org+currency can't race on the same prior balance.
create or replace function public.create_fx_transaction(
  p_org_id          uuid,
  p_user_id         uuid,
  p_date            date,
  p_currency        text,
  p_deposit         numeric,
  p_withdrawal      numeric,
  p_narration       text default null,
  p_transaction_ref text default null,
  p_bank_name       text default null,
  p_bank_id         uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_balance numeric := 0;
  v_new_balance  numeric;
  v_new_id       uuid;
begin
  if p_org_id is null then
    raise exception 'org_id is required';
  end if;
  if coalesce(p_deposit, 0) < 0 or coalesce(p_withdrawal, 0) < 0 then
    raise exception 'deposit and withdrawal must be non-negative';
  end if;
  if coalesce(p_deposit, 0) = 0 and coalesce(p_withdrawal, 0) = 0 then
    raise exception 'Either deposit or withdrawal must be non-zero';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_currency));

  select coalesce(running_balance, 0)
  into   v_prev_balance
  from   public.fx_transactions
  where  org_id   = p_org_id
    and  currency = p_currency
  order  by date desc, created_at desc
  limit  1;

  v_prev_balance := coalesce(v_prev_balance, 0);
  v_new_balance  := v_prev_balance + coalesce(p_deposit, 0) - coalesce(p_withdrawal, 0);

  insert into public.fx_transactions (
    date, currency, deposit, withdrawal, running_balance,
    narration, transaction_ref, bank_name, bank_id, created_by, org_id
  ) values (
    p_date, p_currency,
    coalesce(p_deposit, 0), coalesce(p_withdrawal, 0),
    v_new_balance,
    p_narration, p_transaction_ref, p_bank_name, p_bank_id,
    p_user_id, p_org_id
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function public.create_fx_transaction(
  uuid, uuid, date, text, numeric, numeric, text, text, text, uuid
) to authenticated;

-- ── update_fx_transaction — edit a manual FX ledger entry ────────────────────
-- Full recompute: after any edit, running_balance is recalculated for every
-- row of this org+currency in ascending date/created_at order, so a changed
-- date correctly cascades through every later row.
create or replace function public.update_fx_transaction(
  p_org_id          uuid,
  p_user_id         uuid,
  p_transaction_id  uuid,
  p_date            date,
  p_currency        text,
  p_deposit         numeric,
  p_withdrawal      numeric,
  p_narration       text default null,
  p_transaction_ref text default null,
  p_bank_name       text default null,
  p_bank_id         uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance numeric;
begin
  if p_org_id is null then
    raise exception 'org_id is required';
  end if;
  if coalesce(p_deposit, 0) < 0 or coalesce(p_withdrawal, 0) < 0 then
    raise exception 'deposit and withdrawal must be non-negative';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_currency));

  update public.fx_transactions
  set
    date            = p_date,
    deposit         = coalesce(p_deposit, 0),
    withdrawal      = coalesce(p_withdrawal, 0),
    narration       = p_narration,
    transaction_ref = p_transaction_ref,
    bank_name       = p_bank_name,
    bank_id         = p_bank_id
  where id       = p_transaction_id
    and org_id   = p_org_id
    and currency = p_currency;

  if not found then
    raise exception 'FX transaction % not found or does not belong to this org', p_transaction_id;
  end if;

  with computed as (
    select id,
           sum(deposit - withdrawal) over (
             partition by org_id, currency
             order by date asc, created_at asc
             rows between unbounded preceding and current row
           ) as new_balance
    from   public.fx_transactions
    where  org_id   = p_org_id
      and  currency = p_currency
  )
  update public.fx_transactions t
  set    running_balance = c.new_balance
  from   computed c
  where  t.id = c.id;

  select running_balance into v_new_balance
  from   public.fx_transactions
  where  id = p_transaction_id;

  return v_new_balance;
end;
$$;

grant execute on function public.update_fx_transaction(
  uuid, uuid, uuid, date, text, numeric, numeric, text, text, text, uuid
) to authenticated;

-- ── update_fx_conversion — edit a conversion and cascade to its linked rows ──
create or replace function public.update_fx_conversion(
  p_conversion_id        uuid,
  p_org_id               uuid,
  p_user_id              uuid,
  p_exchange_rate        numeric,
  p_naira_amount         numeric,
  p_notes                text,
  p_allocation_config_id uuid,
  p_stage_code_1         text,
  p_stage_code_2         text,
  p_bank_name            text
)
returns jsonb
language plpgsql
as $$
declare v_conv record;
begin
  if not exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = auth.uid()
      and role in ('owner', 'admin') and status = 'active'
  ) then
    raise exception 'Only admins and owners can edit FX conversions';
  end if;

  select * into v_conv from public.fx_conversions where id = p_conversion_id and org_id = p_org_id;
  if not found then raise exception 'FX conversion not found'; end if;

  update public.fx_conversions set
    exchange_rate = p_exchange_rate, naira_amount = p_naira_amount,
    notes = p_notes, allocation_config_id = p_allocation_config_id
  where id = p_conversion_id;

  if v_conv.naira_inflow_id is not null then
    update public.inflow_transactions set
      amount = p_naira_amount, fx_rate = p_exchange_rate,
      description = coalesce(p_notes, description),
      allocation_config_id = p_allocation_config_id,
      stage_code_1 = p_stage_code_1, stage_code_2 = p_stage_code_2,
      bank_name = p_bank_name
    where id = v_conv.naira_inflow_id;
  end if;

  if v_conv.fx_withdrawal_id is not null and p_notes is not null then
    update public.fx_transactions set narration = p_notes where id = v_conv.fx_withdrawal_id;
  end if;

  return jsonb_build_object(
    'conversion_id', p_conversion_id,
    'inflow_id',     v_conv.naira_inflow_id,
    'fx_tx_id',      v_conv.fx_withdrawal_id
  );
end;
$$;

grant execute on function public.update_fx_conversion(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, text, text
) to authenticated;

-- ── revert_fx_conversion — undo a conversion and restore prior balances ──────
create or replace function public.revert_fx_conversion(
  p_conversion_id uuid,
  p_org_id        uuid,
  p_user_id       uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_conv    record;
  v_fx_date date;
  v_fx_ts   timestamptz;
  v_fx_amt  numeric;
  v_ccy     text;
begin
  if not exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = auth.uid()
      and role in ('owner', 'admin') and status = 'active'
  ) then
    raise exception 'Only admins and owners can revert FX conversions';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(
    (select fx_currency from public.fx_conversions where id = p_conversion_id and org_id = p_org_id)
  ));

  select * into v_conv from public.fx_conversions where id = p_conversion_id and org_id = p_org_id;
  if not found then raise exception 'FX conversion not found'; end if;

  v_ccy    := v_conv.fx_currency;
  v_fx_amt := v_conv.fx_amount;

  if v_conv.fx_withdrawal_id is not null then
    select date, created_at into v_fx_date, v_fx_ts
    from public.fx_transactions where id = v_conv.fx_withdrawal_id;

    delete from public.fx_transactions where id = v_conv.fx_withdrawal_id;

    update public.fx_transactions
    set running_balance = running_balance + v_fx_amt
    where org_id = p_org_id and currency = v_ccy
      and (date > v_fx_date or (date = v_fx_date and created_at > v_fx_ts));
  end if;

  if v_conv.naira_inflow_id is not null then
    delete from public.inflow_transactions where id = v_conv.naira_inflow_id;
  end if;

  delete from public.fx_conversions where id = p_conversion_id;

  return jsonb_build_object(
    'reverted_conversion_id', p_conversion_id,
    'fx_tx_deleted',          v_conv.fx_withdrawal_id,
    'inflow_deleted',         v_conv.naira_inflow_id
  );
end;
$$;

grant execute on function public.revert_fx_conversion(uuid, uuid, uuid) to authenticated;

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
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'level1')
  );
create policy "bsb_update" on public.bank_statement_balances
  for update using (public.is_org_finance_user(org_id));
create policy "bsb_delete" on public.bank_statement_balances
  for delete using (public.is_org_admin(org_id));
create index if not exists idx_bsb_org_bank on public.bank_statement_balances(org_id, bank_name);

-- ================================================================
-- 11b. DUPLICATE TRANSACTION REPORT
-- ================================================================
-- Groups on the full identity key, so every row it returns is a genuine
-- duplicate. Postings that merely share a reference (a transfer and its fee) do
-- not appear. On an existing database the indexes above cannot be created until
-- these are resolved. security_invoker so RLS applies per org.

CREATE OR REPLACE VIEW public.duplicate_transactions
WITH (security_invoker = true) AS
  SELECT 'inflow_transactions'::text AS source_table,
         org_id,
         public.txn_bank_key(bank_id, bank_name)   AS bank_key,
         max(bank_name)                            AS bank_name,
         public.normalize_txn_ref(transaction_ref) AS normalized_ref,
         date,
         amount,
         max(description)                          AS description,
         count(*)                                  AS row_count,
         count(*) - 1                              AS surplus_rows,
         amount * (count(*) - 1)                   AS overstated_amount,
         array_agg(id ORDER BY created_at, id)     AS row_ids
  FROM   public.inflow_transactions
  WHERE  public.normalize_txn_ref(transaction_ref) IS NOT NULL
  GROUP  BY org_id, 3, 5, date, amount,
            coalesce(public.normalize_txn_ref(description), ''), ref_occurrence
  HAVING count(*) > 1

  UNION ALL

  SELECT 'outflow_transactions'::text,
         org_id,
         public.txn_bank_key(bank_id, bank_name),
         max(bank_name),
         public.normalize_txn_ref(transaction_id),
         date,
         amount_disbursed,
         max(description),
         count(*),
         count(*) - 1,
         coalesce(amount_disbursed, 0) * (count(*) - 1),
         array_agg(id ORDER BY created_at, id)
  FROM   public.outflow_transactions
  WHERE  public.normalize_txn_ref(transaction_id) IS NOT NULL
  GROUP  BY org_id, 3, 5, date, amount_disbursed,
            coalesce(public.normalize_txn_ref(description), ''), ref_occurrence
  HAVING count(*) > 1

  UNION ALL

  SELECT 'fx_transactions'::text,
         org_id,
         public.txn_bank_key(bank_id, bank_name),
         max(bank_name),
         public.normalize_txn_ref(transaction_ref),
         date,
         coalesce(deposit, 0) + coalesce(withdrawal, 0),
         max(narration),
         count(*),
         count(*) - 1,
         (coalesce(deposit, 0) + coalesce(withdrawal, 0)) * (count(*) - 1),
         array_agg(id ORDER BY created_at, id)
  FROM   public.fx_transactions
  WHERE  public.normalize_txn_ref(transaction_ref) IS NOT NULL
  GROUP  BY org_id, 3, 5, date, deposit, withdrawal,
            coalesce(public.normalize_txn_ref(narration), ''), ref_occurrence
  HAVING count(*) > 1;

GRANT SELECT  ON public.duplicate_transactions             TO authenticated;
grant execute on function public.normalize_bank_name(text)  to authenticated;
grant execute on function public.normalize_txn_ref(text)    to authenticated;
grant execute on function public.txn_bank_key(uuid, text)   to authenticated;

-- ================================================================
-- 12. PLAN ENFORCEMENT — triggers
-- ================================================================
-- The per-table INSERT policies carrying the plan predicates live inline
-- with their tables in Section 9. This section holds the three checks
-- that RLS can't express, all of which need triggers.
--
-- DESIGN RULE, restated because these two triggers are where it bites:
-- enforcement is on CREATE, never on EDIT. A downgraded org keeps full
-- read, edit and delete access to everything it created on a higher
-- tier. Both triggers below therefore fire only when a gated value is
-- actually being introduced, not when an existing row is touched.

-- ── Plan / billing column lock ────────────────────────────────────────────────
-- orgs_update is `using (is_org_admin(id))` with no WITH CHECK, which in
-- Postgres means the USING expression doubles as the check — an admin can
-- write any column on their own org row. Column privileges can't express
-- "everything except these nine", so the guard is a trigger. Only the
-- service role (Stripe webhook, checkout/portal edge functions) and
-- sessions with no PostgREST JWT (migrations, psql) may pass.

create or replace function public.plan_guard_is_privileged()
returns boolean language plpgsql stable as $$
declare
  v_role text;
begin
  if coalesce(current_setting('app.plan_guard_bypass', true), '') = 'on' then
    return true;
  end if;

  begin
    v_role := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
  exception when others then
    v_role := '';
  end;

  -- '' = no PostgREST request context (a migration or direct psql session).
  return v_role in ('', 'service_role');
end;
$$;

create or replace function public.guard_org_plan_columns()
returns trigger language plpgsql as $$
declare
  -- Compared via to_jsonb rather than `new.plan_status is distinct from
  -- old.plan_status` and friends, so that a database which hasn't applied
  -- every billing migration yet still works: a direct field reference to a
  -- column that doesn't exist raises "record new has no field ..." and would
  -- take down EVERY organizations UPDATE, not just a plan change.
  v_guarded constant text[] := array[
    'plan_tier', 'plan_started_at', 'plan_expires_at', 'plan_status',
    'trial_ends_at', 'stripe_customer_id', 'stripe_subscription_id',
    'imported_rows_count', 'imported_rows_period_start'
  ];
  v_old jsonb;
  v_new jsonb;
  v_col text;
begin
  if public.plan_guard_is_privileged() then
    return new;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);

  foreach v_col in array v_guarded loop
    if v_new ? v_col and (v_old -> v_col) is distinct from (v_new -> v_col) then
      raise exception
        'Plan and billing fields are managed by billing and cannot be changed directly (%)', v_col
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_guard_org_plan_columns on public.organizations;
create trigger trg_guard_org_plan_columns
  before update on public.organizations
  for each row execute function public.guard_org_plan_columns();

-- ── transaction_type gate ─────────────────────────────────────────────────────
-- A trigger rather than an RLS WITH CHECK, specifically so a downgrade
-- doesn't trap data: WITH CHECK on UPDATE cannot see OLD, so it would
-- re-evaluate the row's existing transaction_type and block a Start-tier org
-- from editing a refund it created while on Impact.
create or replace function public.enforce_txn_type_plan()
returns trigger language plpgsql as $$
begin
  -- Nested rather than ANDed with tg_op: PL/pgSQL does not guarantee
  -- short-circuit evaluation, and OLD is unassigned during INSERT, so a
  -- single `tg_op = 'UPDATE' and old.x ...` can raise "record old is not
  -- assigned yet" on every insert.
  if tg_op = 'UPDATE' then
    if new.transaction_type is not distinct from old.transaction_type then
      return new;
    end if;
  end if;

  if not public.org_plan_allows_txn_type(new.org_id, new.transaction_type) then
    raise exception '% transactions require the Clariva Impact plan', new.transaction_type
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_inflow_txn_type_plan on public.inflow_transactions;
create trigger trg_inflow_txn_type_plan
  before insert or update on public.inflow_transactions
  for each row execute function public.enforce_txn_type_plan();

drop trigger if exists trg_outflow_txn_type_plan on public.outflow_transactions;
create trigger trg_outflow_txn_type_plan
  before insert or update on public.outflow_transactions
  for each row execute function public.enforce_txn_type_plan();

-- ── Bank quantity + foreign-currency caps ─────────────────────────────────────
-- Also a trigger: both caps need a count of sibling rows, and the currency
-- cap must distinguish "switching an existing FX bank's currency" from
-- "adding a second currency".
create or replace function public.enforce_bank_plan_limits()
returns trigger language plpgsql as $$
declare
  v_tier          text := public.org_effective_plan_tier(new.org_id);
  v_other_fx      int;
  v_currency_seen bool;
begin
  if tg_op = 'INSERT' and not public.org_can_add_bank(new.org_id) then
    raise exception 'The Clariva Start plan is limited to one bank account'
      using errcode = '42501';
  end if;

  -- Nothing further to check unless this row is (or is becoming) foreign
  -- currency. Editing an existing FX bank's other fields is always allowed.
  if not coalesce(new.is_foreign_currency, false) then
    return new;
  end if;

  -- Nested rather than ANDed with tg_op — see enforce_txn_type_plan().
  if tg_op = 'UPDATE' then
    if coalesce(old.is_foreign_currency, false)
       and new.currency is not distinct from old.currency then
      return new;
    end if;
  end if;

  if v_tier = 'free' then
    raise exception 'Foreign-currency accounts require the Clariva Growth plan'
      using errcode = '42501';
  end if;

  if v_tier = 'level1' then
    -- Growth may run any number of FX banks, but all in the same one foreign
    -- currency. Impact removes the currency-count cap.
    select count(distinct currency),
           bool_or(currency = new.currency)
      into v_other_fx, v_currency_seen
    from public.banks
    where org_id = new.org_id
      and is_foreign_currency
      and id <> new.id;

    if coalesce(v_other_fx, 0) >= 1 and not coalesce(v_currency_seen, false) then
      raise exception 'A second foreign currency requires the Clariva Impact plan'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bank_plan_limits on public.banks;
create trigger trg_bank_plan_limits
  before insert or update on public.banks
  for each row execute function public.enforce_bank_plan_limits();

grant execute on function public.org_plan_allows_txn_type(uuid, text) to authenticated;
grant execute on function public.org_can_add_bank(uuid)              to authenticated;
grant execute on function public.org_can_add_custom_rule(uuid)       to authenticated;
-- ================================================================
-- 12.9 LIVE-DATABASE RECONCILIATION
--
-- Objects that exist in the live database (created by migrations) but were
-- missing from this file. A fresh install must come up byte-identical to a
-- migrated database, otherwise disaster recovery, staging and any RLS
-- integration test are all validating a schema nobody actually runs.
--
-- Verified by loading this file into an empty Postgres, replaying every
-- forward migration on top, and diffing pg_catalog until the two converged.
-- ================================================================

-- ── Duplicate-name policies carried by the live database ─────────────────────
-- These were created under one name by an early migration and re-created under
-- a second name by a later "fresh install fix" migration, so production carries
-- both. The predicates are identical to their siblings above, so the pair is
-- redundant rather than permissive — but it is reproduced here so that a fresh
-- install matches the live database exactly and the drift check can demand
-- equality rather than "close enough".

drop policy if exists "fx_conversions_select" on public.fx_conversions;
create policy "fx_conversions_select" on public.fx_conversions
  for select using (public.is_org_member(org_id));

drop policy if exists "fx_conversions_insert" on public.fx_conversions;
create policy "fx_conversions_insert" on public.fx_conversions
  for insert with check (public.is_org_finance_user(org_id));

drop policy if exists "fx_conversions_delete" on public.fx_conversions;
create policy "fx_conversions_delete" on public.fx_conversions
  for delete using (public.is_org_finance_user(org_id));

drop policy if exists "org_deletion_backups_select" on public.org_deletion_backups;
create policy "org_deletion_backups_select" on public.org_deletion_backups
  for select using (public.is_org_owner(org_id));

drop policy if exists "user_preferences_select" on public.user_preferences;
create policy "user_preferences_select" on public.user_preferences
  for select using (user_id = auth.uid());

drop policy if exists "user_preferences_upsert" on public.user_preferences;
create policy "user_preferences_upsert" on public.user_preferences
  for insert with check (user_id = auth.uid());

drop policy if exists "user_preferences_update" on public.user_preferences;
create policy "user_preferences_update" on public.user_preferences
  for update using (user_id = auth.uid());

-- ── updated_at trigger on user_preferences ───────────────────────────────────
drop trigger if exists trg_user_preferences_updated_at on public.user_preferences;
create trigger trg_user_preferences_updated_at
  before update on public.user_preferences
  for each row execute function public.set_user_preferences_updated_at();

-- ── Indexes / constraints present live but absent here ───────────────────────
create index if not exists idx_org_deletion_backups_org
  on public.org_deletion_backups(org_id);

-- Required by the user_preferences upsert (on_conflict=user_id,org_id).
create unique index if not exists user_preferences_user_org_uniq
  on public.user_preferences(user_id, org_id);

-- Second, redundant unique on (org_id, name); the inline `unique (org_id, name)`
-- above already supplies outflow_types_org_id_name_key. Live carries both.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'outflow_types_org_name_unique') then
    alter table public.outflow_types
      add constraint outflow_types_org_name_unique unique (org_id, name);
  end if;
end $$;

-- ================================================================
-- 12.95 ATOMIC RESTORE SUBSYSTEM
--
-- Folded in verbatim from 20260806000002_atomic_restore_rpc.sql, which
-- had not been reflected here. Self-contained and idempotent.
-- ================================================================

-- ============================================================================
-- Atomic restore: delete + insert in ONE transaction
--
-- Finding addressed (app audit):
--   restoreFromBackup() issued ~26 DELETEs and N upserts as separate,
--   un-transacted PostgREST round-trips from a browser tab. A network drop, a
--   closed tab, or one FK violation between the delete loop and the insert loop
--   left the org permanently empty or half-populated, with no rollback path.
--   A half-restored ledger is worse than no ledger: it looks valid.
--
-- Design: rows are staged over many ordinary (RLS-protected) inserts, then a
-- single SECURITY DEFINER RPC replays them. Chunking the *upload* is safe;
-- chunking the *commit* is not, so commit_restore() does every delete and every
-- insert inside its own implicit transaction — any exception rolls back the lot.
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- ── 1. Allowlist ─────────────────────────────────────────────────────────────
-- commit_restore() builds dynamic SQL. Every identifier it interpolates comes
-- from this table and nowhere else — a caller cannot name an arbitrary relation.
-- Mirrors MANAGED_TABLES in src/utils/backupRestore.ts; insert_order matches the
-- registry's array order (parents before children), delete order is its reverse.

CREATE TABLE IF NOT EXISTS public.restore_allowed_tables (
  table_key         text    PRIMARY KEY,
  insert_order      integer NOT NULL,
  conflict_column   text    NOT NULL DEFAULT 'id',
  /* false = table has no org_id column (global or the org row itself) */
  org_scoped        boolean NOT NULL DEFAULT true,
  /* replace-mode wipes this table first. Never true for non-org-scoped tables:
     an unscoped DELETE would cross tenant boundaries. */
  delete_in_replace boolean NOT NULL DEFAULT false,
  /* 'update' = upsert; 'nothing' = insert-only (append-mode / audit tables) */
  conflict_action   text    NOT NULL DEFAULT 'update'
    CHECK (conflict_action IN ('update', 'nothing'))
);

ALTER TABLE public.restore_allowed_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "restore_allowed_tables_select" ON public.restore_allowed_tables;
CREATE POLICY "restore_allowed_tables_select" ON public.restore_allowed_tables
  FOR SELECT USING (auth.role() = 'authenticated');

-- Reconciled wholesale on every run so the allowlist can never drift from the
-- registry: a table dropped from MANAGED_TABLES disappears here too.
--
-- Upsert + prune rather than TRUNCATE: restore_staging carries an FK to this
-- table, and Postgres refuses to TRUNCATE a table referenced by a foreign key
-- even when the referencing table is empty — which would make every re-run
-- after the first one fail.
WITH seed (table_key, insert_order, conflict_column, org_scoped, delete_in_replace, conflict_action) AS (
  VALUES
    -- Configuration
    ('currencies'::text,                  1::integer, 'id'::text,   true,  true,  'update'::text),
    ('category_groups',                   2, 'id',   true,  true,  'update'),
    ('categories',                        3, 'id',   true,  true,  'update'),
    ('category_opening_balances',         4, 'id',   true,  true,  'update'),
    ('banks',                             5, 'id',   true,  true,  'update'),
    -- Allocation
    ('special_config_groups',             6, 'id',   true,  true,  'update'),
    ('allocation_configs',                7, 'id',   true,  true,  'update'),
    ('income_types',                      8, 'id',   true,  true,  'update'),
    ('outflow_types',                     9, 'id',   true,  true,  'update'),
    ('income_type_rules',                10, 'id',   true,  true,  'update'),
    -- Transactions
    ('inflow_transactions',              11, 'id',   true,  true,  'update'),
    ('outflow_transactions',             12, 'id',   true,  true,  'update'),
    ('intra_flows',                      13, 'id',   true,  true,  'update'),
    ('bank_deposits',                    14, 'id',   true,  true,  'update'),
    ('intrabank_transfers',              15, 'id',   true,  true,  'update'),
    ('fx_transactions',                  16, 'id',   true,  true,  'update'),
    ('fx_conversions',                   17, 'id',   true,  true,  'update'),
    ('transaction_allocation_snapshots', 18, 'id',   true,  false, 'nothing'),
    ('recalculation_logs',               19, 'id',   true,  false, 'nothing'),
    -- Projects
    ('special_projects',                 20, 'id',   true,  true,  'update'),
    ('project_entries',                  21, 'id',   true,  true,  'update'),
    -- Reports
    ('report_templates',                 22, 'id',   true,  true,  'update'),
    ('dynamic_reports',                  23, 'id',   true,  true,  'update'),
    ('dynamic_report_blocks',            24, 'id',   true,  true,  'update'),
    ('dynamic_report_snapshots',         25, 'id',   true,  true,  'update'),
    -- Membership
    ('org_members',                      26, 'id',   true,  false, 'update'),
    -- Reconciliation
    ('bank_statement_balances',          27, 'id',   true,  true,  'update'),
    ('reconciliation_runs',              28, 'id',   true,  false, 'nothing'),
    -- Audit trail: append-only, never deleted, never overwritten on conflict.
    ('receipts',                         29, 'id',   true,  false, 'nothing'),
    ('audit_log',                        30, 'id',   true,  false, 'nothing'),
    ('field_changes',                    31, 'id',   true,  false, 'nothing')
),
-- Data-modifying CTEs always execute, referenced or not.
upserted AS (
  INSERT INTO public.restore_allowed_tables
    (table_key, insert_order, conflict_column, org_scoped, delete_in_replace, conflict_action)
  SELECT * FROM seed
  ON CONFLICT (table_key) DO UPDATE SET
    insert_order      = EXCLUDED.insert_order,
    conflict_column   = EXCLUDED.conflict_column,
    org_scoped        = EXCLUDED.org_scoped,
    delete_in_replace = EXCLUDED.delete_in_replace,
    conflict_action   = EXCLUDED.conflict_action
  RETURNING table_key
)
-- Prune anything no longer in the registry. Fails loudly rather than silently
-- if an in-flight batch still references the removed key.
DELETE FROM public.restore_allowed_tables a
WHERE a.table_key NOT IN (SELECT s.table_key FROM seed s);

-- ── 2. Staging ───────────────────────────────────────────────────────────────
-- The client inserts here over as many round-trips as the payload needs. These
-- are ordinary RLS-protected writes; nothing destructive happens until commit.

CREATE TABLE IF NOT EXISTS public.restore_batches (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by   uuid        NOT NULL DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  status       text        NOT NULL DEFAULT 'staging'
    CHECK (status IN ('staging', 'committed', 'aborted'))
);

CREATE TABLE IF NOT EXISTS public.restore_staging (
  id        bigserial PRIMARY KEY,
  batch_id  uuid  NOT NULL REFERENCES public.restore_batches(id) ON DELETE CASCADE,
  -- FK to the allowlist: an unknown table name is rejected at staging time,
  -- long before anything is deleted.
  table_key text  NOT NULL REFERENCES public.restore_allowed_tables(table_key),
  rows      jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS restore_staging_batch_idx
  ON public.restore_staging (batch_id, table_key, id);

ALTER TABLE public.restore_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restore_staging ENABLE ROW LEVEL SECURITY;

-- Only an org OWNER may stage or commit a restore. Matches the destructiveness
-- of the operation: replace mode discards the org's entire ledger.
DROP POLICY IF EXISTS "restore_batches_all" ON public.restore_batches;
CREATE POLICY "restore_batches_all" ON public.restore_batches
  FOR ALL
  USING       (public.is_org_owner(org_id))
  WITH CHECK  (public.is_org_owner(org_id));

DROP POLICY IF EXISTS "restore_staging_all" ON public.restore_staging;
CREATE POLICY "restore_staging_all" ON public.restore_staging
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.restore_batches b
    WHERE b.id = restore_staging.batch_id AND public.is_org_owner(b.org_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.restore_batches b
    WHERE b.id = restore_staging.batch_id
      AND b.status = 'staging'
      AND public.is_org_owner(b.org_id)
  ));

-- ── 3. Commit ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.commit_restore(
  p_batch_id              uuid,
  p_mode                  text,
  p_acknowledge_data_loss boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id      uuid;
  v_status      text;
  v_tbl         record;
  v_rows        jsonb;
  v_cols        text[];
  v_collist     text;
  v_setlist     text;
  v_sql         text;
  v_live        bigint;
  v_staged      bigint;
  v_inserted    bigint;
  v_shortfall   text[]  := ARRAY[]::text[];
  v_total_short bigint  := 0;
  v_counts      jsonb   := '{}'::jsonb;
BEGIN
  IF p_mode NOT IN ('merge', 'replace') THEN
    RAISE EXCEPTION 'Unknown restore mode: %', p_mode USING ERRCODE = '22023';
  END IF;

  SELECT org_id, status INTO v_org_id, v_status
  FROM public.restore_batches WHERE id = p_batch_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Unknown restore batch %', p_batch_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'staging' THEN
    RAISE EXCEPTION 'Restore batch % is already %', p_batch_id, v_status USING ERRCODE = '55000';
  END IF;

  -- SECURITY DEFINER bypasses RLS, so authorisation is re-checked explicitly.
  IF NOT public.is_org_owner(v_org_id) THEN
    RAISE EXCEPTION 'Only an organisation owner may commit a restore'
      USING ERRCODE = '42501';
  END IF;

  -- A full-ledger replay can outrun the default statement timeout. Scoped to
  -- this transaction only.
  PERFORM set_config('statement_timeout', '600000', true);

  -- ── Replace-mode guard, server side ────────────────────────────────────────
  -- The client runs the same comparison before uploading, but the client is not
  -- a trust boundary: a truncated or wrong-org backup must not be able to empty
  -- the ledger just because the browser skipped the preflight.
  IF p_mode = 'replace' AND NOT p_acknowledge_data_loss THEN
    FOR v_tbl IN
      SELECT * FROM public.restore_allowed_tables
      WHERE delete_in_replace ORDER BY insert_order
    LOOP
      EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id = $1', v_tbl.table_key)
        INTO v_live USING v_org_id;

      SELECT coalesce(sum(jsonb_array_length(s.rows)), 0) INTO v_staged
      FROM public.restore_staging s
      WHERE s.batch_id = p_batch_id AND s.table_key = v_tbl.table_key;

      IF v_staged < v_live THEN
        v_shortfall   := v_shortfall || format('%s (%s live vs %s staged)',
                                               v_tbl.table_key, v_live, v_staged);
        v_total_short := v_total_short + (v_live - v_staged);
      END IF;
    END LOOP;

    IF array_length(v_shortfall, 1) > 0 THEN
      RAISE EXCEPTION
        'Replace refused: backup is short by % row(s) — %. Re-confirm explicitly to proceed.',
        v_total_short, array_to_string(v_shortfall, '; ')
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- ── Delete, children before parents ────────────────────────────────────────
  -- Always org-scoped: RLS is bypassed here, so the WHERE clause is the only
  -- thing standing between this and another tenant's data.
  IF p_mode = 'replace' THEN
    FOR v_tbl IN
      SELECT * FROM public.restore_allowed_tables
      WHERE delete_in_replace ORDER BY insert_order DESC
    LOOP
      EXECUTE format('DELETE FROM public.%I WHERE org_id = $1', v_tbl.table_key)
        USING v_org_id;
    END LOOP;
  END IF;

  -- ── Insert, parents before children ────────────────────────────────────────
  FOR v_tbl IN
    SELECT * FROM public.restore_allowed_tables ORDER BY insert_order
  LOOP
    SELECT coalesce(jsonb_agg(elem ORDER BY s.id, ord), '[]'::jsonb) INTO v_rows
    FROM public.restore_staging s,
         LATERAL jsonb_array_elements(s.rows) WITH ORDINALITY AS t(elem, ord)
    WHERE s.batch_id = p_batch_id AND s.table_key = v_tbl.table_key;

    IF jsonb_array_length(v_rows) = 0 THEN CONTINUE; END IF;

    IF v_tbl.org_scoped THEN
      -- Overwrite org_id on every row rather than trusting the file. A backup
      -- taken from another org cannot be used to write into this one.
      SELECT jsonb_agg(elem || jsonb_build_object('org_id', v_org_id))
        INTO v_rows FROM jsonb_array_elements(v_rows) elem;
    ELSIF v_tbl.table_key = 'organizations' THEN
      -- Only the org being restored; never a sibling tenant's row.
      SELECT coalesce(jsonb_agg(elem), '[]'::jsonb) INTO v_rows
      FROM jsonb_array_elements(v_rows) elem
      WHERE elem->>'id' = v_org_id::text;

      IF jsonb_array_length(v_rows) = 0 THEN CONTINUE; END IF;
    END IF;

    -- Restore only columns the payload actually carries and the table actually
    -- has: an older backup missing a newer column must not null it out, and a
    -- newer backup with a dropped column must not abort the restore.
    SELECT array_agg(DISTINCT k ORDER BY k) INTO v_cols
    FROM jsonb_array_elements(v_rows) e, jsonb_object_keys(e) k
    WHERE k IN (
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_tbl.table_key
        AND is_generated = 'NEVER' AND identity_generation IS DISTINCT FROM 'ALWAYS'
    );

    IF v_cols IS NULL OR array_length(v_cols, 1) = 0 THEN
      RAISE EXCEPTION 'Backup rows for % carry no column matching the live schema',
        v_tbl.table_key USING ERRCODE = '42703';
    END IF;
    IF NOT (v_tbl.conflict_column = ANY (v_cols)) THEN
      RAISE EXCEPTION 'Backup rows for % are missing the key column %',
        v_tbl.table_key, v_tbl.conflict_column USING ERRCODE = '42703';
    END IF;

    SELECT string_agg(quote_ident(c), ', ' ORDER BY c) INTO v_collist FROM unnest(v_cols) c;
    SELECT string_agg(format('%I = EXCLUDED.%I', c, c), ', ' ORDER BY c) INTO v_setlist
    FROM unnest(v_cols) c WHERE c <> v_tbl.conflict_column;

    v_sql := format(
      'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(null::public.%I, $1) ON CONFLICT (%I) DO %s',
      v_tbl.table_key,
      v_collist,
      v_collist,
      v_tbl.table_key,
      v_tbl.conflict_column,
      CASE
        WHEN v_tbl.conflict_action = 'nothing' OR v_setlist IS NULL THEN 'NOTHING'
        ELSE 'UPDATE SET ' || v_setlist
      END
    );

    EXECUTE v_sql USING v_rows;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(v_tbl.table_key, v_inserted);
  END LOOP;

  -- Staged payload is dead weight once replayed; the batch row is kept as a
  -- record that the restore happened.
  DELETE FROM public.restore_staging WHERE batch_id = p_batch_id;
  UPDATE public.restore_batches SET status = 'committed' WHERE id = p_batch_id;

  RETURN jsonb_build_object('org_id', v_org_id, 'mode', p_mode, 'counts', v_counts);
END;
$$;

REVOKE ALL ON FUNCTION public.commit_restore(uuid, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.commit_restore(uuid, text, boolean) TO authenticated;

-- ── 4. Housekeeping ──────────────────────────────────────────────────────────
-- Abandoned batches (tab closed mid-upload) hold no locks and touch no live
-- data, but should not accumulate.

CREATE OR REPLACE FUNCTION public.purge_stale_restore_batches(p_older_than interval DEFAULT '24 hours')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM public.restore_batches
  WHERE status = 'staging' AND created_at < now() - p_older_than;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_stale_restore_batches(interval) FROM public;

NOTIFY pgrst, 'reload schema';


-- ================================================================
-- BALANCE AGGREGATES (20260807000003_balance_aggregate_rpcs)
-- ================================================================
-- Server-side sums for the balance screens. Before these, every balance view
-- streamed the org's whole transaction history to the browser and added it up
-- in JavaScript. See the migration file for the full rationale.
--
-- SECURITY INVOKER (not DEFINER) is deliberate: the caller's RLS policies still
-- apply to the underlying tables, so p_org_id cannot be used to read another
-- tenant's ledger.
--
-- Fidelity rule: these are a performance change, NOT a numbers change. Every
-- filter and sign convention mirrors the JavaScript it replaces exactly,
-- including two behaviours that are arguably wrong but out of scope here:
--   1. Outflows with a NULL stage_code_2 are excluded from the percentage
--      bucket (the client used PostgREST `not.eq`, which drops NULLs).
--   2. Bank balances count every outflow but exclude balance_brought_forward
--      inflows, and apply no offset_role handling on either side.

drop function if exists public.org_bank_balance_totals(uuid);

create function public.org_bank_balance_totals(p_org_id uuid)
returns table (
  bank_id       uuid,
  bank_name     text,
  inflow_total  numeric,
  outflow_total numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with inf as (
    select
      i.bank_id                                         as bank_id,
      case when i.bank_id is null then i.bank_name end  as bank_name,
      sum(coalesce(i.amount, 0))                        as total
    from public.inflow_transactions i
    where i.org_id = p_org_id
      and i.transaction_type is distinct from 'balance_brought_forward'
      and (i.bank_id is not null or nullif(i.bank_name, '') is not null)
    group by 1, 2
  ),
  outf as (
    select
      o.bank_id                                         as bank_id,
      case when o.bank_id is null then o.bank_name end  as bank_name,
      sum(coalesce(o.amount_disbursed, 0))              as total
    from public.outflow_transactions o
    where o.org_id = p_org_id
      and (o.bank_id is not null or nullif(o.bank_name, '') is not null)
    group by 1, 2
  )
  select
    coalesce(inf.bank_id,   outf.bank_id)   as bank_id,
    coalesce(inf.bank_name, outf.bank_name) as bank_name,
    coalesce(inf.total, 0)                  as inflow_total,
    coalesce(outf.total, 0)                 as outflow_total
  from inf
  full outer join outf
    on  inf.bank_id   is not distinct from outf.bank_id
    and inf.bank_name is not distinct from outf.bank_name;
$$;

-- Grouping is by the RAW (category_id, stage_code_1) pair, not by a resolved
-- name: rename-resolution stays in src/utils/categoryReferences.ts so there is
-- one implementation rather than two that can drift.

drop function if exists public.org_category_fund_totals(uuid);

create function public.org_category_fund_totals(p_org_id uuid)
returns table (
  category_id    uuid,
  stage_code_1   text,
  seed_in        numeric,
  seed_out       numeric,
  seed_out_count bigint,
  sav_in         numeric,
  sav_out        numeric,
  pct_out        numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with inflow_side as (
    select
      i.category_id,
      i.stage_code_1,
      sum(coalesce(i.amount, 0)) filter (where i.stage_code_2 = 'Specific Seed') as seed_in,
      sum(coalesce(i.amount, 0)) filter (where i.stage_code_2 = 'Savings')       as sav_in
    from public.inflow_transactions i
    where i.org_id = p_org_id
      and i.stage_code_2 in ('Specific Seed', 'Savings')
    group by 1, 2
  ),
  outflow_side as (
    select
      o.category_id,
      o.stage_code_1,
      sum(
        case when o.offset_role = 'offset' then -coalesce(o.amount_disbursed, 0)
             else coalesce(o.amount_disbursed, 0) end
      ) filter (where o.stage_code_2 = 'Specific Seed')  as seed_out,
      count(*) filter (where o.stage_code_2 = 'Specific Seed') as seed_out_count,
      sum(
        case when o.offset_role = 'offset' then -coalesce(o.amount_disbursed, 0)
             else coalesce(o.amount_disbursed, 0) end
      ) filter (where o.stage_code_2 = 'Savings')        as sav_out,
      -- NULL stage_code_2 excluded on purpose — see the fidelity note above.
      sum(
        case when o.offset_role = 'offset' then -coalesce(o.amount_disbursed, 0)
             else coalesce(o.amount_disbursed, 0) end
      ) filter (
        where o.stage_code_2 is not null
          and o.stage_code_2 <> 'Specific Seed'
          and o.stage_code_2 <> 'Savings'
      )                                                  as pct_out
    from public.outflow_transactions o
    where o.org_id = p_org_id
    group by 1, 2
  )
  select
    coalesce(i.category_id,  o.category_id)  as category_id,
    coalesce(i.stage_code_1, o.stage_code_1) as stage_code_1,
    coalesce(i.seed_in,        0) as seed_in,
    coalesce(o.seed_out,       0) as seed_out,
    coalesce(o.seed_out_count, 0) as seed_out_count,
    coalesce(i.sav_in,         0) as sav_in,
    coalesce(o.sav_out,        0) as sav_out,
    coalesce(o.pct_out,        0) as pct_out
  from inflow_side i
  full outer join outflow_side o
    on  i.category_id  is not distinct from o.category_id
    and i.stage_code_1 is not distinct from o.stage_code_1;
$$;

-- Per-target breakdown for the Designated Gifts tab. `latest` is text because
-- the client compares it as an ISO string, and '' sorts below every real date.

drop function if exists public.org_seed_target_totals(uuid);

create function public.org_seed_target_totals(p_org_id uuid)
returns table (
  category_id  uuid,
  stage_code_1 text,
  label        text,
  total        numeric,
  entry_count  bigint,
  latest       text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    i.category_id,
    i.stage_code_1,
    coalesce(
      nullif(i.specific_seed_description, ''),
      nullif(i.description, ''),
      '(No target specified)'
    )                                        as label,
    sum(coalesce(i.amount, 0))               as total,
    count(*)                                 as entry_count,
    coalesce(max(i.date)::text, '')          as latest
  from public.inflow_transactions i
  where i.org_id = p_org_id
    and i.stage_code_2 = 'Specific Seed'
  group by 1, 2, 3;
$$;

revoke all on function public.org_bank_balance_totals(uuid)   from public;
revoke all on function public.org_category_fund_totals(uuid)  from public;
revoke all on function public.org_seed_target_totals(uuid)    from public;

grant execute on function public.org_bank_balance_totals(uuid)  to authenticated;
grant execute on function public.org_category_fund_totals(uuid) to authenticated;
grant execute on function public.org_seed_target_totals(uuid)   to authenticated;

notify pgrst, 'reload schema';


-- ================================================================
-- 13. SCHEMA RELOAD
-- ================================================================

notify pgrst, 'reload schema';
