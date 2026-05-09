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

- **Main:** Dashboard, Inflows, Outflows, Categories, Special Projects, Foreign Currency, Intra-Account Flows, Import, Pending Deductions, Setup, Reports, Settings
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

## Page Architecture Conventions

- Pages are display-first; data fetching via `use<Entity>.ts` hook at the top of each page component
- `Inflows.tsx` and `Outflows.tsx` are **display-only** — no Add/import triggers; edit and delete remain
- Card view and table view are both present on most list pages (toggle between them)
- Income type badges shown on Inflows page
