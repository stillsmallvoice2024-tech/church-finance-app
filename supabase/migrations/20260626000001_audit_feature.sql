-- ── Audit Feature ─────────────────────────────────────────────────────────────
-- Adds: audit_sessions, audit_findings tables + activity_log_view
-- Safe to re-run (DROP IF EXISTS / CREATE OR REPLACE / IF NOT EXISTS throughout)

-- ── audit_sessions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_sessions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start date        NOT NULL,
  period_end   date        NOT NULL,
  auditor_id   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  status       text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_sessions_select" ON public.audit_sessions;
CREATE POLICY "audit_sessions_select" ON public.audit_sessions
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "audit_sessions_insert" ON public.audit_sessions;
CREATE POLICY "audit_sessions_insert" ON public.audit_sessions
  FOR INSERT WITH CHECK (is_finance_user());
DROP POLICY IF EXISTS "audit_sessions_update" ON public.audit_sessions;
CREATE POLICY "audit_sessions_update" ON public.audit_sessions
  FOR UPDATE USING (is_finance_user());
DROP POLICY IF EXISTS "audit_sessions_delete" ON public.audit_sessions;
CREATE POLICY "audit_sessions_delete" ON public.audit_sessions
  FOR DELETE USING (is_admin());

CREATE INDEX IF NOT EXISTS idx_audit_sessions_org ON public.audit_sessions(org_id, created_at DESC);

-- ── audit_findings ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_findings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid        NOT NULL REFERENCES public.audit_sessions(id) ON DELETE CASCADE,
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type  text        NOT NULL,
  entity_id    uuid        NOT NULL,
  finding_type text        NOT NULL CHECK (finding_type IN ('ok', 'exception', 'note')),
  note         text,
  created_by   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, entity_type, entity_id)
);
ALTER TABLE public.audit_findings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_findings_select" ON public.audit_findings;
CREATE POLICY "audit_findings_select" ON public.audit_findings
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "audit_findings_insert" ON public.audit_findings;
CREATE POLICY "audit_findings_insert" ON public.audit_findings
  FOR INSERT WITH CHECK (is_finance_user());
DROP POLICY IF EXISTS "audit_findings_update" ON public.audit_findings;
CREATE POLICY "audit_findings_update" ON public.audit_findings
  FOR UPDATE USING (is_finance_user());
DROP POLICY IF EXISTS "audit_findings_delete" ON public.audit_findings;
CREATE POLICY "audit_findings_delete" ON public.audit_findings
  FOR DELETE USING (is_finance_user());

CREATE INDEX IF NOT EXISTS idx_audit_findings_session ON public.audit_findings(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_findings_entity  ON public.audit_findings(org_id, entity_type, entity_id);

-- ── activity_log_view ─────────────────────────────────────────────────────────
-- Unified view: field_changes (UPDATE diffs) + audit_log INSERT/DELETE events.
-- security_invoker = true → underlying table RLS applies to the caller.
-- Requires PostgreSQL 15+ (Supabase default as of 2024).
CREATE OR REPLACE VIEW public.activity_log_view
WITH (security_invoker = true) AS
  SELECT
    fc.id                    AS id,
    'field_change'::text     AS event_type,
    fc.user_id,
    fc.org_id,
    fc.table_name,
    fc.record_id,
    fc.changed_at            AS event_at,
    fc.field_name,
    fc.old_value,
    fc.new_value,
    NULL::text               AS action,
    NULL::jsonb              AS snapshot_data,
    p.full_name              AS user_full_name,
    p.email                  AS user_email
  FROM public.field_changes fc
  LEFT JOIN public.profiles p ON p.id = fc.user_id

  UNION ALL

  SELECT
    al.id                    AS id,
    CASE al.action
      WHEN 'INSERT' THEN 'record_created'
      WHEN 'DELETE' THEN 'record_deleted'
      ELSE al.action
    END                      AS event_type,
    al.user_id,
    al.org_id,
    al.table_name,
    al.record_id,
    al.created_at            AS event_at,
    NULL::text               AS field_name,
    NULL::text               AS old_value,
    NULL::text               AS new_value,
    al.action,
    COALESCE(al.new_data, al.old_data)::jsonb AS snapshot_data,
    p.full_name              AS user_full_name,
    p.email                  AS user_email
  FROM public.audit_log al
  LEFT JOIN public.profiles p ON p.id = al.user_id
  WHERE al.action IN ('INSERT', 'DELETE');

GRANT SELECT ON public.activity_log_view TO authenticated;

NOTIFY pgrst, 'reload schema';
