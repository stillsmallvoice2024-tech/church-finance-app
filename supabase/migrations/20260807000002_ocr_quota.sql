-- ================================================================
-- OCR spend control — pdf-ocr Edge Function
--
-- The pdf-ocr function authenticated the caller and then went straight
-- to the paid model: no plan check, no role check, no quota, no size
-- cap. Every call is a billed Sonnet request at up to 8,000 tokens and
-- the cost lands on the API-key owner, not the tenant. Any authenticated
-- user — including a free-tier viewer, or one throwaway signup made with
-- a leaked anon key — could loop it without limit.
--
-- FEATURE_TIERS already declares ocrImport: 'full', but that gate lived
-- only in the browser, and 20260807000000_plan_enforcement moved every
-- other paid feature's enforcement into the database. OCR was missed
-- because it is not a table INSERT — nothing to attach a policy to. This
-- migration gives it the equivalent: a single authorising RPC the Edge
-- Function must call before it spends anything.
--
-- Everything is decided in one round trip, under the row lock that also
-- increments the counter, so concurrent pages cannot race past the cap.
--
-- Idempotent: safe to re-run.
-- ================================================================


-- ════════════════════════════════════════════════════════════════
-- 1. Usage counter
-- ════════════════════════════════════════════════════════════════
-- One row per org per UTC day. Deliberately not an audited business
-- table: it is metering data, it is written by the service role only,
-- and old rows are disposable (see the cleanup note in step 4).
create table if not exists public.ocr_usage (
  org_id     uuid        not null references public.organizations(id) on delete cascade,
  usage_date date        not null default (now() at time zone 'utc')::date,
  pages      int         not null default 0,
  updated_at timestamptz not null default now(),
  primary key (org_id, usage_date)
);

comment on table public.ocr_usage is
  'Per-org daily OCR page count backing the pdf-ocr spend cap. Written only by consume_ocr_page() under the service role.';

alter table public.ocr_usage enable row level security;

-- No policies: RLS with zero policies denies everything to anon and
-- authenticated. The service role bypasses RLS, and the SECURITY DEFINER
-- function below is the only intended writer. Orgs read their own usage
-- through the RPC's return value, not by selecting the table.
revoke all on public.ocr_usage from anon, authenticated;


-- ════════════════════════════════════════════════════════════════
-- 2. Daily page allowance
-- ════════════════════════════════════════════════════════════════
-- 300 pages/day sits far above real use — a long bank statement is
-- 10-30 pages — while capping worst-case spend per org per day at a
-- known, small number. Stored per-org so a genuine heavy user can be
-- raised by a service-role UPDATE without a code change or redeploy.
alter table public.organizations
  add column if not exists ocr_daily_page_limit int not null default 300;

comment on column public.organizations.ocr_daily_page_limit is
  'Max OCR pages this org may submit per UTC day. Raise per-org via service role if a tenant legitimately needs more.';

-- A cap an org admin can raise is not a cap. 20260807000000_lock_billing_columns
-- grants UPDATE per column, and a column added afterwards inherits no grant — so
-- this is already unwritable from the app. Extending the guard trigger as well
-- keeps the two lists in step: if a later migration re-runs that grant loop over
-- every column, the trigger still refuses.
revoke update (ocr_daily_page_limit) on public.organizations from authenticated, anon;

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


-- ════════════════════════════════════════════════════════════════
-- 3. Authorise-and-meter RPC
-- ════════════════════════════════════════════════════════════════
-- Called by the pdf-ocr Edge Function BEFORE the upstream model call,
-- once per page. Returns a verdict rather than raising, so the function
-- can surface a precise reason to the operator.
--
-- Takes p_user_id explicitly: the Edge Function holds the service role,
-- so auth.uid() is null there and the is_org_member()/is_org_finance_user()
-- helpers cannot be reused as-is.
--
-- Three gates, cheapest first:
--   1. membership + role — viewers never import, so they never OCR
--   2. plan              — FEATURE_TIERS.ocrImport = 'full'
--   3. daily quota       — counted under the upserted row's lock
--
-- The counter is incremented only when all three pass, so refusals are
-- free and a refused caller cannot burn their own allowance.
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
  -- 1. Membership and role.
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

  -- 2. Plan.
  if not public.org_plan_at_least(p_org_id, 'full') then
    return jsonb_build_object('allowed', false, 'reason', 'plan_too_low');
  end if;

  select ocr_daily_page_limit into v_limit
  from public.organizations
  where id = p_org_id;

  -- 3. Quota. The upsert takes the row lock; concurrent pages serialise
  -- here, so the check below always sees a settled count.
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

  update public.ocr_usage
  set pages = pages + v_want, updated_at = now()
  where org_id = p_org_id
    and usage_date = (now() at time zone 'utc')::date
  returning pages into v_used;

  return jsonb_build_object('allowed', true, 'used', v_used, 'limit', v_limit);
end;
$$;

-- Service role only. Granting this to authenticated would hand every
-- logged-in user a way to burn their own org's allowance directly.
revoke all on function public.consume_ocr_page(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.consume_ocr_page(uuid, uuid, int) to service_role;


-- ════════════════════════════════════════════════════════════════
-- 4. Retention
-- ════════════════════════════════════════════════════════════════
-- Only today's row is ever consulted; older rows are kept purely so usage
-- trends can be eyeballed. Rows are tiny (one per org per day), so this
-- one sweep on re-run is enough — no scheduled job required.
create index if not exists idx_ocr_usage_date on public.ocr_usage(usage_date);

delete from public.ocr_usage
where usage_date < ((now() at time zone 'utc')::date - 90);

notify pgrst, 'reload schema';
