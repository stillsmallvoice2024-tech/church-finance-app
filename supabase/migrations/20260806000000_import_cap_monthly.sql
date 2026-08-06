-- ================================================================
-- Import Cap — Monthly Reset
-- Changes the free-tier 100-row import cap from lifetime-cumulative
-- to a monthly allowance. Adds imported_rows_period_start and teaches
-- increment_import_count() to roll the counter over when the calendar
-- month has changed since the tracked period started — lazy, no cron.
--
-- Idempotent: safe to re-run.
-- ================================================================

alter table public.organizations
  add column if not exists imported_rows_period_start timestamptz not null default now();

create or replace function public.increment_import_count(p_org_id uuid, p_count int)
returns int language plpgsql security definer as $$
declare
  v_new_count     int;
  v_period_start  timestamptz;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this organization';
  end if;

  select imported_rows_period_start into v_period_start
  from public.organizations where id = p_org_id;

  if date_trunc('month', now()) <> date_trunc('month', v_period_start) then
    -- Calendar month has rolled over since this org's tracked period
    -- started — reset instead of accumulating onto a stale count.
    update public.organizations
    set imported_rows_count       = greatest(p_count, 0),
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

grant execute on function public.increment_import_count(uuid, int) to authenticated;

notify pgrst, 'reload schema';
