-- Fix: intra_flows UPDATE RLS policy
--
-- If updating an intra_flows record returns "Record not found or update
-- blocked by permissions", the intraflow_update policy is missing from the
-- live database.  Run this script in Supabase SQL Editor to add it safely.
--
-- The script is idempotent -- safe to run even if the policy already exists.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename   = 'intra_flows'
      AND policyname  = 'intraflow_update'
  ) THEN
    CREATE POLICY "intraflow_update" ON public.intra_flows
      FOR UPDATE USING (public.is_finance_user());
    RAISE NOTICE 'intraflow_update policy created';
  ELSE
    RAISE NOTICE 'intraflow_update policy already exists -- no action taken';
  END IF;
END $$;

-- Diagnostic: verify all four intra_flows policies are present
SELECT policyname, cmd, qual
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename  = 'intra_flows'
ORDER  BY policyname;
