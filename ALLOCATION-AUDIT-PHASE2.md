# Allocation Audit — Phase 2
# Single-transaction trace through all allocation paths

**Branch:** `claude/regression-investigation-audit-2nGLE`
**Commit window:** before vs after `28111fdb`
**Scope:** allocation generation only (import propagation excluded)

---

## Concrete example

Two configs and two transactions are used throughout to make divergence exact.

### General Config G1 (percentage-type, non-special)
```
id:              cfg-general-001
is_special:      false
allocation_type: 'percentage'
status:          'locked'
start_date:      2026-01-01
rows: [
  { category_name: 'Welfare', budget_portion: 'Percentage', percentage: 60, amount: undefined },
  { category_name: 'Mission', budget_portion: 'Percentage', percentage: 40, amount: undefined },
]
```

### Special Config S1 (amount-type, special)
```
id:              cfg-special-001
is_special:      true
allocation_type: 'amount'
total_amount:    8000
status:          'locked'
rows: [
  { category_name: 'Welfare', budget_portion: 'Percentage', percentage: null, amount: 5000 },
  { category_name: 'Mission', budget_portion: 'Percentage', percentage: null, amount: 3000 },
]
```

### Transaction TG (uses General Config)
```
id:                   txn-general
amount:               100000
date:                 2026-05-01
stage_code_2:         null
allocation_config_id: null          ← resolved by date
transaction_type:     null
```

### Transaction TS (uses Special Config)
```
id:                   txn-special
amount:               100000
date:                 2026-05-01
stage_code_2:         null
allocation_config_id: cfg-special-001
transaction_type:     null
```

---

## Config resolution

Both paths run through this code (identical in `useReportEngine.ts:180` and `CategoryLedger.tsx:212`):

```ts
const configId = r.allocation_config_id as string | null
const cfg = configId
  ? (configs.find(c => c.id === configId) ?? getConfigForDate(configs, r.date))
  : getConfigForDate(configs, r.date)
```

`getConfigForDate` (allocationStore.ts:50) filters `!c.is_special` — special configs are **excluded** from date-based lookup. General configs only.

| Transaction | configId | Resolution |
|-------------|----------|-----------|
| TG | null | `getConfigForDate` → G1 (locked, non-special, start_date ≤ date) |
| TS | cfg-special-001 | `configs.find(...)` → S1 directly |

---

## Path 1 — useReportEngine `allocMap` loop

**File:** `src/hooks/useReportEngine.ts:185`
**Feeds:** `ReportCategoryBalance.percentageAllocated` → Dashboard KPIs, FinancialReport, DynamicReports

### BEFORE `28111fdb`

```ts
for (const catRow of cfg.rows) {
  if (!catRow.percentage) continue              // ← sole guard
  const allocated = allocatePercent(Number(r.amount), catRow.percentage)
  ...
  allocMap.set(catRow.category_name, (allocMap.get(catRow.category_name) ?? 0) + allocated)
}
```

**TG through G1:**

| catRow | `catRow.percentage` | guard (`!percentage`) | `allocated` |
|--------|--------------------|-----------------------|-------------|
| Welfare | 60 | false → continues | `allocatePercent(100000, 60)` = **60000** |
| Mission | 40 | false → continues | `allocatePercent(100000, 40)` = **40000** |

`allocMap` after TG: `{ Welfare: 60000, Mission: 40000 }`

**TS through S1:**

| catRow | `catRow.percentage` | guard (`!percentage`) | `allocated` |
|--------|--------------------|-----------------------|-------------|
| Welfare | null | **true → SKIP** | — |
| Mission | null | **true → SKIP** | — |

`allocMap` after TS: unchanged — `{ Welfare: 60000, Mission: 40000 }`

---

### AFTER `28111fdb`

```ts
for (const catRow of cfg.rows) {
  let allocated: number
  if (catRow.amount != null && catRow.amount > 0) {
    allocated = catRow.amount
  } else if (catRow.percentage) {
    allocated = allocatePercent(Number(r.amount), catRow.percentage)
  } else {
    continue
  }
  ...
  allocMap.set(catRow.category_name, (allocMap.get(catRow.category_name) ?? 0) + allocated)
}
```

**TG through G1:**
- Welfare: `catRow.amount = undefined` → `undefined != null` is `false` in JS (loose equality: `null == undefined`) → branch SKIPS
- Falls to `else if (catRow.percentage)` → 60 → `allocatePercent(100000, 60)` = 60000
- Mission: same → 40000

`allocMap` after TG: `{ Welfare: 60000, Mission: 40000 }` — **identical to BEFORE**

**TS through S1:**
- Welfare: `catRow.amount = 5000` → `5000 != null` = true, `5000 > 0` = true → `allocated = 5000`
- Mission: `catRow.amount = 3000` → `allocated = 3000`

`allocMap` after TS: `{ Welfare: 65000, Mission: 43000 }`

**→ First divergence. `useReportEngine.ts line 187`. Expected (before) = 0 contribution from TS. Actual (after) = +5000 to Welfare, +3000 to Mission.**

The guard `!catRow.percentage` previously blocked the entire row for amount-type configs. The replacement condition `catRow.amount != null && catRow.amount > 0` correctly distinguishes `undefined` (general config rows) from `5000` (amount-type rows), so General Config allocation is untouched.

---

## Path 2 — CategoryLedger `loadSummary` allocMap loop

**File:** `src/pages/CategoryLedger.tsx:217` (`loadSummary`)
**Feeds:** `CategoryRow.percentageAllocated` → "Allocation" column in Summary table, `globalTotals.alloc` header card

The loop body is **character-for-character identical** to useReportEngine. Divergence is the same:

| State | Welfare allocMap | Mission allocMap |
|-------|-----------------|-----------------|
| Before `28111fdb` (after TS) | 0 | 0 |
| After `28111fdb` (after TS) | 5000 | 3000 |

**`percentageAllocated` for Welfare** = `(allocMap.get('Welfare') ?? 0) - (pctOutMap.get('Welfare') ?? 0)`

| State | `percentageAllocated` shown in UI |
|-------|----------------------------------|
| Before | 0 (TS contributes nothing) |
| After | 5000 (TS contributes fixed amount) |

If N transactions all point at S1:

| N | Before | After |
|---|--------|-------|
| 1 | 0 | 5000 |
| 10 | 0 | 50000 |
| 100 | 0 | 500000 |

The `catRow.amount` is applied **multiplicatively per transaction**, not once per config.

---

## Path 3 — CategoryLedger `loadLedger` — Percentage tab

**File:** `src/pages/CategoryLedger.tsx:324` (`loadLedger`, `ledgerPortion === 'Percentage'`)
**Feeds:** per-row `LedgerRow.inflow` entries → running balance in Percentage tab

The catRow lookup at line 324 was **also changed by `f04f152e`** (now accepts `budget_portion === 'Percentage Allocation'`). For S1, `catRow.budget_portion === 'Percentage'` → matches either way.

**BEFORE `28111fdb`** (guard was `if (!catRow?.percentage) continue`):
- TS → catRow found (budget_portion matches), but `catRow.percentage = null` → `!null` = true → **SKIP**
- No `LedgerRow` entry created for TS

**AFTER `28111fdb`** (guard changed to `if (!catRow) continue`):
- TS → catRow found → guard passes (catRow is not nullish)
- `catRow.amount = 5000 > 0` → `allocated = 5000`
- `allocated > 0` → `LedgerRow { inflow: 5000 }` pushed

Running balance calculation (`ledgerFilteredWithBalance`) includes this row. For N transactions pointing at S1, N ledger rows each with `inflow = 5000` appear in the Percentage tab.

**→ Second divergence. `CategoryLedger.tsx line 325`. Guard change `!catRow?.percentage` → `!catRow` allows amount-type rows through when they were previously blocked.**

---

## Path 4 — CategoryLedger `loadLedger` — Specific Seed / Savings config-split

**File:** `src/pages/CategoryLedger.tsx:405` (`loadLedger`, `sc2 = 'Specific Seed'` or `'Savings'`)
**Feeds:** per-row `LedgerRow.inflow` entries for Specific Seed / Savings tabs

`cfgInflowRes` query fetches inflows where `allocation_config_id IS NOT NULL` AND `stage_code_2 IS NULL`. TS qualifies.

catRow lookup: `cfg.rows.find(c => c.category_name === activeCategory && c.budget_portion === sc2)`.

For S1 with only `budget_portion = 'Percentage'` rows: catRow is `undefined` → `if (!catRow) continue` → SKIP. No change for this example.

If S1 had a row `{ category_name: 'Reserves', budget_portion: 'Specific Seed', amount: 1000 }`:

**BEFORE:** `if (!catRow?.percentage) continue` → amount = 1000, percentage = null → SKIP. No ledger entry.
**AFTER:** `if (!catRow) continue` → catRow exists → `allocated = 1000` → ledger entry created.

Same divergence pattern — blocked by percentage check before, passes existence check after.

---

## Path 5 — PercentageAllocation page config-split loop

**File:** `src/pages/PercentageAllocation.tsx:125`
**Feeds:** `PctRow.deposited` → "Total Allocated" column, net balance

**`28111fdb` did NOT touch this file.** The loop remains:

```ts
type ConfigRowShape = { category_name: string; budget_portion?: string; percentage?: number }
// ↑ `amount` field is NOT in this type — it is never read

for (const row of cfgRows) {
  if (row.budget_portion && row.budget_portion !== 'Percentage' && row.budget_portion !== 'Percentage Allocation') continue
  const pct = Number(row.percentage ?? 0)     // ← null coalesces to 0
  if (pct <= 0) continue                       // ← always fires for amount-type rows
  ...
}
```

For S1 Welfare row: `row.percentage = null` → `pct = 0` → `pct <= 0` → **SKIP, always**.

PercentageAllocation.tsx has no `catRow.amount` branch and its `ConfigRowShape` type does not include `amount`. Amount-type special config rows contribute **zero** to `deposited` in this view — both before and after `28111fdb`.

---

## Shared code paths — both General and Special Configs pass through the same loop

The inner loop that changed is copy-pasted identically in three places:

| File | Function | Lines | Branch level |
|------|----------|-------|-------------|
| `useReportEngine.ts` | `compute` | 185–201 | Row-level: all inflows |
| `CategoryLedger.tsx` | `loadSummary` | 217–233 | Row-level: all inflows |
| `CategoryLedger.tsx` | `loadLedger` (Percentage tab) | 326–333 | Row-level: per-catRow |
| `CategoryLedger.tsx` | `loadLedger` (config-split tab) | 407–414 | Row-level: per-catRow |

All four sites received the same guard change in `28111fdb`. `PercentageAllocation.tsx` was NOT touched.

The config resolution (`configs.find` → `getConfigForDate`) is identical across all four sites. The loop over `cfg.rows` is identical. The guard is the shared discriminator.

---

## Why the General Config path is not regressed

JavaScript loose equality: `undefined != null` evaluates to `false` (`null == undefined` per spec §7.2.14).

General config rows have `amount: undefined` (not present in DB JSONB → deserialized as `undefined`). The condition `catRow.amount != null && catRow.amount > 0`:

- `undefined != null` → **false** (first operand short-circuits the AND)
- Falls through to `else if (catRow.percentage)` → percentage-based path — same as before

General Config allocation is byte-for-byte identical before and after `28111fdb`.

---

## Why allocations are incomplete — divergence analysis

### Pre-`28111fdb` incompleteness (understatement)

**Root cause:** `if (!catRow.percentage) continue` — a single falsy check used as the universal gate for all config row types.

For S1 Welfare row: `catRow.percentage = null` → `!null` = `true` → entire row skipped.

This means: **any transaction pointing at an amount-type special config contributed zero to every allocation calculation in every view.** The config might as well not exist for allocation purposes.

**First calculation point where expected ≠ actual (before the fix):**

```
useReportEngine.ts:186  (and CategoryLedger.tsx:218 — identical)

Expected:  allocMap['Welfare'] += 5000   (S1 row specifies this)
Actual:    skipped — allocMap['Welfare'] unchanged
```

The guard `!catRow.percentage` never intended to skip amount-type rows — it was written assuming all rows would carry a percentage. Amount-type rows carry `amount`, not `percentage`, so the guard always fired incorrectly for them.

### Post-`28111fdb` incompleteness (inconsistency)

The fix correctly removes the blocking guard for amount-type rows in three allocation contexts (useReportEngine, CategoryLedger summary, CategoryLedger ledger). But it leaves a **fourth path unchanged**.

**PercentageAllocation.tsx** is the orphaned path. Its `ConfigRowShape` type has no `amount` field. Its guard (`pct <= 0`) still blocks all amount-type rows. Its deposited totals remain at zero for amount-type special configs.

Result: after `28111fdb`, CategoryLedger summary shows Welfare = `N × 5000` but PercentageAllocation shows Welfare deposited = `0`. The two views represent the same underlying data but produce contradictory figures.

### Per-transaction multiplication — the scale problem

The amount-type allocation is applied once **per inflow transaction** that references the config. With N inflows pointing at S1:

```
allocMap['Welfare'] = N × catRow.amount
                    = N × 5000
```

Whether this is correct depends on the intended semantics of amount-type configs:
- **Intended:** each inflow triggers a fixed allocation → N × 5000 is correct
- **Intended:** the config defines the total allocation regardless of inflow count → 5000 is correct

The code gives no indication which semantic is intended. `total_amount` on the config is never read in any of the four allocation loops — it is stored but never used to cap or validate the per-transaction sum.

---

## Summary table — per-path before/after

| Path | File:line | Before `28111fdb` (TS result) | After `28111fdb` (TS result) |
|------|-----------|-------------------------------|------------------------------|
| Report Engine allocMap | `useReportEngine.ts:186` | **0** (skipped) | **+5000** per TS |
| CategoryLedger summary allocMap | `CategoryLedger.tsx:218` | **0** (skipped) | **+5000** per TS |
| CategoryLedger Percentage tab ledger | `CategoryLedger.tsx:325` | **no entry** | **inflow=5000 row** |
| CategoryLedger Specific Seed/Savings config-split | `CategoryLedger.tsx:406` | **no entry** | **inflow=amount row** (if row exists) |
| PercentageAllocation config-split | `PercentageAllocation.tsx:127` | **0** (pct=0 guard) | **0** (unchanged — not touched by `28111fdb`) |

**General Config (TG) result: identical before and after in all five paths.**

---

## First calculation point where expected ≠ actual

```
File:   src/hooks/useReportEngine.ts
Line:   186  (before commit: `if (!catRow.percentage) continue`)
Line:   187  (after commit:  `if (catRow.amount != null && catRow.amount > 0)`)

Transaction: TS (amount=100000, allocation_config_id=cfg-special-001)
Config row:  { category_name:'Welfare', percentage:null, amount:5000 }

BEFORE:
  condition:  !null  →  true  →  row SKIPPED
  allocMap:   { Welfare: 0 }

AFTER:
  condition:  5000 != null && 5000 > 0  →  true  →  allocated = 5000
  allocMap:   { Welfare: 5000 }

Delta: +5000 per transaction per amount-type config row
```

This is the single guard change that propagates to all four changed sites. `PercentageAllocation.tsx` does not share this code path and retains its own independent (and still-blocking) guard at line 127.
