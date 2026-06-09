-- ============================================================
-- Fix 1: currencies table (404 — table missing from live DB)
-- Fix 2: user_preferences.preferences column (400 — column may
--         be named 'prefs' from schema-fix migration, or missing)
-- All changes are idempotent.
-- ============================================================

-- ── Fix 1: currencies ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.currencies (
  code       text    PRIMARY KEY,
  name       text    NOT NULL,
  symbol     text    NOT NULL DEFAULT '',
  flag       text,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 99
);

ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read the currency list.
DROP POLICY IF EXISTS "currencies_select" ON public.currencies;
CREATE POLICY "currencies_select" ON public.currencies
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only org owners/admins may manage currencies.
DROP POLICY IF EXISTS "currencies_insert" ON public.currencies;
CREATE POLICY "currencies_insert" ON public.currencies
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "currencies_update" ON public.currencies;
CREATE POLICY "currencies_update" ON public.currencies
  FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "currencies_delete" ON public.currencies;
CREATE POLICY "currencies_delete" ON public.currencies
  FOR DELETE USING (public.is_admin());

-- Seed default currencies (no-op if they already exist).
INSERT INTO public.currencies (code, name, symbol, flag, is_active, sort_order)
VALUES
  ('NGN', 'Nigerian Naira', '₦', '🇳🇬', true, 0),
  ('USD', 'US Dollar',      '$', '🇺🇸', true, 1),
  ('GBP', 'British Pound',  '£', '🇬🇧', true, 2),
  ('EUR', 'Euro',           '€', '🇪🇺', true, 3),
  ('CNY', 'Chinese Yuan',   '¥', '🇨🇳', true, 4)
ON CONFLICT (code) DO NOTHING;

-- ── Fix 2: user_preferences — ensure correct column and constraint ─────────────
-- The schema-fix migration (20260605000001) used column name 'prefs' while
-- the canonical migration (20260602000004) and all app code use 'preferences'.
-- On live DBs where 20260605000001 ran first, the column is 'prefs'.
-- This block safely adds 'preferences', migrates any data from 'prefs', and
-- ensures the unique constraint needed by the upsert on_conflict clause.

DO $$
BEGIN
  -- Add 'preferences' column if absent
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_preferences'
      AND column_name  = 'preferences'
  ) THEN
    ALTER TABLE public.user_preferences
      ADD COLUMN preferences jsonb NOT NULL DEFAULT '{}';

    -- Copy any existing data stored under the old 'prefs' column name
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'user_preferences'
        AND column_name  = 'prefs'
    ) THEN
      UPDATE public.user_preferences
      SET    preferences = prefs
      WHERE  prefs IS NOT NULL AND prefs != '{}'::jsonb;
    END IF;
  END IF;
END $$;

-- Ensure unique index exists for upsert on_conflict=user_id,org_id
CREATE UNIQUE INDEX IF NOT EXISTS user_preferences_user_org_uniq
  ON public.user_preferences (user_id, org_id);

-- Re-assert RLS policies with canonical names (idempotent)
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_preferences_select_own" ON public.user_preferences;
CREATE POLICY "user_preferences_select_own" ON public.user_preferences
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_preferences_insert_own" ON public.user_preferences;
CREATE POLICY "user_preferences_insert_own" ON public.user_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_preferences_update_own" ON public.user_preferences;
CREATE POLICY "user_preferences_update_own" ON public.user_preferences
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_preferences_delete_own" ON public.user_preferences;
CREATE POLICY "user_preferences_delete_own" ON public.user_preferences
  FOR DELETE USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
