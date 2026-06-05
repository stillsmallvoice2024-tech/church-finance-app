-- Fix: self-signup was being attached to the existing 'primary' organisation.
--
-- The handle_new_user trigger unconditionally inserted every new auth user into
-- the organisation with slug = 'primary'.  For self-signups with email
-- confirmation enabled, create_organization() was never called before the
-- confirmation link was clicked, so the viewer membership persisted.
-- After confirmation the auth listener found that membership, set orgId to the
-- primary org, and onboarding either (a) skipped org creation because localOrgId
-- was already populated, or (b) was bypassed entirely because onboarding_complete
-- was null (≠ false) for the seeded primary org.
--
-- Fix: the trigger must only create the profile row.  Org membership is always
-- created explicitly by:
--   • create_organization()  — self-signup
--   • accept_invitation()    — invite flow

create or replace function public.handle_new_user()
returns trigger as $$
begin
  -- Profile insert: attempt with username; fall back to NULL on unique conflict.
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
      raise warning '[handle_new_user] username conflict user=% — retrying with NULL username', new.id;
      begin
        insert into public.profiles (id, email, full_name, username)
        values (new.id, new.email, new.raw_user_meta_data->>'full_name', null)
        on conflict (id) do nothing;
      exception when others then
        raise warning '[handle_new_user] profile fallback insert failed user=% sqlstate=% err=%', new.id, sqlstate, sqlerrm;
      end;
    when others then
      raise warning '[handle_new_user] profile insert failed user=% sqlstate=% err=%', new.id, sqlstate, sqlerrm;
  end;

  -- NOTE: org_members is intentionally NOT touched here.
  -- Self-signups: create_organization() creates the org + admin membership.
  -- Invited users: accept_invitation() sets the correct org membership.
  -- Auto-assigning to 'primary' was the cause of cross-org contamination.

  return new;
end;
$$ language plpgsql security definer;
