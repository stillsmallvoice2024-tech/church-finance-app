-- ============================================================================
-- Org-scope the currencies table.
--
-- Before this migration `currencies` was a single global table keyed by `code`
-- with `is_admin()` (admin in ANY active org) guarding writes. That meant an
-- admin of one organisation could rename, deactivate or DELETE a currency for
-- every organisation on the instance, and a backup restore upserted rows over
-- every other tenant's list.
--
-- After: each organisation owns its own currency list. Surrogate `id` PK plus
-- UNIQUE (org_id, code) so the table behaves like every other org-scoped table
-- in the backup/restore registry.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- Legacy shape, for databases where the table was never created at all. The
-- DO block below immediately migrates it to the org-scoped shape.
CREATE TABLE IF NOT EXISTS public.currencies (
  code       text    PRIMARY KEY,
  name       text    NOT NULL,
  symbol     text    NOT NULL DEFAULT '',
  flag       text,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 99
);

-- ── Reshape: global → org-scoped ────────────────────────────────────────────
DO $$
DECLARE
  v_global jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'currencies' AND column_name = 'org_id'
  ) THEN
    RETURN;  -- already migrated
  END IF;

  -- Snapshot the old global list before dropping it; it is fanned out to every
  -- existing organisation below so no org loses a currency it was using.
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_global
  FROM public.currencies c;

  ALTER TABLE public.currencies DROP CONSTRAINT IF EXISTS currencies_pkey;
  ALTER TABLE public.currencies ADD COLUMN id     uuid NOT NULL DEFAULT gen_random_uuid();
  ALTER TABLE public.currencies ADD COLUMN org_id uuid;

  DELETE FROM public.currencies;

  ALTER TABLE public.currencies ADD PRIMARY KEY (id);
  ALTER TABLE public.currencies ALTER COLUMN org_id SET NOT NULL;
  ALTER TABLE public.currencies
    ADD CONSTRAINT currencies_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

  CREATE UNIQUE INDEX IF NOT EXISTS currencies_org_code_uniq
    ON public.currencies (org_id, code);
  CREATE INDEX IF NOT EXISTS currencies_org_id_idx
    ON public.currencies (org_id);

  INSERT INTO public.currencies (org_id, code, name, symbol, flag, is_active, sort_order)
  SELECT o.id, g.code, g.name, g.symbol, g.flag, g.is_active, g.sort_order
  FROM   public.organizations o
  CROSS  JOIN jsonb_to_recordset(v_global)
         AS g(code text, name text, symbol text, flag text, is_active boolean, sort_order integer)
  ON CONFLICT (org_id, code) DO NOTHING;
END $$;

-- ── Default currency list, per organisation ─────────────────────────────────
-- Mirrors DEFAULT_CURRENCIES in src/hooks/useCurrencies.ts.
CREATE OR REPLACE FUNCTION public.seed_default_currencies(p_org_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.currencies (org_id, code, name, symbol, flag, is_active, sort_order)
  SELECT p_org_id, d.code, d.name, d.symbol, d.flag, true, d.sort_order
  FROM (VALUES
    ('NGN', 'Nigerian Naira', '₦', '🇳🇬', 0),
    ('USD', 'US Dollar',      '$', '🇺🇸', 1),
    ('GBP', 'British Pound',  '£', '🇬🇧', 2),
    ('EUR', 'Euro',           '€', '🇪🇺', 3),
    ('CNY', 'Chinese Yuan',   '¥', '🇨🇳', 4)
  ) AS d(code, name, symbol, flag, sort_order)
  ON CONFLICT (org_id, code) DO NOTHING;
$$;

-- Backfill: every existing organisation gets at least the defaults.
DO $$
DECLARE v_org uuid;
BEGIN
  FOR v_org IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_currencies(v_org);
  END LOOP;
END $$;

-- New organisations are seeded automatically, whichever path creates them.
CREATE OR REPLACE FUNCTION public.seed_currencies_on_org_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.seed_default_currencies(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seed_currencies_on_org_insert ON public.organizations;
CREATE TRIGGER trg_seed_currencies_on_org_insert
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_currencies_on_org_insert();

-- ── RLS: org-scoped, admin-managed ──────────────────────────────────────────
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "currencies_select" ON public.currencies;
CREATE POLICY "currencies_select" ON public.currencies
  FOR SELECT USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "currencies_insert" ON public.currencies;
CREATE POLICY "currencies_insert" ON public.currencies
  FOR INSERT WITH CHECK (public.is_org_admin(org_id));

DROP POLICY IF EXISTS "currencies_update" ON public.currencies;
CREATE POLICY "currencies_update" ON public.currencies
  FOR UPDATE USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));

DROP POLICY IF EXISTS "currencies_delete" ON public.currencies;
CREATE POLICY "currencies_delete" ON public.currencies
  FOR DELETE USING (public.is_org_admin(org_id));

-- Legacy policy names from older self-hosted databases.
DROP POLICY IF EXISTS "currencies_read"  ON public.currencies;
DROP POLICY IF EXISTS "currencies_write" ON public.currencies;

-- ── Restore allowlist: currencies is now an ordinary org-scoped table ───────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'restore_allowed_tables') THEN
    UPDATE public.restore_allowed_tables
    SET    conflict_column   = 'id',
           org_scoped        = true,
           delete_in_replace = true
    WHERE  table_key = 'currencies';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
