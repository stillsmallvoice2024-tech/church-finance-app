# Church Finance App — Claude Context

> **Always load and follow `token-mode.md` for every task in this project.**

**App:** Multi-user church finance SPA. Tracks inflows, outflows, banks, FX, budget allocations, categories, special projects, receipts.
**Repo:** `stillsmallvoice2024-tech/church-finance-app` | **Branch:** `main` | **Deploy:** Vercel (SPA rewrite via `vercel.json`)

## Context Loading Rules

Load domain files only when relevant to the active task:
- Financial/ledger logic → `ledger-rules.md`
- UI/frontend conventions → `ui-rules.md`
- Import pipeline → `import-rules.md`
- Auth, roles, invites, RLS → `auth-rules.md`
- DB schema, migrations, audit trail → `db-rules.md`
- History/debugging/edge cases → `miscellaneous.md` (**do not load unless explicitly needed**)
- Updating project memory → `m-maintenance.md`
- Scoping active domain context → `determine-domain.md`

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
npm test             # vitest unit tests (pure-logic utils; no DB required)
```

**Always run `npm run build` after code changes.**

---

## Env & Supabase Client

`.env.local` (not committed): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
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

## Global Architecture Principles

- **All writes** via `useMutations.ts`. Pattern: `const { mutate } = useAddInflow(); await mutate(input)`
- **All reads** via `use<Entity>.ts` hooks → `{ data, loading, error, refetch }`. Mutations call `refetch` on success.
- **`bank_name` is plain text** (not FK). Must be set at insert time — `NULL` = invisible to BankLedger.
- **`category_id` is the authoritative fund link; `stage_code_1` is a display snapshot.** Set both at insert time. Reads that group by fund must resolve `category_id` → the category's current name (`resolveFundName`) and fall back to `stage_code_1` only for pre-backfill rows. `intra_flows` uses `from_category_id`/`to_category_id` the same way; `allocation_configs.rows[].category_name` is still name-only (jsonb) and relies on the rename cascade.
- **Renames must cascade, deletes must be blocked when referenced** — always go through `src/utils/categoryReferences.ts` (`cascadeCategoryRename`, `countCategoryReferences`); never `UPDATE`/`DELETE` a category row directly.
- **Every UPDATE**: fetch old record → `logAudit()` (snapshot to `audit_log`) → `logFieldChanges()` (diff to `field_changes`).
- **Deletes** use `count: 'exact'`; throw if `count === 0` to catch silent RLS denials.
- **Import is sole transaction entry point.** Inflows/Outflows pages are display-only (edit/delete only).
- **Special configs** (`is_special = true`) applied only via explicit `allocation_config_id`, never by date lookup.
- **Dynamic currencies** fall back to 5 defaults (NGN, USD, GBP, EUR, CNY) if `currencies` table is missing.
- **Gate on `!!user`, not `!!role`** — `user` is synchronous; `role` requires a round-trip fetch that can fail.
