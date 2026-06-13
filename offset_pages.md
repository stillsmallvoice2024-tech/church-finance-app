# Offset Pages — Approved Plan

## Approved Build: Sorting + Pagination + Bulk Selection + Root-Offset Grouping

All 4 offset-enabled pages must adopt this architecture consistently.

---

## Affected Pages

| Page | File | Current State |
|---|---|---|
| Reversals | `src/pages/ReversalTransactions.tsx` | Grouping done, no sort/pagination/bulk |
| Refunds | `src/pages/RefundTransactions.tsx` | Grouping done, no sort/pagination/bulk |
| Bank Deposits tab | `src/pages/BankMovement.tsx` → `DepositsPanel` | Has sort/pagination, no grouping |
| Intrabank Transfers tab | `src/pages/BankMovement.tsx` → `TransfersPanel` | Flat list only, no grouping/pagination/bulk |

---

## Processing Pipeline (universal)

```
fetch (capped at 5,000 rows)
  → filter (date range, bank, direction, type)
  → groupAwareSearch()        ← searches BEFORE grouping
  → groupRows()               → { groups, unmatched }
  → sortGroups(groups, sortKey, sortDir)   ← root row drives group order
  → sortUnmatched(unmatched, sortKey, sortDir)
  → paginate: slice groups[] by page       ← NOT individual rows
  → render paginated groups + unmatched tail
```

Unmatched rows always render after matched groups on the same page — not paginated separately.

---

## 1. Sorting

- Sort `groups[]` by `group.root[sortKey]`.
- Offsets within a group **always** sort by `date` descending (immutable — not user-controllable).
- `SortableHeader` drives `sortKey` + `sortDir` state as today.

```ts
function sortGroups(groups: TxnGroup[], key: SortKey, dir: 'asc' | 'desc'): TxnGroup[] {
  return [...groups].sort((a, b) => {
    const va = a.root[key] ?? ''
    const vb = b.root[key] ?? ''
    return dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
  })
}
```

**DepositsPanel special case:** Currently uses server-side sort params. Switch to client-side sort (same 5,000-row cap model). Remove `orderBy` from Supabase query; sort on the fetched array after grouping.

---

## 2. Pagination

Paginate over `groups[]`, not over individual rows. A group is never split across pages.

```ts
const totalGroups = groups.length          // PaginationBar total
const pagedGroups = groups.slice(
  (page - 1) * pageSize,
  page * pageSize
)
// Unmatched always appended after pagedGroups — not counted in group pagination
```

- `PaginationBar` receives `total={totalGroups}` and `pageSize`.
- Row count label = `pagedGroups.flatMap(g => [g.root, ...g.offsets]).length + unmatched.length`.
- **Reversals/Refunds:** add `useDataViewState` (`storageKey: 'rev'` / `'ref'`). Default `pageSize = 25`.
- **TransfersPanel:** add `useDataViewState` (`storageKey: 'tf'`). Default `pageSize = 25`.
- **DepositsPanel:** already has `useDataViewState` — redirect its `total` from row count to group count.

---

## 3. Bulk Selection

Group-level selection only. Checkbox on root row selects the whole group.

```ts
// selectedIds = Set of root row IDs (and unmatched row IDs)
function toggleGroup(rootId: string) { /* add/remove from set */ }
function isGroupSelected(rootId: string): boolean { return selectedRootIds.has(rootId) }
function selectAll() { /* add all pagedGroups root IDs + unmatched IDs */ }
```

- Offset rows: no checkbox, but subtle `bg-emerald-50/30` tint when group is selected.
- Unmatched rows: each gets its own independent checkbox.
- Header checkbox: `indeterminate` if some-but-not-all selected; `checked` if all selected.
- Bulk delete: resolves to `[rootId, ...offsets.map(o => o.id)]` per selected group.

---

## 4. Group-Aware Search

Runs **before** `groupRows()` on the full filtered array. If any row in a group matches, the entire group is included.

```ts
function groupAwareSearch(rows: TxnRow[], query: string): TxnRow[] {
  if (!query.trim()) return rows
  const q = query.toLowerCase()
  const matchingIds = new Set(
    rows.filter(r => searchFields(r).some(f => f?.toLowerCase().includes(q))).map(r => r.id)
  )
  return rows.filter(r => {
    if (matchingIds.has(r.id)) return true
    if (r.offset_role === 'root')
      return rows.some(o => o.root_transaction_id === r.id && matchingIds.has(o.id))
    if (r.root_transaction_id)
      return matchingIds.has(r.root_transaction_id)
    return false
  })
}
```

---

## 5. Per-Page Specifics

| Page | Sorting | Pagination | Bulk Select | Special notes |
|---|---|---|---|---|
| Reversals | Add `useDataViewState` | Add (25 groups/page) | Add group-level | Currently flat sorted only |
| Refunds | Same as Reversals | Same | Same | Mirror of Reversals |
| TransfersPanel | Add `useDataViewState` | Add (25 groups/page) | Add group-level | Currently flat, no pagination |
| DepositsPanel | Switch to client-side sort | Keep existing bar, redirect total to group count | Add group-level | Remove server-side `orderBy`, keep 5k cap |

---

## 6. Shared Utilities to Extract

All shared code goes into new files to avoid duplication across 4 pages:

### `src/utils/groupTransactions.ts`
- `groupRows(rows: TxnRow[]): { groups: TxnGroup[]; unmatched: TxnRow[] }` ← already exists in Reversals/Refunds verbatim, extract once
- `sortGroups(groups, key, dir)`
- `sortUnmatched(rows, key, dir)`
- `groupAwareSearch(rows, query)`

### `src/types/index.ts`
- Move `TxnRow` and `TxnGroup` interfaces here (currently duplicated in Reversals + Refunds)

### `src/components/ui/TreeConnectorCell.tsx`
- Shared `<td>` with absolute-positioned dot + vertical/horizontal line
- Props: `kind: 'root' | 'offset' | 'none'`, `hasOffsets?: boolean`, `isLastOffset?: boolean`

### `src/components/ui/ClusterCard.tsx`
- Shared cluster wrapper with emerald header strip and gutter column
- Props: `offsets: TxnRow[]`, `header: ReactNode`, `children: ReactNode`

---

## 7. Build Order (approved)

1. Extract `groupRows` + `TxnRow`/`TxnGroup` types into shared util + types
2. Extract `TreeConnectorCell` + `ClusterCard` UI components
3. Add pagination + sort + bulk to **Reversals** (test baseline)
4. Mirror to **Refunds**
5. Add grouping + group-aware pagination + bulk to **TransfersPanel**
6. Refactor **DepositsPanel** (client-side sort, group-level pagination, bulk)

---

## Key Context: Current State of Grouping (already built)

### `groupRows()` logic (currently duplicated in both pages)

```ts
function groupRows(rows: TxnRow[]): { groups: TxnGroup[]; unmatched: TxnRow[] } {
  const roots = rows.filter(r => r.offset_role === 'root')
  const effectiveOff = rows.filter(r => r.root_transaction_id !== null)
  const unmatchedRows = rows.filter(r =>
    r.root_transaction_id === null &&
    (r.offset_role === null || r.offset_role === 'offset')
  )
  const rootIds = new Set(roots.map(r => r.id))
  const byRoot = new Map<string, TxnRow[]>()
  const orphans: TxnRow[] = []
  for (const off of effectiveOff) {
    const rid = off.root_transaction_id!
    if (rootIds.has(rid)) {
      if (!byRoot.has(rid)) byRoot.set(rid, [])
      byRoot.get(rid)!.push(off)
    } else { orphans.push(off) }
  }
  const groups = roots
    .map(root => ({ root, offsets: (byRoot.get(root.id) ?? []).sort((a, b) => b.date.localeCompare(a.date)) }))
    .sort((a, b) => b.root.date.localeCompare(a.root.date))
  return { groups, unmatched: [...unmatchedRows, ...orphans].sort((a, b) => b.date.localeCompare(a.date)) }
}
```

### Fallback rules (hardcoded)
- Any row with `root_transaction_id` set → treat as `offset_role === 'offset'` (overrides missing/wrong value)
- Any row with `offset_role` not set OR `offset_role === 'offset'` AND no `root_transaction_id` → Unmatched section

### Tree connector rendering
- Dedicated 24px `<td>` with `position: relative`; children use `position: absolute`
- Root: emerald dot (`#34d399`) + downward stem to first offset
- Offset: vertical stem from above + horizontal stub + slate dot (`#94a3b8`); bottom stem continues if not last offset
- Uses inline pixel styles (not Tailwind) for precision

### Card cluster structure
- Outer: `rounded-2xl border border-emerald-200/70 shadow-md overflow-hidden`
- Header strip: `bg-emerald-50 border-b border-emerald-100` with `Link2` icon
- Root card: `bg-white`
- Offset cards: `bg-slate-50/60` inside a flex row with `w-5` gutter column carrying the connector lines
- Unmatched cluster: rose/pink divider with count badge

---

## Pending Prerequisite (NOT YET DONE — confirm before building)

### BankMovement.tsx — data source removal
The user intends to remove native table sources from both panels so data comes from `inflow_transactions`/`outflow_transactions` only. **Currently still present:**

- **DepositsPanel:** still queries `bank_deposits` table (lines ~172–185, 228). `source: 'bank_deposits'` type variant still active.
- **TransfersPanel:** still queries `intrabank_transfers` table (lines ~581–590, 633). `source: 'intrabank_transfers'` type variant still active.

This must be resolved before (or as part of) the BankMovement grouping build steps (steps 5–6 above).

---

## Branch

Build on a **new branch** (to be created from `claude/gallant-meitner-aeczpz`). Do not build on `feature/grouped-reversals-refunds`.

`feature/grouped-reversals-refunds` contains only the Reversals/Refunds grouping and polish (2 commits). It has a draft PR open against main. Its commits must be merged to main before or alongside the new branch work.
