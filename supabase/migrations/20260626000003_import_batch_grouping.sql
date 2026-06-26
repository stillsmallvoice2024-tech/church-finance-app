-- ============================================================
-- Import batch grouping
--
-- Goal: collapse the flood of per-row record_created audit entries
-- produced by a bulk import into a single expandable group in the
-- Activity Log, while keeping each created row individually queryable.
--
-- Mechanism: the import pipeline stamps a single import_batch_id
-- (uuid) on every transaction row it inserts. The generic audit
-- trigger copies that id from the row into audit_log. A grouped
-- view aggregates record_created rows by (import_batch_id, table)
-- so pagination counts groups, not raw rows.
--
-- Grouping is per (batch, table): a bank-statement import that writes
-- both inflows and outflows surfaces as two groups (Inflows, Outflows),
-- which keeps the Table filter single-valued and correct.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ── 1. Add import_batch_id columns (nullable; historical rows stay NULL) ──────

ALTER TABLE public.inflow_transactions  ADD COLUMN IF NOT EXISTS import_batch_id uuid;
ALTER TABLE public.outflow_transactions ADD COLUMN IF NOT EXISTS import_batch_id uuid;
ALTER TABLE public.fx_transactions      ADD COLUMN IF NOT EXISTS import_batch_id uuid;
ALTER TABLE public.audit_log            ADD COLUMN IF NOT EXISTS import_batch_id uuid;

CREATE INDEX IF NOT EXISTS idx_audit_log_import_batch
  ON public.audit_log(org_id, import_batch_id)
  WHERE import_batch_id IS NOT NULL;

-- ── 2. Teach the generic audit trigger to capture import_batch_id ────────────
-- Reads import_batch_id out of the row JSONB. Tables without the column simply
-- yield NULL (jsonb ->> missing key = NULL), so this is safe for every audited
-- table, not just the import targets.

CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id         uuid;
  v_org_id          uuid;
  v_record_id       uuid;
  v_import_batch_id uuid;
  v_old_data        jsonb;
  v_new_data        jsonb;
  v_row_json        jsonb;
BEGIN
  -- Server-captured — cannot be supplied by the client
  v_user_id := auth.uid();

  IF TG_OP = 'DELETE' THEN
    v_row_json := row_to_json(OLD)::jsonb;
    v_old_data := v_row_json;
    v_new_data := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_row_json := row_to_json(NEW)::jsonb;
    v_old_data := NULL;
    v_new_data := v_row_json;
  ELSE
    v_row_json := row_to_json(NEW)::jsonb;
    v_old_data := row_to_json(OLD)::jsonb;
    v_new_data := v_row_json;
  END IF;

  BEGIN v_record_id       := (v_row_json->>'id')::uuid;              EXCEPTION WHEN OTHERS THEN v_record_id := NULL; END;
  BEGIN v_org_id          := (v_row_json->>'org_id')::uuid;         EXCEPTION WHEN OTHERS THEN v_org_id := NULL; END;
  BEGIN v_import_batch_id := (v_row_json->>'import_batch_id')::uuid; EXCEPTION WHEN OTHERS THEN v_import_batch_id := NULL; END;

  INSERT INTO public.audit_log (user_id, action, table_name, record_id, old_data, new_data, org_id, import_batch_id)
  VALUES (v_user_id, TG_OP, TG_TABLE_NAME, v_record_id, v_old_data, v_new_data, v_org_id, v_import_batch_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── 3. Recreate activity_log_view with import_batch_id (appended column) ──────
-- Column order/types of existing columns are unchanged; import_batch_id is
-- appended at the end. security_invoker = true keeps underlying-table RLS.

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
    p.email                  AS user_email,
    NULL::uuid               AS import_batch_id
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
    al.record_id::text       AS record_id,
    al.created_at            AS event_at,
    NULL::text               AS field_name,
    NULL::text               AS old_value,
    NULL::text               AS new_value,
    al.action,
    COALESCE(al.new_data, al.old_data)::jsonb AS snapshot_data,
    p.full_name              AS user_full_name,
    p.email                  AS user_email,
    al.import_batch_id       AS import_batch_id
  FROM public.audit_log al
  LEFT JOIN public.profiles p ON p.id = al.user_id
  WHERE al.action IN ('INSERT', 'DELETE');

GRANT SELECT ON public.activity_log_view TO authenticated;

-- ── 4. Grouped view: one row per import batch per table, rest individual ──────
-- record_created rows that carry an import_batch_id collapse into a single
-- group row (event_type stays 'record_created' so existing filters/sorts work;
-- group_count > 1 is how the UI detects a collapsible group). Everything else
-- passes through as an individual row with group_count = 1.

CREATE OR REPLACE VIEW public.activity_log_view_grouped
WITH (security_invoker = true) AS
  SELECT
    ('batch:' || v.import_batch_id::text || ':' || v.table_name)::text AS id,
    'record_created'::text   AS event_type,
    v.user_id,
    v.org_id,
    v.table_name,
    NULL::text               AS record_id,
    MAX(v.event_at)          AS event_at,
    NULL::text               AS field_name,
    NULL::text               AS old_value,
    NULL::text               AS new_value,
    'INSERT'::text           AS action,
    NULL::jsonb              AS snapshot_data,
    v.user_full_name,
    v.user_email,
    v.import_batch_id,
    COUNT(*)                 AS group_count
  FROM public.activity_log_view v
  WHERE v.import_batch_id IS NOT NULL
    AND v.event_type = 'record_created'
  GROUP BY v.import_batch_id, v.table_name, v.org_id, v.user_id, v.user_full_name, v.user_email

  UNION ALL

  SELECT
    v.id::text               AS id,
    v.event_type,
    v.user_id,
    v.org_id,
    v.table_name,
    v.record_id,
    v.event_at,
    v.field_name,
    v.old_value,
    v.new_value,
    v.action,
    v.snapshot_data,
    v.user_full_name,
    v.user_email,
    v.import_batch_id,
    1::bigint                AS group_count
  FROM public.activity_log_view v
  WHERE v.import_batch_id IS NULL
     OR v.event_type <> 'record_created';

GRANT SELECT ON public.activity_log_view_grouped TO authenticated;

-- ── 5. Reload schema cache ────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
