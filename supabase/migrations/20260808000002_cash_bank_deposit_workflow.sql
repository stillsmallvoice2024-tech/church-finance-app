-- Default "Cash" bank per org (system-owned, protected) + cash-deposit linking.
-- Users no longer need to create "Cash" manually; it's seeded on org creation
-- and cannot be renamed or deleted. Marking a cash inflow "deposited" auto-
-- creates the linked bank outflow via the existing deposit_group_id/offset_role
-- pairing mechanism (see LinkDepositGroupModal).

alter table public.banks
  add column if not exists is_system boolean not null default false;

-- At most one system bank per org (the seeded "Cash" bank).
create unique index if not exists idx_banks_one_system_per_org
  on public.banks (org_id) where is_system;

-- Protect system banks from rename/delete — enforced at the DB layer since
-- client code has more than one entry point (Banks tab, bulk edit, etc).
create or replace function public.protect_system_bank_fn()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'The "Cash" bank is managed automatically and cannot be deleted.';
    end if;
    return old;
  end if;

  if old.is_system and (new.name is distinct from old.name or new.is_system is distinct from old.is_system) then
    raise exception 'The "Cash" bank is managed automatically and cannot be renamed.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_system_bank on public.banks;
create trigger trg_protect_system_bank
  before update or delete on public.banks
  for each row execute function public.protect_system_bank_fn();

-- Backfill: promote an existing "Cash" bank to system-owned, or create one,
-- for every org that doesn't already have a system bank.
insert into public.banks (org_id, name, currency, is_system)
select o.id, 'Cash', coalesce(o.default_currency, 'NGN'), true
from public.organizations o
where o.status <> 'pending_deletion'
  and not exists (select 1 from public.banks b where b.org_id = o.id and b.is_system)
  and not exists (select 1 from public.banks b where b.org_id = o.id and lower(b.name) = 'cash');

update public.banks b
set is_system = true
where lower(b.name) = 'cash'
  and not exists (select 1 from public.banks b2 where b2.org_id = b.org_id and b2.is_system);

-- Seed the Cash bank whenever a new org is created.
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

  delete from public.org_members
  where  org_id  = (select id from public.organizations where slug = 'primary' limit 1)
    and  user_id = v_user_id
    and  role    = 'viewer';

  insert into public.banks (org_id, name, currency, is_system)
  values (v_org_id, 'Cash', 'NGN', true);

  return v_org_id;
end;
$$;

grant execute on function public.create_organization(text) to authenticated;
