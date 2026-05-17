# UI & Frontend Rules

## Accessibility Foundations

- **Focus ring:** `:focus-visible` shows a 2px primary-blue ring (dark: `#60a5fa`); mouse/touch users see none. Defined globally in `index.css` — do not add custom `outline` overrides in components.
- **Skip link:** `Layout.tsx` renders a `sr-only focus:not-sr-only` "Skip to main content" link targeting `#main-content` on `<main>`. Always present — do not remove.
- **`Field` accessibility:** auto-injects `aria-invalid`, `aria-describedby`, and `htmlFor` — no manual wiring needed in form modals.
- **Modal focus trap:** built into `Modal.tsx` — Tab stays within panel; focus returns to trigger on close.
- **`CollapsibleSection`:** emits `aria-expanded` + `aria-controls` automatically.
- **`ViewToggle`:** emits `role="group"` + `aria-pressed` automatically.
- **Page titles:** `usePageTitle(title)` sets `{title} — Church Finance`. All pages use this hook — keep consistent.
- **Dark mode muted text:** `text-gray-400` maps to `#9ca3af` in dark (not `#6b7280`) — sufficient contrast on dark card backgrounds. Placeholders follow the same value.

---

## DescriptionCell Pattern

All long-text table columns **and card view descriptions/remarks** use `DescriptionCell` + `useDescriptionExpand` hook (`src/components/ui/DescriptionCell.tsx`).

**Interaction model (unified — no inline accordion expansion):**
- **Mouse hover** → popover tooltip via `DescriptionTooltip` portal (`document.body`, `z-[9999]`); dismisses on pointer leave
- **Tap / click** → same popover; dismisses on outside tap, ESC key, or tab-away
- **Keyboard focus** → popover shows on focus, hides on blur; Enter/Space re-show
- **One popover at a time** — clicking another truncated cell switches the active popover cleanly
- **Never inline-expand** (no accordion, no layout shift, rows stay compact)

**`DescriptionCell` props:**
```tsx
interface DescriptionCellProps {
  id: string
  text: string | null
  tooltip: TooltipState | null
  setTooltip: (t: TooltipState | null) => void
  textCls?: string   // default 'text-gray-700'; override for semantic colours
}
```

`expanded` and `onToggle` props **do not exist** — the component is self-contained.

**`useDescriptionExpand` hook** (simplified — no `expandedIds` or `toggle`):
```tsx
const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()
// hook also wires outside-click + ESC dismissal automatically
```

**Usage:**
```tsx
// In table cell:
<td className="px-4 py-3 text-sm max-w-[200px]">
  <DescriptionCell id={row.id} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} />
</td>

// In card view (wrap in div for colour context):
{row.description && (
  <div className="text-xs text-gray-500">
    <DescriptionCell id={`card-desc-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-500" />
  </div>
)}

// At end of return (renders hover tooltip portal):
<DescriptionTooltip tooltip={descTooltip} />
```

ID prefixing rules:
- Second field in same row: `rem-${row.id}` (remarks) or any unique prefix
- Card view: `card-desc-${row.id}`, `card-rem-${row.id}` — prevents collision with table-view IDs

**`textCls` prop** — override text colour without forking the component (e.g. `textCls="text-red-600"` for old values in ChangeLog). Null text renders a non-interactive `—` in the given colour.

**Never use bare `truncate` on user-visible text fields** — always use `DescriptionCell` so tap/hover expansion works on all devices.

Pages using DescriptionCell: Inflows, Outflows, BankLedger, CategoryLedger, IntraFlow, BankDeposits, ForeignCurrency, Categories, ReversalTransactions, IntraBankTransfers, RefundTransactions, ChangeLog.

---

## Mobile Horizontal Scrolling

Tables must be inside an `overflow-x-auto` container. Two patterns:

1. **Standard** (most pages): `<div className="overflow-x-auto"><table ...>`
2. **Rounded-card** (CategoryLedger, PercentageAllocations, SpecificGivings, SavingsPortions, Setup tabs): `<div className="... rounded-xl overflow-x-auto">`

**Never use `overflow-hidden` alone** on a table container — clips without allowing scroll, breaking mobile.

## Horizontal Overflow Containment

- **`<main>` in `Layout.tsx`** carries `overflow-x-hidden` — systemic backstop that prevents any child overflow from causing page-level horizontal scroll. Do not remove it.
- **Tab nav bars** (e.g. Setup): the border-b wrapper must include `overflow-x-auto` when tabs are `whitespace-nowrap` and may exceed viewport on mobile. Pattern: `<div className="border-b border-gray-200 overflow-x-auto"><nav className="-mb-px flex gap-x">`.
- **Segmented controls / pill tab bars** using `w-fit overflow-x-auto`: always pair with `max-w-full` so the viewport constraint is respected and scroll can engage. Pattern: `className="flex ... w-fit max-w-full overflow-x-auto"`.
- **`-mx-N px-N` negative-margin tab rows**: safe only when `<main>`'s `overflow-x-hidden` backstop is in place — do not pair with a parent that has `overflow: visible`.

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

Toast container uses `.toast-safe-bottom` (CSS var `--tab-bar-height: 64px`) on mobile so it never overlaps the bottom tab bar. On `md:` and above it reverts to `bottom-5`.

---

## Modal Sizing & Behaviour

`Modal.tsx` accepts a `size` prop: `max-w-sm | max-w-md | max-w-lg | max-w-xl | max-w-2xl`

- **Mobile full-screen:** below `sm` the panel fills the viewport (`h-full`, no border-radius). Centred card layout at `sm`+.
- **`footer` prop:** pass action buttons here — rendered in a sticky strip below the scrollable body, always visible regardless of form length. Give the `<form>` an `id` and use `form={id}` on the submit button.
- **`isDirty` prop:** when `true`, ESC / backdrop / × show a "Discard changes?" overlay instead of closing immediately. Cancel buttons inside the form bypass this guard (explicit intent).
  - react-hook-form modals: pass `formState.isDirty`
  - Controlled-state modals: snapshot initial values in a `useRef` on open and compare
- **Focus trap:** Tab/Shift+Tab are trapped within the modal panel while open. Focus moves to the first focusable element on open; returns to the triggering element on close. No manual focus management needed in individual modals.

---

## Infrastructure / Schema Error Display

Never show raw SQL, migration instructions, or PostgREST/Supabase terminology in the normal workflow UI.

- Wrap technical details in `<TechDetails>` (`src/components/ui/TechDetails.tsx`) — collapsed by default
- User-facing copy pattern: *"We couldn't complete this action right now. Please try again."*
- Admin setup required: *"This feature requires a one-time setup. Ask your administrator to enable it."*
- Keep all existing retry logic, schema checks, and Re-check buttons intact — only the display changes

`TechDetails` usage:
```tsx
import { TechDetails } from '../ui/TechDetails'

<TechDetails>{MIGRATION_SQL}</TechDetails>
// or
<TechDetails>{`NOTIFY pgrst, 'reload schema';`}</TechDetails>
```

---

## Sidebar Navigation

Collapsible groups; state persisted in `localStorage` under key `nav-group-<id>`.

| Group (`id`) | Default | Items |
|---|---|---|
| Daily Finance (`daily`) | open | Dashboard, Inflows, Outflows, Import, Receipts |
| Banking (`banking`) | open | Bank Ledger, Bank Deposits, Intrabank Transfers, Intra-Account Flows, Foreign Currency |
| Review & Processing (`review`) | open | Pending Deductions, Refunds, Reversals |
| Budget & Allocation (`budget`) | open | Categories, Category Ledger, Percentage Allocations, Specific Givings, Savings Portions |
| Reports (`reports`) | **closed** | Reports, Financial Report |
| Administration (`admin`) | **closed** | Setup, Settings, User Management†, Change Log† |

† `adminOnly: true` — filtered out for non-admin users. All other items visible to all authenticated users.

**Active-state layout shift fix:** All nav items carry `border-l-2 pl-[10px] pr-3` at all times. Active → `border-accent bg-white/15 text-white`; inactive → `border-transparent text-white/70`. Padding never changes, eliminating layout shift.

**Icon assignments (semantic):** `PiggyBank` → Savings Portions, `Hourglass` → Pending Deductions, `HandCoins` → Specific Givings, `Repeat2` → Intra-Account Flows, `ArrowRightLeft` → Intrabank Transfers, `FileUp` → Import, `Receipt` → Receipts.

**Mobile bottom bar (BottomTabBar):** Primary tabs — Home, Inflows, Outflows, Import, More. More drawer shows all remaining items grouped by the same sections (2-col grid per section, section headers, `border-l-2` active indicator, `min-h-[48px]` tap targets, `aria-expanded` on More button). Drawer is scrollable with `max-h-[75vh]`.

**TopBar:** App title (`"Church Finance"`) is a `NavLink` to `/`. Role badge is always visible (not hidden on mobile).

---

## Dashboard Layout

Section order (top → bottom):
1. **Welcome + Quick Actions** — greeting left, `<CanWrite>` action buttons right; always first
2. **KPI stat cards** — 4-col grid
3. **Monthly chart** — full-width area chart
4. **Recent Transactions** — last 10 inflows
5. **Foreign Currency** — compact single Card with 4-col internal grid (not 4 separate Cards)

Quick action button hierarchy:
- **Add Inflow** — `bg-success text-white` (primary)
- **Add Outflow** — `bg-white border border-gray-200 text-gray-700` (secondary)
- **Import** — `bg-white border border-gray-200 text-gray-500` (utility)

**Do not** place Quick Actions at the bottom of the dashboard. **Do not** use a separate section heading for them.

**FX strip**: single `<Card>` with `grid grid-cols-2 sm:grid-cols-4` inside — not 4 individual Card components. Empty currencies use `opacity-40`.

---

## StatCard (`src/components/ui/StatCard.tsx`)

- Label: `text-xs font-medium text-gray-400 uppercase tracking-wide` — intentionally small/quiet
- Value: `text-2xl font-bold text-gray-900` — intentionally dominant
- Trend: `text-xs font-medium` (was `text-sm`) — kept subordinate to value
- Icon container: `p-2.5 rounded-lg` (was `p-3 rounded-xl`)

---

## Settings Page (`src/pages/Settings.tsx`)

Section order: Profile → Password → **Theme** → App Information  
(App Information is the least user-relevant section; always last.)

---

## Setup Page Tabs (`src/pages/Setup.tsx`)

- **General** — org name, accounting year
- **Banks** — list/add/edit/delete banks (multi-row starting balance allocation)
- **Allocation** — allocation configs (draft/lock workflow)
- **Special Configs** — group-based UI; each group shows active version (effective dates, type, status) + "Create New Version" button + expandable version history table; "Create New Group" at top; uses `useSpecialConfigGroups()` hook
- **Income Types** — user-defined inflow labels with keyword/stage-code rules
- **Currencies** — add/remove currencies (code, name, symbol, flag emoji); shows migration SQL

**Database tab removed from primary nav.** Migration SQL is now inside the **Developer Tools** collapsible section below the tab content (collapsed by default). `devToolsOpen` state controls visibility. Do not re-add Database as a primary tab — it is infrastructure tooling, not operational config.

## Developer Tools Pattern (Setup page)

Low-emphasis collapsible section below the main tab content, above Danger Zone. Pattern:
```tsx
<div className="border border-gray-200 rounded-xl overflow-hidden">
  <button onClick={() => setDevToolsOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-4 ...">
    <Terminal w-4 h-4 text-gray-400 /> + title "Developer Tools" (text-gray-500) + subtitle (text-gray-400)
    <ChevronDown rotates 180° when open />
  </button>
  {devToolsOpen && <div className="border-t border-gray-100 p-5"><DatabaseTab /></div>}
</div>
```
- `DatabaseTab` component is preserved intact; only its entry point changed
- idempotent migration SQL: `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
- Copy button wired to `navigator.clipboard.writeText(MIGRATION_SQL)`
- Use this pattern for any future infrastructure/admin-only tools that should not dominate the primary UI

---

## ReceiptBadge Upload Behaviour

- `inputRef` resets `input.value = ''` after each upload batch — allows re-selecting the same file
- **FileList is live** — snapshot `Array.from(files)` and `files.length` into local vars before the `try/finally` block; resetting `input.value` clears the live FileList, corrupting any count read after the reset
- Failure toast includes the real backend error message (storage or DB); full failure → `"Upload failed: <error>"`; partial → `"N of M file(s) failed: <error>"`
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
| Right-aligned monetary `<td>` | `src/components/ui/AmountCell.tsx` |

---

## Table Standards

**Header row:** always `bg-gray-50 border-b border-gray-100` on `<thead> <tr>`. Dark variant: `dark:bg-gray-800/50 dark:border-gray-700`.

**Body dividers:** `divide-y divide-gray-100` (not `divide-gray-50`). Dark: `dark:divide-gray-700/50`.

**Numeric column headers:** use `text-right` for all financial amount columns. Text/label columns use `text-left`.

**Amount cells:** use `<AmountCell>` (`src/components/ui/AmountCell.tsx`) — a drop-in `<td>` with `text-right font-mono font-semibold whitespace-nowrap` defaults.
- `mode="inflow"` → `text-success` (green)
- `mode="outflow"` → `text-danger` (red)
- `mode="balance"` → `text-gray-900` positive / `text-danger` negative; use `showZero` for running totals
- `mode="neutral"` (default) → `text-danger` for negative, `text-gray-800` for positive
- Zero value shows `—` unless `showZero={true}`
- `amountColorCls(value, mode)` exported for use outside a `<td>`

**Empty states in tables:** use `<EmptyState compact>` inside `<td colSpan={n}>` — do NOT write inline `<div className="flex flex-col items-center ...">` inside table cells.

**DataTable component (`src/components/ui/DataTable.tsx`):** generic table with these standards built in. `Column.rightAlign?: boolean` controls header alignment.

---

## Shared Form Primitives

All form modals must use these shared components — do NOT define local copies.

### `Field` + `inputCls` + `filterInputCls` (`src/components/ui/FormField.tsx`)

```tsx
import { Field, inputCls, filterInputCls } from '../ui/FormField'

// Modal form fields with error support:
<Field label="Date *" error={errors.date?.message}>
  <input type="date" {...register('date')} className={inputCls(!!errors.date)} />
</Field>

// Filter/search inputs without error states:
<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={filterInputCls} />
<input type="text" placeholder="Search…" className={`${filterInputCls} pl-9`} />
```

- `Field` renders label (`text-xs font-medium text-gray-600`) + children + optional red error text
- Automatically injects `id`, `aria-invalid`, `aria-describedby` onto the first child element via `React.cloneElement` + `useId` — no manual aria wiring needed in modals
- Error message rendered with `role="alert"` so screen readers announce it on appearance
- `inputCls(hasError)` — for form modal fields; includes `min-h-[44px]` and error border state
- `filterInputCls` — plain string constant for filter/search inputs; no error state; same visual appearance
- **Never define local `inputCls` or `filterInputCls` duplicates in page files** — import from FormField
- `error` prop is optional — omit when no validation message needed

### `ButtonSpinner` (`src/components/ui/ButtonSpinner.tsx`)

```tsx
import { ButtonSpinner } from '../ui/ButtonSpinner'

<button disabled={loading} className="… flex items-center gap-2">
  {loading && <ButtonSpinner />}
  {loading ? 'Saving…' : 'Save'}
</button>
```

### `CollapsibleSection` (`src/components/ui/CollapsibleSection.tsx`)

```tsx
import { CollapsibleSection } from '../ui/CollapsibleSection'

<CollapsibleSection label="FX Details (amount & rate)">
  {/* content rendered inside p-4 space-y-4 container */}
</CollapsibleSection>
```

- State is internal; resets automatically on modal close (Modal unmounts on `open=false`)
- `defaultOpen?: boolean` — defaults to `false`
- Chevron rotates 180° when open (CSS `transition-transform duration-200`)
- Renders `aria-expanded` + `aria-controls` on the trigger button automatically
- Use for: FX sections, advanced config, optional settings, expandable helper content

### `ViewToggle` + `useViewToggle` (`src/components/ui/ViewToggle.tsx`)

Wired on Inflows (`inflows-view`) and Outflows (`outflows-view`). Use the same pattern for any new list page.

```tsx
import { ViewToggle, useViewToggle } from '../ui/ViewToggle'

const { view, setView } = useViewToggle('my-page-view')

<ViewToggle storageKey="my-page-view" value={view} onChange={setView} />
```

- Renders labeled `[ Table ] [ Cards ]` segmented control (not icon-only) — **never use icon-only toggle buttons**
- Desktop default = `table`, mobile default = `cards` (via `matchMedia('(min-width: 768px)')`)
- User override persists in `localStorage` under `storageKey`
- Container has `role="group" aria-label="View mode"`; each button has `aria-pressed`
- **Do NOT apply to:** financial reports, allocation admin screens, dense config tables
- **Placement:** always in a results toolbar row immediately above the cards/table section — NOT in the page header. Pattern: `<div className="flex items-center justify-between">` with result count left and `<ViewToggle>` right. Export/action buttons remain in the page header.

---

## Receipts Folder Navigation (responsive)

- Mobile (`< md`): horizontal scrollable pill tabs — `flex overflow-x-auto gap-2 md:hidden`
- Desktop (`md+`): `hidden md:block w-52 shrink-0` sidebar — same `folder` state drives both
- **Never use a fixed-width sidebar without a mobile fallback** — `w-52 shrink-0` alone forces horizontal page scroll on narrow screens

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

## Inflows Table — Column Order

Checkbox, Expand-chevron, Date, Recorded, **Bank**, **Txn Ref**, Type, Description, Amount (₦), Actions (10 total).

- `bank_name` → Bank column after Recorded
- `transaction_ref` → Txn Ref column after Bank
- Type column shows income type badge + transaction type badge (stacked `flex-col`); fallback `—` when both null
- Expanded remark row uses `colSpan={10}`

---

## Outflows Table — Column Order

Checkbox, Date, Recorded, **Bank**, Txn ID, Description, Disbursed (₦), Refunded (₦), Net (₦), Stage Code 1, Remarks, 📎, Actions (13 total).

- `transfer_charge` is **not shown** as a column but is still deducted in the Net (₦) calculation
- `bank_name` is displayed as the **Bank** column, positioned after Recorded

---

## Outflow — Removed Fields (all entry points)

The **Optional Banking Details** section (`amount_refunded`, `transfer_charge`) has been fully removed from all outflow entry points:
- `AddOutflowModal.tsx` — removed from Zod schema, `resetForm` defaults, and both update/add submit payloads
- `Import.tsx` manual outflow entry — removed from UI block and submit payload
- Nothing is sent to the backend for these fields from any entry point
- `fx_currency` is absent from the UI but kept in `AddOutflowInput` (optional) for backward compat with existing records
- The **FX Details** collapsible (fx_amount, fx_rate) remains in both entry points

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
- colSpan for loading/empty/expanded rows must equal total column count (10 for Inflows, 13 for Outflows)
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

---

## Finalized Design System Standards (Phase 7 Audit)

### Page Container Rhythm

- Top-level page `div`: `space-y-5` (standard) or `space-y-6` for dashboard-style pages
- Page header layout: `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`
- Heading: `text-2xl font-bold text-gray-900`
- Subheading: `text-sm text-gray-500 mt-0.5`

### Table Standards

- `<thead> <tr>`: always `bg-gray-50 border-b border-gray-100`
- `<tbody>`: always `divide-y divide-gray-100` (never `divide-gray-50`)
- Dark variants: `dark:bg-gray-800/50 dark:border-gray-700` on thead, `dark:divide-gray-700/50` on tbody

### Empty States

- Table empty cell: `<td colSpan={n}><EmptyState icon={X} title="…" compact /></td>`
- Full-page empty: `<EmptyState icon={X} title="…" message="…" />` (non-compact)
- Chart empty: `<ChartEmpty message="…" />` wrapped in a height-constrained div
- **Never** use inline `<div className="flex flex-col items-center …">` for empty states

### Summary Strip Grids (responsive)

- 3-item strips: `grid-cols-1 sm:grid-cols-3 gap-3`
- 4-item strips: `grid-cols-2 sm:grid-cols-4 gap-3`
- **Never** use bare `grid-cols-3` or `grid-cols-4` without a mobile breakpoint — causes overflow on small screens
- Card divs must have `min-w-0 overflow-hidden` to allow grid overflow containment
- Value text: `text-sm font-bold tabular-nums` — prevents overflow at narrow widths; `tabular-nums` ensures consistent digit width
- Label text: `truncate` to prevent overflow on long labels
- **Mixed-span pattern** (when one card is conceptually wider): `grid-cols-2 sm:grid-cols-3` with primary card as `col-span-2 sm:col-span-1` — full-width on mobile, equal column on sm+. Used in CategoryLedger ledger summary strip.

### StatCard Value Sizing

- Value: `text-xl sm:text-2xl font-bold tabular-nums` — responsive scaling prevents overflow on small screens while preserving hierarchy at wider widths

### Card View Date Metadata

- Always use `formatDate(row.date)` for dates in card views — single-line format (`"17 May 2026"`) consistent across all pages (Inflows, Outflows, BankLedger, CategoryLedger, etc.)
- Do NOT stack date across two lines — creates visual inconsistency with pages that use `formatDate`

### Dark Mode Status

Dark mode class application (`darkMode: 'class'`) is configured but UI coverage is limited to `FinancialReport.tsx` and a few layout components. Pages and shared UI components are light-mode only. Full dark mode is a future project, not incremental page patches.

### Icon Size Conventions

| Context | Size |
|---|---|
| Inline text / table cell | `w-4 h-4` |
| Button / nav item | `w-4 h-4` or `w-5 h-5` |
| Page heading decoration | `w-6 h-6` |
| Error / alert state | `w-10 h-10` |
| Empty state (via EmptyState component) | `w-7 h-7` (managed by component) |

---

## Mobile Card View Pattern (CategoryLedger)

Vertical stacked layout — **not** horizontal flex. All ledger card views must follow this structure:

```
┌───────────────────────────────────┐
│  Date label (text-[11px] gray-400)│
│  Description (DescriptionCell)    │
│  ─────────────────────────────────│
│  bg-gray-50/40 metrics footer:    │
│  INFLOW/OUTFLOW  │  BALANCE        │
│  (label above value, 2-col grid)  │
└───────────────────────────────────┘
```

- **Header**: date at top (`text-[11px] font-semibold text-gray-400`), description below via `DescriptionCell`
- **Metrics footer**: `grid grid-cols-2 border-t bg-gray-50/40 px-4 py-3` — label (`text-[10px] uppercase tracking-wide font-semibold`) sits above value (`text-sm font-mono font-bold tabular-nums`)
- **Amount column**: show whichever of inflow/outflow is non-zero; label reads "Inflow" or "Outflow" accordingly — avoids 3-col squeeze on 320px screens
- **Card surface**: `rounded-xl border shadow-sm overflow-hidden bg-white border-gray-200`
- **B/F row**: `bg-blue-50/60 border-blue-200`; label shows "Balance B/F"; amount label shows "B/F Amount"; description rendered as plain `<p>` (not DescriptionCell)
- **Toggle placement**: Table/Cards toggle lives in a toolbar row **directly above** the card/table content, paired with a transaction count (`{n} transaction{s}`). Never in the top page controls row.
- **`space-y-3`** between cards (not `space-y-2`)
- All card item IDs prefixed `card-${row.id}` to avoid collision with table-view DescriptionCell IDs
