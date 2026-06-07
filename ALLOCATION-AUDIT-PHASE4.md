# Allocation Audit — Phase 4
# Data-structure trace: transaction that should allocate but does not

**Branch:** `claude/regression-investigation-audit-2nGLE`
**Scope:** data structures only — no UI views

---

## Transaction

One transaction. Two config scenarios traced in parallel.

```
T = {
  id:                   'txn-001',
  amount:               100_000,
  date:                 '2026-05-01',
  stage_code_2:         null,
  transaction_type:     null,
  allocation_config_id: <see per scenario>,
}
```

---

## Scenario P — Percentage-based General Config (works correctly)

### Selected config

`getConfigForDate` resolves T (no `allocation_config_id`) to:

```typescript
AllocationConfig {        // allocationStore.ts — AllocationConfig interface
  id:              'cfg-general-001',
  is_special:      false,
  allocation_type: 'percentage',
  status:          'locked',
  start_date:      '2026-01-01',
  rows: AllocationRow[] = [
    { category_name: 'Welfare', budget_portion: 'Percentage', percentage: 60,  amount: undefined },
    { category_name: 'Mission', budget_portion: 'Percentage', percentage: 40,  amount: undefined },
  ]
}
```

`amount: undefined` — field absent from DB JSONB for percentage-type rows; JS deserialises
missing keys as `undefined`.

### Allocation rows evaluated (useReportEngine / CategoryLedger loadSummary)

```
catRow = AllocationRow { category_name:'Welfare', percentage:60, amount:undefined }

Guard 1:  catRow.amount != null && catRow.amount > 0
          undefined != null  →  false   (JS: null == undefined per §7.2.14)
          → branch skipped

Guard 2:  catRow.percentage  →  60 (truthy)
          allocated = allocatePercent(100_000, 60) = 60_000

Dispatch: budget_portion 'Percentage' → else branch → allocMap
```

```
catRow = AllocationRow { category_name:'Mission', percentage:40, amount:undefined }
→ allocated = 40_000 → allocMap
```

### allocMap after T (Scenario P)

```typescript
Map<string, number> {
  'Welfare' => 60_000,
  'Mission' => 40_000,
}
```

### Expected category amounts

```
Welfare: 60_000   Mission: 40_000
```

### Actual category amounts

```
Welfare: 60_000   Mission: 40_000   ✓ correct
```

Scenario P allocates correctly across all paths. No divergence.

---

## Scenario A — Amount-based Special Config (allocation incomplete)

`T.allocation_config_id = 'cfg-special-001'`

### Selected config

`configs.find(c => c.id === 'cfg-special-001')` resolves directly (bypasses `getConfigForDate`;
special configs are excluded from date-based lookup by `!c.is_special` filter).

```typescript
AllocationConfig {        // allocationStore.ts — AllocationConfig interface
  id:              'cfg-special-001',
  is_special:      true,
  allocation_type: 'amount',
  total_amount:    8_000,
  status:          'locked',
  rows: AllocationRow[] = [
    { category_name: 'Welfare', budget_portion: 'Percentage', percentage: null, amount: 5_000 },
    { category_name: 'Mission', budget_portion: 'Percentage', percentage: null, amount: 3_000 },
  ]
}
```

`percentage: null` — DB stores `null` for amount-type rows, not `undefined`.
`amount: 5_000` — present in `AllocationRow` interface (allocationStore.ts:11 `amount?: number`).

### Allocation rows evaluated (useReportEngine / CategoryLedger loadSummary)

Config comes from `allocationStore` which loads via `supabase.from('allocation_configs').select('*')`.
The `*` select includes all JSONB fields. Rows are cast as `AllocationRow[]` which declares `amount`.

```
catRow = AllocationRow { category_name:'Welfare', percentage:null, amount:5_000 }

Guard 1:  catRow.amount != null && catRow.amount > 0
          5_000 != null  →  true
          5_000 > 0      →  true
          → allocated = catRow.amount = 5_000          ← fires

Dispatch: budget_portion 'Percentage' → else branch → allocMap
```

```
catRow = AllocationRow { category_name:'Mission', percentage:null, amount:3_000 }
→ allocated = 3_000 → allocMap
```

### allocMap after T (Scenario A — useReportEngine / CategoryLedger loadSummary)

```typescript
Map<string, number> {
  'Welfare' => 5_000,
  'Mission' => 3_000,
}
```

### Expected category amounts

```
Welfare: 5_000   Mission: 3_000
```

### Actual category amounts (useReportEngine / CategoryLedger loadSummary)

```
Welfare: 5_000   Mission: 3_000   ✓ correct at this path
```

---

## Where Scenario A breaks — PercentageAllocation config-split path

### configSplitData query

T qualifies (`allocation_config_id IS NOT NULL`, `stage_code_2 IS NULL`, `transaction_type IS NULL`):

```typescript
configSplitData: Array<{ amount: number; allocation_config_id: string }> = [
  { amount: 100_000, allocation_config_id: 'cfg-special-001' },
]
```

### configsRes fetch

```
supabase.from('allocation_configs').select('id, rows').in('id', ['cfg-special-001'])
```

Raw Supabase response (JSONB deserialised):

```typescript
configsRes.data = [
  {
    id:   'cfg-special-001',
    rows: [
      { category_name: 'Welfare', budget_portion: 'Percentage', percentage: null, amount: 5_000 },
      { category_name: 'Mission', budget_portion: 'Percentage', percentage: null, amount: 3_000 },
    ]
  }
]
```

### configMap construction — first incorrect data structure

```typescript
// PercentageAllocation.tsx:35
type ConfigRowShape = {
  category_name:  string
  budget_portion?: string
  percentage?:    number
  // amount is absent
}

// PercentageAllocation.tsx:117
const configMap = new Map<string, ConfigRowShape[]>(
  configsRes.data.map(c => [c.id as string, c.rows as ConfigRowShape[]])
)
```

The type assertion `c.rows as ConfigRowShape[]` narrows the static type but does not strip
runtime values. The JS objects in `configMap` still carry `amount: 5_000` at runtime, but
`ConfigRowShape` does not declare `amount`, so no subsequent code can reference it without
a type error.

```typescript
// configMap after construction:
Map<string, ConfigRowShape[]> {
  'cfg-special-001' => [
    // Runtime JS object:  { category_name:'Welfare', budget_portion:'Percentage', percentage:null, amount:5_000 }
    // TypeScript sees:    { category_name:'Welfare', budget_portion:'Percentage', percentage:undefined }
    //                                                                              ↑ null coerces to undefined
    //                                                                              amount not visible to type
    { category_name: 'Welfare', budget_portion: 'Percentage', percentage: null },
    { category_name: 'Mission', budget_portion: 'Percentage', percentage: null },
  ]
}
```

`ConfigRowShape.percentage` is typed as `number | undefined`. The actual runtime value is
`null` (from DB). TypeScript treats the field as `undefined`-compatible, but `Number(null ?? 0)`
coalesces `null` to `0`.

### Loop execution on configMap rows

```
row = ConfigRowShape { category_name:'Welfare', budget_portion:'Percentage', percentage:null }

Guard (budget_portion):
  row.budget_portion && ... !== 'Percentage' && ... !== 'Percentage Allocation'
  'Percentage' && ('Percentage' !== 'Percentage')
  true && false
  = false → does NOT continue → PASSES budget_portion guard

Guard (percentage):
  pct = Number(row.percentage ?? 0)
      = Number(null ?? 0)
      = Number(0)
      = 0

  if (pct <= 0) continue    →  0 <= 0 = true  →  SKIP
```

`row.amount` is never read. The `amount: 5_000` field on the runtime object is unreachable
because `ConfigRowShape` does not declare it and the loop code contains no reference to
`row.amount`.

### allocMap / deposited after T (PercentageAllocation path)

```typescript
// deposited map for PercentageAllocation — Scenario A
Map<string, { deposited: number; withdrawn: number }> {
  // T never contributes — both rows hit pct <= 0 guard
}
```

### Expected vs actual (PercentageAllocation config-split)

```
           Expected   Actual   Delta
Welfare:    5_000       0      −5_000
Mission:    3_000       0      −3_000
```

---

## Type divergence — root cause

Two type definitions exist for the same DB rows:

```typescript
// allocationStore.ts:7 — used by useReportEngine, CategoryLedger
interface AllocationRow {
  category_name:  string
  budget_portion?: string
  percentage?:    number
  amount?:        number    // ← declared
}

// PercentageAllocation.tsx:35 — used only within that file
type ConfigRowShape = {
  category_name:  string
  budget_portion?: string
  percentage?:    number
  // amount        ← absent
}
```

`AllocationRow` is the canonical type. `ConfigRowShape` is a private, narrower type that
predates `AllocationRow` gaining the `amount` field. No compile-time error surfaces because
the type cast `c.rows as ConfigRowShape[]` is an explicit assertion that suppresses checking.

### First data structure where allocation becomes incorrect

```
PercentageAllocation.tsx:117

const configMap = new Map<string, ConfigRowShape[]>(
  configsRes.data.map(c => [c.id as string, c.rows as ConfigRowShape[]])
)
```

The `configMap` values are the first data structure where a runtime-correct allocation row
(`{ ..., amount: 5_000 }`) becomes allocation-inaccessible. Every subsequent read from
`configMap` only sees fields declared on `ConfigRowShape`. `amount` is present in memory
but unreachable to the loop that computes `deposited`.

The `pct <= 0` guard at line 127 is the proximate kill point, but its `0` input originates
from `Number(row.percentage ?? 0)` which reads `null` because `ConfigRowShape` excludes
`amount` — making `row.percentage = null` the only numeric field the loop can see.

---

## Comparison summary

| Data structure | Scenario P (% general) | Scenario A (amount special) |
|---------------|------------------------|----------------------------|
| `AllocationConfig.rows` from allocationStore | `AllocationRow[]` with `percentage:60, amount:undefined` | `AllocationRow[]` with `percentage:null, amount:5_000` |
| allocMap (useReportEngine / CategoryLedger) | `{Welfare:60_000, Mission:40_000}` ✓ | `{Welfare:5_000, Mission:3_000}` ✓ |
| configMap (PercentageAllocation) | T not in configSplitData (null allocation_config_id) | `ConfigRowShape[]` — `amount` not visible |
| pct evaluated | not reached | `Number(null ?? 0)` = `0` |
| pct guard | not reached | `0 <= 0` → SKIP |
| deposited result | not applicable | `0` (expected `5_000`) |
