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
| `allocation_configs` | Budget split configs; `rows` JSONB, `status` draft/locked, `is_special`, `allocation_type` |
| `income_types` | Inflow labels; `color`, `special_config_id` |
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

---

## Migration Strategy

- `supabase/schema.sql` = complete DDL for fresh installs — **not auto-run** against existing projects
- Incremental patches live in `MIGRATION_SQL` constant in `Setup.tsx` (Database tab — run manually in Supabase SQL editor)
- New column or table → update **both** `schema.sql` AND `Setup.tsx`
- **Receipts feature** has its own separate `MIGRATION_SQL` displayed inline on the Receipts page and in the ReceiptBadge error panel — it is **not** in `Setup.tsx`. Includes: table creation, RLS enable + policies, storage bucket, and `storage.objects` INSERT/SELECT/DELETE policies. Users who ran an older version of this migration (pre-storage-policies) must re-run just the `DO $$ ... storage.objects ...` blocks manually.

### Live-DB Migration Notes

| Columns | Tables | Required by |
|---|---|---|
| `transaction_type text` | `inflow_transactions`, `outflow_transactions` | Reversals, Refunds, BankDeposits pages |
| `original_transaction_id text` | `inflow_transactions`, `outflow_transactions` | Reversals, Refunds display |
| `starting_balance numeric`, `starting_balance_category text`, `starting_balance_budget_portion text`, `starting_balance_alloc_type text`, `starting_balance_allocations jsonb NOT NULL DEFAULT '[]'` | `banks` | AddBankModal opening balance section — also requires `bank_schema_check` view + GRANT (see SQL below) |
| `recorded_at timestamptz` | `inflow_transactions`, `outflow_transactions` | Financial Report basis selector (Recorded Date mode); "Recorded" column on Inflows/Outflows pages; editable in AddInflowModal/AddOutflowModal; **defaults to current date/time on all creation paths** |

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

The `banks` starting balance migration must also include the helper view so `checkBankStartingBalanceMigration()` can query live schema state:
```sql
ALTER TABLE banks
  ADD COLUMN IF NOT EXISTS starting_balance               numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS starting_balance_category      text,
  ADD COLUMN IF NOT EXISTS starting_balance_budget_portion text,
  ADD COLUMN IF NOT EXISTS starting_balance_alloc_type    text,
  ADD COLUMN IF NOT EXISTS starting_balance_allocations   jsonb NOT NULL DEFAULT '[]';
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
| `ok` | Columns exist in DB and PostgREST cache knows them | None — save proceeds |
| `migration_needed` | Columns absent from DB | Run full `ALTER TABLE` + view SQL |
| `cache_stale` | Columns exist in DB but PostgREST INSERT cache is stale | Run `NOTIFY pgrst, 'reload schema';` only |

Check flow:
1. Query `bank_schema_check` view → reflects live `information_schema` (unaffected by PostgREST table cache)
2. If columns confirmed in DB, do a zero-row SELECT via PostgREST to verify its INSERT cache
3. PostgREST SELECT error → `cache_stale`; success → `ok`; view query error or missing columns → `migration_needed`

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

## Audit Trail Pattern

Every UPDATE in the app must:
1. Fetch the old record from Supabase
2. Call `logAudit()` → inserts whole-record snapshot into `audit_log`
3. Call `logFieldChanges()` → inserts per-field diff rows into `field_changes`

`field_changes.user_id` is a FK → `profiles(id)` — must be the currently authenticated user's ID.

---

## Supabase RLS

- All tables in `public` schema with RLS enabled
- Helper functions: `is_admin()`, `is_finance_user()` (defined in schema)
- DELETE policies must use `auth.uid() IS NOT NULL` — see `auth-rules.md` and `miscellaneous.md`
- `useDeleteTransaction(table)` passes `count: 'exact'` and throws if `count === 0` — catches silent RLS denials
- `profiles` table: uses three separate non-recursive policies (`profiles_insert`, `profiles_update`, `profiles_delete`) — all `auth.uid() IS NOT NULL`. The old `profiles_admin_all` policy called `is_admin()` which re-queried `profiles`, causing infinite recursion — do not re-introduce helper-function-based policies on `profiles`

---

## Setup Page Integration (`src/pages/Setup.tsx`)

- **Database tab** — displays `MIGRATION_SQL` with a copy-to-clipboard button; user pastes into Supabase SQL editor
- `MIGRATION_SQL` is an idempotent string of `DO $$ ... EXCEPTION ...` blocks
- Tabs: General, Banks, Allocation, Special Configs, Income Types, Currencies, Database
