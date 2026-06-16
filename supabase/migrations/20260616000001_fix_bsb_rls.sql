-- Fix bank_statement_balances RLS policies.
-- bsb_select previously used org_id = get_current_org_id() which resolves to
-- the 'primary' slug org only, making saved balances invisible to all other orgs.
-- All other tables in the schema use is_org_member(org_id) — aligning here.

DROP POLICY IF EXISTS "bsb_select" ON public.bank_statement_balances;
DROP POLICY IF EXISTS "bsb_insert" ON public.bank_statement_balances;
DROP POLICY IF EXISTS "bsb_update" ON public.bank_statement_balances;
DROP POLICY IF EXISTS "bsb_delete" ON public.bank_statement_balances;

CREATE POLICY "bsb_select" ON public.bank_statement_balances
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "bsb_insert" ON public.bank_statement_balances
  FOR INSERT WITH CHECK (public.is_org_finance_user(org_id));

CREATE POLICY "bsb_update" ON public.bank_statement_balances
  FOR UPDATE USING (public.is_org_finance_user(org_id));

CREATE POLICY "bsb_delete" ON public.bank_statement_balances
  FOR DELETE USING (public.is_org_admin(org_id));

NOTIFY pgrst, 'reload schema';
