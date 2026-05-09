# Church Finance App — Claude Context

## What This Is

A multi-user church finance management SPA for tracking inflows, outflows, bank accounts, FX holdings, budget allocations, categories, special projects, and receipts. Built with React + TypeScript + Vite, backed by Supabase (Postgres + Auth + Storage). Deployed to Vercel.

**Active dev branch:** `main`
**Repo:** `stillsmallvoice2024-tech/church-finance-app`

---

## Tech Stack

| Layer | Library |
|---|---|
| UI framework | React 18, React Router v6 |
| Language | TypeScript 5.6, strict mode |
| Styling | Tailwind CSS 3 (`darkMode: 'class'`) |
| Forms | react-hook-form + zod |
| State | Zustand stores |
| Backend | Supabase JS v2 (Postgres + Auth + Storage) |
| Charts | Recharts |
| File parsing | xlsx (spreadsheets), pdfjs-dist (bank statement PDFs) |
| Icons | lucide-react |
| Build | Vite 6 |
| Deploy | Vercel (SPA rewrites in `vercel.json`) |

---

## Commands

```bash
npm run dev          # start dev server
npm run build        # production build (also used to type-check)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint, zero warnings tolerance
npm run preview      # preview prod build locally
```

**Always run `npm run build` after code changes to verify no TypeScript errors.**

---

## Environment Variables

In `.env.local` (not committed):
```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Supabase client: `src/lib/supabase.ts` — single `supabase` export used everywhere.

---

## Project Structure

```
src/
├── App.tsx                    # Router, all routes
├── main.tsx
├── index.css
│
├── components/
│   ├── auth/
│   │   ├── AuthGuard.tsx      # Wraps all protected routes, provides RoleContext
│   │   ├── LoginPage.tsx      # Accepts email OR username; resolveEmail() queries profiles
│   │   └── RoleGates.tsx      # <AdminOnly>, <CanWrite> render-prop guards
│   ├── layout/
│   │   ├── Layout.tsx         # Shell with Sidebar + TopBar + <Outlet>
│   │   ├── Sidebar.tsx        # Nav groups: main, banking, allocations, admin
│   │   ├── TopBar.tsx
│   │   └── BottomTabBar.tsx   # Mobile nav
│   ├── modals/                # All add/edit forms live here as Modal wrappers
│   │   ├── AddInflowModal.tsx  # Includes Bank selector (stores bank_name); Stage Code 1 field kept for data entry but removed from Inflows list UI
│   │   ├── AddOutflowModal.tsx # Includes Bank selector (stores bank_name); outflows now propagate to BankLedger
│   │   ├── AddIntraFlowModal.tsx
│   │   ├── AddBankModal.tsx           # Multi-row starting-balance allocation builder
│   │   ├── AddFXModal.tsx             # Add FX transaction (deposit/withdrawal)
│   │   ├── AddFXConversionModal.tsx   # Convert FX → NGN (creates 3 linked records)
│   │   ├── AddIncomeTypeModal.tsx     # Income type with rules + colour + linked config; reloads special configs on open
│   │   ├── AddProjectEntryModal.tsx   # Special project entries (supports edit)
│   │   ├── AddSpecialProjectModal.tsx
│   │   ├── AllocationConfigModal.tsx
│   │   ├── CreateSpecialConfigModal.tsx  # "Save as Draft" + "Save & Lock" buttons
│   │   ├── ImportModal.tsx            # 4-step Excel/PDF import wizard; sets bank_name from selected bank prop; exports detectHeaderRow()
│   │   └── ResetDataModal.tsx
│   └── ui/
│       ├── Modal.tsx          # Base modal wrapper (size prop: max-w-sm/md/lg/xl/2xl)
│       ├── DeleteDialog.tsx   # Confirmation dialog
│       ├── Card.tsx           # Basic card wrapper (padding prop)
│       ├── ReceiptBadge.tsx   # Paperclip button with floating panel (smart above/below)
│       ├── Toast.tsx          # Toast notifications
│       └── ...                # Badge, DataTable, EmptyState, ErrorBoundary, etc.
│
├── hooks/
│   ├── useAuth.ts             # Sets up supabase.auth.onAuthStateChange listener; uses requestIdRef + AbortController per event to enforce request ownership; fetchProfile uses raw fetch with credentials: 'include'; window focus listener fires FOCUS_REVALIDATE; setLoading(false) guarded by requestId + signal in a finally block
│   ├── useRole.ts             # Returns { isAdmin, isAccountant, canWrite, canDelete } — isAdmin/canWrite/canDelete all return !!user (true for any authenticated user); role is read from store for display only
│   ├── useMutations.ts        # ALL write mutations (add/update/delete for every entity)
│   ├── useTransactions.ts     # useFetchInflows(), useFetchOutflows() with filters; InflowTransaction and OutflowTransaction both include bank_name
│   ├── useBanks.ts            # useBanks() → { banks: DbBank[], loading, error, refetch }
│   ├── useCategories.ts       # useCategories(), useCategoryGroups(), useCategoryOpeningBalances(); exports upsertCategoryOpeningBalance(), deleteCategoryOpeningBalance(), fetchCategoryOpeningBalances()
│   ├── useCurrencies.ts       # Dynamic currency list; falls back to 5 defaults if no DB table
│   ├── useFX.ts               # useFXTransactions(currency?) → { transactions, summaries }
│   ├── useFXConversions.ts    # useFXConversions(), useAddFXConversion()
│   ├── useIncomeTypes.ts      # useIncomeTypes(), useSpecialConfigOptions() (exposes reload()), etc.
│   ├── useSpecialProjects.ts
│   ├── useLedger.ts
│   ├── useAuditLog.ts         # Fetches audit_log; no role gate — accessible to all authenticated users
│   ├── useFieldChanges.ts     # Fetches field_changes; no role gate — accessible to all authenticated users
│   ├── useReceipts.ts
│   ├── useDashboard.ts
│   └── usePageTitle.ts        # Sets document.title
│
├── pages/
│   ├── Dashboard.tsx
│   ├── Inflows.tsx            # Display-only — table + card view, income type badges, tooltip/expand; no Add/import buttons (all creation via Import page)
│   ├── Outflows.tsx           # Display-only — table + card view, tooltip/expand; no Add/import buttons (all creation via Import page)
│   ├── Categories.tsx         # Table + card view; CategoryModal supports dynamic multi-portion opening balances
│   ├── ForeignCurrency.tsx    # Currency cards, rate calculator, conversion history
│   ├── BankDeposits.tsx       # Table + card view, FX tab, FX fields on modal
│   ├── BankLedger.tsx         # Queries inflow_transactions + outflow_transactions WHERE bank_name = ?
│   ├── IntraBankTransfers.tsx
│   ├── IntraFlow.tsx
│   ├── SpecialProjects.tsx    # Projects + entries; entries are editable
│   ├── Import.tsx             # 5-step wizard + ManualEntryForm; ManualEntryForm resolves bank_id → bank_name before saving
│   ├── Reports.tsx            # Summaries + income type breakdown + audit log tab (visible to all users)
│   ├── Setup.tsx              # Tabs: General | Banks | Allocation | Special Configs | Income Types | Currencies | Database
│   ├── UserManagement.tsx     # List users, invite, edit profile, change password (visible to all authenticated users)
│   ├── Settings.tsx           # Current user: profile, username, change password
│   ├── CategoryLedger.tsx     # Aggregate summary cards (% Allocated, Specific Seeds, Savings Net, Grand Total) + per-category ledger; reads category_opening_balances with old-field fallback; uses stored allocation_config_id per inflow for accurate percentage computation
│   ├── PercentageAllocations.tsx
│   ├── SpecificGivings.tsx    # Injects opening balances from category_opening_balances (Specific Seed) + old-field fallback
│   ├── SavingsPortions.tsx    # Reads Savings opening balances from category_opening_balances + old-field fallback
│   ├── PendingDeductions.tsx
│   ├── RefundTransactions.tsx
│   ├── ReversalTransactions.tsx
│   ├── ChangeLog.tsx          # Per-field change history; visible to all authenticated users
│   └── Receipts.tsx
│
├── store/
│   ├── authStore.ts           # { user, profile, role } — set by useAuth listener
│   ├── allocationStore.ts     # Zustand; holds all AllocationConfig[], fetched once
│   ├── accountingYearStore.ts # Selected accounting year
│   ├── accountCodesStore.ts   # Stage/account code lookups; fetched in App.tsx on boot
│   ├── financeStore.ts
│   ├── themeStore.ts          # dark/light; applies class to <html> as side effect on import
│   └── toastStore.ts          # push(message, type) to show Toast
│
├── types/
│   ├── index.ts               # UserRole, UserProfile, Currency, Transaction, etc.
│   └── supabase.ts            # Auto-generated Supabase types (may be outdated)
│
└── utils/
    ├── formatters.ts          # formatCurrency, formatDate, formatCurrencyCompact, etc.
    ├── csvExport.ts           # exportCSV(filename, headers, rows)
    ├── inflowTypes.ts         # Legacy InflowType enum + labels (mostly superseded by income_types)
    ├── classifyIncomeType.ts  # matchIncomeType() rule engine for auto-classifying inflows
    ├── constants.ts
    ├── accountNames.ts
    └── pdfParser.ts           # PDF bank statement parsing using pdfjs-dist

supabase/
├── schema.sql                 # Complete DDL for all tables — reference for fresh installs
└── seed.sql                   # Seed data
```

---

## Database Schema (Key Tables)

All tables in `public` schema with RLS enabled. See `supabase/schema.sql` for complete DDL.

| Table | Purpose |
|---|---|
| `profiles` | Extends `auth.users`; adds `full_name`, `username`, `role` |
| `categories` | Budget categories; `starting_balance`, `group_id`, `is_hidden` |
| `category_groups` | Groups categories for ledger display |
| `category_opening_balances` | Multi-portion opening balances per category; `UNIQUE(category_id, budget_portion)`; supersedes `categories.starting_balance` — consumers check this table first and fall back to old field |
| `banks` | Bank accounts; `currency` (any code, default NGN) |
| `currencies` | User-managed currency list; code PK, name, symbol, flag |
| `allocation_configs` | Budget split configs; `rows` JSONB, `status` draft/locked, `is_special` boolean, `allocation_type` percentage/amount |
| `income_types` | User-defined inflow labels; `color`, `special_config_id` |
| `income_type_rules` | Keyword/stage-code rules per income type |
| `inflow_transactions` | All money received; `bank_name` text, FX fields, `income_type_id`, `transaction_type`, `allocation_config_id` |
| `outflow_transactions` | All money paid out; `bank_name` text, FX fields, `is_pending_deduction` |
| `intra_flows` | Internal fund movements between accounts |
| `bank_deposits` | Physical cash deposited to bank; `currency`, `fx_amount`, `fx_rate` |
| `intrabank_transfers` | Transfers between bank accounts |
| `fx_transactions` | FX ledger; running balance per currency |
| `fx_conversions` | Links FX withdrawal → NGN inflow; `is_partial`, `exchange_rate` |
| `special_projects` | Named fundraising projects |
| `project_entries` | Entries (inflow/outflow) per project |
| `receipts` | File attachments; `entity_type` (inflow/outflow/bank_deposit), `entity_id` |
| `invitations` | Token-based user invitations; `token` UUID, `expires_at` |
| `audit_log` | Whole-record snapshots on INSERT/UPDATE/DELETE |
| `field_changes` | Per-field old/new values on UPDATE (written by `logFieldChanges()`); `user_id` FK references `public.profiles(id)` so PostgREST can join profiles |

**Helper functions:** `is_admin()`, `is_finance_user()` — used in RLS policies.

---

## Auth & Roles

Three roles stored in `profiles.role`: `admin`, `accountant`, `viewer`. Role labels are preserved in the DB and shown as badges in the UI, but the **application no longer restricts any feature by role** — all authenticated users have full read/write/delete access to every page and action.

`useRole()` in `src/hooks/useRole.ts`:
```ts
const { isAdmin, canWrite, canDelete } = useRole()
// isAdmin()   → !!user  (true for any signed-in user)
// canWrite()  → !!user
// canDelete() → !!user
```

**Important:** `canWrite`/`canDelete`/`isAdmin` gate on `!!user` (set synchronously at the start of every auth event), **not** `!!role` (which requires a successful `fetchProfile` round-trip). If `fetchProfile` fails or returns null, `user` is still set and buttons remain visible. Using `!!role` caused edit/delete buttons to be hidden for any user whose profile fetch failed.

`<AdminOnly>` (RoleGates.tsx) and `<CanWrite>` gates still exist in the component tree but pass through for all authenticated users since `isAdmin()` always returns true when signed in.

> **DB note:** Supabase RLS DELETE policies previously enforced `is_admin()`. The migration SQL in Setup → Database tab updates all three DELETE policies (`inflow_delete`, `outflow_delete`, `intraflow_delete`) to `auth.uid() IS NOT NULL`. **Run this migration in your Supabase SQL editor to enable deletes for all authenticated users.** Without it, deletes silently succeed on the client (no error returned) but no rows are actually removed — `useDeleteTransaction` now detects this via `count: 'exact'` and throws a descriptive error.

**Login:** Accepts email or username. `resolveEmail()` in `LoginPage.tsx` queries `profiles.username` to map a username to email, then calls `supabase.auth.signInWithPassword`.

**Invite flow:** Any user generates token → copyable link `/invite/:token` → `AcceptInvite` page validates token, calls `signUp`, sets profile name/username/role, marks invitation `accepted`.

**Password reset:** `/reset-password` page listens for `PASSWORD_RECOVERY` auth event, then calls `supabase.auth.updateUser({ password })`.

**Background-tab resilience (request ownership model):** `useAuth.ts` uses a monotonically increasing `requestIdRef` (useRef) and an `AbortController` ref (`controllerRef`) to enforce strict request ownership. Every auth event — including a synthetic `FOCUS_REVALIDATE` fired by a `window focus` listener — increments `requestId`, aborts the previous controller, and creates a new one. State updates (profile, setLoading) only run when `requestIdRef.current === requestId && mounted && !signal.aborted`. `fetchProfile` uses a raw `fetch` with `credentials: 'include'` and the session Bearer token. All lifecycle transitions are logged with `[auth:N]` prefixes for tracing races.

---

## Key Patterns

### Mutations (`src/hooks/useMutations.ts`)
All writes go through hooks in `useMutations.ts`. Pattern:

```ts
const { mutate, loading, error } = useAddInflow()
await mutate(input)  // throws on error
```

Every UPDATE hook:
1. Fetches the old record first
2. Calls `logAudit()` — whole-record snapshot to `audit_log`
3. Calls `logFieldChanges()` — per-field diff to `field_changes`

`useDeleteTransaction(table)` accepts `'inflow_transactions' | 'outflow_transactions' | 'intra_flows'`. Any signed-in user can delete; no client-side role check. Uses `delete({ count: 'exact' })` and throws if `count === 0` — this catches silent Supabase RLS denials (PostgREST returns no error when a DELETE is blocked by RLS, just deletes 0 rows).

### Reading data
Each entity has its own `use<Entity>.ts` hook that fetches from Supabase. Hooks return `{ data, loading, error, refetch }`. Mutations call `refetch` on success.

### Bank Ledger Propagation
`BankLedger.tsx` queries `inflow_transactions` and `outflow_transactions` filtered by `bank_name`. For a transaction to appear in the bank ledger, `bank_name` must be set at insert time.

- **`AddInflowModal`** — has a Bank selector dropdown; stores the bank's `name` (not `id`) as `bank_name`
- **`AddOutflowModal`** — has a Bank selector dropdown (added this session); stores `bank_name` on both add and edit; outflows now appear in BankLedger
- **`Import.tsx` ManualEntryForm** — `doSaveInflow` and `doSaveOutflow` both resolve the selected `bank_id` to `bank_name` before calling the mutation
- **`ImportModal.tsx` batch wizard** — sets `bank_name` from the `bank` prop passed from `Import.tsx` (the bank selected on the import page before opening the wizard)

Both `AddInflowInput` and `AddOutflowInput` in `useMutations.ts` include `bank_name?: string`. `OutflowTransaction` type in `useTransactions.ts` includes `bank_name: string | null`.

> **Note:** Existing outflows saved before the bank selector was added have `bank_name = NULL` and will not appear in BankLedger. Edit and re-save them to assign a bank, or update them directly in Supabase.

### Special Configs (`allocation_configs` where `is_special = true`)
- Created and managed via `CreateSpecialConfigModal` — two save modes: **Save as Draft** and **Save & Lock**
- `SpecialConfigsTab` in Setup shows status badge (Draft/Locked) and lock/unlock controls mirroring the `AllocationTab` pattern
- Locked configs are immutable; unlock via the "Unlock & Edit" or "Create a Copy" dialog
- Linked to income types via `income_types.special_config_id`; auto-applied to inflow transactions when that income type is selected
- `useSpecialConfigOptions()` exposes a `reload()` function; `AddIncomeTypeModal` calls it on open to ensure newly created configs appear immediately

### Allocation Config (regular)
`allocationStore` holds all configs (fetched once on first use). `getConfigForDate(configs, date)` returns the most recent locked, **non-special** config whose `start_date` ≤ the target date. Special configs (`is_special = true`) are explicitly excluded so they never shadow the date-based general config. Draft configs are never applied.

### Category Ledger (`CategoryLedger.tsx`)
Summary view shows 4 aggregate cards at the top (computed from all unfiltered rows):
- **% Allocated** — total NGN allocated via percentage configs
- **Specific Seeds** — total Specific Seed portion
- **Savings Net** — net savings (in − out)
- **Grand Total** — sum of all three

Ledger view shows per-transaction rows for a selected category + portion, with "Balance Brought Forward" prepended from `category_opening_balances`.

**Allocation computation:** Both `loadSummary` and `loadLedger` fetch `allocation_config_id` on each inflow. Per-inflow config resolution:
1. If the inflow has `allocation_config_id` set, look up that specific config (handles special configs correctly)
2. Otherwise fall back to `getConfigForDate(configs, inflow.date)`

This ensures inflows tagged with a special config (e.g. Easter offering) use that config's percentages in the ledger rather than the date-based general config.

### Category Opening Balances
Multi-portion opening balances are stored in `category_opening_balances` (one row per category per budget portion). The `CategoryModal` in `Categories.tsx` renders a dynamic add/remove rows section and pre-populates from the new table on edit (or migrates from the legacy `categories.starting_balance` field if no new-table rows exist yet).

Consumers that read opening balances (`CategoryLedger`, `SavingsPortions`, `SpecificGivings`) always query `category_opening_balances` first and fall back to `categories.starting_balance` for categories not yet migrated. Helper functions in `useCategories.ts`: `upsertCategoryOpeningBalance()`, `deleteCategoryOpeningBalance()`, `fetchCategoryOpeningBalances()`.

### Specific Givings (`SpecificGivings.tsx`)
Queries `inflow_transactions` where `stage_code_2 = 'Specific Seed'` filtered by accounting year. Also injects synthetic "Opening Balance" rows from `category_opening_balances` (Specific Seed portion) regardless of year filter.

### FX Conversion (3-step atomic insert)
`useAddFXConversion()` in `useFXConversions.ts` creates three records sequentially:
1. `fx_transactions` withdrawal (computes new running balance from last row)
2. `inflow_transactions` NGN inflow
3. `fx_conversions` link record with both IDs

No true DB transaction — if step 2 fails, step 1 is committed. Acceptable trade-off.

### Dynamic Currencies
`useCurrencies()` fetches from the `currencies` table. Falls back to 5 defaults (NGN, USD, GBP, EUR, CNY) silently when the table doesn't exist. Used by: AddFXModal, AddFXConversionModal, AddBankModal, ForeignCurrency page. Managed in Setup → Currencies tab.

### Import Wizard (`Import.tsx`)
Multi-step flow: upload file → parse → map columns → configure rows (allocation config, income type, FX fields per row) → bulk insert. Handles both Excel (xlsx) and PDF bank statements (pdfjs-dist). Also has a `ManualEntryForm` for single-transaction entry that resolves `bank_id` to `bank_name` before saving.

**Import is the sole entry point for all transaction creation** (bulk and manual). The Inflows and Outflows pages are display-only — no Add buttons, no import triggers. Edit and delete remain available on both pages. All records propagate to those pages via their normal data-fetch hooks.

**Header detection (`detectHeaderRow`):** Exported from `ImportModal.tsx` and used by both the modal and `Import.tsx`'s pre-modal duplicate check. Scans the first 15 rows, scores each by counting cell values that match known field aliases (date, description, credit, debit, balance, reference, etc.), and returns the index of the best-scoring row (minimum 2 alias matches). Falls back to row 0. Both parse paths must use this function — hardcoding `rows[0]` causes wrong row counts, missing column detection, and broken duplicate IDs for statements with title/metadata rows above the actual headers.

**Continuation row merging (`ImportModal.tsx`, bank statement mode):** Some bank statement Excel files split a single transaction across two rows — the narration or reference overflows into the next row, which has no date and no amount. Before the main processing loop, a shallow copy of the sheet rows (`mergedRows`) is built. A pre-pass scans each row: if it has no valid date, no credit, and no debit, but has non-empty description or reference text, it is a continuation row — its text is appended (space-separated) to the nearest preceding row that has a valid date. The main loop then iterates `mergedRows`; continuation rows are still skipped (no date), but the primary row now carries the complete merged text. Row indices are preserved so per-row UI state (income type, stage codes, allocation config) remains correct. Normal imports with no continuation rows are unaffected.

### Tailwind Colours
Custom semantic tokens in `tailwind.config.js`:
- `primary` / `primary-light` / `primary-dark` — deep blue (`#1E3A8A`)
- `success` — dark green (`#065F46`)
- `danger` — dark red (`#991B1B`)
- `accent` — amber (`#D97706`)
- `background` — light grey (`#F8FAFC`)

### Toast notifications
```ts
const { push } = useToastStore()
push('Saved successfully', 'success')  // types: success | error | info
```

---

## Sidebar Navigation

All nav items are visible to all authenticated users.

**Main nav:**
Dashboard, Inflows, Outflows, Categories, Special Projects, Foreign Currency, Intra-Account Flows, Import, Pending Deductions, Setup, Reports, Settings

**Banking:**
Bank Ledger, Bank Deposits, Intrabank Transfers, Refunds, Reversals, Receipts

**Allocations:**
Category Ledger, Percentage Allocations, Specific Givings, Savings Portions

**Admin:**
User Management, Change Log

---

## Setup Page Tabs

`src/pages/Setup.tsx` — tab bar with:
- **General** — org name, accounting year
- **Banks** — list/add/edit/delete banks (with multi-row starting balance allocation)
- **Allocation** — allocation configs (draft/lock workflow)
- **Special Configs** — special configs with status badges, lock/unlock controls, Save as Draft / Save & Lock from modal
- **Income Types** — user-defined inflow labels with keyword/stage-code recognition rules
- **Currencies** — add/remove currencies (code, name, symbol, flag emoji); shows migration SQL
- **Database** — migration SQL for adding columns/tables to existing Supabase projects; uses `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` pattern for idempotent policy creation

---

## Migration Strategy

`supabase/schema.sql` is the reference DDL for fresh installs — not run automatically against existing projects. For existing deployments, the Setup → Database tab contains incremental `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` SQL that users run manually in the Supabase SQL editor.

When a new column or table is needed, add the DDL to both:
1. `supabase/schema.sql` (complete state)
2. The `MIGRATION_SQL` constant in `Setup.tsx` (incremental patch)

**FK references in migration SQL must NOT use the `public.` schema prefix** (e.g. `REFERENCES categories(id)` not `REFERENCES public.categories(id)`) — Supabase's SQL editor resolves via search_path. **`CREATE POLICY` has no `IF NOT EXISTS` clause** — use `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` instead.

To **replace** an existing RLS policy, use `DROP POLICY IF EXISTS` (natively supported) then `CREATE POLICY`:
```sql
DROP POLICY IF EXISTS "inflow_delete" ON inflow_transactions;
CREATE POLICY "inflow_delete" ON inflow_transactions FOR DELETE USING (auth.uid() IS NOT NULL);
```

Some hooks detect "relation does not exist" errors and fall back to defaults (e.g. `useCurrencies`, `useCategoryOpeningBalances`).

---

## Known Propagation Gaps (not yet fixed)

These flows exist in the data model but are not fully wired in the UI — document here so future work can be scoped correctly:

| Gap | Detail |
|-----|--------|
| FX conversion NGN inflow missing `bank_name` | `useAddFXConversion` doesn't accept a bank; the created inflow won't appear in any bank ledger |
| Intrabank transfers invisible to BankLedger | `intrabank_transfers` records are not queried by BankLedger |
| Bank deposits invisible to BankLedger | `bank_deposits` records are not queried by BankLedger |
| FX inflow fields not synced to `fx_transactions` | Inflows with `fx_currency` set do NOT auto-create an `fx_transactions` row |
| Project entries not linked to transactions | `project_entries` amounts are a parallel ledger; not included in Reports or CategoryLedger totals |
| Dashboard doesn't react to deletes | `useDashboard` subscribes to Supabase INSERT events only; deleting a transaction won't update KPI cards until page reload |

---

## Public Routes

| Route | Page | Purpose |
|---|---|---|
| `/login` | `LoginPage` | Email or username login |
| `/reset-password` | `ResetPassword` | Supabase password recovery flow |
| `/invite/:token` | `AcceptInvite` | Token-based invite acceptance + signup |

All other routes are behind `<AuthGuard>`.

---

## Deployment

- **Platform:** Vercel
- **`vercel.json`:** SPA rewrite (`*` → `index.html`) + security headers (X-Frame-Options: DENY, etc.)
- **Build output:** `dist/` — single bundle ~1.7MB gzipped ~460KB (chunk size warning is expected, not an error)
