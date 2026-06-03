-- Migration: invitation_emails
-- Audit log for invite email delivery events.
-- The send-invite-email Edge Function writes here via the service role (bypasses RLS).

CREATE TABLE IF NOT EXISTS public.invitation_emails (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid        NOT NULL REFERENCES public.invitations(id) ON DELETE CASCADE,
  email         text        NOT NULL,
  status        text        NOT NULL CHECK (status IN ('sent', 'failed')),
  error_msg     text,
  resend_id     text,
  sent_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitation_emails_invitation
  ON public.invitation_emails(invitation_id);

CREATE INDEX IF NOT EXISTS idx_invitation_emails_sent_at
  ON public.invitation_emails(sent_at DESC);

ALTER TABLE public.invitation_emails ENABLE ROW LEVEL SECURITY;

-- Admins can read delivery logs; service role (edge function) bypasses RLS for INSERT
DO $$ BEGIN
  CREATE POLICY "invitation_emails_admin_read"
    ON public.invitation_emails FOR SELECT
    USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
