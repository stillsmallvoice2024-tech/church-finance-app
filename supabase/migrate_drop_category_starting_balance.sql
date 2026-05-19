-- ============================================================
-- Migration: drop categories.starting_balance and
--            categories.starting_balance_budget_portion
--
-- Prerequisites: category_opening_balances table must exist.
-- Run this AFTER deploying the updated application code.
-- ============================================================

-- Step 1: Migrate any remaining legacy values into category_opening_balances.
-- ON CONFLICT DO NOTHING — existing COB rows take precedence; legacy values
-- are only inserted where no COB row exists for that category+portion pair.
INSERT INTO public.category_opening_balances (category_id, budget_portion, amount)
SELECT
  id                               AS category_id,
  starting_balance_budget_portion  AS budget_portion,
  starting_balance                 AS amount
FROM public.categories
WHERE starting_balance IS NOT NULL
  AND starting_balance <> 0
  AND starting_balance_budget_portion IS NOT NULL
  AND starting_balance_budget_portion IN ('Percentage Allocation', 'Specific Seed', 'Savings')
ON CONFLICT (category_id, budget_portion) DO NOTHING;

-- Step 2: Drop the legacy columns.
ALTER TABLE public.categories
  DROP COLUMN IF EXISTS starting_balance,
  DROP COLUMN IF EXISTS starting_balance_budget_portion;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- ROLLBACK (run manually if needed)
-- ============================================================
-- ALTER TABLE public.categories
--   ADD COLUMN IF NOT EXISTS starting_balance                numeric(15,2) DEFAULT 0,
--   ADD COLUMN IF NOT EXISTS starting_balance_budget_portion text;
--
-- UPDATE public.categories c
-- SET
--   starting_balance                = cob.amount,
--   starting_balance_budget_portion = cob.budget_portion
-- FROM (
--   SELECT DISTINCT ON (category_id)
--     category_id, amount, budget_portion
--   FROM public.category_opening_balances
--   ORDER BY category_id, created_at
-- ) cob
-- WHERE c.id = cob.category_id;
--
-- NOTIFY pgrst, 'reload schema';
