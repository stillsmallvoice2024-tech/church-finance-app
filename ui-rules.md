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

## Page Architecture Conventions

- Pages are display-first; data fetching via `use<Entity>.ts` hook at the top of each page component
- `Inflows.tsx` and `Outflows.tsx` are **display-only** — no Add/import triggers; edit and delete remain
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
