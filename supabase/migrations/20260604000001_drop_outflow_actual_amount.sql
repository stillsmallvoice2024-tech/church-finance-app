-- Drop actual_amount from outflow_transactions.
--
-- This column was always DEFAULT 0 and was never set by any UI or import path.
-- All read sites previously used (actual_amount || amount_disbursed || 0);
-- since actual_amount was always 0, this was equivalent to amount_disbursed.
-- A data audit confirmed zero rows with actual_amount != 0 before this migration.
--
-- Pre-requisite: deploy the updated application code before running this migration.

ALTER TABLE outflow_transactions DROP COLUMN IF EXISTS actual_amount;
