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
| `banks` | Bank accounts; `currency` (default NGN) |
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
| `receipts` | File attachments; `entity_type`, `entity_id` |
| `invitations` | Token-based invites; `token` UUID, `expires_at` |
| `audit_log` | Whole-record snapshots on INSERT/UPDATE/DELETE |
| `field_changes` | Per-field old/new on UPDATE; `user_id` FK → `profiles(id)` |

---

## Migration Strategy

- `supabase/schema.sql` = complete DDL for fresh installs — **not auto-run** against existing projects
- Incremental patches live in `MIGRATION_SQL` constant in `Setup.tsx` (Database tab — run manually in Supabase SQL editor)
- New column or table → update **both** `schema.sql` AND `Setup.tsx`

### Live-DB Migration Notes

| Columns | Tables | Required by |
|---|---|---|
| `transaction_type text` | `inflow_transactions`, `outflow_transactions` | Reversals, Refunds, BankDeposits pages |
| `original_transaction_id text` | `inflow_transactions`, `outflow_transactions` | Reversals, Refunds display |

If `transaction_type` is missing, Reversals/Refunds pages will error on SELECT (PostgREST rejects the `.eq()` filter); the ImportModal silently strips it on INSERT and records are saved without it. Run in Supabase SQL editor:
```sql
ALTER TABLE inflow_transactions  ADD COLUMN IF NOT EXISTS transaction_type text;
ALTER TABLE outflow_transactions ADD COLUMN IF NOT EXISTS transaction_type text;
ALTER TABLE inflow_transactions  ADD COLUMN IF NOT EXISTS original_transaction_id text;
ALTER TABLE outflow_transactions ADD COLUMN IF NOT EXISTS original_transaction_id text;
CREATE INDEX IF NOT EXISTS idx_inflow_txn_type  ON inflow_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_outflow_txn_type ON outflow_transactions(transaction_type);
```

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

---

## Setup Page Integration (`src/pages/Setup.tsx`)

- **Database tab** — displays `MIGRATION_SQL` with a copy-to-clipboard button; user pastes into Supabase SQL editor
- `MIGRATION_SQL` is an idempotent string of `DO $$ ... EXCEPTION ...` blocks
- Tabs: General, Banks, Allocation, Special Configs, Income Types, Currencies, Database
