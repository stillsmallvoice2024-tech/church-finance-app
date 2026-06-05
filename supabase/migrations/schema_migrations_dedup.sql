-- ── Fix duplicate migration timestamps in supabase_migrations.schema_migrations ─
-- Run ONCE on production via Supabase SQL editor (as postgres / service role).
-- Safe to re-run — uses DELETE + INSERT with ON CONFLICT DO NOTHING.
--
-- Context: four collision pairs existed where two files shared the same
-- timestamp prefix. Supabase tracks one version row per timestamp, meaning
-- one file per pair was never recorded as applied (even though it ran).
-- This script brings the tracking table into sync with the renamed files.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Group 1: 20260528000001 ───────────────────────────────────────────────────
-- Before: org_backfill (000001) + org_backfill_rollback (000001) — collision
-- After:  org_backfill (000001) | org_backfill_rollback (000002)

DELETE FROM supabase_migrations.schema_migrations
  WHERE version IN ('20260528000001', '20260528000002');

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20260528000001', 'org_backfill'),
  ('20260528000002', 'org_backfill_rollback')
ON CONFLICT (version) DO NOTHING;

-- ── Group 2: 20260530000000 ───────────────────────────────────────────────────
-- Before: fix_username (000000) + org_onboarding (000000) — collision
--         resolve_username_rpc (000001), org_onboarding (000002), fix_selfsignup (000003)
-- After:  fix_username (000000) | org_onboarding (000001) | resolve_username_rpc (000002)
--         org_onboarding (000003) | fix_selfsignup (000004)

DELETE FROM supabase_migrations.schema_migrations
  WHERE version IN (
    '20260530000000', '20260530000001', '20260530000002',
    '20260530000003', '20260530000004'
  );

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20260530000000', 'fix_username_and_org_fallback'),
  ('20260530000001', 'org_onboarding'),
  ('20260530000002', 'resolve_username_rpc'),
  ('20260530000003', 'org_onboarding'),
  ('20260530000004', 'fix_selfsignup_org_assignment')
ON CONFLICT (version) DO NOTHING;

-- ── Group 3: 20260602000001 + 20260602000002 ──────────────────────────────────
-- Before: fix_accept_invitation (000001) + org_deletion_flow (000001) — collision
--         audit_log_org_isolation (000002) + user_preferences (000002) — collision
--         storage_org_isolation (000003)
-- After:  fix_accept_invitation (000001) | org_deletion_flow (000002)
--         audit_log_org_isolation (000003) | user_preferences (000004)
--         storage_org_isolation (000005)

DELETE FROM supabase_migrations.schema_migrations
  WHERE version IN (
    '20260602000001', '20260602000002', '20260602000003',
    '20260602000004', '20260602000005'
  );

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20260602000001', 'fix_accept_invitation_existing_user'),
  ('20260602000002', 'org_deletion_flow'),
  ('20260602000003', 'audit_log_org_isolation'),
  ('20260602000004', 'user_preferences'),
  ('20260602000005', 'storage_org_isolation')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- Run this SELECT to confirm all 14 rows exist with unique versions:
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version IN (
  '20260528000001', '20260528000002',
  '20260530000000', '20260530000001', '20260530000002', '20260530000003', '20260530000004',
  '20260602000001', '20260602000002', '20260602000003', '20260602000004', '20260602000005'
)
ORDER BY version;
