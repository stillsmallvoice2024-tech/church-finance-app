# Staging gate for migrations — one-time setup

This repo can test every migration on a practice ("staging") database before
it touches production. The workflow is already wired for it
(`.github/workflows/migrate.yml`); it's just off until you create a staging
Supabase project and add its secrets.

## Steps

1. In Supabase, create a new project (e.g. `church-finance-app-staging`).
2. On that project, run the same setup as production: apply
   `supabase/schema.sql`, then everything under `supabase/migrations/`, so it
   matches production's current shape.
3. In GitHub → repo Settings → Environments, create an environment named
   `staging` (mirrors the existing `production` environment).
4. Add these secrets to the `staging` environment:
   - `STAGING_SUPABASE_PROJECT_ID` — the staging project's ref ID
   - `STAGING_SUPABASE_DB_PASSWORD` — the staging project's DB password
5. Push a migration. The workflow will now run `deploy-staging` first;
   production only proceeds if staging succeeds.

Until step 4 is done, `deploy-staging` is skipped automatically and
production deploys as before — this is safe to merge ahead of the staging
project existing.
