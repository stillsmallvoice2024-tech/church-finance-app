-- ============================================================
-- SECURITY: scope profiles + global-admin reads to shared-org membership
-- Idempotent — safe to re-run.
--
-- Findings addressed (release audit item 1):
--   1. profiles_select used auth.uid() IS NOT NULL — ANY authenticated
--      user could read EVERY profile (email + name) across ALL orgs.
--      Now restricted to: own row, or a user who shares an active org.
--   2. invitation_emails_admin_read used is_admin() (admin in ANY org),
--      so an admin of Org A could read Org B's invitation email log.
--      Now restricted to admins of the invitation's own org.
--
-- Username login is unaffected: it resolves via the resolve_username()
-- SECURITY DEFINER RPC (migration 20260530000002), not a direct table read.
-- The UserManagement roster embeds profiles through org_members, so
-- same-org members remain visible under the new policy.
-- ============================================================

-- ── profiles_select: self OR shares an active org ────────────────────────────
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM   public.org_members caller
      JOIN   public.org_members target
        ON   target.org_id = caller.org_id
      WHERE  caller.user_id = auth.uid()
        AND  caller.status  = 'active'
        AND  target.user_id = profiles.id
        AND  target.status  = 'active'
    )
  );

-- ── invitation_emails: admins of the invitation's own org only ───────────────
DROP POLICY IF EXISTS "invitation_emails_admin_read" ON public.invitation_emails;

CREATE POLICY "invitation_emails_admin_read" ON public.invitation_emails
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM   public.invitations i
      WHERE  i.id = invitation_emails.invitation_id
        AND  public.is_org_admin(i.org_id)
    )
  );

NOTIFY pgrst, 'reload schema';
