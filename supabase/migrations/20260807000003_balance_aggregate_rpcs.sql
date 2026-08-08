-- Server-side aggregates for the balance screens.
--
-- Before this migration every balance view streamed the org's entire
-- transaction history into the browser and summed it in JavaScript:
--   * useBankBalances  — all inflows + all outflows, all-time, to produce one
--                        number per bank.
--   * computeFundBuckets — nine queries, five of which are plain SUM/GROUP BY
--                        with no downstream per-row use.
-- On a large org that is tens of thousands of rows and dozens of sequential
-- 1000-row PostgREST pages, re-fetched on every mount of four separate pages.
--
-- These three functions answer exactly those aggregates in Postgres and return
-- one row per bank / per category / per seed target instead.
--
-- SECURITY INVOKER (not DEFINER) is deliberate: the caller's RLS policies still
-- apply to inflow_transactions / outflow_transactions, so p_org_id cannot be
-- used to read another tenant's ledger — a non-member simply gets zero rows.
-- The org_id predicate is kept anyway so the index is used and so the intent is
-- explicit at the call site.
--
-- ── Fidelity rule ───────────────────────────────────────────────────────────
-- These are a performance change, NOT a numbers change. Every filter and sign
-- convention below mirrors the JavaScript it replaces exactly, including two
-- behaviours that are arguably wrong but are out of scope to change here:
--
--   1. Outflows with a NULL stage_code_2 are excluded from the percentage
--      bucket. The client used PostgREST `not.eq`, which renders as
--      NOT (col = 'x') and drops NULLs under three-valued logic. Mirrored below
--      as an explicit `stage_code_2 is not null`.
--   2. Bank balances count every outflow but exclude balance_brought_forward
--      inflows, and apply no offset_role handling on either side.
--
-- Changing either belongs in its own migration with its own before/after
-- reconciliation, not in a performance fix.

-- ── Indexes supporting the aggregates ────────────────────────────────────────

create index if not exists idx_inflow_org_stage2   on public.inflow_transactions(org_id, stage_code_2);
create index if not exists idx_outflow_org_stage2  on public.outflow_transactions(org_id, stage_code_2);
create index if not exists idx_inflow_org_bank_id  on public.inflow_transactions(org_id, bank_id);
create index if not exists idx_outflow_org_bank_id on public.outflow_transactions(org_id, bank_id);

-- ── 1. Bank balances ─────────────────────────────────────────────────────────
-- Replaces the two full-table scans in src/hooks/useBankBalances.ts.
--
-- bank_id is the authoritative key; bank_name is only the grouping key for rows
-- written before the bank_id backfill (20260804000002). A row carrying neither
-- contributed to no bank in the JS and is dropped here too. Empty-string
-- bank_name is treated as absent, matching the JS truthiness check.

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

-- ── 2. Category fund totals ──────────────────────────────────────────────────
-- Replaces five of the nine queries in src/utils/fundBuckets.ts: the Specific
-- Seed in/out, Savings in/out, and percentage-outflow scans.
--
-- Grouping is by the RAW (category_id, stage_code_1) pair, NOT by a resolved
-- name. Resolving category_id to the category's current name stays in
-- src/utils/categoryReferences.ts on the client, so rename-resolution has one
-- implementation rather than two that can drift. The client folds the handful
-- of rows returned here down to one per fund.
--
-- seed_out_count is returned because the client reconstructs a single
-- "Withdrawal" seed-target entry per category, and that entry's count is the
-- number of underlying outflow rows.
--
-- offset_role = 'offset' rows subtract rather than add on the outflow side,
-- matching the JS `r.offset_role === 'offset' ? -amt : amt`.

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
      -- NULL stage_code_2 excluded on purpose — see the fidelity note at the top.
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

-- ── 3. Seed target totals ────────────────────────────────────────────────────
-- The Designated Gifts tab breaks each category down by what the gift was for.
-- That label is the row's specific_seed_description, falling back to its
-- description, falling back to a placeholder — and empty string counts as
-- absent, matching the JS `a || b || c` chain.
--
-- Grouping by (category_id, stage_code_1, label) collapses what was one browser
-- row per gift into one row per target. `latest` is returned as text because the
-- client compares it as an ISO string, and '' sorts below every real date —
-- the same seed value the JS grouping starts from.

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

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Signed-in users only. anon has no business reading an org's balances, and
-- SECURITY INVOKER means anon would get nothing anyway.

revoke all on function public.org_bank_balance_totals(uuid)   from public;
revoke all on function public.org_category_fund_totals(uuid)  from public;
revoke all on function public.org_seed_target_totals(uuid)    from public;

grant execute on function public.org_bank_balance_totals(uuid)  to authenticated;
grant execute on function public.org_category_fund_totals(uuid) to authenticated;
grant execute on function public.org_seed_target_totals(uuid)   to authenticated;

notify pgrst, 'reload schema';
