-- ================================================================
-- Lock billing columns on public.organizations
--
-- The "orgs_update" RLS policy is row-level only: any org admin may
-- update their own organization row, and that includes the billing
-- columns that live on the same table. An admin with DevTools could
-- therefore grant themselves a paid plan, clear the expiry, or reset
-- the monthly import counter.
--
-- Two layers of defence:
--   1. Column-level REVOKE UPDATE  — Postgres rejects the write before
--      RLS is even consulted.
--   2. BEFORE UPDATE guard trigger — backstop in case a later migration
--      re-grants table-wide UPDATE. Only privileged roles (service_role
--      from the Stripe webhook, or the owner role that SECURITY DEFINER
--      functions such as increment_import_count() run as) may change
--      these values.
--
-- Legitimate client writes to this table (timezone, org_type, metadata,
-- name) are unaffected.
--
-- Idempotent: safe to re-run.
-- ================================================================

-- ── 1. Column-level privileges ───────────────────────────────────────────────
-- Postgres has no "revoke one column" primitive: revoking table-wide UPDATE
-- and re-granting the safe columns is the standard way to express this.
revoke update on public.organizations from authenticated, anon;

do $$
declare
  v_col text;
  -- Every column EXCEPT the billing/metering ones.
  v_locked text[] := array[
    'plan_tier',
    'plan_status',
    'plan_started_at',
    'plan_expires_at',
    'trial_ends_at',
    'stripe_customer_id',
    'stripe_subscription_id',
    'imported_rows_count',
    'imported_rows_period_start'
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

-- ── 2. Guard trigger ─────────────────────────────────────────────────────────
create or replace function public.guard_organization_billing_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- current_user is 'service_role' for the Stripe webhook (service-role key)
  -- and the table owner for SECURITY DEFINER functions. Ordinary browser
  -- sessions arrive as 'authenticated' (or 'anon') and are blocked.
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

notify pgrst, 'reload schema';
