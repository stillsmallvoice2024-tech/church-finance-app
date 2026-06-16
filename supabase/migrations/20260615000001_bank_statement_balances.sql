-- ── bank_statement_balances ────────────────────────────────────────────────────
-- Stores one reference (closing) balance per bank per org, captured during
-- bank-statement import or entered manually in the Reconciliation Centre.
-- The unique constraint (org_id, bank_name) is required by the PostgREST upsert
-- used in ImportModal.tsx and useReconciliation.ts.

CREATE TABLE IF NOT EXISTS public.bank_statement_balances (
  id                uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_name         text          NOT NULL,
  bank_id           uuid          REFERENCES public.banks(id) ON DELETE SET NULL,
  reference_balance numeric(15,2) NOT NULL,
  statement_date    date          NOT NULL,
  notes             text,
  entered_by        uuid          REFERENCES public.profiles(id),
  org_id            uuid          NOT NULL DEFAULT public.get_current_org_id()
                    REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at        timestamptz   DEFAULT now(),
  UNIQUE (org_id, bank_name)
);

ALTER TABLE public.bank_statement_balances ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "bsb_select" ON public.bank_statement_balances
    FOR SELECT USING (public.is_org_member(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "bsb_insert" ON public.bank_statement_balances
    FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "bsb_update" ON public.bank_statement_balances
    FOR UPDATE USING (public.is_org_finance_user(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "bsb_delete" ON public.bank_statement_balances
    FOR DELETE USING (public.is_org_admin(org_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_bsb_org_bank ON public.bank_statement_balances(org_id, bank_name);

NOTIFY pgrst, 'reload schema';
