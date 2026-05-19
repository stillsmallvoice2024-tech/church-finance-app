# Ledger & Financial Rules

## Bank Deposits Page (`BankDeposits.tsx`)

`BankDeposits.tsx` shows a **merged view** of three sources:
1. `bank_deposits` table rows (physical deposit slips — editable/deletable)
2. `inflow_transactions` where `transaction_type = 'bank_deposit'`
3. `outflow_transactions` where `transaction_type = 'bank_deposit'`

Each row carries a `source` field (`'bank_deposits' | 'inflow' | 'outflow'`). Edit/delete actions are restricted to `bank_deposits`-source rows only. Bank filter: `bank_deposits` rows matched by `bank_id`; tagged rows matched by `bank_name`.

The reconciliation panel (collapsible) computes `SUM(inflow.amount WHERE transaction_type='bank_deposit') − SUM(outflow.amount_disbursed WHERE transaction_type='bank_deposit')`. Uses tagged transaction rows only — the `bank_deposits` table is not part of this calculation.

> `bank_deposits` table rows do NOT appear in BankLedger — that gap remains open (see Known Propagation Gaps).

---



**Rule:** `bank_name` is plain text (not FK) and **must be set at insert time** — records with `bank_name = NULL` are invisible to BankLedger.

Sources that set `bank_name`:
- `AddInflowModal` — Bank selector stores bank `name` as `bank_name`
- `AddOutflowModal` — Bank selector stores `bank_name` on both add and edit
- `Import.tsx` ManualEntryForm — resolves `bank_id` → `bank_name` before calling mutation
- `ImportModal.tsx` batch wizard — sets `bank_name` from the `bank` prop passed from `Import.tsx`

Both `AddInflowInput` and `AddOutflowInput` in `useMutations.ts` include `bank_name?: string`. `OutflowTransaction` type includes `bank_name: string | null`.

> Existing outflows with `bank_name = NULL` won't appear in BankLedger. Edit-and-resave or update directly in Supabase.

---

## Allocation Configs

**Regular configs** (`is_special = false`):
- Held in `allocationStore` (fetched once on first use)
- `getConfigForDate(configs, date)` → most recent **locked, non-special** config with `start_date` ≤ date
- Draft configs are never applied
- Special configs are explicitly excluded from date lookup

**Special configs** (`is_special = true`):
- Created via `CreateSpecialConfigModal` — Save as Draft or Save & Lock
- Locked = immutable; unlock via "Unlock & Edit" or "Create a Copy" dialog
- Linked to income types via `income_types.special_config_id`
- Auto-applied to inflow transactions when that income type is selected
- `useSpecialConfigOptions()` exposes `reload()`; `AddIncomeTypeModal` calls it on open

---

## Category Ledger (`CategoryLedger.tsx`)

4 aggregate summary cards (computed from all unfiltered rows):
- **% Allocated** — total NGN allocated via percentage configs
- **Specific Seeds** — total Specific Seed portion
- **Savings Net** — net savings (in − out)
- **Grand Total** — sum of all three

Per-inflow allocation config resolution (used in both `loadSummary` and `loadLedger`):
1. **If `transaction_type` is set → skip entirely** (refund, reversal, bank_deposit, intrabank_transfer are never allocated)
2. If inflow has `allocation_config_id` set → use that specific config
3. Otherwise → `getConfigForDate(configs, inflow.date)`

This ensures special-config inflows (e.g. Easter offering) use the correct percentages rather than the date-based general config.

> `transaction_type` must be included in the SELECT for both `loadSummary` and `loadLedger` queries — the guard uses `(r as Record<string, unknown>).transaction_type`.

---

## Category Opening Balances

- Table: `category_opening_balances` — one row per category per budget portion
- `UNIQUE(category_id, budget_portion)` constraint
- **Supersedes** `categories.starting_balance` (legacy field)
- All consumers (`CategoryLedger`, `SavingsPortions`, `SpecificGivings`) query new table first, fall back to `categories.starting_balance`
- `CategoryModal` pre-populates from new table on edit; migrates from legacy field if no new-table rows exist
- **On save**, `CategoryModal.handleSubmit` mirrors the first valid ob-row into `categories.starting_balance` / `starting_balance_budget_portion` in the same UPDATE — ensures the balance persists via the legacy field if `category_opening_balances` hasn't been migrated yet; upsert to new table still runs when the table exists
- Helper functions in `useCategories.ts`: `upsertCategoryOpeningBalance()`, `deleteCategoryOpeningBalance()`, `fetchCategoryOpeningBalances()`

### Bank Opening Balance Propagation

`AddBankModal` propagates allocations into `category_opening_balances` after saving the bank record:
- Each allocation row has `apply_to_category: boolean` — `true` = new/unrecorded amount, `false` = already in transaction records (skip)
- For `apply_to_category = true` rows: upsert `(category_id, budget_portion, amount)` resolved as:
  - Percentage mode: `Math.round((pct / 100) × starting_balance × 100) / 100`
  - Amount mode: direct `amount` value
- For `apply_to_category = false` rows: no write — amount is already captured in existing transactions, no double-count
- Category is resolved by name: `categories.find(c => c.name === row.category_name)?.id`
- Propagation runs after successful bank INSERT/UPDATE; partial failure → warning toast naming each failing category (bank save not rolled back)
- On edit: stale cleanup — if a row was previously `apply_to_category = true` and is now `false`, the modal deletes the corresponding `category_opening_balances` row via `deleteCategoryOpeningBalance()` before upserting new entries
- `starting_balance_allocations` is only sent in the save payload when `hasBalance` is true; sending it for plain banks (no opening balance) would force schema migration unnecessarily
- Schema cache retry (when save fails due to stale PostgREST cache): on re-check returning `'ok'`, modal toasts "Save failed during schema refresh — please try again" so the user knows to resubmit; the save is NOT retried automatically

---

## Specific Givings (`SpecificGivings.tsx`)

- Queries `inflow_transactions` where `stage_code_2 = 'Specific Seed'`, filtered by accounting year
- Injects synthetic "Opening Balance" rows from `category_opening_balances` (Specific Seed portion) **regardless of year filter**

---

## FX Conversion (3-step sequential insert)

`useAddFXConversion()` in `useFXConversions.ts`:
1. Insert `fx_transactions` withdrawal (computes running balance from last row)
2. Insert `inflow_transactions` NGN inflow
3. Insert `fx_conversions` link record with both IDs

No DB transaction — step 1 commits even if step 2 fails. Accepted trade-off.

---

## Category Ledger Auto-Sync

`src/store/transactionSyncStore.ts` holds an `outflowVersion` counter.

Bumped after every outflow write:
- `useAddOutflow` — after successful insert
- `useUpdateTransaction` — when `table === 'outflow_transactions'`
- `ImportModal` — after outflow batch loop if `outflowToInsert.length > 0`

`CategoryLedger` subscribes via `useTransactionSyncStore(s => s.outflowVersion)` and adds it to **both** useEffect dep arrays:
- `useEffect([loadSummary, outflowVersion])` — re-runs summary cards
- `useEffect([viewMode, activeCategory, ledgerPortion, loadLedger, outflowVersion])` — re-runs per-category ledger view

Both effects must include `outflowVersion`; omitting it from either causes the corresponding view to go stale after outflow writes.

---

## Outflow Amount Calculation

`outflow_transactions.actual_amount` has `DEFAULT 0` — it is **never NULL** for rows inserted without that field (manual entry via `AddOutflowModal` never sets it).

**Always use `||` (not `??`) when falling back to `amount_disbursed`:**
```ts
Number(r.actual_amount || r.amount_disbursed || 0)
```
`??` only replaces `null`/`undefined`; `0 ?? 500` = `0`. Using `??` makes every manually-entered outflow compute as zero, hiding it from CategoryLedger, SavingsPortions, useReportEngine, and Reports.

Affected call sites: `CategoryLedger.tsx` (loadSummary + both loadLedger loops), `SavingsPortions.tsx`, `useReportEngine.ts` (savingsOut + pctOut), `Reports.tsx` (annual + monthly — also requires `amount_disbursed` in SELECT).

---

## Mutations & Audit Trail

All writes via `useMutations.ts`:
```ts
const { mutate, loading, error } = useAddInflow()
await mutate(input)  // throws on error
```

Every UPDATE hook:
1. Fetches old record
2. `logAudit()` → whole-record snapshot to `audit_log`
3. `logFieldChanges()` → per-field diff to `field_changes`

`useDeleteTransaction(table)` accepts `'inflow_transactions' | 'outflow_transactions' | 'intra_flows'`.
Uses `delete({ count: 'exact' })`; throws if `count === 0` — catches silent Supabase RLS denials (PostgREST returns no error but deletes 0 rows).

---

## Known Propagation Gaps (Not Yet Fixed)

| Gap | Detail |
|-----|--------|
| FX conversion NGN inflow missing `bank_name` | `useAddFXConversion` doesn't accept a bank; created inflow won't appear in any bank ledger |
| Intrabank transfers invisible to BankLedger | `intrabank_transfers` not queried by BankLedger |
| Bank deposits invisible to BankLedger | `bank_deposits` table rows not queried by BankLedger |
| FX inflow fields not synced to `fx_transactions` | Inflows with `fx_currency` set do NOT auto-create an `fx_transactions` row |
| Project entries not linked to transactions | `project_entries` amounts are a parallel ledger; excluded from Reports and CategoryLedger totals |
| Dashboard doesn't react to deletes | `useDashboard` subscribes to INSERT events only; delete won't update KPI cards until page reload |

## Financial Report (`FinancialReport.tsx`)

### Report Basis

Two date axes, toggled via UI selector (`ReportBasis`):
- `'transaction_date'` (default) — cumulative financial reports; filters by transaction `date` field (`.lte('date', reportDate)`)
- `'recorded_at'` — operational upload reports; filters by `recorded_at` field (`.lte('recorded_at', ...)`)

Config resolution always uses `inflow.date` regardless of basis (allocation config is financial, not operational).

### Balance Engine: `useReportEngine(reportDate, reportBasis)`

`src/hooks/useReportEngine.ts` returns:
- `balances: Map<categoryName, ReportCategoryBalance>` — standard category balances (percentage allocated, specific seed, savings net)
- `operationalBalances: OperationalBalanceMap` — `Map<string, number>` for income-type and transaction-type rows

**Operational balance keys** (always exact-day filter on `recorded_at`):
- Income type rows: `it::${incomeTypeId}`
- Tagged transaction-type rows: `tt::${transactionType}` (reversal, refund, bank_deposit, intrabank_transfer)
- Normal inflow rows: `tt::normal` — inflows where `transaction_type IS NULL`

### Multi-Table Layout

`ReportLayout = { tables?: ReportTable[], groups?: ReportGroup[], basis?: ReportBasis }`
- New format: `tables` array (multi-table, each table independent)
- Legacy format: `groups` array (auto-migrated by `normaliseTables()` → wraps into single table with `id: 'legacy'`)
- `normaliseTables(layout)` in `reportExport.ts` and `FinancialReport.tsx` provides backward compat on load

Hierarchy: **Table → Group → Subgroup (optional) → Item**

Item row types (`ReportRowType`): `'category'` | `'inflow_type'` | `'transaction_type'`
- Category rows: use `balances` map keyed by `categoryName`
- Income type rows: use `operationalBalances` keyed `it::${incomeTypeId}`
- Transaction type rows: use `operationalBalances` keyed `tt::${transactionTypeKey}`

`itemKey(item)` — canonical dedup key: `it::${id}` / `tt::${key}` / `cat::${name}::${portion}`
Same category may appear with different portions; each is a distinct item.

`ReportTable.include_in_combined_total?: boolean` — defaults `true`; when `false`, table excluded from combined grand total. `computeGrandTotal()` and both export functions only sum opted-in tables. `normaliseTables()` sets `true` for legacy layouts.

### `recorded_at` Field

- `recorded_at timestamptz` — editable business/upload date; field label is "Recorded Date" in both AddInflowModal and AddOutflowModal
- **Defaults to current date/time on all creation paths:** AddInflowModal, AddOutflowModal (date picker pre-filled), ManualEntryForm in Import.tsx (`new Date().toISOString()`), ImportModal batch insert (single `importTimestamp` stamped on all rows in the batch)
- Fully editable after creation in both modals
- `created_at` — immutable audit timestamp; **not used for report filtering** (old behaviour removed)
- Migration backfills `recorded_at = created_at` for existing rows

### Template Storage

`report_templates` table; `layout` JSONB now stores `{ tables: ReportTable[], basis: ReportBasis }`.
Legacy templates with `{ groups: [...] }` are auto-migrated on load via `normaliseTables()`.
Hooks: `useReportTemplates`, `useAddReportTemplate`, `useUpdateReportTemplate`, `useDeleteReportTemplate` in `src/hooks/useReportTemplates.ts`

### Export (`src/utils/reportExport.ts`)

- `exportReportPDF()` — per-table title bars, subgroup sub-totals, per-table totals; combined grand total appended when ≥2 visible tables and at least one is opted in
- `exportReportExcel()` — one sheet per table; Summary sheet added when combined total applies
- `computeGroupTotal / computeTableTotal / computeGrandTotal` — `computeGrandTotal` only sums opted-in visible tables
- `getItemBalance(item, balances, opBalances)` — dispatches by `rowType` (category / inflow_type / transaction_type)

---

## Transaction-Type Page Routing

Pages that show type-filtered views of `inflow_transactions` / `outflow_transactions`:

| `transaction_type` value | Page | Query |
|---|---|---|
| `'reversal'` | `ReversalTransactions.tsx` | `.eq('transaction_type', 'reversal')` on both tables |
| `'refund'` | `RefundTransactions.tsx` | `.eq('transaction_type', 'refund')` on both tables |
| `'bank_deposit'` | `BankDeposits.tsx` | merged into page alongside `bank_deposits` table |
| `'intrabank_transfer'` | *(IntraBankTransfers queries `intrabank_transfers` table — tagged txns not surfaced there)* | gap open |

> If Reversals or Refunds pages show an error or empty results: verify the `transaction_type` column exists in the live DB (see `db-rules.md`). The application query logic is correct.
