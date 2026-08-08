-- ============================================================================
-- Backup/restore: stop treating organizations as a row-level table
--
-- Finding addressed (app audit): backups export cross-org rows and can be
-- weaponised on restore.
--   - `organizations` has no org_id, so exporting it grabbed every row RLS
--     let the caller read — a user in two orgs got both orgs' row in one file.
--   - Restoring `organizations` upserted columns straight from a
--     user-editable JSON file, including billing-adjacent ones
--     (plan_tier, stripe_*) — already blocked by the plan-guard trigger
--     (20260807000000_plan_enforcement.sql), but the row-level restore path
--     itself should not exist for a table like this.
--
-- (`currencies` is unaffected here — 20260807000001_org_scope_currencies.sql
-- already made it an ordinary org-scoped table, which is the correct fix for
-- that one; it stays in the registry and this allowlist.)
--
-- Fix: remove `organizations` from the atomic-restore allowlist entirely,
-- matching the client-side registry change in src/utils/backupRestore.ts
-- (MANAGED_TABLES no longer lists it). Org identity/settings are now
-- captured as a scalar, non-restorable snapshot in the backup file's _meta
-- instead.
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- Staging rows referencing this key would block the delete below via FK.
-- In practice this table is empty outside an in-flight restore, but be safe.
DELETE FROM public.restore_staging
WHERE table_key = 'organizations';

DELETE FROM public.restore_allowed_tables
WHERE table_key = 'organizations';

NOTIFY pgrst, 'reload schema';
