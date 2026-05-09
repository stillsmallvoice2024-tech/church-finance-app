# Church Finance App — Claude Context

**App:** Multi-user church finance SPA. Tracks inflows, outflows, banks, FX, budget allocations, categories, special projects, receipts.
**Repo:** `stillsmallvoice2024-tech/church-finance-app` | **Branch:** `main` | **Deploy:** Vercel

## Context Loading Rules

Load domain files only when relevant to the active task:
- Financial/ledger logic → `ledger-rules.md`
- UI/frontend conventions → `ui-rules.md`
- Import behavior → `import-rules.md`
- History/debugging/edge cases → `miscellaneous.md` (**do not load unless explicitly needed**)

**Maintenance rule:** Keep this file minimal. Classify new information into the correct domain file. Move verbose/historical notes to `miscellaneous.md`. Deduplicate aggressively.

---

## Memory Maintenance Rules

* CLAUDE.md must remain minimal, high-signal, and globally relevant only.
* Do not allow CLAUDE.md to become a documentation dump.

### Routing Rules

* Financial and ledger rules belong in `ledger-rules.md`
* UI/component conventions belong in `ui-rules.md`
* Import pipeline behavior belongs in `import-rules.md`
* Debugging history, edge cases, temporary notes, and experimental ideas belong in `miscellaneous.md`

### Context Discipline

* Load only files relevant to the active task
* Avoid project-wide reasoning unless explicitly requested
* Avoid loading `miscellaneous.md` unless necessary

### Growth Control

* If CLAUDE.md exceeds ~800 words, audit and move domain-specific content into supporting files
* Deduplicate aggressively across all memory files
* Prefer concise bullet points over verbose explanations

### Code Examples

* Never place large code examples in CLAUDE.md
* Keep implementation examples inside relevant domain files only

### Maintenance Behavior

Whenever updating project memory:

1. Classify information before saving
2. Store information in the narrowest relevant file
3. Keep startup context lightweight
4. Preserve information while minimizing active token usage

---

## Tech Stack

| Layer | Library |
|---|---|
| UI | React 18, React Router v6 |
| Language | TypeScript 5.6, strict mode |
| Styling | Tailwind CSS 3 (`darkMode: 'class'`) |
| Forms | react-hook-form + zod |
| State | Zustand stores |
| Backend | Supabase JS v2 (Postgres + Auth + Storage) |
| Charts | Recharts |
| File parsing | xlsx, pdfjs-dist |
| Icons | lucide-react |
| Build | Vite 6 |

---

## Commands

```bash
npm run dev          # dev server
npm run build        # production build + type-check
npm run typecheck    # tsc --noEmit
npm run lint         # eslint, zero warnings tolerance
```

**Always run `npm run build` after code changes to verify no TypeScript errors.**

---

## Env Variables (`.env.local`, not committed)

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Supabase client: `src/lib/supabase.ts` — single `supabase` export used everywhere.

---

## Project Structure

```
src/
├── App.tsx                   # Router + all routes
├── components/
│   ├── auth/                 # AuthGuard, LoginPage, RoleGates
│   ├── layout/               # Layout, Sidebar, TopBar, BottomTabBar
│   ├── modals/               # All add/edit form modals
│   └── ui/                   # Shared UI primitives
├── hooks/                    # Data fetching + all mutations
├── pages/                    # One file per route/page
├── store/                    # Zustand stores (auth, allocation, theme, toast, etc.)
├── types/                    # TypeScript types (index.ts, supabase.ts)
└── utils/                    # Formatters, helpers, parsers
supabase/
├── schema.sql                # Complete DDL — fresh install reference
└── seed.sql
```

---

## Database Schema (Key Tables)

All tables in `public` schema with RLS enabled.

| Table | Purpose |
|---|---|
| `profiles` | Extends auth.users; `full_name`, `username`, `role` |
| `categories` | Budget categories; `starting_balance`, `group_id`, `is_hidden` |
| `category_groups` | Groups categories for ledger display |
| `category_opening_balances` | Multi-portion opening balances; supersedes `categories.starting_balance` |
| `banks` | Bank accounts; `currency` (default NGN) |
| `currencies` | User-managed currency list; code PK, name, symbol, flag |
| `allocation_configs` | Budget split configs; `rows` JSONB, `status` draft/locked, `is_special`, `allocation_type` |
| `income_types` | Inflow labels; `color`, `special_config_id` |
| `income_type_rules` | Keyword/stage-code rules per income type |
| `inflow_transactions` | Money received; `bank_name` text, FX fields, `income_type_id`, `allocation_config_id` |
| `outflow_transactions` | Money paid out; `bank_name` text, FX fields, `is_pending_deduction` |
| `intra_flows` | Internal fund movements |
| `bank_deposits` | Physical cash deposits; `currency`, `fx_amount`, `fx_rate` |
| `intrabank_transfers` | Bank-to-bank transfers |
| `fx_transactions` | FX ledger; running balance per currency |
| `fx_conversions` | Links FX withdrawal → NGN inflow; `is_partial`, `exchange_rate` |
| `special_projects` | Named fundraising projects |
| `project_entries` | Entries per project |
| `receipts` | File attachments; `entity_type`, `entity_id` |
| `invitations` | Token-based invites; `token` UUID, `expires_at` |
| `audit_log` | Whole-record snapshots on INSERT/UPDATE/DELETE |
| `field_changes` | Per-field old/new on UPDATE; `user_id` FK → `profiles(id)` |

Helper RLS functions: `is_admin()`, `is_finance_user()`.

---

## Auth & Roles

- Three roles: `admin`, `accountant`, `viewer` — stored in `profiles.role`, shown as UI badges only.
- **All authenticated users have full read/write/delete access. No feature is role-restricted.**
- `useRole()` → `isAdmin()`, `canWrite()`, `canDelete()` all return `!!user` (not `!!role`).
- **Gate on `!!user`, not `!!role`** — `user` is set synchronously; `role` requires a fetchProfile round-trip that can fail.
- `<AdminOnly>` and `<CanWrite>` still exist in the tree but always pass through when signed in.

**Auth flows:**
- Login: email OR username (`resolveEmail()` in `LoginPage.tsx` maps username → email)
- Invite: `/invite/:token` → `AcceptInvite` validates token, calls signUp, sets profile
- Password reset: `/reset-password` listens for `PASSWORD_RECOVERY` auth event

**Public routes:** `/login`, `/reset-password`, `/invite/:token`. All others behind `<AuthGuard>`.

---

## Architecture Principles

- **All writes** go through `useMutations.ts`. Pattern: `const { mutate } = useAddInflow(); await mutate(input)`
- **All reads** via `use<Entity>.ts` hooks returning `{ data, loading, error, refetch }`. Mutations call `refetch` on success.
- **`bank_name` stored as text** (not FK). Must be set at insert time for the record to appear in BankLedger.
- **Every UPDATE** fetches old record first, then `logAudit()` (audit_log snapshot) + `logFieldChanges()` (field_changes diff).
- **Deletes** use `count: 'exact'`; throw if count === 0 to catch silent RLS denials.
- **Import is the sole entry point** for transaction creation. Inflows/Outflows pages are display-only (edit/delete only).
- **Special configs** (`is_special = true`) are never applied by date lookup — only via explicit `allocation_config_id` on the inflow.
- **Dynamic currencies** fall back to 5 defaults (NGN, USD, GBP, EUR, CNY) if `currencies` table is missing.

---

## Migration Strategy

- `supabase/schema.sql` = complete DDL for fresh installs (not auto-run against existing projects).
- Incremental patches live in `MIGRATION_SQL` constant in `Setup.tsx` (Database tab — run manually in Supabase SQL editor).
- New column/table → update **both** `schema.sql` AND `Setup.tsx`.
- FK refs in migration SQL: **no `public.` prefix** (Supabase resolves via search_path).
- `CREATE POLICY` has no `IF NOT EXISTS` — wrap in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
- To replace a policy: `DROP POLICY IF EXISTS` then `CREATE POLICY`.

---

## Deployment

- **Platform:** Vercel
- `vercel.json` — SPA rewrite (`*` → `index.html`) + security headers (X-Frame-Options: DENY, etc.)
- Build output: `dist/` — chunk size warning is expected, not an error
