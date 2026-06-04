-- LB-8 / E-H6: Block NaN and negative amounts in category_opening_balances.
-- Postgres numeric accepts NaN as a valid value; this migration prevents it at the DB level.

-- Remove any existing NaN or negative rows before adding the constraint.
DELETE FROM public.category_opening_balances
WHERE amount < 0 OR amount = 'NaN'::numeric;

-- Add constraint (idempotent).
DO $$ BEGIN
  ALTER TABLE public.category_opening_balances
    ADD CONSTRAINT cob_amount_valid
    CHECK (amount >= 0 AND amount != 'NaN'::numeric);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
