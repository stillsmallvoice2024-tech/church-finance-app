-- ============================================================================
-- Add 'bank' as a recognition-rule type
--
-- income_type_rules and outflow_classification_rules gain a `bank` rule_type
-- alongside `keyword`. A bank rule matches when the import (or manual entry)
-- is for that bank, and outranks keyword matches — a whole import batch
-- belongs to one bank, so an account dedicated to one purpose (e.g. a
-- Missions-only account) shouldn't be second-guessed by a coincidental
-- keyword in the description.
--
-- `stage_code` is left as an allowed value on both tables — income_type_rules
-- had real `stage_code` rows before this migration and outflow_classification
-- _rules matches it in classifyOutflow — but neither UI can create new ones;
-- `bank` replaces it as the second option users see.
-- ============================================================================

ALTER TABLE public.income_type_rules
  DROP CONSTRAINT IF EXISTS income_type_rules_rule_type_check;
ALTER TABLE public.income_type_rules
  ADD CONSTRAINT income_type_rules_rule_type_check
  CHECK (rule_type IN ('keyword', 'stage_code', 'bank'));

-- outflow_classification_rules ships from 20260803000001; guard in case this
-- runs on a database where that migration hasn't applied yet.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'outflow_classification_rules'
  ) THEN
    ALTER TABLE public.outflow_classification_rules
      DROP CONSTRAINT IF EXISTS outflow_classification_rules_rule_type_check;
    ALTER TABLE public.outflow_classification_rules
      ADD CONSTRAINT outflow_classification_rules_rule_type_check
      CHECK (rule_type IN ('keyword', 'stage_code', 'bank'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
