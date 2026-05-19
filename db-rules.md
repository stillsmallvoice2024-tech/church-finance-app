# Database & Migration Rules

> Load when tasks involve: schema changes, new columns/tables, migration SQL, RLS policies, Supabase setup, table structure.

---

## Key Tables

| Table | Purpose |
|---|---|
| `profiles` | Extends auth.users; `full_name`, `username`, `role` |
| `categories` | Budget categories; `starting_balance`, `group_id`, `is_hidden` |
| `category_groups` | Groups categories for ledger display |
| `category_opening_balances` | Multi-portion opening balances; supersedes `categories.starting_balance` |
| `banks` | Bank accounts; `currency` (default NGN); starting balance cols: `starting_balance`, `starting_balance_category`, `starting_balance_budget_portion`, `starting_balance_alloc_type`, `starting_balance_allocations jsonb` |
| `currencies` | User-managed currency list; code PK, name, symbol, flag emoji |
| `allocation_configs` | Budget split configs; `rows` JSONB, `status` draft/locked, `is_special`, `allocation_type`; versioning cols: `config_group_id` → `special_config_groups(id)`, `effective_from date`, `effective_to date`, `version_number int` |
| `income_types` | Inflow labels; `color`, `special_config_id` (legacy), `special_config_group_id` → `special_config_groups(id)` |
| `special_config_groups` | Groups multiple versions of the same special config; `name`, `created_at`; income types link here via `special_config_group_id` |
| `transaction_allocation_snapshots` | Per-transaction snapshot of resolved special config at calculation time; `transaction_id` UNIQUE, `config_version_id`, `config_group_id`, `resolved_rows jsonb`, `allocation_type`, `is_recalculated bool`, `recalculated_at` |
| `recalculation_logs` | Audit trail for bulk recalculation actions; `config_group_id`, `config_version_id`, `performed_by`, `affected_count`, `reason`, `action_summary` |
| `income_type_rules` | Keyword/stage-code rules per income type |
| `inflow_transactions` | Money received; `bank_name` text, FX fields, `income_type_id`, `allocation_config_id` |
| `outflow_transactions` | Money paid out; `bank_name` text, FX fields, `is_pending_deduction` |
| `intra_flows` | Internal fund movements |
| `bank_deposits` | Physical cash deposits; `currency`, `fx_amount`, `fx_rate` |
| `intrabank_transfers` | Bank-to-bank transfers |
| `fx_transactions` | FX ledger; running balance per currency |
| `fx_conversions` | Links FX withdrawal → NGN inflow; `is_partial`, `exchange_rate` |
| `special_projects` | Named fundraising projects |
| `project_entries` | Entries per project |
| `receipts` | File attachments; `entity_type`, `entity_id`; RLS: SELECT=any auth user, INSERT/DELETE=any auth user (migration) |
| `invitations` | Token-based invites; `token` UUID, `expires_at` |
| `audit_log` | Whole-record snapshots on INSERT/UPDATE/DELETE |
| `field_changes` | Per-field old/new on UPDATE; `user_id` FK → `profiles(id)` |
| `report_templates` | Saved report layouts; `layout` JSONB, `created_by` FK → `profiles(id)` |
| `bank_schema_check` | Helper view; `SELECT column_name::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'banks'`; queried by `checkBankStartingBalanceMigration()` to bypass PostgREST column cache |
| `schema_discovery_view` | Optional helper view; `SELECT table_name::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`; queried by `discoverSchemaTables()` in `backupRestore.ts` to detect unmanaged tables; install via `SCHEMA_DISCOVERY_MIGRATION_SQL` exported from that module |

---

## Migration Strategy

- `supabase/schema.sql` = complete DDL for fresh installs — **not auto-run** against existing projects
- Incremental patches live in `MIGRATION_SQL` constant in `Setup.tsx` (Database tab — run manually in Supabase SQL editor)
- New column or table → update **both** `schema.sql` AND `Setup.tsx`
- **Receipts feature** has its own separate `MIGRATION_SQL` displayed inline on the Receipts page and in the ReceiptBadge error panel — it is **not** in `Setup.tsx`. Includes: table creation, RLS enable + policies, storage bucket, and `storage.objects` INSERT/SELECT/DELETE policies.
  - Policy blocks use `DROP POLICY IF EXISTS` + `CREATE POLICY` (not `DO $$ EXCEPTION duplicate_object`) — re-running the migration replaces any pre-existing wrong policies
  - If receipts INSERT is rejected with an RLS error, re-run the full receipts migration SQL; older schema installs had `is_finance_user()` / `is_admin()` on those policies

### Live-DB Migration Notes

| Columns | Tables | Required by |
|---|---|---|
| `transaction_type text` | `inflow_transactions`, `outflow_transactions` | Reversals, Refunds, BankDeposits pages |
| `original_transaction_id text` | `inflow_transactions`, `outflow_transactions` | Reversals, Refunds display |
| `currency text NOT NULL DEFAULT 'NGN'`, `starting_balance numeric`, `starting_balance_category text`, `starting_balance_budget_portion text`, `starting_balance_alloc_type text`, `starting_balance_allocations jsonb NOT NULL DEFAULT '[]'` | `banks` | AddBankModal opening balance section — also requires `bank_schema_check` view + GRANT (see SQL below) |
| `recorded_at timestamptz` | `inflow_transactions`, `outflow_transactions` | Financial Report basis selector (Recorded Date mode); "Recorded" column on Inflows/Outflows pages; editable in AddInflowModal/AddOutflowModal; **defaults to current date/time on all creation paths** |
| `config_group_id uuid`, `effective_from date`, `effective_to date`, `version_number int` | `allocation_configs` | Special config versioning — see Special Config Versioning section |
| `special_config_group_id uuid` | `income_types` | Links income type to a config group (replaces per-version `special_config_id` link) |

`recorded_at` migration is already in `MIGRATION_SQL` in `Setup.tsx` and backfills from `created_at` for existing rows. If adding manually:
```sql
ALTER TABLE inflow_transactions  ADD COLUMN IF NOT EXISTS recorded_at timestamptz;
UPDATE inflow_transactions SET recorded_at = created_at WHERE recorded_at IS NULL;
ALTER TABLE outflow_transactions ADD COLUMN IF NOT EXISTS recorded_at timestamptz;
UPDATE outflow_transactions SET recorded_at = created_at WHERE recorded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inflow_recorded_at  ON inflow_transactions(recorded_at);
CREATE INDEX IF NOT EXISTS idx_outflow_recorded_at ON outflow_transactions(recorded_at);
NOTIFY pgrst, 'reload schema';
```

If `transaction_type` is missing, Reversals/Refunds pages will error on SELECT (PostgREST rejects the `.eq()` filter); the ImportModal silently strips it on INSERT and records are saved without it. Run in Supabase SQL editor:
```sql
ALTER TABLE inflow_transactions  ADD COLUMN IF NOT EXISTS transaction_type text;
ALTER TABLE outflow_transactions ADD COLUMN IF NOT EXISTS transaction_type text;
ALTER TABLE inflow_transactions  ADD COLUMN IF NOT EXISTS original_transaction_id text;
ALTER TABLE outflow_transactions ADD COLUMN IF NOT EXISTS original_transaction_id text;
CREATE INDEX IF NOT EXISTS idx_inflow_txn_type  ON inflow_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_outflow_txn_type ON outflow_transactions(transaction_type);
```

The `banks` migration must include `currency` and all starting balance columns plus the helper view:
```sql
ALTER TABLE banks
  ADD COLUMN IF NOT EXISTS currency                  text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS starting_balance          numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS starting_balance_category text,
  ADD COLUMN IF NOT EXISTS starting_balance_budget_portion text,
  ADD COLUMN IF NOT EXISTS starting_balance_alloc_type text,
  ADD COLUMN IF NOT EXISTS starting_balance_allocations jsonb NOT NULL DEFAULT '[]';
CREATE OR REPLACE VIEW public.bank_schema_check AS
  SELECT column_name::text
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'banks';
GRANT SELECT ON public.bank_schema_check TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
```

### Two-Phase Schema Check (`SchemaStatus`)

`checkBankStartingBalanceMigration()` in `src/hooks/useBanks.ts` returns `SchemaStatus = 'ok' | 'migration_needed' | 'cache_stale'`:

| Status | Meaning | Required action |
|---|---|---|
| `ok` | All 6 columns exist in DB and PostgREST SELECT cache knows them | None — save proceeds |
| `migration_needed` | One or more columns absent from DB (logs which ones) | Run full `ALTER TABLE` + view SQL |
| `cache_stale` | Columns exist in DB but PostgREST SELECT cache is stale | Run `NOTIFY pgrst, 'reload schema';` only |

Checked columns (all 6 must exist): `currency`, `starting_balance`, `starting_balance_category`, `starting_balance_budget_portion`, `starting_balance_alloc_type`, `starting_balance_allocations`

Check flow:
1. Query `bank_schema_check` view → reflects live `information_schema` (unaffected by PostgREST table cache)
2. If all columns confirmed in DB, do a zero-row SELECT via PostgREST to verify its **SELECT** plan cache
3. PostgREST SELECT error → `cache_stale`; success → `ok`; view query error or missing columns → `migration_needed`

> **Important limitation**: the SELECT plan cache and the INSERT/UPDATE plan cache are separate in PostgREST. The check returning `'ok'` guarantees the SELECT cache is fresh but does **not** guarantee the INSERT/UPDATE cache is. If a save fails with a schema cache error after the check returns `'ok'`, the modal treats this as `'cache_stale'` (shows the NOTIFY banner) rather than retrying — retrying would loop until `schemaStuck` because the INSERT cache is still stale.

> **`schemaStuck` banner**: when the retry limit is exceeded, the modal now shows the actual raw DB error string + full migration SQL so the user has actionable information. The `cache_stale` banner also shows the raw error for diagnosis.

This distinction matters because `cache_stale` requires only `NOTIFY pgrst` (no DDL), while `migration_needed` requires a full `ALTER TABLE`. Showing the wrong SQL wastes a DDL operation on an already-migrated DB.

---

### SQL Authoring Rules

- FK refs in migration SQL: **no `public.` prefix** — Supabase resolves via `search_path`
- `CREATE POLICY` has no `IF NOT EXISTS` — always wrap in:
  ```sql
  DO $$ BEGIN
    CREATE POLICY "policy_name" ON table_name ...;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  ```
- To replace a policy: `DROP POLICY IF EXISTS "name" ON table;` then `CREATE POLICY`
- After any `ALTER TABLE ... ADD COLUMN`: append `NOTIFY pgrst, 'reload schema';` so PostgREST schema cache reloads immediately without user having to wait

---

## Supabase FK Join Type Inference

Supabase JS v2 infers many-to-one FK joins (e.g. `.select('amount, categories(name)')`) as `{ name: any }[]` (array) in TypeScript, even though the runtime value is a single object. Direct casts (`r.categories as { name: string }`) trigger TS2352 ("conversion may be a mistake").

**Fix**: double-cast via `unknown` to bypass the overlap check:
```ts
(r.categories as unknown as { name: string } | null)?.name ?? ''
```
This is safe — many-to-one FK joins genuinely return a single object at runtime.

---

## Audit Trail Pattern

Every UPDATE in the app must:
1. Fetch the old record from Supabase (`.select('*').eq('id', id).single()`)
2. Call `logAudit()` → inserts whole-record snapshot into `audit_log` — pass both `oldData` and `newData`
3. Call `logFieldChanges()` → inserts per-field diff rows into `field_changes` — call only if `oldData` exists

`field_changes.user_id` is a FK → `profiles(id)` — must be the currently authenticated user's ID.

Build the `updates` object as a named const before calling `.update()` so the same object can be passed to both `logAudit` and `logFieldChanges` without re-expressing the payload.

**Row-count check on UPDATE**: always chain `.select('id')` and throw if `!updatedRows?.length` — PostgREST silently returns no error when RLS rejects the row or the record is missing. **Never use `head: true` in `.select()` after `.update()`** — `head: true` changes the HTTP method to HEAD, which reads without writing; PostgREST returns the count of matching rows (not rows updated), `err` is null, and the write silently no-ops while appearing successful. Example pattern used in `useUpdateBank`:

**Conditional optional columns in UPDATE**: never fall back nullable migration columns to `[]` or `{}` — use a conditional spread so those fields are omitted entirely when not provided. Sending `starting_balance_allocations: []` on every bank UPDATE would trigger a PostgREST schema cache miss for users who haven't run the migration. Pattern used in `useUpdateBank`:
```ts
...(input.starting_balance_allocations !== undefined && {
  starting_balance_allocations: input.starting_balance_allocations,
})
```
```ts
const { data: updatedRows, error: err } = await supabase
  .from('banks').update(updates).eq('id', input.id).select('id')
if (err) throw err
if (!updatedRows?.length) throw new Error('Record not found or update silently rejected — please refresh and try again.')
```

Hooks confirmed compliant: `useUpdateTransaction`, `useUpdateFXTransaction`, `useUpdateBank`, `useUpdateCategory`. Any new UPDATE hook must follow the same pattern.

---

## Supabase RLS

- All tables in `public` schema with RLS enabled
- Helper functions: `is_admin()`, `is_finance_user()` (defined in schema)
- DELETE policies must use `auth.uid() IS NOT NULL` — see `auth-rules.md` and `miscellaneous.md`
- `useDeleteTransaction(table)` passes `count: 'exact'` and throws if `count === 0` — catches silent RLS denials
- `profiles` table: uses three separate non-recursive policies (`profiles_insert`, `profiles_update`, `profiles_delete`) — all `auth.uid() IS NOT NULL`. The old `profiles_admin_all` policy called `is_admin()` which re-queried `profiles`, causing infinite recursion — do not re-introduce helper-function-based policies on `profiles`

---

## Special Config Versioning

`special_config_groups` is the parent record. Each group can have multiple `allocation_configs` rows (versions), identified by `config_group_id`.

**Version resolution** (`getSpecialConfigVersionForDate` in `allocationStore.ts`):
- Filters by `config_group_id`, `status = 'locked'`, `effective_from <= date`, `effective_to >= date` (or NULL)
- Returns the version with the latest `effective_from` within range

**Creating a new version** (`createNewVersion` in `useSpecialConfigGroups.ts`):
1. Finds the version currently covering `effective_from` → sets its `effective_to = effective_from - 1 day`
2. Finds the next version after `effective_from` → sets new version's `effective_to = next.effective_from - 1 day` (or NULL if latest)
3. Inserts new version with `version_number = max + 1`

**Income type link** lives at the group level (`income_types.special_config_group_id`), not per-version. `special_config_id` (old per-config link) is preserved for backward compat; `AddInflowModal` checks group link first.

**Backdated recalculation**: after creating a backdated locked version, `getImpactedTransactionCount` finds transactions in the new version's date range → optionally calls `recalculateTransactions` which updates `allocation_config_id` + upserts `transaction_allocation_snapshots` + writes `recalculation_logs`.

**Data migration** (in `MIGRATION_SQL`): each existing `is_special = true` allocation_config gets its own group (version 1); income types' `special_config_group_id` is backfilled from `special_config_id`.

---

## Backup & Restore System (`src/utils/backupRestore.ts`)

- **`MANAGED_TABLES`** — registry of 21 tables with metadata: `key`, `label`, `module`, `restorePriority`, `backupEnabled`, `restoreMode`, `conflictColumn`, `requiresMigration`, `sensitive`, `optional`, `dependencies`
- **`restoreMode`** per table: `replace` (delete+insert), `merge` (upsert, rows preserved), `append` (upsert, nothing deleted — used for audit/log tables)
- **`DELETE_TABLES`** — derived at module load from `MANAGED_TABLES` (reversed order, filtered to `restoreMode !== 'append'` and `backupEnabled`). Never manually maintained.
- **`currencies` PK is `code`** (not `id`) — `conflictColumn: 'code'` required for upsert. All other tables use `conflictColumn: 'id'`.
- **Backup file format v2**: `{ _meta: BackupManifest, managed: {}, unmanaged: {} }`. v1 files (`{ _meta, data: {} }`) are auto-upgraded via `normalizeToV2()` inside `parseBackupFile()`.
- **Schema discovery**: `discoverSchemaTables()` queries `schema_discovery_view`. If view is absent, backup still works but unmanaged detection is skipped. Install via `SCHEMA_DISCOVERY_MIGRATION_SQL` (exported constant).
- **`compareRegistryToSchema()`** — developer utility; returns `{ inRegistry, inDb, notInRegistry, notInDb }` — useful for checking registry completeness after adding new tables.
- **Supabase Storage**: `backups/` bucket; `createShareableLink()` uploads backup JSON and returns a 7-day signed URL.
- **Strict mode**: when enabled, backup aborts if `schema_discovery_view` is unavailable or unmanaged tables are detected with data.

---

## Setup Page Integration (`src/pages/Setup.tsx`)

- **Database tab** — displays `MIGRATION_SQL` with a copy-to-clipboard button; user pastes into Supabase SQL editor
- `MIGRATION_SQL` is an idempotent string of `DO $$ ... EXCEPTION ...` blocks
- Tabs: General, Banks, Allocation, Special Configs, Income Types, Currencies, Database
