# UI & Frontend Rules

## DescriptionCell Pattern

All long-text table columns use `DescriptionCell` + `useDescriptionExpand` hook (`src/components/ui/DescriptionCell.tsx`).

- **Hover** → tooltip via `DescriptionTooltip` portal (renders in `document.body`, `z-[9999]`)
- **Click** → inline expand below row text
- **Chevron** (`ChevronDown`, `shrink-0`) — always visible; inner `<span>` needs `min-w-0` so flex container truncates instead of hiding the icon

```tsx
const { expandedIds: descExpanded, tooltip: descTooltip, setTooltip: setDescTooltip, toggle: toggleDesc } = useDescriptionExpand()

// In table cell:
<td className="px-4 py-3 text-sm max-w-[200px]">
  <DescriptionCell
    id={row.id}
    text={row.description}
    expanded={descExpanded.has(row.id)}
    onToggle={() => toggleDesc(row.id)}
    tooltip={descTooltip}
    setTooltip={setDescTooltip}
  />
</td>

// At end of return (renders portal):
<DescriptionTooltip tooltip={descTooltip} />
```

Use a prefixed id (e.g. `rem-${row.id}`) for a second `DescriptionCell` in the same row.

Pages using DescriptionCell: Inflows, Outflows, BankLedger, IntraFlow, BankDeposits, ForeignCurrency, Categories, ReversalTransactions, IntraBankTransfers, RefundTransactions.

---

## Mobile Horizontal Scrolling

Tables must be inside an `overflow-x-auto` container. Two patterns:

1. **Standard** (most pages): `<div className="overflow-x-auto"><table ...>`
2. **Rounded-card** (CategoryLedger, PercentageAllocations, SpecificGivings, SavingsPortions): `<div className="... rounded-xl overflow-x-auto">`

**Never use `overflow-hidden` alone** on a table container — clips without allowing scroll, breaking mobile.

---

## Tailwind Colours

Custom semantic tokens in `tailwind.config.js`:
- `primary` / `primary-light` / `primary-dark` — deep blue (`#1E3A8A`)
- `success` — dark green (`#065F46`)
- `danger` — dark red (`#991B1B`)
- `accent` — amber (`#D97706`)
- `background` — light grey (`#F8FAFC`)

Dark mode: `darkMode: 'class'` — `themeStore.ts` applies class to `<html>` as a side effect on import.

---

## Toast Notifications

```ts
const { push } = useToastStore()
push('Saved successfully', 'success')  // types: success | error | info
```

---

## Modal Sizing

`Modal.tsx` accepts a `size` prop: `max-w-sm | max-w-md | max-w-lg | max-w-xl | max-w-2xl`

---

## Sidebar Navigation

All nav items visible to all authenticated users.

- **Main:** Dashboard, Inflows, Outflows, Categories, Special Projects, Foreign Currency, Intra-Account Flows, Import, Pending Deductions, Setup, Reports, **Financial Report**, Settings
- **Banking:** Bank Ledger, Bank Deposits, Intrabank Transfers, Refunds, Reversals, Receipts
- **Allocations:** Category Ledger, Percentage Allocations, Specific Givings, Savings Portions
- **Admin:** User Management, Change Log

---

## Setup Page Tabs (`src/pages/Setup.tsx`)

- **General** — org name, accounting year
- **Banks** — list/add/edit/delete banks (multi-row starting balance allocation)
- **Allocation** — allocation configs (draft/lock workflow)
- **Special Configs** — special configs with status badges, lock/unlock controls
- **Income Types** — user-defined inflow labels with keyword/stage-code rules
- **Currencies** — add/remove currencies (code, name, symbol, flag emoji); shows migration SQL
- **Database** — migration SQL panel; idempotent `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` pattern

---

## ReceiptBadge Upload Behaviour

- `inputRef` resets `input.value = ''` after each upload batch — allows re-selecting the same file
- Errors surfaced via `useToastStore`: full failure → "Upload failed — check storage permissions or bucket setup"; partial → "N of M file(s) failed to upload"
- Success toast shown on clean upload
- Upload errors from `useReceipts.upload()` are caught per-file; count tracked; never silently swallowed

---

## PendingDeductions Resolve Guard

`handleResolve` in `PendingDeductions.tsx` checks `stage_code_1` and `stage_code_2` before updating `is_pending_deduction`:
- If either is blank/null → error toast + `openEdit(row)` — DB update is NOT called
- Only proceeds to mark resolved when both stage codes are filled

---

## Key Component Locations

| Component | Location |
|---|---|
| Base modal wrapper | `src/components/ui/Modal.tsx` |
| Delete confirmation | `src/components/ui/DeleteDialog.tsx` |
| Card wrapper (`padding` prop) | `src/components/ui/Card.tsx` |
| Receipt attachment (smart above/below) | `src/components/ui/ReceiptBadge.tsx` |
| All add/edit form modals | `src/components/modals/` |

---

## Inline Rename Pattern (Category Groups)

Used in `Categories.tsx` group header rows. State: `editGroupId`, `editGroupName`, `savingGroup`.

- Pencil icon sets `editGroupId = g.id` and seeds `editGroupName = g.name`
- While editing: render `<form>` with input + confirm (`Check`) + cancel (`X`) buttons
- On submit: trim, bail if unchanged, call `useUpdateCategoryGroup`, `refetchGroups()`, clear `editGroupId`
- Reuse this pattern for any other inline-rename list items

## Realtime Search Pattern (Categories page)

- Single `search` string state; cleared by an `X` button when non-empty
- Filter applied inside the `visible` derivation — matches against category name **or** group name (resolved from `groups` array via `cat.group_id`)
- No debounce needed for local in-memory arrays

---

## Categories Page — Opening Balance Display

`useCategoryOpeningBalances()` (no `categoryId` arg) is called at page level to fetch all rows from `category_opening_balances`.

**Per-category display logic** (applied in both `CategoryRow` and card view):
1. Filter `allOpeningBalances` by `category_id` → `catBalances`
2. If `catBalances.length > 0` → use new-table data (multiple portions possible)
3. Else fall back to legacy `cat.starting_balance` + `cat.starting_balance_budget_portion` (single row)

**Rendering:** Multiple portions stack vertically — `flex-col gap-0.5` for both the Portion pill column and the Bal. B/F amount column.

---

## AddOutflowModal — Removed Fields

The **Optional Banking Details** section has been removed from `AddOutflowModal.tsx`. Fields no longer shown in the UI:
- Amount Refunded (`amount_refunded`)
- Transfer Charge (`transfer_charge`)
- FX Currency (`fx_currency`)

The Zod schema and `onSubmit` handler retain these fields for backward compat with existing records. The **FX Details** collapsible (fx_amount, fx_rate) remains.

---

## Multi-Select Rows + Bulk Operations (Inflows / Outflows table view)

- `selectedIds: Set<string>` state; cleared on page change, filter change, and year reset
- Checkbox column is first in table header and each row (`w-10 pl-4 pr-2`); header checkbox = select/deselect all on current page
- Selected rows get `bg-primary/5 hover:bg-primary/10` highlight
- **Bulk action bar** appears above `overflow-x-auto` when `selectedIds.size > 0`:
  - "Edit selected" (canWrite) → opens `BulkEditInflowModal` / `BulkEditOutflowModal`
  - "Delete selected" (canDelete) → `DeleteDialog` with count-aware label → sequential `deleteRecord` loop → `refetch()`
  - "Clear" → `setSelectedIds(new Set())`
- **BulkEdit modal** (inline function component at bottom of page file):
  - Inflows: `bank_name` (select) + `recorded_at` (date) + `transaction_type` (select) + `income_type_id` (select, shown only when income types exist) + `stage_code_1` (category select) + `stage_code_2` (select: Percentage Allocation / Specific Seed / Savings); calls `useCategories()` + `useIncomeTypes()` internally
  - Outflows: `bank_name` (select) + `recorded_at` (date) + `transaction_type` (select) + `stage_code_1` (category select, from `categories` prop) + `stage_code_2` (select)
  - Blank fields skipped; only filled fields sent in `updates`; `useUpdateTransaction` called internally per ID; no way to bulk-clear `transaction_type` (individual edit only)
  - **Strip-and-retry pattern**: `handleApply` uses `let updates` + `MISSING_COL_RE` — on first schema cache error for a column, strips that column from `updates` for the current row AND all subsequent rows (prevents cascade failures). Per-column warning toast emitted once after loop. Toast order: column warnings → success/fail count.
- colSpan for loading/empty/expanded rows must equal total column count (8 for Inflows, 13 for Outflows)
- Multi-select is **table view only** — cards view unchanged

## Schema Cache Error — Inline Display (Inflows / Outflows modals)

Lighter alternative to full Migration-Gated Modal when a column is optional and the save is not gated:

```tsx
{error && (
  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
    {/schema cache/i.test(error) ? (
      <div className="space-y-2">
        <p className="font-semibold">Schema cache out of sync — run this in Supabase SQL editor, then retry:</p>
        <code className="block font-mono text-xs bg-white border border-red-200 rounded p-2 whitespace-pre-wrap break-all select-all">
          {`NOTIFY pgrst, 'reload schema';`}
        </code>
        <p className="text-xs">If the column is also missing, run the full migration in <strong>Setup → Database tab</strong>.</p>
      </div>
    ) : error}
  </div>
)}
```

Applied in `AddInflowModal` and `AddOutflowModal`. Shows only `NOTIFY pgrst` (cache-stale fix) — do NOT hardcode column-specific `ALTER TABLE` SQL here, as the column is stable; full migration is in Setup → Database tab.

---

## Page Architecture Conventions

- Pages are display-first; data fetching via `use<Entity>.ts` hook at the top of each page component
- `Inflows.tsx` and `Outflows.tsx` are **display-only** — no Add/import triggers; edit and delete remain; multi-select + bulk ops available in table view
- Card view and table view are both present on most list pages (toggle between them)
- Income type badges shown on Inflows page
- Transaction type badges shown on Inflows, Outflows, and BankLedger (see Transaction Type Badge below)

## Transaction Type Badge

Slate-grey pill (`bg-slate-100 text-slate-500`, `rounded-full`, `text-[10px] font-semibold`) displayed on:
- **Inflows** — in the "Type" column (alongside or below the income type badge); card top-right
- **Outflows** — inline in description cell before text (alongside "Pending" badge); card top-right
- **BankLedger** — inline in description cell before text; card between amount row and description

Normal transactions (`transaction_type = null`) show nothing. Each page defines a local `TXN_TYPE_LABELS` map:
```ts
{ refund: 'Refund', reversal: 'Reversal', bank_deposit: 'Bank Deposit', intrabank_transfer: 'Intrabank Transfer' }
```

BankLedger carries `transaction_type: string | null` in its `LedgerRow` interface, populated from source inflow/outflow `select('*')` data.

---

## Migration-Gated Modals (`AddBankModal` pattern)

For modals that depend on optional DB columns, gate the save button on schema state rather than crashing on INSERT.

**State:**
```ts
const [schemaStatus,   setSchemaStatus]   = useState<SchemaStatus>('ok')  // 'ok' | 'migration_needed' | 'cache_stale'
const [checkingSchema, setCheckingSchema] = useState(false)
const cacheRetryCount = useRef(0)
const MAX_CACHE_RETRIES = 3
```

**On modal open** — reset counter, run check with one 1.5 s retry before surfacing non-ok status:
```ts
useEffect(() => {
  if (!open) return
  setSchemaStatus('ok')
  cacheRetryCount.current = 0
  setCheckingSchema(true)
  let active = true
  ;(async () => {
    let status = await checkBankStartingBalanceMigration()
    if (active && status !== 'ok') {
      await new Promise(r => setTimeout(r, 1500))
      status = await checkBankStartingBalanceMigration()
    }
    if (active) { setSchemaStatus(status); setCheckingSchema(false) }
  })()
  return () => { active = false }
}, [open, ...otherDeps])
```

**On schema-cache save error** — auto-retry (capped), clear mutation error so it doesn't block UI:
```ts
const isSchemaCacheError = !!error && /schema cache/i.test(error)   // hoist above all useEffects

useEffect(() => {
  if (!error || !/schema cache/i.test(error)) return
  cacheRetryCount.current++
  if (cacheRetryCount.current > MAX_CACHE_RETRIES) return
  let cancelled = false
  ;(async () => {
    const status = await checkBankStartingBalanceMigration()
    if (cancelled) return
    setSchemaStatus(status)
    resetAdd(); resetUpdate()   // clears mutation error
  })()
  return () => { cancelled = true }
}, [error])
```

**Derived flags:**
```ts
const schemaStuck         = isSchemaCacheError && cacheRetryCount.current > MAX_CACHE_RETRIES
const showMigrationBanner = (!checkingSchema && schemaStatus !== 'ok') || schemaStuck
```

**Banner — three cases:**
- `schemaStuck` → red; tell user to reload page
- `cache_stale` → amber; show `NOTIFY pgrst, 'reload schema';` only
- `migration_needed` → amber; show full `ALTER TABLE` + view SQL

**Save button:**
```ts
disabled={loading || checkingSchema || schemaStatus !== 'ok' || schemaStuck || (hasBalance && !balanced)}
```

**Suppress raw error** when schema banner already explains it:
```tsx
{error && !isSchemaCacheError && !showMigrationBanner && <p className="text-red-600">{error}</p>}
```

**Key rule:** Define `isSchemaCacheError` immediately after `const error = addError || updateError`, before any `useEffect` that references it — avoids React TDZ crash.

---

## Financial Report Page (`src/pages/FinancialReport.tsx`)

Two modes toggled by "Edit Layout" button:
- **View mode** — rendered multi-table report; each table has independent subtotals and grand total; combined grand total shown when >1 table; PDF + Excel export buttons
- **Edit mode** — DnD builder; CategoryPicker panel (3 tabs: Category / Income Type / Txn Type); sortable Table → Group → Subgroup → Item hierarchy on right

Layout state (`tables: ReportTable[]`) is local until "Save Template" → `SaveReportTemplateModal`.

### DnD ID Conventions

All `useSortable` IDs use a prefix to distinguish hierarchy level:
- Tables: `tbl-{uuid}`
- Groups: `grp-{uuid}`
- Subgroups: `sgp-{uuid}`
- Items: `itm-{uuid}`

`stripPrefix(id)` removes prefix; `prefixType(id)` returns `'table'|'group'|'subgroup'|'item'`.
Locators `findItem(tables, itemId)` and `findGroup(tables, groupId)` scan the entire `tables` array.
Cross-group item moves handled in `onDragOver`; table/group/subgroup/item reorder in `onDragEnd`.

### CategoryPicker

3 tabs: **Category** (standard budget categories + portion selector), **Income Type** (from `useIncomeTypes`), **Txn Type** (hardcoded keys: reversal, refund, bank_deposit, intrabank_transfer).
`usedKeys` set (keyed by `itemKey()`) prevents duplicate rows — same category + same portion = blocked; same category + different portion = allowed.

### Report Basis Selector

Controls toggle `reportBasis: ReportBasis` → `'transaction_date'` (financial) | `'recorded_at'` (operational). Passed to `useReportEngine`.

### Backward Compat

`ensureMultiTable(layout)` = `normaliseTables(layout)` — wraps legacy `{ groups: [...] }` templates into `{ tables: [{ id: 'legacy', ... }] }` on template load.

Dependencies: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `jspdf`, `jspdf-autotable`.

### Table Reorder Controls (Edit Mode)

Each table title bar has ↑/↓ buttons (`ChevronUp`/`ChevronDown`) alongside the drag handle:
- Up → `arrayMove(tables, idx, idx-1)`; disabled + greyed when first
- Down → `arrayMove(tables, idx, idx+1)`; disabled + greyed when last
- Both methods use `useCallback`; complement existing DnD

### Combined Total Toggle (Edit Mode)

Each table has a `∑` button in the title bar toggling `include_in_combined_total`:
- Active (blue bg) = included in combined grand total (default)
- Inactive (grey) = excluded; table stays independent
- Combined grand total row hides entirely when no tables are opted in

### CategoryPicker TXN_TYPES

Full list: `normal` (Normal Transactions), `reversal`, `refund`, `bank_deposit`, `intrabank_transfer`.
`tt::normal` maps to inflows where `transaction_type IS NULL`.

### SortableContext Isolation (DnD reliability)

Each level has its own `SortableContext` to prevent cross-level collision interference:
- **Top-level**: `tblId`s + `grpId`s + direct `itmId`s + `sgpId`s (no subgroup items) — used by the outer `SortableContext` in `renderEditMode`
- **Per-table**: `grpId`s only — inside `SortableTableBlock`
- **Per-group**: direct `itmId`s + `sgpId`s only — inside `SortableGroup` (`allItemIds` must NOT include subgroup item IDs)
- **Per-subgroup**: `itmId`s of that subgroup only — inside `SortableSubgroup`

Subgroup items are intentionally excluded from `allSortableIds` and `allItemIds`; they live only in their subgroup-level context. Breaking this isolation causes unreliable same-subgroup reordering.

### Group Reorder Controls (Edit Mode)

Each group header shows ↑/↓ `ChevronUp`/`ChevronDown` buttons (alongside grip + add-subgroup + eye + trash):
- `onMoveGroupUp?` / `onMoveGroupDown?` are `undefined` (greyed `text-gray-300`, disabled) at boundaries
- Callbacks: `moveGroupUp(gId)` / `moveGroupDown(gId)` — scan all tables, `arrayMove` within the matched table's `groups` array
- Threaded: main component → `SortableTableBlock` (curries `group.id`, passes index-aware `undefined` at boundaries) → `SortableGroup`
- No cross-table group movement via buttons (DnD only)

### Unified Children Ordering Model (Groups)

`ReportGroup.children: ReportGroupChild[]` is a **single ordered list** of all direct children — categories and subgroups interleaved in any order. There are no separate `items` or `subgroups` arrays on `ReportGroup`.

```ts
type ReportGroupChild =
  | { kind: 'item';     data: ReportItem }
  | { kind: 'subgroup'; data: ReportSubgroup }
```

- All mutations (`addItem`, `moveItemUp`, `deleteItem`, `addSubgroup`, `moveSubgroupUp`, …) operate on `g.children` via the discriminated union
- `migrateGroupChildren(g)` in `reportExport.ts` converts legacy `{items, subgroups}` shapes to `{children}` for backward compat with stored templates
- Rendering (view + edit mode, PDF, Excel) iterates `group.children` in order
- Subtotal computation (`computeGroupTotal`) iterates `group.children` in order

### Item Reorder Controls (Edit Mode)

Each item row shows ▲/▼ buttons (`ChevronUp`/`ChevronDown`) alongside drag handle:
- Up/Down swap item with adjacent sibling in `g.children` (when in group root) or within `sg.items` (when inside a subgroup)
- `onMoveUp` is `undefined` (disabled) when item is first; `onMoveDown` is `undefined` when last
- Callbacks: `moveItemUp(itemId)` / `moveItemDown(itemId)` — locate item in `g.children` or `sg.items`, apply `arrayMove`

### Subgroup Assignment (Edit Mode)

Each item has a `— Root —` + subgroup `<select>` dropdown (shown only when parent group has ≥1 subgroup):
- Changing to a subgroup ID → `moveItemToSubgroup(itemId, targetSgId)` — removes from current location, appends to target subgroup
- Changing to `''` (Root) → `removeItemFromSubgroup(itemId)` — removes from subgroup, appends to group's direct items
- **Cross-group moves are blocked**: `moveItemToSubgroup` validates `targetSgId` is in the item's current parent group; cross-group is a two-step flow (DnD to group header to move to group root, then assign subgroup)
- Callbacks thread through: `SortableTableBlock` → `SortableGroup` → `SortableSubgroup` → `SortableItem`

### Subgroup Reorder Controls (Edit Mode)

Each subgroup header shows ↑/↓ `ChevronUp`/`ChevronDown` buttons (alongside grip + eye + trash):
- `onMoveSubgroupUp?` / `onMoveSubgroupDown?` are `undefined` (greyed, disabled) at boundaries
- Callbacks: `moveSubgroupUp(gId, sgId)` / `moveSubgroupDown(gId, sgId)` — `arrayMove` within `g.children` (subgroup child swaps with adjacent sibling of any kind), constrained to same parent group
- Threaded: main component → `SortableTableBlock` → `SortableGroup` (curries `group.id` and passes index-aware `undefined` at boundaries) → `SortableSubgroup`
- No cross-group subgroup movement (DnD or buttons)

### Subgroup Drag-and-Drop Rules

- Items inside a subgroup can be reordered within that subgroup via DnD or ▲/▼ buttons
- Items in group root can be dragged to another group via group header (DnD over `grp-{id}` triggers `handleDragOver` cross-group move)
- Direct cross-subgroup DnD blocked — assign via dropdown instead
- Subgroups and root items reorder within the same parent group via the unified `itm/sgp` branch in `handleDragEnd` (reorders `g.children` directly), or via ↑/↓ buttons
- Categories and subgroups can be freely interleaved — any child order is valid (e.g. Cat1, SgA, Cat2, SgB, Cat3)
