-- ================================================================
-- Plan Enforcement — Phase 3
--
-- Until now, subscription tiers were enforced *only* in the browser:
-- every gate was a React component, org_plan_at_least() was defined and
-- granted but never called by a single policy, and resolveEffectiveTier()
-- failed OPEN to 'full'. Three consequences, all exploitable without any
-- special tooling:
--
--   1. Deleting a DOM node re-enabled the feature underneath it.
--   2. A failed/slow org lookup handed out the top tier.
--   3. orgs_update had no WITH CHECK and no column restriction, so any
--      org admin could set their own plan_tier = 'full' directly.
--
-- This migration moves enforcement into the database:
--
--   1. Grandfather every org that exists today (see note below).
--   2. Lock the plan/billing columns to the service role.
--   3. Gate INSERTs on the tables each paid feature writes to.
--   4. Gate the transaction_type values the Adjustments / Bank Movement
--      pages exist to manage.
--
-- DESIGN RULE — enforcement is on CREATE, never on READ/EDIT/DELETE.
-- A downgrade must never trap an org's existing data: they keep full
-- read, edit and delete access to everything they created on a higher
-- tier. They simply cannot create *more* of it. Every check below is
-- therefore INSERT-only, or (for transaction_type) fires only when the
-- gated value is actually being introduced.
--
-- Idempotent: safe to re-run.
-- ================================================================


-- ════════════════════════════════════════════════════════════════
-- 1. Grandfathering
-- ════════════════════════════════════════════════════════════════
-- 20260805000000_subscription_tiers granted one year of 'full' to every
-- org that existed when it ran. Two gaps that pass extends over:
--
--   • Orgs created AFTER that migration defaulted to 'free', but the
--     client-side fail-open has been letting them use paid features
--     anyway. Switching enforcement on would take those features away
--     with no notice, so they get the same one-year deal.
--   • If the original backfill was missed or only partly applied on a
--     given database, this re-asserts it. That matters because step 2
--     below makes plan columns unwritable from the app — after this
--     point a missed org can only be fixed by a direct service-role
--     statement.
--
-- Anything already resolving to 'full', and anything with a live Stripe
-- subscription, is left untouched.
do $$
declare
  v_cutoff timestamptz := now();
  v_count  int;
begin
  update public.organizations
  set plan_tier       = 'full',
      plan_started_at = v_cutoff,
      plan_expires_at = v_cutoff + interval '1 year',
      plan_status     = 'active'
  where public.org_effective_plan_tier(id) <> 'full'
    and stripe_subscription_id is null;

  get diagnostics v_count = row_count;
  raise notice 'plan_enforcement: grandfathered % organization(s) to full until %',
    v_count, v_cutoff + interval '1 year';
end $$;


-- ════════════════════════════════════════════════════════════════
-- 2. Lock the plan / billing columns
-- ════════════════════════════════════════════════════════════════
-- orgs_update is `using (is_org_admin(id))` with no WITH CHECK, which in
-- Postgres means the USING expression doubles as the check — an admin
-- can write any column on their own org row, plan_tier included. Column
-- privileges can't express "admins may edit everything except these
-- nine", so the guard is a trigger.
--
-- Allowed through: the service role (Stripe webhook, checkout/portal
-- edge functions), and any session with no PostgREST JWT at all
-- (migrations, psql, dashboard SQL editor).

create or replace function public.plan_guard_is_privileged()
returns boolean language plpgsql stable as $$
declare
  v_role text;
begin
  -- Transaction-local bypass, set by the SECURITY DEFINER RPCs below that
  -- legitimately move the import counter on behalf of a normal user.
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

-- increment_import_count() runs as SECURITY DEFINER but inside the calling
-- user's request, so request.jwt.claims still reads 'authenticated' and the
-- guard above would block its write. Re-declared here with the bypass flag
-- set; body is otherwise identical to 20260806000000_import_cap_monthly.
create or replace function public.increment_import_count(p_org_id uuid, p_count int)
returns int language plpgsql security definer as $$
declare
  v_new_count     int;
  v_period_start  timestamptz;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this organization';
  end if;

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


-- ════════════════════════════════════════════════════════════════
-- 3. Plan predicates used by the policies below
-- ════════════════════════════════════════════════════════════════

-- Which tier a given inflow/outflow transaction_type requires. Mirrors
-- TXN_TYPE_FEATURE in src/hooks/usePlan.ts — the four types the
-- Adjustments and Bank Movement pages exist to manage, both Impact-tier
-- features. NULL / ordinary types are unrestricted.
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

-- Mirrors QUANTITY_LIMITS.multiBank — Start is capped at one bank,
-- Growth and Impact are unlimited.
create or replace function public.org_can_add_bank(p_org_id uuid)
returns boolean language sql stable security definer as $$
  select public.org_plan_at_least(p_org_id, 'level1')
      or (select count(*) from public.banks where org_id = p_org_id) < 1;
$$;

-- Mirrors QUANTITY_LIMITS.customDistributionRules — Start none,
-- Growth two, Impact unlimited. A custom distribution rule is one
-- special_config_groups row.
create or replace function public.org_can_add_custom_rule(p_org_id uuid)
returns boolean language sql stable security definer as $$
  select case public.org_effective_plan_tier(p_org_id)
    when 'full'   then true
    when 'level1' then (select count(*) from public.special_config_groups where org_id = p_org_id) < 2
    else               false
  end;
$$;

grant execute on function public.org_plan_allows_txn_type(uuid, text) to authenticated;
grant execute on function public.org_can_add_bank(uuid)              to authenticated;
grant execute on function public.org_can_add_custom_rule(uuid)       to authenticated;


-- ════════════════════════════════════════════════════════════════
-- 4. Growth-tier (level1) gates
-- ════════════════════════════════════════════════════════════════
-- INSERT policies only — see the DESIGN RULE at the top. The existing
-- role predicate is preserved and the plan predicate ANDed onto it.

-- fx / multi-currency
drop policy if exists "fx_insert" on public.fx_transactions;
create policy "fx_insert" on public.fx_transactions
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'level1')
  );

drop policy if exists "fxc_insert" on public.fx_conversions;
create policy "fxc_insert" on public.fx_conversions
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'level1')
  );

-- receipts
drop policy if exists "receipts_insert" on public.receipts;
create policy "receipts_insert" on public.receipts
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'level1')
  );

-- reconciliation
drop policy if exists "bsb_insert" on public.bank_statement_balances;
create policy "bsb_insert" on public.bank_statement_balances
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'level1')
  );

-- team invites
drop policy if exists "invitations_insert" on public.invitations;
create policy "invitations_insert" on public.invitations
  for insert with check (
    public.is_org_admin(org_id)
    and public.org_plan_at_least(org_id, 'level1')
  );

-- saved report templates
drop policy if exists "report_templates_insert" on public.report_templates;
create policy "report_templates_insert" on public.report_templates
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'level1')
  );

-- custom distribution rules (quantity-capped, not on/off)
drop policy if exists "scg_insert" on public.special_config_groups;
create policy "scg_insert" on public.special_config_groups
  for insert with check (
    public.is_org_admin(org_id)
    and public.org_can_add_custom_rule(org_id)
  );


-- ════════════════════════════════════════════════════════════════
-- 5. Impact-tier (full) gates
-- ════════════════════════════════════════════════════════════════

-- bank movement
drop policy if exists "bank_deposits_insert" on public.bank_deposits;
create policy "bank_deposits_insert" on public.bank_deposits
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'full')
  );

drop policy if exists "intrabank_insert" on public.intrabank_transfers;
create policy "intrabank_insert" on public.intrabank_transfers
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'full')
  );

-- dynamic (custom) reports — children isolate via their parent report,
-- so gating the parent's INSERT is what actually stops new ones being
-- built; the child policies keep working on reports that already exist.
drop policy if exists "dr_insert" on public.dynamic_reports;
create policy "dr_insert" on public.dynamic_reports
  for insert with check (
    public.is_org_finance_user(org_id)
    and public.org_plan_at_least(org_id, 'full')
  );


-- ════════════════════════════════════════════════════════════════
-- 6. transaction_type gate (inflow / outflow)
-- ════════════════════════════════════════════════════════════════
-- A trigger rather than an RLS WITH CHECK, specifically so a downgrade
-- doesn't trap data: WITH CHECK on UPDATE cannot see OLD, so it would
-- re-evaluate the row's *existing* transaction_type and block a Start-tier
-- org from editing a refund it created while on Impact. The trigger only
-- fires when the gated value is actually being introduced.
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


-- ════════════════════════════════════════════════════════════════
-- 7. Bank quantity + foreign-currency caps
-- ════════════════════════════════════════════════════════════════
-- Also a trigger: the free tier's one-bank cap and the Growth tier's
-- one-foreign-currency cap both need a count of sibling rows, and the
-- currency cap needs to distinguish "switching an existing FX bank's
-- currency" from "adding a second currency".
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
    -- Growth may run any number of FX banks, but all in the same one
    -- foreign currency. Impact removes the currency-count cap.
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


notify pgrst, 'reload schema';
