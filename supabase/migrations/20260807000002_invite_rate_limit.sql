-- ============================================================================
-- Invite rate limiting
-- ============================================================================
-- An org name and inviter display name are both attacker-controllable
-- (self-signup, editable profile). Combined with the invite email, an
-- unbounded invite rate lets a malicious org blast phishing-style emails
-- from our verified sending domain to arbitrary addresses. Cap the volume
-- an org can generate regardless of which path performs the insert.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_invite_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_count int;
BEGIN
  SELECT count(*) INTO v_recent_count
  FROM public.invitations
  WHERE org_id = NEW.org_id
    AND created_at > now() - interval '1 hour';

  IF v_recent_count >= 20 THEN
    RAISE EXCEPTION 'Too many invitations sent recently. Please try again later.'
      USING errcode = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invitations_rate_limit ON public.invitations;
CREATE TRIGGER invitations_rate_limit
  BEFORE INSERT ON public.invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_invite_rate_limit();
