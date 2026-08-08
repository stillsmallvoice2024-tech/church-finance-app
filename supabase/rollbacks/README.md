# Rollback scripts — NOT migrations

Scripts here undo a migration. They are **never** applied automatically and must
not live in `supabase/migrations/`.

## Why they were moved out

Every tool that applies migrations — `supabase db push`, a first-boot
`supabase start`, and anything else that globs `supabase/migrations/*.sql` —
runs the folder in filename order, with no notion of "this one is an undo".

`20260528000002_org_backfill_rollback.sql` sorts immediately after
`20260528000001_org_backfill.sql`. Left in `migrations/`, it would run right
after the migration it exists to reverse: stripping `NOT NULL` and the
`get_current_org_id()` default from every `org_id` column, and deleting the org
and member rows. That undoes the multi-tenant foundation — the isolation
boundary between one church's books and another's — on any database provisioned
from the migration history.

This was found while diffing a fresh install against the migrated schema: a
replay of `migrations/` dropped 23 org-scoped indexes and produced a large
phantom diff, which traced back to this script executing as if it were a
forward migration.

`migrate-check.yml` never tripped over it only because that workflow stashes
every existing migration and loads `schema.sql` as its baseline instead.

## Running one

Deliberately, manually, against a database you have a backup of:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollbacks/<script>.sql
```

Check what the script drops before running it. These are destructive by nature —
they delete data as well as schema.
