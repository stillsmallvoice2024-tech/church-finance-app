-- ================================================================
-- Subscription Tiers — Phase 1
-- Adds plan_tier / plan_expires_at / imported_rows_count to
-- organizations, an effective-tier helper (lazy expiry check, no
-- cron needed), and an import-counter RPC.
--
-- Idempotent: safe to re-run.
-- ================================================================

-- ── Columns ──────────────────────────────────────────────────────────────────
alter table public.organizations
  add column if not exists plan_tier           text        not null default 'free'
                            check (plan_tier in ('free', 'level1', 'full')),
  add column if not exists plan_started_at      timestamptz not null default now(),
  add column if not exists plan_expires_at      timestamptz,
  add column if not exists imported_rows_count  int         not null default 0;

-- ── Grandfather existing orgs ────────────────────────────────────────────────
-- One-time backfill: every org that already existed before this migration
-- keeps full access for one year from today. New orgs created after this
-- statement runs get the column defaults (free, no expiry) instead, because
-- their created_at will be after `now()` captured here.
do $$
declare
  v_cutoff timestamptz := now();
begin
  update public.organizations
  set plan_tier       = 'full',
      plan_started_at = v_cutoff,
      plan_expires_at = v_cutoff + interval '1 year'
  where created_at <= v_cutoff;
end $$;

-- ── Effective-tier helpers ───────────────────────────────────────────────────
-- A grandfathered/expired plan silently reverts to 'free' the moment
-- plan_expires_at is in the past — no cron job required, every read
-- re-evaluates it.
create or replace function public.org_effective_plan_tier(p_org_id uuid)
returns text language sql security definer stable as $$
  select case
    when o.plan_expires_at is not null and o.plan_expires_at < now() then 'free'
    else o.plan_tier
  end
  from public.organizations o
  where o.id = p_org_id;
$$;

create or replace function public.org_plan_at_least(p_org_id uuid, p_min_tier text)
returns boolean language sql security definer stable as $$
  select case public.org_effective_plan_tier(p_org_id)
    when 'full'   then true
    when 'level1' then p_min_tier in ('free', 'level1')
    else               p_min_tier = 'free'
  end;
$$;

-- ── Import counter RPC ───────────────────────────────────────────────────────
-- Increments organizations.imported_rows_count atomically so the free-tier
-- 100-row Import cap can't be raced by concurrent imports. Caller must be an
-- active member of the org.
create or replace function public.increment_import_count(p_org_id uuid, p_count int)
returns int language plpgsql security definer as $$
declare
  v_new_count int;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this organization';
  end if;

  update public.organizations
  set imported_rows_count = imported_rows_count + greatest(p_count, 0)
  where id = p_org_id
  returning imported_rows_count into v_new_count;

  return v_new_count;
end;
$$;

grant execute on function public.org_effective_plan_tier(uuid) to authenticated;
grant execute on function public.org_plan_at_least(uuid, text) to authenticated;
grant execute on function public.increment_import_count(uuid, int) to authenticated;

notify pgrst, 'reload schema';
