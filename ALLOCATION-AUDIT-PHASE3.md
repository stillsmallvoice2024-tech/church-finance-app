# Allocation Audit — Phase 3
# Single-transaction trace through all allocation paths, before/after f04f152e

**Branch:** `claude/regression-investigation-audit-2nGLE`
**Commit:** `f04f152e` — "Fix special config Percentage Allocation budget_portion propagation"
**Scope:** allocation generation only (import propagation excluded)

---

## Concrete example

### What the DB contains after being written by CreateSpecialConfigModal BEFORE f04f152e

The modal's `<option value>` was `"Percentage Allocation"` (the bug). Every special config
row where the user selected "Percentage Allocation" in the dropdown was persisted with
`budget_portion = 'Percentage Allocation'` in the `allocation_configs.rows` JSONB column.

### Special Config S2 (percentage-type, created before f04f152e)
```
id:              cfg-special-002
is_special:      true
allocation_type: 'percentage'
status:          'locked'
rows: [
  { category_name: 'Welfare', budget_portion: 'Percentage Allocation', percentage: 60, amount: null },
  { category_name: 'Mission', budget_portion: 'Percentage Allocation', percentage: 40, amount: null },
]
```

### General Config G1 (percentage-type, non-special)
```
id:              cfg-general-001
is_special:      false
allocation_type: 'percentage'
status:          'locked'
start_date:      2026-01-01
rows: [
  { category_name: 'Welfare', budget_portion: 'Percentage', percentage: 60, amount: null },
  { category_name: 'Mission', budget_portion: 'Percentage', percentage: 40, amount: null },
]
```

Note: G1 rows carry `budget_portion = 'Percentage'` — the canonical value, which the
modal never produced for special configs before f04f152e.

### Transaction TG (general config, by date resolution)
```
amount:               100000
stage_code_2:         null
allocation_config_id: null
transaction_type:     null
date:                 2026-05-01
```

### Transaction TS2 (special config, explicit link)
```
amount:               100000
stage_code_2:         null
allocation_config_id: cfg-special-002
transaction_type:     null
date:                 2026-05-01
```

---

## Config resolution (unchanged by f04f152e)

```ts
const configId = r.allocation_config_id as string | null
const cfg = configId
  ? (configs.find(c => c.id === configId) ?? getConfigForDate(configs, r.date))
  : getConfigForDate(configs, r.date)
```

`getConfigForDate` filters `!c.is_special` — special configs are excluded from date-based lookup.

| Transaction | configId | Resolution |
|-------------|----------|-----------|
| TG | null | `getConfigForDate` → G1 |
| TS2 | cfg-special-002 | `configs.find(...)` → S2 |

---

## Path 1 — useReportEngine allocMap loop

**File:** `useReportEngine.ts:185`
**Status: NOT changed by f04f152e**

The loop (at the state of f04f152e's parent, also identical to loadSummary):

```ts
for (const catRow of cfg.rows) {
  if (!catRow.percentage) continue
  const allocated = allocatePercent(Number(r.amount), catRow.percentage)
  if (catRow.budget_portion === 'Specific Seed') {
    ensure(catRow.category_name).specificSeed += allocated
  } else if (catRow.budget_portion === 'Savings') {
    ensure(catRow.category_name).savingsIn += allocated
  } else {                                              // ← catches ALL other values
    allocMap.set(catRow.category_name, ...)
  }
}
```

The `else` branch is the key: it catches any `budget_portion` value that is not
`'Specific Seed'` or `'Savings'` — including `'Percentage Allocation'`, `'Percentage'`,
empty string, null, and undefined.

### TG through G1 — BEFORE f04f152e

| catRow | `!percentage` | `budget_portion` | branch | `allocated` |
|--------|--------------|-----------------|--------|-------------|
| Welfare | `!60`=false → continues | 'Percentage' → else | allocMap | 60000 |
| Mission | `!40`=false → continues | 'Percentage' → else | allocMap | 40000 |

`allocMap`: `{ Welfare: 60000, Mission: 40000 }`

### TG through G1 — AFTER f04f152e

Identical. Neither this file nor this loop was touched by f04f152e.

### TS2 through S2 — BEFORE f04f152e

| catRow | `!percentage` | `budget_portion` | branch | `allocated` |
|--------|--------------|-----------------|--------|-------------|
| Welfare | `!60`=false → continues | 'Percentage Allocation' → **else** | allocMap | 60000 |
| Mission | `!40`=false → continues | 'Percentage Allocation' → **else** | allocMap | 40000 |

`allocMap`: `{ Welfare: 60000, Mission: 40000 }` — **CORRECT, already.**

### TS2 through S2 — AFTER f04f152e

Identical. Loop unchanged.

**useReportEngine: zero divergence before/after f04f152e for any config type.**

The `else` dispatch pre-dates f04f152e and already correctly routes `'Percentage Allocation'`
rows to `allocMap`. Dashboard totals and report balances were **never broken** for this
config type.

---

## Path 2 — CategoryLedger `loadSummary` allocMap loop

**File:** `CategoryLedger.tsx:208`
**Status: NOT changed by f04f152e**

The loop is character-for-character identical to useReportEngine's loop shown above.
Same `else` branch. Same result.

| Scenario | allocMap result | Divergence |
|----------|----------------|-----------|
| TG before/after | `{ Welfare:60000, Mission:40000 }` | none |
| TS2 before/after | `{ Welfare:60000, Mission:40000 }` | none |

`percentageAllocated` in the Summary table = `allocMap.get(name) - pctOutMap.get(name)`.

**CategoryLedger Summary: zero divergence. The "Allocation" column was already correct for TS2 before f04f152e.**

This is confirmed explicitly by the commit message: *"rows with 'Percentage Allocation' were invisible in the Percentage ledger tab **despite appearing correctly in summary cards**."*

---

## Path 3 — CategoryLedger `loadLedger` — Percentage tab

**File:** `CategoryLedger.tsx:318` (loadLedger, `ledgerPortion === 'Percentage'`)
**Status: CHANGED by f04f152e**
**Feeds:** per-transaction `LedgerRow` entries → running balance in Percentage tab

### BEFORE f04f152e — catRow lookup

```ts
const catRow = cfg?.rows.find(c =>
  c.category_name === activeCategory &&
  (c.budget_portion === 'Percentage' || !c.budget_portion)   // ← two-clause predicate
)
if (!catRow?.percentage) continue
```

For TS2 / S2 / activeCategory = 'Welfare':

```
Evaluate: c.budget_portion === 'Percentage' || !c.budget_portion
        = 'Percentage Allocation' === 'Percentage'  ||  !'Percentage Allocation'
        = false                                      ||  false
        = false
```

`.find()` returns `undefined`. Guard: `!undefined?.percentage` = `!undefined` = `true` → **SKIP**.

No `LedgerRow` entry for TS2. Welfare Percentage tab shows empty for TS2.

### AFTER f04f152e — catRow lookup

```ts
const catRow = cfg?.rows.find(c =>
  c.category_name === activeCategory &&
  (c.budget_portion === 'Percentage' || c.budget_portion === 'Percentage Allocation' || !c.budget_portion)
)
if (!catRow?.percentage) continue
```

For TS2 / S2 / activeCategory = 'Welfare':

```
Evaluate: 'Percentage Allocation' === 'Percentage'  ||  'Percentage Allocation' === 'Percentage Allocation'  ||  false
        = false                                      ||  true
        = true
```

`.find()` returns `{ category_name:'Welfare', budget_portion:'Percentage Allocation', percentage:60, amount:null }`.

Guard: `!60` = `false` → **PASSES**.

`allocated = allocatePercent(100000, 60)` = **60000**.

`LedgerRow { inflow: 60000 }` pushed → appears in Percentage tab → contributes to running balance.

**→ First divergence. `CategoryLedger.tsx:318`. Before: catRow = undefined → SKIP. After: catRow found → inflow entry created.**

### TG through G1 — no change

G1 rows have `budget_portion = 'Percentage'`. The original predicate `c.budget_portion === 'Percentage' || !c.budget_portion` already matched them. Adding `|| c.budget_portion === 'Percentage Allocation'` is a no-op for G1. TG's ledger entries are identical before and after.

---

## Path 4 — PercentageAllocation config-split loop

**File:** `PercentageAllocation.tsx:125`
**Status: CHANGED by f04f152e**
**Feeds:** `PctRow.deposited` → "Total Allocated" column, Net Balance

The configSplitData query:

```ts
supabase
  .from('inflow_transactions')
  .select('amount, allocation_config_id')
  .not('allocation_config_id', 'is', null)
  .is('stage_code_2', null)
  .is('transaction_type', null)
```

TS2 qualifies (`allocation_config_id` = cfg-special-002, `stage_code_2` = null, `transaction_type` = null).
TG does NOT qualify (`allocation_config_id` is null → excluded by `.not(...'is', null)` filter).

**→ TG never reaches this loop. Only special-config transactions enter configSplitData.**

### BEFORE f04f152e — loop guard

```ts
if (row.budget_portion && row.budget_portion !== 'Percentage') continue
```

For S2 Welfare row, `budget_portion = 'Percentage Allocation'`:

```
row.budget_portion                    = 'Percentage Allocation' → truthy     → first operand: true
row.budget_portion !== 'Percentage'   = 'Percentage Allocation' !== 'Percentage' = true  → second operand: true
Combined: true && true = true → continue → SKIP
```

`'Percentage Allocation'` is explicitly excluded. TS2 contributes **0** to `deposited`.

### AFTER f04f152e — loop guard

```ts
if (row.budget_portion && row.budget_portion !== 'Percentage' && row.budget_portion !== 'Percentage Allocation') continue
```

For S2 Welfare row, `budget_portion = 'Percentage Allocation'`:

```
row.budget_portion                                = truthy → true
row.budget_portion !== 'Percentage'               = true
row.budget_portion !== 'Percentage Allocation'    = 'Percentage Allocation' !== 'Percentage Allocation' = FALSE
Combined: true && true && false = false → does NOT continue → PASSES
```

`pct = Number(60)` = 60 > 0 → passes secondary guard.
`allocAmount = allocatePercent(100000, 60)` = **60000**.
`ensure('Welfare').deposited += 60000`.

**→ Second divergence. `PercentageAllocation.tsx:125`. Before: 'Percentage Allocation' explicitly skipped → deposited += 0. After: passes → deposited += 60000.**

---

## Path 5 — CategoryLedger `loadLedger` — Specific Seed / Savings config-split

**File:** `CategoryLedger.tsx:405`
**Status: NOT changed by f04f152e**

The catRow lookup here matches `c.budget_portion === sc2` where `sc2 = 'Specific Seed'` or `'Savings'`.

S2 rows have `budget_portion = 'Percentage Allocation'` → no match → `catRow = undefined` → skip.
This was true before and after f04f152e (this block was not in the diff).

**No change in Specific Seed / Savings config-split behaviour.**

---

## Shared code paths — what f04f152e actually touches

| Path | File:line | Changed by f04f152e? | Reason |
|------|-----------|---------------------|--------|
| useReportEngine allocMap loop | `useReportEngine.ts:185` | **No** | else-branch already routes 'Percentage Allocation' to allocMap |
| CategoryLedger loadSummary allocMap loop | `CategoryLedger.tsx:208` | **No** | identical else-branch |
| CategoryLedger loadLedger Percentage tab catRow | `CategoryLedger.tsx:318` | **Yes** | predicate was `'Percentage' || !budget_portion`; now includes 'Percentage Allocation' |
| PercentageAllocation config-split guard | `PercentageAllocation.tsx:125` | **Yes** | guard explicitly skipped 'Percentage Allocation'; now passes it |
| CategoryLedger loadLedger config-split tab | `CategoryLedger.tsx:405` | **No** | sc2 match; 'Percentage Allocation' rows never matched sc2 |

General configs are unaffected by f04f152e across all paths:
- G1 rows carry `budget_portion = 'Percentage'` — already matched by original predicate
- TG has `allocation_config_id = null` → excluded from configSplitData query

---

## Why category allocations were incomplete — exact divergence

### The split-view inconsistency before f04f152e

Before f04f152e, two consumers gave conflicting answers for the same transaction TS2:

| Consumer | Path taken | Result for Welfare |
|----------|-----------|-------------------|
| CategoryLedger Summary "Allocation" column | allocMap loop else-branch | **60000** (correct) |
| CategoryLedger Ledger > Percentage tab | catRow lookup → undefined → skip | **0 entries** (wrong) |
| PercentageAllocation "Total Allocated" | guard → continue → skip | **0** (wrong) |
| useReportEngine / Dashboard KPIs | allocMap loop else-branch | **60000** (correct) |

The summary cards and Dashboard KPIs were computing correctly via the `else` branch, which
pre-dated f04f152e and required no `budget_portion` equality match. The two detail-drill views
had hard-coded string comparisons that excluded `'Percentage Allocation'`.

### First calculation point where expected ≠ actual (before f04f152e)

```
File:  src/pages/CategoryLedger.tsx
Line:  318  (pre-f04f152e numbering)

Expression:
  cfg?.rows.find(c =>
    c.category_name === activeCategory &&
    (c.budget_portion === 'Percentage' || !c.budget_portion)  ← missing third clause
  )

Input:  catRow from S2: { budget_portion: 'Percentage Allocation', percentage: 60 }

Expected result:  catRow found → allocated = allocatePercent(100000, 60) = 60000
Actual result:    catRow = undefined → guard !undefined?.percentage = true → SKIP
Delta:            −60000 per transaction in Percentage ledger tab
```

The `.find()` predicate matches on two `budget_portion` values (`'Percentage'` and falsy/null).
`'Percentage Allocation'` is truthy and `!== 'Percentage'`, so it matches neither clause.
The row is present in `cfg.rows` but invisible to the predicate.

The downstream guard `if (!catRow?.percentage)` amplifies the skip — even if catRow were
partially found, the guard would also have blocked it. But the `.find()` itself is the
origin of the miss.

### Second divergence point

```
File:  src/pages/PercentageAllocation.tsx
Line:  125  (pre-f04f152e)

Expression:
  if (row.budget_portion && row.budget_portion !== 'Percentage') continue

Input:  row from S2: { budget_portion: 'Percentage Allocation', percentage: 60 }

Evaluation:
  'Percentage Allocation' (truthy)  &&  'Percentage Allocation' !== 'Percentage' (true)
  → true → continue → SKIP

Expected:  ensure('Welfare').deposited += allocatePercent(100000, 60) = 60000
Actual:    skipped — deposited unchanged
Delta:     −60000 per transaction × per config row in PercentageAllocation
```

---

## Consequence of f04f152e — what changes after the fix

After f04f152e:

- **CategoryLedger Percentage ledger tab**: TS2 now generates `LedgerRow { inflow: 60000 }` entries — one per qualifying inflow. Running balance increases by 60000 per TS2.
- **PercentageAllocation deposited**: TS2 now contributes 60000 to Welfare deposited. For N inflows using S2: deposited increases by N × 60000. All orgs that have used S2-type configs (budget_portion = 'Percentage Allocation') will see their PercentageAllocation balances increase.

The summary/report allocMap (useReportEngine, CategoryLedger loadSummary) is **unchanged** — it was already correct.

### What f04f152e does NOT fix

`PercentageAllocation.tsx` only reads `percentage` from `ConfigRowShape` — the type definition at line 35 has no `amount` field. Amount-type special config rows (the Phase 2 subject) still produce `pct = 0` → always skipped — unaffected by f04f152e.

---

## Before/after summary table

| Path | Before f04f152e (TS2 result) | After f04f152e (TS2 result) |
|------|------------------------------|------------------------------|
| useReportEngine allocMap | **60000** (correct via else) | **60000** (unchanged) |
| CategoryLedger loadSummary allocMap | **60000** (correct via else) | **60000** (unchanged) |
| CategoryLedger Percentage tab LedgerRow | **no entry** (catRow = undefined) | **inflow=60000 entry** |
| PercentageAllocation deposited | **0** (guard skipped) | **+60000** |
| CategoryLedger Specific Seed/Savings config-split | no entry (budget_portion mismatch) | no entry (unchanged) |

**General Config (TG): identical before and after in all five paths.**
