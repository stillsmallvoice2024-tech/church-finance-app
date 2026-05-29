# Database & Migration Rules

> Load when tasks involve: schema changes, new columns/tables, migration SQL, RLS policies, Supabase setup, table structure.

---

## Key Tables

| Table | Purpose |
|---|---|
| `profiles` | Extends auth.users; `full_name`, `username`, `role` |
| `categories` | Budget categories; `group_id`, `is_hidden` — `starting_balance` and `starting_balance_budget_portion` columns dropped (see migration script) |
| `category_groups` | Groups categories for ledger display |
| `category_opening_balances` | Multi-portion opening balances; **sole source of truth** for category opening balances |
| `banks` | Bank accounts; `currency` (default NGN); starting balance cols: `starting_balance`, `starting_balance_category`, `starting_balance_budget_portion`, `starting_balance_alloc_type`, `starting_balance_allocations jsonb`; opening balance propagated to `inflow_transactions` as `transaction_type = 'balance_brought_forward'` via `src/utils/bankOpeningBalance.ts` |
| `currencies` | User-managed currency list; code PK, name, symbol, flag emoji |
| `allocation_configs` | Budget split configs; `rows` JSONB, `status` draft/locked, `is_special`, `allocation_type`; versioning cols: `config_group_id` → `special_config_groups(id)`, `effective_from date`, `effective_to date`, `version_number int`; **no `start_date`/`end_date`** — only `effective_from`/`effective_to` exist |
| `outflow_types` | Reporting-only labels for outflows; `name` (unique), `color`, `created_by` FK → `profiles(id)` — **no effect on balances or allocations** |
| `income_types` | Inflow labels; `color`, `special_config_id` (legacy), `special_config_group_id` → `special_config_groups(id)` |
| `special_config_groups` | Groups multiple versions of the same special config; `name`, `created_at`; income types link here via `special_config_group_id` |
| `transaction_allocation_snapshots` | Per-transaction snapshot of resolved special config at calculation time; `transaction_id` UNIQUE, `config_version_id`, `config_group_id`, `resolved_rows jsonb`, `allocation_type`, `is_recalculated bool`, `recalculated_at` |
| `recalculation_logs` | Audit trail for bulk recalculation actions; `config_group_id`, `config_version_id`, `performed_by`, `affected_count`, `reason`, `action_summary` |
| `income_type_rules` | Keyword/stage-code rules per income type |
| `inflow_transactions` | Money received; `bank_name` text, FX fields, `income_type_id`, `allocation_config_id` |
| `outflow_transactions` | Money paid out; `bank_name` text, FX fields, `is_pending_deduction`, `outflow_type_id` nullable FK → `outflow_types(id) ON DELETE SET NULL` |
| `intra_flows` | Internal fund movements between categories; `account_from`/`account_to` text (name snapshot), `account_from_stage2`/`account_to_stage2` text (portion label), `total_amount`, `from_category_id`/`to_category_id` UUID FK → `categories(id) ON DELETE SET NULL` (authoritative ID), `status text DEFAULT 'active' CHECK (status IN ('active','reversed','void'))`, `reversal_of_id` UUID FK → `intra_flows(id)`, `transfer_type text` (e.g. `'bulk_reallocation'`), `batch_id uuid` (groups rows from the same bulk operation) |
| `bank_deposits` | Physical cash deposits; `currency`, `fx_amount`, `fx_rate` |
| `intrabank_transfers` | Bank-to-bank transfers |
| `fx_transactions` | FX ledger; running balance per currency |
| `fx_conversions` | Links FX withdrawal → NGN inflow; `is_partial`, `exchange_rate` |
| `special_projects` | Named fundraising projects |
| `project_entries` | Entries per project |
| `receipts` | File attachments; `entity_type`, `entity_id`; RLS: SELECT=any auth, INSERT/DELETE=`is_finance_user()` |
| `invitations` | Token-based invites; `token` UUID, `expires_at`; no direct SELECT for non-admins — use `get_invitation_by_token()` RPC |
| `audit_log` | Whole-record snapshots on INSERT/UPDATE/DELETE |
| `field_changes` | Per-field old/new on UPDATE; `user_id` FK → `profiles(id)` |
| `report_templates` | Saved report layouts; `layout` JSONB, `created_by` FK → `profiles(id)` |
| `dynamic_reports` | Report shells; `title`, `created_by` FK → `profiles(id)` |
| `dynamic_report_blocks` | Blocks per report; `report_id` FK, `block_type` (text/metric/table/formula), `position int`, `config_json jsonb` |
| `dynamic_report_snapshots` | Frozen resolved values; `report_id` FK, `label`, `snapshot_at timestamptz`, `data jsonb` (`SnapshotData`: `resolvedAt`, `resolved: Record<string,number>`, `tableData: Record<string, TableRow[]>`); RLS: read=any auth, write=`is_finance_user()`, delete=`is_admin()`; index on `(report_id, snapshot_at DESC)` |
| `bank_schema_check` | Helper view; `SELECT column_name::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'banks'`; queried by `checkBankStartingBalanceMigration()` to bypass PostgREST column cache |
| `schema_discovery_view` | Optional helper view; `SELECT table_name::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`; queried by `discoverSchemaTables()` in `backupRestore.ts` to detect unmanaged tables; install via `SCHEMA_DISCOVERY_MIGRATION_SQL` exported from that module |
| `organizations` | Tenant registry; `name`, `slug` UNIQUE, `created_by`, `metadata jsonb`; Phase 1 — bootstrap org `slug='primary'` created by Phase 2 migration |
| `org_members` | Maps users to orgs; `org_id`, `user_id`, `role` (admin/accountant/viewer), `status` (active/invited/suspended); UNIQUE `(org_id, user_id)`; backfilled from `profiles.role` by Phase 2 migration |

---

## Migration Strategy

- `supabase/schema.sql` = complete DDL for fresh installs — **not auto-run** against existing projects
- Incremental patches live in `MIGRATION_SQL` constant in `Setup.tsx` (Database tab — run manually in Supabase SQL editor)
- New column or table → update **both** `schema.sql` AND `Setup.tsx`
- **Receipts feature** has its own separate `MIGRATION_SQL` displayed inline on the Receipts page and in the ReceiptBadge error panel — it is **not** in `Setup.tsx`. Includes: table creation, RLS enable + policies, storage bucket, and `storage.objects` INSERT/SELECT/DELETE policies.
  - Policy blocks use `DROP POLICY IF EXISTS` + `CREATE POLICY` (not `DO $$ EXCEPTION duplicate_object`) — re-running the migration replaces any pre-existing wrong policies
  - Correct receipts INSERT/DELETE policy: `is_finance_user()` — re-run full receipts migration if older `auth.uid() IS NOT NULL` policies are present
- **Security hardening migration**: `supabase/migrations/20260519000000_security_hardening.sql` — apply once in Supabase SQL editor; idempotent (`DROP IF EXISTS` before every `CREATE`)
- **Multi-tenant Phase 1**: `supabase/migrations/20260528000000_multi_tenant_foundation.sql` — creates `organizations`, `org_members`; adds nullable `org_id` to 26 business tables; stubs `get_current_org_id()` returning NULL
- **Multi-tenant Phase 2**: `supabase/migrations/20260528000001_org_backfill.sql` — run against existing DB (**not** `schema.sql`); idempotent; see [Org Backfill State](#org-backfill-state) below
  - Rollback: `supabase/migrations/20260528000001_org_backfill_rollback.sql`

### Live-DB Migration Notes

| Columns | Tables | Required by |
|---|---|---|
| `outflow_type_id uuid REFERENCES outflow_types(id) ON DELETE SET NULL` + `CREATE INDEX idx_outflow_type_id` | `outflow_transactions` | Outflow Types feature; requires `outflow_types` table to exist first |
| `transaction_type text` | `inflow_transactions`, `outflow_transactions` | Reversals, Refunds, BankDeposits pages |
| `original_transaction_id text` | `inflow_transactions`, `outflow_transactions` | Reversals, Refunds display |
| `currency text NOT NULL DEFAULT 'NGN'`, `starting_balance numeric`, `starting_balance_category text`, `starting_balance_budget_portion text`, `starting_balance_alloc_type text`, `starting_balance_allocations jsonb NOT NULL DEFAULT '[]'` | `banks` | AddBankModal opening balance section — also requires `bank_schema_check` view + GRANT (see SQL below) |
| `recorded_at timestamptz` | `inflow_transactions`, `outflow_transactions` | Financial Report basis selector (Recorded Date mode); "Recorded" column on Inflows/Outflows pages; editable in AddInflowModal/AddOutflowModal; **defaults to current date/time on all creation paths** |
| `UNIQUE INDEX idx_inflow_bf_unique_bank (bank_name) WHERE transaction_type = 'balance_brought_forward'` + `idx_inflow_bank_name` + `idx_outflow_bank_name` | `inflow_transactions`, `outflow_transactions` | B/F dedup constraint + query perf; dedup cleanup step in `MIGRATION_SQL` runs first to clear existing duplicates |
| `config_group_id uuid`, `effective_from date`, `effective_to date`, `version_number int` | `allocation_configs` | Special config versioning — see Special Config Versioning section |
| `special_config_group_id uuid` | `income_types` | Links income type to a config group (replaces per-version `special_config_id` link) |
| `from_category_id uuid`, `to_category_id uuid`, `status text`, `reversal_of_id uuid` | `intra_flows` | Intraflow traceability — run `supabase/add_intraflow_traceability.sql`; backfills IDs from name text for existing rows; `status DEFAULT 'active'` |
| `transfer_type text`, `batch_id uuid` | `intra_flows` | Bulk reallocation tagging — run `supabase/add_bulk_reallocation_support.sql`; adds `idx_intra_batch` index on `batch_id` |

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

### Org Backfill State (Phase 2 — applied 2026-05-28)

- **Primary org**: `organizations` row with `slug = 'primary'`, name `My Church`
- **`org_id` on 26 business tables**: `NOT NULL DEFAULT public.get_current_org_id()` — all rows backfilled; new inserts get org_id automatically without frontend changes
- **`get_current_org_id()`**: resolves `SELECT id FROM organizations WHERE slug = 'primary' LIMIT 1` (was NULL stub in Phase 1)
- **`org_members`**: one row per `profiles` row, `role` copied from `profiles.role`, `status = 'active'`
- **Composite indexes added**: `(org_id, date)` on `inflow_transactions`, `outflow_transactions`, `intra_flows`, `bank_deposits`, `intrabank_transfers`, `fx_transactions`, `project_entries`, `ledger_entries`
- **Phase 3 remaining**: RLS `org_id = get_current_org_id()` predicates; `handle_new_user()` trigger to insert `org_members`; `accept_invitation` RPC update; `backupRestore.ts` registry additions
- **Tables without `org_id`**: `profiles`, `audit_log`, `field_changes`, `dynamic_report_blocks`, `dynamic_report_snapshots`, `currencies`

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

**Row-count check on UPSERT**: same pattern applies — chain `.select('id')` and throw if `data?.length === 0`. PostgREST upserts silently no-op when RLS blocks the INSERT or UPDATE without returning an error. `upsertCategoryOpeningBalance` is the reference implementation.

**Filtering / deleting SQL NULL via PostgREST**: `.eq('column', null)` matches the string `"null"`, NOT SQL NULL. To match SQL NULL use `.is('column', null)` (renders as `column=is.null`). Applies to both SELECT filters and DELETE `.eq()` chains.

---

## Supabase RLS

- All tables in `public` schema with RLS enabled
- Helper functions: `is_admin()`, `is_finance_user()` — both `SECURITY DEFINER STABLE`; safe to use in any policy including `profiles` (no recursion — they bypass RLS internally)
- **DELETE policy rule**: transaction/receipt tables use `is_finance_user()`; config/setup/profile tables use `is_admin()`. Do NOT use bare `auth.uid() IS NOT NULL` for destructive ops.
- `useDeleteTransaction(table)` passes `count: 'exact'` and throws if `count === 0` — catches silent RLS denials
- `outflow_types` and `category_outflow_type_map`: RLS enabled (added in security hardening); read=any auth, write=`is_finance_user()`, delete=`is_admin()` / `is_finance_user()`

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

- **`MANAGED_TABLES`** — registry of 22 tables with metadata: `key`, `label`, `module`, `restorePriority`, `backupEnabled`, `restoreMode`, `conflictColumn`, `requiresMigration`, `sensitive`, `optional`, `dependencies`
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
- Tabs: General, Banks, Allocation, Special Configs, Income Types, **Outflow Types**, Currencies, Database
