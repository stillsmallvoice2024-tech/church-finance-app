-- ── Align the distribution-rule schema with schema.sql ───────────────────────
--
-- The distribution-rule tables and their versioning columns only ever existed
-- in schema.sql (the fresh-install reference) and in the ad-hoc SQL strings in
-- src/pages/setup/migrationSql.ts. No migration ever created them, so a live
-- project provisioned before those strings were pasted in is missing pieces —
-- confirmed by `column ac.superseded_by_id does not exist`.
--
-- Everything here is idempotent and additive: existing data is never rewritten.
-- Must run before 20260803000001, which references these columns.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. special_config_groups ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.special_config_groups (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  org_id     uuid        NOT NULL DEFAULT public.get_current_org_id()
             REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.special_config_groups
  ADD COLUMN IF NOT EXISTS is_default  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

ALTER TABLE public.special_config_groups ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "scg_select" ON public.special_config_groups
    FOR SELECT USING (public.is_org_member(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "scg_insert" ON public.special_config_groups
    FOR INSERT WITH CHECK (public.is_org_admin(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "scg_update" ON public.special_config_groups
    FOR UPDATE USING (public.is_org_admin(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "scg_delete" ON public.special_config_groups
    FOR DELETE USING (public.is_org_admin(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_special_config_groups_org
  ON public.special_config_groups(org_id);

-- 2. allocation_configs — grouping + version lineage columns ──────────────────

ALTER TABLE public.allocation_configs
  ADD COLUMN IF NOT EXISTS is_special        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allocation_type   text,
  ADD COLUMN IF NOT EXISTS total_amount      numeric(15,2),
  ADD COLUMN IF NOT EXISTS config_group_id   uuid REFERENCES public.special_config_groups(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS effective_from    date,
  ADD COLUMN IF NOT EXISTS effective_to      date,
  ADD COLUMN IF NOT EXISTS version_number    integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS superseded_by_id  uuid REFERENCES public.allocation_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at     timestamptz,
  ADD COLUMN IF NOT EXISTS change_type       text DEFAULT 'initial',
  ADD COLUMN IF NOT EXISTS source_version_id uuid REFERENCES public.allocation_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amendment_reason  text;

DO $$ BEGIN
  ALTER TABLE public.allocation_configs
    ADD CONSTRAINT allocation_configs_change_type_check
    CHECK (change_type IN ('initial','new_version','date_split','amendment'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_alloc_config_group
  ON public.allocation_configs(config_group_id);
CREATE INDEX IF NOT EXISTS idx_alloc_configs_org_effective
  ON public.allocation_configs(org_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_alloc_configs_group_date
  ON public.allocation_configs(config_group_id, status, effective_from, effective_to)
  WHERE config_group_id IS NOT NULL;

-- No two LIVE versions of a rule may start on the same day. Drafts are exempt.
DO $$ BEGIN
  CREATE UNIQUE INDEX idx_alloc_configs_group_effrom_unique
    ON public.allocation_configs(config_group_id, effective_from)
    WHERE status = 'locked';
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

-- 3. income_types — group-level rule link ─────────────────────────────────────

ALTER TABLE public.income_types
  ADD COLUMN IF NOT EXISTS special_config_id       uuid REFERENCES public.allocation_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS special_config_group_id uuid REFERENCES public.special_config_groups(id) ON DELETE SET NULL;

-- 4. categories — the seeded General fund ─────────────────────────────────────

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- 5. Recalculation bookkeeping ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transaction_allocation_snapshots (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id    uuid        NOT NULL REFERENCES public.inflow_transactions(id) ON DELETE CASCADE,
  config_version_id uuid        REFERENCES public.allocation_configs(id) ON DELETE RESTRICT,
  config_group_id   uuid        REFERENCES public.special_config_groups(id) ON DELETE SET NULL,
  resolved_rows     jsonb       NOT NULL DEFAULT '[]',
  allocation_type   text,
  org_id            uuid        NOT NULL DEFAULT public.get_current_org_id()
                    REFERENCES public.organizations(id) ON DELETE SET NULL,
  is_recalculated   boolean     NOT NULL DEFAULT false,
  recalculated_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id)
);

ALTER TABLE public.transaction_allocation_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tas_select" ON public.transaction_allocation_snapshots
    FOR SELECT USING (public.is_org_member(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "tas_insert" ON public.transaction_allocation_snapshots
    FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "tas_update" ON public.transaction_allocation_snapshots
    FOR UPDATE USING (public.is_org_finance_user(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "tas_delete" ON public.transaction_allocation_snapshots
    FOR DELETE USING (public.is_org_admin(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_tas_org     ON public.transaction_allocation_snapshots(org_id);
CREATE INDEX IF NOT EXISTS idx_tas_org_txn ON public.transaction_allocation_snapshots(org_id, transaction_id);

CREATE TABLE IF NOT EXISTS public.recalculation_logs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  config_group_id   uuid        REFERENCES public.special_config_groups(id) ON DELETE SET NULL,
  config_version_id uuid        REFERENCES public.allocation_configs(id) ON DELETE SET NULL,
  performed_by      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  performed_at      timestamptz NOT NULL DEFAULT now(),
  affected_count    integer     NOT NULL DEFAULT 0,
  reason            text,
  action_summary    text        NOT NULL,
  org_id            uuid        NOT NULL DEFAULT public.get_current_org_id()
                    REFERENCES public.organizations(id) ON DELETE SET NULL
);

ALTER TABLE public.recalculation_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "rl_select" ON public.recalculation_logs
    FOR SELECT USING (public.is_org_member(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "rl_insert" ON public.recalculation_logs
    FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_recalc_logs_org ON public.recalculation_logs(org_id);

-- 6. Backfill effective_from so grouped versions resolve ──────────────────────
-- buildVersionIndex() ignores any version with a NULL effective_from.

UPDATE public.allocation_configs
SET    effective_from = start_date
WHERE  config_group_id IS NOT NULL
  AND  effective_from IS NULL;

NOTIFY pgrst, 'reload schema';
