# Church Finance App — Claude Context

## What This Is

A multi-user church finance management SPA for tracking inflows, outflows, bank accounts, FX holdings, budget allocations, categories, special projects, and receipts. Built with React + TypeScript + Vite, backed by Supabase (Postgres + Auth + Storage). Deployed to Vercel.

**Active dev branch:** `claude/setup-church-finance-app-qO7cG`
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
│   │   ├── AddInflowModal.tsx
│   │   ├── AddOutflowModal.tsx
│   │   ├── AddIntraFlowModal.tsx
│   │   ├── AddBankModal.tsx           # Multi-row starting-balance allocation builder
│   │   ├── AddFXModal.tsx             # Add FX transaction (deposit/withdrawal)
│   │   ├── AddFXConversionModal.tsx   # Convert FX → NGN (creates 3 linked records)
│   │   ├── AddIncomeTypeModal.tsx     # Income type with rules + colour + linked config
│   │   ├── AddProjectEntryModal.tsx   # Special project entries (supports edit)
│   │   ├── AddSpecialProjectModal.tsx
│   │   ├── AllocationConfigModal.tsx
│   │   ├── CreateSpecialConfigModal.tsx
│   │   ├── ImportModal.tsx            # 4-step Excel/PDF import wizard
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
│   ├── useAuth.ts             # Sets up supabase.auth.onAuthStateChange listener
│   ├── useRole.ts             # Returns { isAdmin, isAccountant, canWrite, canDelete }
│   ├── useMutations.ts        # ALL write mutations (add/update/delete for every entity)
│   ├── useTransactions.ts     # useFetchInflows(), useFetchOutflows() with filters
│   ├── useBanks.ts            # useBanks() → { banks: DbBank[], loading, error, refetch }
│   ├── useCategories.ts       # useCategories(), useCategoryGroups()
│   ├── useCurrencies.ts       # Dynamic currency list; falls back to 5 defaults if no DB table
│   ├── useFX.ts               # useFXTransactions(currency?) → { transactions, summaries }
│   ├── useFXConversions.ts    # useFXConversions(), useAddFXConversion()
│   ├── useIncomeTypes.ts      # useIncomeTypes(), useAddIncomeType(), etc.
│   ├── useSpecialProjects.ts
│   ├── useLedger.ts
│   ├── useAuditLog.ts
│   ├── useReceipts.ts
│   ├── useDashboard.ts
│   └── usePageTitle.ts        # Sets document.title
│
├── pages/
│   ├── Dashboard.tsx
│   ├── Inflows.tsx            # Table + card view, income type badges, tooltip/expand
│   ├── Outflows.tsx           # Table + card view, tooltip/expand
│   ├── Categories.tsx         # Table + card view, starting balance column
│   ├── ForeignCurrency.tsx    # Currency cards, rate calculator, conversion history
│   ├── BankDeposits.tsx       # Table + card view, FX tab, FX fields on modal
│   ├── BankLedger.tsx
│   ├── IntraBankTransfers.tsx
│   ├── IntraFlow.tsx
│   ├── SpecialProjects.tsx    # Projects + entries; entries are editable
│   ├── Import.tsx             # 5-step wizard + ManualEntryForm
│   ├── Reports.tsx            # Summaries + income type breakdown
│   ├── Setup.tsx              # Tabs: General | Banks | Allocation | Special Configs | Income Types | Currencies | Database
│   ├── UserManagement.tsx     # Admin: list users, invite, edit profile, change password
│   ├── Settings.tsx           # Current user: profile, username, change password
│   ├── CategoryLedger.tsx     # Per-category ledger with group headers + subtotals
│   ├── PercentageAllocations.tsx
│   ├── SpecificGivings.tsx
│   ├── SavingsPortions.tsx
│   ├── PendingDeductions.tsx
│   ├── RefundTransactions.tsx
│   ├── ReversalTransactions.tsx
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
| `banks` | Bank accounts; `currency` (any code, default NGN) |
| `currencies` | User-managed currency list; code PK, name, symbol, flag |
| `allocation_configs` | Budget split configs; `rows` JSONB, `status` draft/locked |
| `income_types` | User-defined inflow labels; `color`, `special_config_id` |
| `income_type_rules` | Keyword/stage-code rules per income type |
| `inflow_transactions` | All money received; FX fields, `income_type_id`, `transaction_type`, `allocation_config_id` |
| `outflow_transactions` | All money paid out; FX fields, `is_pending_deduction` |
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
| `field_changes` | Per-field old/new values on UPDATE (written by `logFieldChanges()`) |

**Helper functions:** `is_admin()`, `is_finance_user()` — used in RLS policies.

---

## Auth & Roles

Three roles: `admin`, `accountant`, `viewer`.

- `admin` — full read/write/delete; user management; setup
- `accountant` — read/write; no delete, no user management
- `viewer` — read only

Role is stored on `profiles.role`, surfaced via `useAuthStore` and `useRole()`:

```ts
const { isAdmin, canWrite, canDelete } = useRole()
```

**Login:** Accepts email or username. `resolveEmail()` in `LoginPage.tsx` queries `profiles.username` to map a username to email, then calls `supabase.auth.signInWithPassword`.

**Invite flow:** Admin generates token → copyable link `/invite/:token` → `AcceptInvite` page validates token, calls `signUp`, sets profile name/username/role, marks invitation `accepted`.

**Password reset:** `/reset-password` page listens for `PASSWORD_RECOVERY` auth event, then calls `supabase.auth.updateUser({ password })`.

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

### Reading data
Each entity has its own `use<Entity>.ts` hook that fetches from Supabase. Hooks return `{ data, loading, error, refetch }`. Mutations call `refetch` on success.

### FX Conversion (3-step atomic insert)
`useAddFXConversion()` in `useFXConversions.ts` creates three records sequentially:
1. `fx_transactions` withdrawal (computes new running balance from last row)
2. `inflow_transactions` NGN inflow
3. `fx_conversions` link record with both IDs

No true DB transaction — if step 2 fails, step 1 is committed. Acceptable trade-off.

### Dynamic Currencies
`useCurrencies()` fetches from the `currencies` table. Falls back to 5 defaults (NGN, USD, GBP, EUR, CNY) silently when the table doesn't exist. Used by: AddFXModal, AddFXConversionModal, AddBankModal, ForeignCurrency page. Managed in Setup → Currencies tab.

### Allocation Config
`allocationStore` holds all configs (fetched once on first use). `getConfigForDate(configs, date)` returns the config whose `start_date` is the most recent on-or-before the given date. Used to auto-assign an allocation config to inflow transactions.

### Import Wizard (`Import.tsx`)
Multi-step flow: upload file → parse → map columns → configure rows (allocation config, income type, FX fields per row) → bulk insert. Handles both Excel (xlsx) and PDF bank statements (pdfjs-dist). Also has a `ManualEntryForm` for single-transaction entry.

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

Four groups rendered by `Sidebar.tsx`:

**Main nav** (all roles):
Dashboard, Inflows, Outflows, Categories, Special Projects, Foreign Currency, Intra-Account Flows, Import, Pending Deductions, Setup, Reports, Settings

**Banking** (all roles):
Bank Ledger, Bank Deposits, Intrabank Transfers, Refunds, Reversals, Receipts

**Allocations** (all roles):
Category Ledger, Percentage Allocations, Specific Givings, Savings Portions

**Admin only:**
User Management

---

## Setup Page Tabs

`src/pages/Setup.tsx` — tab bar with:
- **General** — org name, accounting year
- **Banks** — list/add/edit/delete banks (with multi-row starting balance allocation)
- **Allocation** — allocation configs (draft/lock workflow)
- **Special Configs** — special (non-percentage) allocation configs
- **Income Types** — user-defined inflow labels with keyword/stage-code recognition rules
- **Currencies** — add/remove currencies (code, name, symbol, flag emoji); shows migration SQL
- **Database** — migration SQL for adding columns to existing Supabase projects

---

## Migration Strategy

`supabase/schema.sql` is the reference DDL for fresh installs — not run automatically against existing projects. For existing deployments, the Setup → Database tab contains incremental `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` SQL that users run manually in the Supabase SQL editor.

When a new column or table is needed, add the DDL to both:
1. `supabase/schema.sql` (complete state)
2. The `MIGRATION_SQL` constant in `Setup.tsx` (incremental patch)

Some hooks detect "relation does not exist" errors and fall back to defaults (e.g. `useCurrencies`).

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
