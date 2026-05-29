-- ============================================================
-- FIX: handle_new_user trigger — invite signup "Database error saving new user"
-- Idempotent — safe to re-run.
-- Prerequisites: Phases 1–5 applied.
--
-- ROOT CAUSE
-- handle_new_user() uses ON CONFLICT (id) DO NOTHING, which only suppresses
-- conflicts on the primary key.  If an invited user enters a username that
-- already exists in profiles.username (UNIQUE constraint), the INSERT raises
-- unique_violation and the entire auth.users insert is rolled back, causing
-- Supabase Auth to surface "Database error saving new user" to the client.
--
-- FIX
-- Wrap the profiles INSERT in an inner exception block.  On unique_violation
-- (username taken), retry the insert with username = NULL so the trigger never
-- blocks auth user creation.  AcceptInvite.tsx already sends a subsequent
-- profiles UPDATE that sets full_name / username; the NULL value is a safe
-- interim state.
-- ============================================================


CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- Primary insert: full metadata from signUp options.data.
  -- Inner exception block: if username is already taken (unique_violation on
  -- profiles_username_key), retry without username rather than aborting the
  -- entire auth user creation.
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, username)
    VALUES (
      new.id,
      new.email,
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'username'
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE
      '[handle_new_user] username conflict for user %; inserting with NULL username',
      new.id;
    INSERT INTO public.profiles (id, email, full_name, username)
    VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name', NULL)
    ON CONFLICT (id) DO NOTHING;
  END;

  -- Auto-enroll in the primary org as viewer.
  -- accept_invitation() will promote the role to the invited value atomically.
  SELECT id INTO v_org_id
  FROM   public.organizations
  WHERE  slug = 'primary'
  LIMIT  1;

  IF v_org_id IS NOT NULL THEN
    INSERT INTO public.org_members (org_id, user_id, role, status)
    VALUES (v_org_id, new.id, 'viewer', 'active')
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;

  RETURN new;
END;
$$;

NOTIFY pgrst, 'reload schema';
