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

**Every config must belong to a group.** `buildVersionIndex()` skips any row with a null `config_group_id`, and the Distribution Rules tab only lists rows by group — so a config written without one is invisible everywhere and applies to nothing. The General (fallback) rule is the group with `special_config_groups.is_default = true`; write to it via `createGeneralVersion()`.

**Drafts apply to nothing.** Only `status = 'locked'` versions resolve. Anything that creates drafts (the onboarding wizard) needs a reachable approve action — see `approveDraft` in `DistributionRulesTab.tsx`.

**Regular configs** (`is_special = false`):
- Held in `allocationStore` (fetched once on first use; `reload()` shares/awaits the in-flight fetch)
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
- **% Allocation** — net NGN balance in the Percentage Allocation bucket (`allocMap − pctOutMap`); includes opening balances, config-allocated inflows, and intraflow adjustments, minus pct-allocation outflows
- **Specific Seeds** — net Specific Seed balance; includes direct seed inflows, COB, config-split allocations, intraflow adjustments, minus outflows tagged `stage_code_2 = 'Specific Seed'`
- **Savings Net** — net savings (in − out)
- **Grand Total** — sum of all three

**`loadSummary` query pattern** — all three non-percentage buckets follow the same net-balance formula (inflows + COB + config-splits + intraflow credits − outflows − intraflow debits):
- `pctOutRes`: `outflow_transactions` excluding Specific Seed and Savings → subtracted from `allocMap` per category
- `seedOutRes`: `outflow_transactions WHERE stage_code_2 = 'Specific Seed'` → subtracted from `specificSeed` per category
- `savOutRes`: `outflow_transactions WHERE stage_code_2 = 'Savings'` → subtracted via `savingsOut` per category (existing)

Without each outflow query the corresponding card shows cumulative inflows, not current balance.

Per-inflow allocation config resolution (used in both `loadSummary` and `loadLedger`):
1. **If `transaction_type` is set → skip entirely** (refund, reversal, bank_deposit, intrabank_transfer are never allocated)
2. **Guard:** `if (r.stage_code_2 && r.stage_code_2 !== 'Percentage Allocation') continue` — skips any inflow with an explicit non-percentage portion (avoids double-counting with `seedRes`/`savInRes` queries); `null` stage_code_2 passes through
3. If inflow has `allocation_config_id` set → use that specific config
4. Otherwise → `getConfigForDate(configs, inflow.date)`

This ensures special-config inflows (e.g. Easter offering) use the correct percentages rather than the date-based general config.

> `transaction_type` must be included in the SELECT for both `loadSummary` and `loadLedger` queries — the guard uses `(r as Record<string, unknown>).transaction_type`.

### Budget Portion Routing from Config Rows

Each `AllocationRow` carries `budget_portion: 'Percentage' | 'Specific Seed' | 'Savings'`. When processing a config's rows, the allocated amount (`inflow.amount × row.percentage / 100`) is routed to the **correct bucket per row**, not universally to percentage:

| `row.budget_portion` | Routed to |
|---|---|
| `'Specific Seed'` | `specificSeed` bucket (same as direct Specific Seed transactions) |
| `'Savings'` | `savingsIn` bucket |
| `'Percentage'` or unset | `allocMap` (percentage allocation bucket) |

**Example:** Crusades config — `10% Tithe / Percentage` + `90% God-Encounters / Specific Seed`:
- 5,000 inflow → 500 → `allocMap['Tithe']`, 4,500 → `specificSeed['God-Encounters']`

**Critical:** `allocation_config_id` presence NEVER forces an inflow into the percentage bucket. Only the config row's own `budget_portion` determines placement. Config-based inflows intentionally have `stage_code_2 = null`; routing is read-time from config rows, not stored on the transaction.

**CategoryLedger Percentage ledger**: catRow match restricted to `budget_portion === 'Percentage'` or unset — prevents config rows tagged for other portions from bleeding into the Percentage ledger tab.

**CategoryLedger Specific Seed / Savings ledger**: fetches a third query for config-split inflows (`allocation_config_id NOT NULL`, `stage_code_2 IS NULL`) and includes the allocated amount for `activeCategory` where the matching config row's `budget_portion` equals the active portion tab.

---

## Category Opening Balances

- Table: `category_opening_balances` — one row per category per budget portion
- `UNIQUE(category_id, budget_portion)` constraint
- **Sole and exclusive source** for category opening balances — `categories.starting_balance` and `categories.starting_balance_budget_portion` columns have been **dropped** from the DB
- `Category` interface no longer includes balance fields; `AddCategoryInput` / `UpdateCategoryInput` have no balance fields
- All consumers (`CategoryLedger`, `SavingsPortions`, `SpecificGivings`, `useReportEngine`) read exclusively from `category_opening_balances`
- `CategoryModal` pre-populates from COB on edit; saves write only to COB (no legacy mirror)
- **On save (stale cleanup)**, deletes stale portions then upserts new ones; null-`budget_portion` rows cleaned via `.is('budget_portion', null)` (`.eq()` matches the string `"null"`, not SQL NULL)
- **`upsertCategoryOpeningBalance()`** chains `.select('id')` and throws if `data?.length === 0` — catches silent RLS denials; `cob_write` policy must exist
- **Ob error state**: `CategoryModal` has a separate `obError` state for upsert errors — shown in the modal's error box
- **`categoryHasLinkedData()`**: checks `category_opening_balances` (count > 0) + inflow/outflow transactions
- **Migration script**: `supabase/migrate_drop_category_starting_balance.sql` — backfills legacy values into COB then drops the two columns; run **after** deploying updated code
- Helper functions in `useCategories.ts`: `upsertCategoryOpeningBalance()`, `deleteCategoryOpeningBalance()`, `fetchCategoryOpeningBalances()`

### Bank Ledger Balance Brought Forward Propagation

`AddBankModal` calls `propagateBankOpeningBalance()` (`src/utils/bankOpeningBalance.ts`) after every successful bank save:
- Upserts a DB audit row in `inflow_transactions`: `transaction_type = 'balance_brought_forward'`, `date = '1900-01-01'`, `description = 'Balance Brought Forward'`, `bank_name = bankName`
- DB row is for audit/export/backup only — **BankLedger never displays it directly**
- Deduplication: `.limit(2)` (not `.maybeSingle()`) to avoid PGRST116 when duplicates exist; inline cleanup deletes extras before proceeding
- Balance > 0 → insert (if none) or update `amount` (if exists)
- Balance cleared / ≤ 0 → delete the DB entry
- Bank rename (`previousBankName !== bankName`) → delete entry under old name first, then upsert under new name
- Propagation failure → warning toast; bank save is NOT rolled back
- DB uniqueness enforced by partial unique index `idx_inflow_bf_unique_bank ON inflow_transactions(bank_name) WHERE transaction_type = 'balance_brought_forward'`

**BankLedger synthetic-first rendering** (`src/pages/BankLedger.tsx`):
- `load(bankName, openingBalance)` queries with `.neq('transaction_type', BALANCE_BROUGHT_FORWARD_TYPE)` — DB B/F rows excluded from query entirely
- If `openingBalance > 0`: synthetic B/F row `{ id: '__bf__', inflow: openingBalance, ... }` prepended in memory from `bank.starting_balance`
- Running balance seeds from `openingBalance` so all subsequent rows carry correct cumulative totals
- `dateFiltered` exempts `transaction_type === BALANCE_BROUGHT_FORWARD_TYPE` rows — B/F always visible regardless of date filter
- Self-healing: even if DB propagation fails, BankLedger always shows the correct balance from authoritative `banks.starting_balance`
- Rendered with blue highlight (`bg-blue-50/60`), blue badge (`bg-blue-100 text-blue-700`), no edit button, no `ReceiptBadge`; date column shows "—"

**Other consumers:**
- **Inflows page**: edit + delete buttons suppressed for `transaction_type === 'balance_brought_forward'`; blue badge applied
- **CategoryLedger**: B/F entry has `transaction_type` set → skipped in allocation (correct — category amounts already via `category_opening_balances`)
- **Backup/restore**: DB entry lives in `inflow_transactions` → included in standard backup automatically

### Bank Opening Balance Propagation (Category)

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
- Config-split inflows (`allocation_config_id NOT NULL`, `stage_code_2 NULL`) processed for rows with `budget_portion = 'Specific Seed'`
- **Intraflow rows** (year-filtered, `status = 'active'`): TO `Specific Seed` → `SpecificRow` with positive amount for the TO category; FROM `Specific Seed` → `SpecificRow` with negative amount for the FROM category. Circular flows skipped. Rows appear as targets in the per-category breakdown; net effects propagate to per-category totals and the grand total.
- Subscribes to `intraflowVersion` (`useTransactionSyncStore`) → reloads on any intraflow write/delete

---

## Bulk Reallocation (`BulkReallocation.tsx`)

- Located at `/intra-flow` under the **Bulk Reallocation** tab (alongside Internal Transfers tab)
- Moves balances between any two budget portions across selected categories by inserting `intra_flows` records with `account_from = account_to = categoryName`, `account_from_stage2 = sourcePortion`, `account_to_stage2 = destPortion`
- Rows tagged `transfer_type='bulk_reallocation'` and share a `batch_id` UUID per execution
- **Balance source:** reads per-portion balances exclusively from `useReportEngine(today)` — the same canonical engine as Financial Report; `getPortionBalance(bal, portion)` maps `ReportCategoryBalance.percentageAllocated / specificSeed / savingsNet` to the selected portion. No custom balance math in this component.
- Modes: Full Balance (all of source), Percentage (% of source), Fixed Amount (capped at source balance)
- Preview step required before execution; warns on categories that will zero out the source portion
- Batch insert via single `supabase.from('intra_flows').insert([...])` call; all existing pages (SavingsPortions, PercentageAllocation, CategoryLedger, reportQueryEngine) already handle these rows correctly — no special-casing needed
- After execution: bumps `intraflowVersion` (so dependent pages reload) **and** calls `refetchBalances()` (from `useReportEngine`) to update displayed balances immediately

---

## Savings Portions (`SavingsPortions.tsx`)

- Queries all-time: direct savings inflows/outflows, config-split inflows (Savings rows), category opening balances (Savings portion)
- **Intraflow rows** (`status = 'active'`, all-time): TO `Savings` → added to `deposited` for TO category; FROM `Savings` → added to `withdrawn` for FROM category. Circular flows skipped.
- Subscribes to `intraflowVersion` → reloads on any intraflow write/delete

---

## Percentage Allocation (`PercentageAllocation.tsx`)

- Balance-driven page (nav: "Percentage Allocation", storageKey `pa`) — mirrors SavingsPortions structure for the Percentage Allocation portion
- Queries all-time: direct `stage_code_2 = 'Percentage Allocation'` inflows/outflows, config-split inflows (Percentage/unset rows), category opening balances (Percentage Allocation portion)
- **Intraflow rows** (`status = 'active'`, all-time): TO `Percentage Allocation` → added to `deposited`; FROM → added to `withdrawn`. Circular flows skipped.
- Subscribes to `intraflowVersion` → reloads on any intraflow write/delete
- **Distinct from** `PercentageAllocations.tsx` (nav: "Allocation Configs", storageKey `pca`) which is a read-only display of `allocation_configs` rows — no balance computation

---

## FX Transaction Entry (Single Authoritative Path)

**All FX transactions must be entered through the Foreign Currency page (`ForeignCurrency.tsx`) via `AddFXModal`.** This is the sole creation path.

Enforcement is 3-layer:

| Layer | Mechanism |
|---|---|
| UI | `ManualEntryForm` in `Import.tsx` filters out `is_foreign_currency` banks from all bank dropdowns; shows amber redirect notice linking to `/foreign-currency`. No FX amount/rate/currency fields on the manual entry form. |
| Service | `useAddInflow` and `useAddOutflow` throw `'FX transactions must be entered through the Foreign Currency module.'` if `transaction_type === 'fx_inflow'` or `'fx_outflow'`. |
| Schema | `fx_transactions.bank_name text` column records the originating FX bank; `AddFXTransactionInput` / `UpdateFXTransactionInput` include `bank_name?: string`; insert uses strip-and-retry (`MISSING_COL_RE`) for DBs not yet migrated. |

`TXN_TYPE_OPTIONS` in both `Import.tsx` and `ImportModal.tsx` no longer includes `fx_inflow` or `fx_outflow`. The `ImportModal` batch wizard's FX bank path previously locked imports to `fx_transactions` — that special-casing was removed; FX banks in file imports are treated as normal banks directing to the standard inflow/outflow tables.

`AddFXModal` requires a `fxBanks` prop (`{ id: string; name: string }[]` — banks with `is_foreign_currency = true`) and renders a Bank selector as a required field. `ForeignCurrency.tsx` derives `fxBanks` from `useBanks()` filtered by `b.is_foreign_currency`.

---

## FX Conversion (3-step sequential insert)

`useAddFXConversion()` in `useFXConversions.ts`:
1. Insert `fx_transactions` withdrawal (computes running balance from last row)
2. Insert `inflow_transactions` NGN inflow
3. Insert `fx_conversions` link record with both IDs

No DB transaction — step 1 commits even if step 2 fails. Accepted trade-off.

---

## Category Ledger Auto-Sync

`src/store/transactionSyncStore.ts` holds two version counters.

**`outflowVersion`** — bumped after every outflow write:
- `useAddOutflow` — after successful insert
- `useUpdateTransaction` — when `table === 'outflow_transactions'`
- `ImportModal` — after outflow batch loop if `outflowToInsert.length > 0`

**`intraflowVersion`** — bumped after every intraflow write or delete:
- `useAddIntraFlow` — after successful insert
- `useUpdateTransaction` — when `table === 'intra_flows'`
- `useDeleteTransaction` — when `table === 'intra_flows'`

`CategoryLedger` subscribes to **both** and adds them to **both** useEffect dep arrays:
- `useEffect([loadSummary, outflowVersion, intraflowVersion])`
- `useEffect([viewMode, activeCategory, ledgerPortion, loadLedger, outflowVersion, intraflowVersion])`

Omitting either version from either effect causes that view to go stale after writes.

`PercentageAllocation`, `SavingsPortions`, `SpecificGivings` subscribe to `intraflowVersion` only (`useEffect([load, intraflowVersion])`). Outflow changes do not need a separate version here — `load` is already triggered on mount and the pages fetch fresh data each call.

---

## Intraflow Propagation (CategoryLedger)

`intra_flows` is the **authoritative source** for internal fund movements. CategoryLedger reads it directly — no synthetic inflow/outflow transactions are created.

**`loadSummary`** fetches all `intra_flows WHERE status='active'` in the same `Promise.all` as the other queries. For each row:
- FROM category: debit — subtract `total_amount` from its `percentageAllocated`, `specificSeed`, or `savingsIn` based on `account_from_stage2`
- TO category: credit — add `total_amount` to the corresponding field
- Skip if `fromCat === toCat && fromStage === toStage` (circular, net-zero)
- Global totals (summary cards) remain unchanged — transfers net to zero across all categories

**`loadLedger`** fetches intraflows for the active category+portion (two scoped queries in parallel with the COB query):
```
WHERE account_from = activeCategory AND account_from_stage2 = portionStage2 AND status = 'active'
WHERE account_to   = activeCategory AND account_to_stage2   = portionStage2 AND status = 'active'
```
- FROM match → outflow row (debit); ID prefixed `if-out-{id}`
- TO match → inflow row (credit); ID prefixed `if-in-{id}`
- Both included in combined sort + running balance

**Portion label mapping** (intraflow `account_*_stage2` ↔ ledger `LedgerPortion`):
- `'Percentage Allocation'` ↔ `'Percentage'`
- `'Specific Seed'` ↔ `'Specific Seed'`
- `'Savings'` ↔ `'Savings'`

**Edge cases handled:**
- `status = 'reversed'` or `'void'` → excluded from both summary and ledger (query filter)
- Circular allocation (same category+portion both sides) → skipped in summary
- Deleted categories → `account_from`/`account_to` text snapshot remains readable even after FK goes NULL

### Intraflow Propagation: `useReportEngine` + `reportQueryEngine`

Same intra_flows logic now applied in both report engines — `balances` from `useReportEngine` always agrees with CategoryLedger summary for the same date.

**`useReportEngine`** — queries `intra_flows WHERE status='active' AND date <= reportDate` (always `date`; `intra_flows` has no `recorded_at` column — filter is basis-independent). Applies identical FROM-debit / TO-credit adjustments to `allocMap` / `specificSeed` / `savingsIn` in the same pass as all other sources.

**`reportQueryEngine.ts`** (`src/utils/reportQueryEngine.ts`) — used by Dynamic Reports, token parser, and `resolveTableBlock`:

**`getCategoryInflows(category, dateRange?, portion?, dateField?)`**
- `'percentage'` — `getCategoryConfigInflows` (Percentage Allocation filter) + pct intra_flows
- `'seed'` / `'savings'` — direct stage_code_1+stage_code_2 query + `getCategoryConfigInflows` (portion filter) + stage2-filtered intra_flows
- `'all'` — direct seed txns + direct savings txns + `getCategoryConfigInflows(null, all portions)` + all intra_flows (no stage2 filter)
- **Critical:** querying `stage_code_1=category` alone misses all percentage-allocated inflows (stage_code_2=null, no stage_code_1 set); must use `getCategoryConfigInflows` for those

**`getCategoryConfigInflows(category, dateRange, dateField, portionFilter)`** — private helper:
- Fetches all `transaction_type IS NULL` inflows; skips `stage_code_2='Specific Seed'/'Savings'` (handled by direct queries)
- Uses `fetchLockedConfigs()` which fetches ALL locked configs (including `is_special=true`) so explicit `allocation_config_id` references to special configs resolve correctly
- `findConfigForDate` date-based fallback still filters `is_special=true` — specials are never applied by date
- `portionFilter=null` → sums all config rows for the category across all budget_portions
- Normalises `budget_portion='Percentage'` → `'Percentage Allocation'` for comparison

**`getCategoryBalance`** — `opening_balance + inflows − outflows`; includes `category_opening_balances` via `getCategoryOpeningBalance`

**`getCategoryOpeningBalance(category, portion?)`** — fetches `category_opening_balances` with `categories(name)` join, filters in JS by category name and optional portion

**`resolveTableBlock`** — balance column now includes opening balance (same as `getCategoryBalance`)

**`getCategoryOutflows`** — unchanged; `stage_code_1=category` is correct (outflows always have stage_code_1 set)

**`getNetMovement`** — not updated; intra_flows net to zero across all categories

**Portion → stage2 mapping** (`STAGE_CODE_MAP`): `seed → 'Specific Seed'`, `savings → 'Savings'`, `percentage → 'Percentage Allocation'`; `all` = no stage2 filter

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
| FX inflow fields not synced to `fx_transactions` | Legacy: inflows with `fx_currency` set do NOT auto-create an `fx_transactions` row. Since the FX entry refactor, new FX transactions are entered exclusively through the FX module — this gap only affects pre-refactor records. |
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

**Intra-flows included:** queries `intra_flows WHERE status='active' AND date <= reportDate` and applies FROM-debit / TO-credit adjustments. See "Intraflow Propagation: useReportEngine + reportQueryEngine" above.

**Specific Seed outflows deducted:** `seedOutRes` queries `outflow_transactions WHERE stage_code_2='Specific Seed'` and subtracts from `specificSeed` (mirrors the savingsIn/savingsOut pattern). Without this, seed disbursements are silently dropped and the category shows inflated balances.

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
| `'balance_brought_forward'` | BankLedger (blue row, no edit), Inflows (blue badge, no edit/delete) | synthetic; managed by `src/utils/bankOpeningBalance.ts` |

> If Reversals or Refunds pages show an error or empty results: verify the `transaction_type` column exists in the live DB (see `db-rules.md`). The application query logic is correct.

### Reversal Root Auto-Tagging

Reversals ONLY: when an offset row (`transaction_type='reversal'`, `offset_role='offset'`) is linked to a root via `RootTransactionSearch`, the root is auto-promoted to `offset_role='root'` + `transaction_type='reversal'` — no manual root edit needed, and it now satisfies the Reversals page's `.eq('transaction_type','reversal')` fetch on both tables so `groupRows()` nests it correctly.

- Shared helper: `autoTagReversalRoot()` in `src/utils/autoTagReversalRoot.ts` — no-ops unless `transactionType==='reversal' && offsetRole==='offset' && rootTxnLink`; picks the target-table `useUpdateTransaction` mutate fn by `rootTxnLink.table`.
- Wired into the three places `RootTransactionSearch` creates a root link: `AddInflowModal`/`AddOutflowModal` (post-save, both add & edit branches) and `Import.tsx` `ManualEntryForm` (`doSaveInflow`/`doSaveOutflow`).
- Best-effort: failure doesn't roll back the already-saved offset row — surfaces via a warning toast instead (mirrors `AddBankModal`'s B/F propagation pattern).
- `ImportModal.tsx` batch wizard's `batchOffsetRole` is unaffected — it bulk-labels rows within one import batch with no per-row `root_transaction_id`, so there's no discrete root to promote.
- Pre-existing offset rows already linked to a root before this fix was added are not backfilled — this only fires on new saves.
